"""Módulos para obtener datos reales de diferentes fuentes."""
from __future__ import annotations

import html
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests

# Datos estáticos
HARVEST_SEASON_DATA: Dict[int, List[Dict[str, str]]] = {
    1: [  # Enero
        {"name": "Naranjas", "status": "Temporada alta"},
        {"name": "Mandarinas", "status": "Temporada alta"},
        {"name": "Limones", "status": "Temporada"},
        {"name": "Acelgas", "status": "Temporada"},
        {"name": "Coles", "status": "Temporada"},
    ],
    2: [  # Febrero
        {"name": "Naranjas", "status": "Temporada"},
        {"name": "Mandarinas", "status": "Fin de temporada"},
        {"name": "Limones", "status": "Temporada"},
        {"name": "Acelgas", "status": "Temporada"},
        {"name": "Brócoli", "status": "Temporada"},
    ],
    3: [  # Marzo
        {"name": "Limones", "status": "Temporada"},
        {"name": "Fresas", "status": "Inicio temporada"},
        {"name": "Acelgas", "status": "Temporada"},
        {"name": "Brócoli", "status": "Temporada"},
        {"name": "Espinacas", "status": "Temporada"},
    ],
    4: [  # Abril
        {"name": "Fresas", "status": "Temporada alta"},
        {"name": "Alcachofas", "status": "Temporada"},
        {"name": "Guisantes", "status": "Temporada"},
        {"name": "Lechugas", "status": "Temporada"},
        {"name": "Rábanos", "status": "Temporada"},
    ],
    5: [  # Mayo
        {"name": "Fresas", "status": "Temporada"},
        {"name": "Alcachofas", "status": "Temporada"},
        {"name": "Guisantes", "status": "Temporada"},
        {"name": "Lechugas", "status": "Temporada"},
        {"name": "Judías verdes", "status": "Inicio temporada"},
    ],
    6: [  # Junio
        {"name": "Melocotones", "status": "Inicio temporada"},
        {"name": "Albaricoques", "status": "Inicio temporada"},
        {"name": "Judías verdes", "status": "Temporada"},
        {"name": "Calabacines", "status": "Inicio temporada"},
        {"name": "Tomates", "status": "Inicio temporada"},
    ],
    7: [  # Julio
        {"name": "Melocotones", "status": "Temporada alta"},
        {"name": "Albaricoques", "status": "Temporada"},
        {"name": "Melones", "status": "Temporada"},
        {"name": "Sandías", "status": "Temporada"},
        {"name": "Tomates", "status": "Temporada alta"},
        {"name": "Pimientos", "status": "Temporada"},
    ],
    8: [  # Agosto
        {"name": "Melocotones", "status": "Temporada"},
        {"name": "Melones", "status": "Temporada alta"},
        {"name": "Sandías", "status": "Temporada alta"},
        {"name": "Tomates", "status": "Temporada alta"},
        {"name": "Pimientos", "status": "Temporada"},
        {"name": "Calabacines", "status": "Temporada"},
    ],
    9: [  # Septiembre
        {"name": "Uvas", "status": "Temporada"},
        {"name": "Higos", "status": "Temporada"},
        {"name": "Tomates", "status": "Temporada"},
        {"name": "Pimientos", "status": "Temporada"},
        {"name": "Calabazas", "status": "Inicio temporada"},
    ],
    10: [  # Octubre
        {"name": "Uvas", "status": "Temporada"},
        {"name": "Granadas", "status": "Temporada"},
        {"name": "Caquis", "status": "Temporada"},
        {"name": "Calabazas", "status": "Temporada"},
        {"name": "Berenjenas", "status": "Temporada"},
    ],
    11: [  # Noviembre
        {"name": "Caquis", "status": "Temporada"},
        {"name": "Castñas", "status": "Temporada"},
        {"name": "Calabazas", "status": "Temporada"},
        {"name": "Coles", "status": "Temporada"},
        {"name": "Coliflor", "status": "Temporada"},
    ],
    12: [  # Diciembre
        {"name": "Naranjas", "status": "Inicio temporada"},
        {"name": "Mandarinas", "status": "Temporada"},
        {"name": "Limones", "status": "Temporada"},
        {"name": "Coles", "status": "Temporada"},
        {"name": "Coliflor", "status": "Temporada"},
    ],
}

SAINTS_BY_DATE: Dict[str, List[str]] = {
    "01-01": ["María, Madre de Dios"],
    "01-02": ["Basilio", "Gregorio"],
    "01-03": ["Genoveva"],
    "01-06": ["Epifanía", "Reyes Magos"],
    "01-07": ["Raimundo de Peñafort"],
    "01-13": ["Hilario"],
    "01-17": ["Antonio Abad"],
    "01-20": ["Sebastián", "Fabio"],
    "01-21": ["Inés"],
    "01-22": ["Vicente"],
    "01-25": ["Conversión de San Pablo"],
    "01-27": ["Ángela Merici"],
    "01-28": ["Tomás de Aquino"],
    "01-31": ["Juan Bosco"],
    "02-02": ["Presentación del Señor", "Candelaria"],
    "02-03": ["Blas"],
    "02-05": ["Águeda"],
    "02-06": ["Amando"],
    "02-10": ["Escolástica"],
    "02-11": ["Nuestra Señora de Lourdes"],
    "02-14": ["Valentín", "Cirilo", "Metodio"],
    "02-19": ["Álvaro"],
    "02-22": ["Cátedra de San Pedro"],
    "02-23": ["Polícarp"],
    "02-27": ["Gabriel de la Dolorosa"],
    "03-03": ["Camilo"],
    "03-04": ["Casimiro"],
    "03-07": ["Perpetua", "Felicidad"],
    "03-08": ["Juan de Dios"],
    "03-09": ["Francesca de Roma"],
    "03-17": ["Patricio"],
    "03-19": ["José", "José de Nazaret"],
    "03-25": ["Anunciación del Señor"],
    "04-04": ["Isidoro"],
    "04-07": ["Juan Bautista de la Salle"],
    "04-11": ["Estanislao"],
    "04-13": ["Martín I"],
    "04-21": ["Anselmo"],
    "04-23": ["Jorge"],
    "04-25": ["Marcos"],
    "04-29": ["Catalina de Siena"],
    "04-30": ["Pío V"],
    "05-01": ["José Obrero"],
    "05-02": ["Atanasio"],
    "05-03": ["Felipe", "Santiago"],
    "05-04": ["Florián"],
    "05-08": ["Miguel Arcángel"],
    "05-10": ["Antonino"],
    "05-12": ["Nereo", "Aquileo", "Pancracio"],
    "05-13": ["Nuestra Señora de Fátima"],
    "05-14": ["Matías"],
    "05-15": ["Isidro Labrador"],
    "05-16": ["Juan Nepomuceno"],
    "05-18": ["Juan I"],
    "05-25": ["Beda"],
    "05-26": ["Felipe Neri"],
    "05-27": ["Agustín de Canterbury"],
    "05-31": ["Visitación de la Virgen María"],
    "06-01": ["Justino"],
    "06-02": ["Marcellino", "Pedro"],
    "06-03": ["Carlos Lwanga"],
    "06-05": ["Bonifacio"],
    "06-09": ["Efrén"],
    "06-11": ["Bernabé"],
    "06-13": ["Antonio de Padua"],
    "06-19": ["Romualdo"],
    "06-21": ["Luis Gonzaga"],
    "06-22": ["Paulino de Nola"],
    "06-24": ["Nacimiento de San Juan Bautista"],
    "06-27": ["Cirilo de Alejandría"],
    "06-28": ["Ireneo"],
    "06-29": ["Pedro", "Pablo"],
    "06-30": ["Primeros Mártires"],
    "07-03": ["Tomás"],
    "07-04": ["Isabel de Portugal"],
    "07-05": ["Antonio María Zaccaría"],
    "07-06": ["María Goretti"],
    "07-11": ["Benedicto"],
    "07-14": ["Camilo de Lelis"],
    "07-15": ["Bonaventura"],
    "07-16": ["Nuestra Señora del Carmen"],
    "07-20": ["Elías"],
    "07-22": ["María Magdalena"],
    "07-23": ["Brigida"],
    "07-25": ["Santiago"],
    "07-26": ["Joaquín", "Ana"],
    "07-29": ["Marta"],
    "07-30": ["Pedro Crisólogo"],
    "07-31": ["Ignacio de Loyola"],
    "08-01": ["Alfonso María de Ligorio"],
    "08-04": ["Juan María Vianney"],
    "08-05": ["Dedicación de Santa María"],
    "08-06": ["Transfiguración del Señor"],
    "08-08": ["Domingo"],
    "08-10": ["Lorenzo"],
    "08-11": ["Clara"],
    "08-13": ["Hipólito", "Ponciano"],
    "08-14": ["Maximiliano Kolbe"],
    "08-15": ["Asunción de la Virgen María"],
    "08-16": ["Esteban de Hungría"],
    "08-19": ["Juan Eudes"],
    "08-20": ["Bernardo"],
    "08-21": ["Pío X"],
    "08-22": ["María Reina"],
    "08-23": ["Rosa de Lima"],
    "08-24": ["Bartolomé"],
    "08-25": ["Luis"],
    "08-27": ["Mónica"],
    "08-28": ["Agustín"],
    "08-29": ["Martirio de San Juan Bautista"],
    "09-03": ["Gregorio Magno"],
    "09-08": ["Nacimiento de la Virgen María"],
    "09-09": ["Pedro Claver"],
    "09-13": ["Juan Crisóstomo"],
    "09-14": ["Exaltación de la Santa Cruz"],
    "09-15": ["Nuestra Señora de los Dolores"],
    "09-16": ["Cornelio", "Cipriano"],
    "09-17": ["Roberto Belarmino"],
    "09-19": ["Jenaro"],
    "09-21": ["Mateo"],
    "09-23": ["Lino"],
    "09-27": ["Vicente de Paúl"],
    "09-28": ["Wenceslao"],
    "09-29": ["Arcángeles Miguel", "Gabriel", "Rafael"],
    "09-30": ["Jerónimo"],
    "10-01": ["Teresa del Niño Jesús"],
    "10-02": ["Ángeles Custodios"],
    "10-04": ["Francisco de Asís"],
    "10-05": ["Faustina Kowalska"],
    "10-06": ["Bruno"],
    "10-07": ["Nuestra Señora del Rosario"],
    "10-09": ["Dionisio"],
    "10-15": ["Teresa de Ávila"],
    "10-16": ["Margarita María Alacoque"],
    "10-17": ["Ignacio de Antioquía"],
    "10-18": ["Lucas"],
    "10-19": ["Isaac Jogues"],
    "10-23": ["Juan de Capistrano"],
    "10-24": ["Antonio María Claret"],
    "10-28": ["Simón", "Judas Tadeo"],
    "10-31": ["Alfonso Rodríguez"],
    "11-01": ["Todos los Santos"],
    "11-02": ["Fieles Difuntos"],
    "11-03": ["Martín de Porres"],
    "11-04": ["Carlos Borromeo"],
    "11-09": ["Dedicación de la Basílica de Letrán"],
    "11-10": ["León Magno"],
    "11-11": ["Martín de Tours"],
    "11-12": ["Josafat"],
    "11-13": ["Francisco Javier Cabrini"],
    "11-15": ["Alberto Magno"],
    "11-16": ["Margarita de Escocia"],
    "11-17": ["Isabel de Hungría"],
    "11-18": ["Dedicación de las Basílicas de San Pedro y San Pablo"],
    "11-21": ["Presentación de la Virgen María"],
    "11-22": ["Cecilia"],
    "11-23": ["Clemente I"],
    "11-24": ["Columba de Rieti"],
    "11-25": ["Catalina de Alejandría"],
    "11-30": ["Andrés"],
    "12-03": ["Francisco Javier"],
    "12-04": ["Juan Damasceno"],
    "12-06": ["Nicolás"],
    "12-07": ["Ambrocio"],
    "12-08": ["Inmaculada Concepción"],
    "12-09": ["Juan Diego"],
    "12-11": ["Dámaso"],
    "12-12": ["Nuestra Señora de Guadalupe"],
    "12-13": ["Lucía"],
    "12-14": ["Juan de la Cruz"],
    "12-21": ["Pedro Canisio"],
    "12-23": ["Juan de Kety"],
    "12-25": ["Natividad del Señor", "Navidad"],
    "12-26": ["Esteban"],
    "12-27": ["Juan"],
    "12-28": ["Santos Inocentes"],
    "12-29": ["Tomás Becket"],
    "12-31": ["Silvestre I"],
}


def parse_rss_feed(feed_url: str, max_items: int = 10, timeout: int = 10) -> List[Dict[str, Any]]:
    """Parsea un feed RSS/Atom y devuelve una lista de artículos."""
    try:
        response = requests.get(feed_url, timeout=timeout, headers={
            "User-Agent": "Mozilla/5.0 (compatible; PantallaReloj/1.0)"
        })
        response.raise_for_status()
        
        # Parsear XML básico (sin dependencia externa)
        items: List[Dict[str, Any]] = []
        content = response.text
        
        # Extraer items/elements
        item_pattern = re.compile(r'<(?:item|entry)[^>]*>(.*?)</(?:item|entry)>', re.DOTALL | re.IGNORECASE)
        matches = item_pattern.findall(content)
        
        for match in matches[:max_items]:
            item: Dict[str, Any] = {}
            
            # Título
            title_match = re.search(r'<(?:title|dc:title)[^>]*>(.*?)</(?:title|dc:title)>', match, re.DOTALL | re.IGNORECASE)
            if title_match:
                title = html.unescape(re.sub(r'<[^>]+>', '', title_match.group(1)).strip())
                item["title"] = title
            
            # Descripción/summary
            desc_match = re.search(r'<(?:description|summary|content|dc:description)[^>]*>(.*?)</(?:description|summary|content|dc:description)>', match, re.DOTALL | re.IGNORECASE)
            if desc_match:
                desc = html.unescape(re.sub(r'<[^>]+>', '', desc_match.group(1)).strip())
                item["summary"] = desc[:200] + "..." if len(desc) > 200 else desc
            
            # Link
            link_match = re.search(r'<(?:link|guid)[^>]*>(.*?)</(?:link|guid)>', match, re.DOTALL | re.IGNORECASE)
            if link_match:
                item["link"] = link_match.group(1).strip()
            
            # Fecha
            date_match = re.search(r'<(?:pubDate|published|dc:date)[^>]*>(.*?)</(?:pubDate|published|dc:date)>', match, re.DOTALL | re.IGNORECASE)
            if date_match:
                item["published_at"] = date_match.group(1).strip()
            
            # Source (del feed)
            parsed_url = urlparse(feed_url)
            item["source"] = parsed_url.netloc.replace("www.", "")
            
            if item.get("title"):
                items.append(item)
        
        return items
    except Exception as exc:
        print(f"Error parsing RSS feed {feed_url}: {exc}")
        return []


def get_harvest_data(custom_items: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Obtiene datos de hortalizas según el mes actual."""
    today = date.today()
    month = today.month
    
    # Obtener datos estacionales
    seasonal_items = HARVEST_SEASON_DATA.get(month, [])
    
    # Combinar con items personalizados
    all_items = list(seasonal_items)
    if custom_items:
        all_items.extend(custom_items)
    
    return all_items


def get_saints_today(include_namedays: bool = True, locale: str = "es") -> List[str]:
    """Obtiene los santos del día actual."""
    today = date.today()
    date_key = f"{today.month:02d}-{today.day:02d}"
    
    saints = SAINTS_BY_DATE.get(date_key, [])
    
    if include_namedays and locale == "es":
        # Agregar onomásticos comunes (simplificado)
        # En una implementación completa, esto vendría de una base de datos
        pass
    
    return saints


def calculate_moon_phase(dt: Optional[datetime] = None) -> Dict[str, Any]:
    """Calcula la fase lunar y su iluminación."""
    if dt is None:
        dt = datetime.now(timezone.utc)
    
    # Algoritmo simple de fase lunar
    # Referencia: día juliano de una luna nueva conocida
    # 1 de enero 2000, 18:14 UTC fue luna nueva
    base_new_moon = datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc)
    days_since_base = (dt - base_new_moon).total_seconds() / 86400.0
    
    # Período sinódico de la luna: 29.53058867 días
    synodic_period = 29.53058867
    days_in_cycle = days_since_base % synodic_period
    
    # Calcular fase (0 = luna nueva, 14.765 = luna llena)
    phase_ratio = days_in_cycle / synodic_period
    
    # Determinar nombre de fase
    if phase_ratio < 0.03 or phase_ratio > 0.97:
        phase_name = "Luna nueva"
        illumination = 0.0
    elif phase_ratio < 0.22:
        phase_name = "Luna creciente"
        illumination = (phase_ratio / 0.22) * 50.0
    elif phase_ratio < 0.28:
        phase_name = "Cuarto creciente"
        illumination = 50.0
    elif phase_ratio < 0.47:
        phase_name = "Luna creciente"
        illumination = 50.0 + ((phase_ratio - 0.28) / 0.19) * 50.0
    elif phase_ratio < 0.53:
        phase_name = "Luna llena"
        illumination = 100.0
    elif phase_ratio < 0.72:
        phase_name = "Luna menguante"
        illumination = 100.0 - ((phase_ratio - 0.53) / 0.19) * 50.0
    elif phase_ratio < 0.78:
        phase_name = "Cuarto menguante"
        illumination = 50.0
    else:
        phase_name = "Luna menguante"
        illumination = 50.0 - ((phase_ratio - 0.78) / 0.19) * 50.0
    
    illumination = max(0.0, min(100.0, illumination))
    
    return {
        "moon_phase": phase_name,
        "moon_illumination": round(illumination, 1),
        "illumination": round(illumination, 1),  # Alias para compatibilidad
    }


def calculate_sun_times(lat: float, lng: float, tz_str: str = "Europe/Madrid", dt: Optional[date] = None) -> Dict[str, str]:
    """Calcula horas de salida y puesta del sol (simplificado)."""
    if dt is None:
        dt = date.today()
    
    # Algoritmo simplificado de salida/puesta de sol
    # Para mayor precisión, usar librería como `astral` o `pyephem`
    day_of_year = dt.timetuple().tm_yday
    
    # Ecuación del tiempo (simplificada)
    eq_time = 4 * (
        0.000075 + 0.001868 * (day_of_year - 81) - 0.014615 * (day_of_year - 81) ** 2 / 365
    )
    
    # Declinación solar (simplificada)
    declination = 23.45 * (3.14159 / 180) * (360 / 365.0) * (day_of_year - 81)
    
    # Hora solar (simplificada, sin considerar horario de verano)
    solar_noon = 12 - (lng / 15.0) - eq_time / 60.0
    hour_angle = abs(declination) * (3.14159 / 180) / 15.0
    
    sunrise_hour = solar_noon - hour_angle
    sunset_hour = solar_noon + hour_angle
    
    # Formatear horas
    sunrise_str = f"{int(sunrise_hour):02d}:{int((sunrise_hour % 1) * 60):02d}"
    sunset_str = f"{int(sunset_hour):02d}:{int((sunset_hour % 1) * 60):02d}"
    
    return {
        "sunrise": sunrise_str,
        "sunset": sunset_str,
    }


def fetch_google_calendar_events(
    api_key: str,
    calendar_id: str,
    days_ahead: int = 14,
    max_results: int = 10,
) -> List[Dict[str, Any]]:
    """Obtiene eventos de Google Calendar."""
    try:
        time_min = datetime.now(timezone.utc).isoformat()
        time_max = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).isoformat()
        
        url = f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"
        params = {
            "key": api_key,
            "timeMin": time_min,
            "timeMax": time_max,
            "maxResults": max_results,
            "orderBy": "startTime",
            "singleEvents": "true",
        }
        
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        events = []
        
        for item in data.get("items", []):
            event: Dict[str, Any] = {
                "title": item.get("summary", "Evento sin título"),
            }
            
            # Fecha de inicio
            start = item.get("start", {})
            if "dateTime" in start:
                event["start"] = start["dateTime"]
            elif "date" in start:
                event["start"] = start["date"]
            
            events.append(event)
        
        return events
    except Exception as exc:
        print(f"Error fetching Google Calendar events: {exc}")
        return []

