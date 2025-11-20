"""Módulos para obtener datos reales de diferentes fuentes."""
from __future__ import annotations

import html
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Union
from urllib.parse import urlparse

import logging
import httpx  # CAMBIO: Usar httpx en lugar de requests

logger = logging.getLogger(__name__)

# Datos estáticos mejorados con siembra, cosecha y mantenimiento
HARVEST_SEASON_DATA: Dict[int, Dict[str, List[Dict[str, str]]]] = {
    1: {  # Enero
        "harvest": [  # Cosecha
            {"name": "Naranjas", "status": "Temporada alta"},
            {"name": "Mandarinas", "status": "Temporada alta"},
            {"name": "Limones", "status": "Temporada"},
            {"name": "Acelgas", "status": "Temporada"},
            {"name": "Coles", "status": "Temporada"},
        ],
        "planting": [  # Siembra
            {"name": "Ajo", "status": "Siembra directa"},
            {"name": "Cebolla", "status": "Semilleros"},
            {"name": "Guisantes", "status": "Siembra protegida"},
        ],
        "maintenance": [  # Mantenimiento
            {"name": "Poda de árboles frutales", "status": "Temporada"},
            {"name": "Abonado de cítricos", "status": "Preparación"},
        ],
    },
    2: {  # Febrero
        "harvest": [
            {"name": "Naranjas", "status": "Temporada"},
            {"name": "Mandarinas", "status": "Fin de temporada"},
            {"name": "Limones", "status": "Temporada"},
            {"name": "Acelgas", "status": "Temporada"},
            {"name": "Brócoli", "status": "Temporada"},
        ],
        "planting": [
            {"name": "Lechugas", "status": "Semilleros"},
            {"name": "Rábanos", "status": "Siembra directa"},
            {"name": "Espinacas", "status": "Siembra directa"},
            {"name": "Zanahorias", "status": "Siembra directa"},
        ],
        "maintenance": [
            {"name": "Poda de árboles", "status": "Temporada alta"},
            {"name": "Abonado", "status": "Inicio temporada"},
        ],
    },
    3: {  # Marzo
        "harvest": [
            {"name": "Limones", "status": "Temporada"},
            {"name": "Fresas", "status": "Inicio temporada"},
            {"name": "Acelgas", "status": "Temporada"},
            {"name": "Brócoli", "status": "Temporada"},
            {"name": "Espinacas", "status": "Temporada"},
        ],
        "planting": [
            {"name": "Tomates", "status": "Semilleros"},
            {"name": "Pimientos", "status": "Semilleros"},
            {"name": "Berenjenas", "status": "Semilleros"},
            {"name": "Calabacines", "status": "Semilleros"},
            {"name": "Calabazas", "status": "Semilleros"},
        ],
        "maintenance": [
            {"name": "Trasplante de semilleros", "status": "Temporada"},
            {"name": "Preparación de bancales", "status": "Temporada"},
        ],
    },
    4: {  # Abril
        "harvest": [
            {"name": "Fresas", "status": "Temporada alta"},
            {"name": "Alcachofas", "status": "Temporada"},
            {"name": "Guisantes", "status": "Temporada"},
            {"name": "Lechugas", "status": "Temporada"},
            {"name": "Rábanos", "status": "Temporada"},
        ],
        "planting": [
            {"name": "Maíz", "status": "Siembra directa"},
            {"name": "Judías verdes", "status": "Siembra directa"},
            {"name": "Calabacines", "status": "Trasplante"},
            {"name": "Tomates", "status": "Trasplante"},
        ],
        "maintenance": [
            {"name": "Trasplante al aire libre", "status": "Temporada alta"},
            {"name": "Riego regular", "status": "Inicio"},
        ],
    },
    5: {  # Mayo
        "harvest": [
            {"name": "Fresas", "status": "Temporada"},
            {"name": "Alcachofas", "status": "Temporada"},
            {"name": "Guisantes", "status": "Temporada"},
            {"name": "Lechugas", "status": "Temporada"},
            {"name": "Judías verdes", "status": "Inicio temporada"},
        ],
        "planting": [
            {"name": "Calabazas", "status": "Siembra directa"},
            {"name": "Melones", "status": "Siembra directa"},
            {"name": "Sandías", "status": "Siembra directa"},
            {"name": "Pepinos", "status": "Trasplante"},
        ],
        "maintenance": [
            {"name": "Entutorado", "status": "Temporada"},
            {"name": "Riego", "status": "Temporada alta"},
        ],
    },
    6: {  # Junio
        "harvest": [
            {"name": "Melocotones", "status": "Inicio temporada"},
            {"name": "Albaricoques", "status": "Inicio temporada"},
            {"name": "Judías verdes", "status": "Temporada"},
            {"name": "Calabacines", "status": "Inicio temporada"},
            {"name": "Tomates", "status": "Inicio temporada"},
        ],
        "planting": [
            {"name": "Zanahorias", "status": "Siembra escalonada"},
            {"name": "Rábanos", "status": "Siembra escalonada"},
            {"name": "Lechugas", "status": "Siembra escalonada"},
        ],
        "maintenance": [
            {"name": "Riego", "status": "Temporada alta"},
            {"name": "Desherbado", "status": "Temporada"},
        ],
    },
    7: {  # Julio
        "harvest": [
            {"name": "Melocotones", "status": "Temporada alta"},
            {"name": "Albaricoques", "status": "Temporada"},
            {"name": "Melones", "status": "Temporada"},
            {"name": "Sandías", "status": "Temporada"},
            {"name": "Tomates", "status": "Temporada alta"},
            {"name": "Pimientos", "status": "Temporada"},
        ],
        "planting": [
            {"name": "Coles de invierno", "status": "Siembra"},
            {"name": "Brócoli", "status": "Siembra"},
            {"name": "Coliflor", "status": "Siembra"},
        ],
        "maintenance": [
            {"name": "Riego", "status": "Temporada crítica"},
            {"name": "Recolección frecuente", "status": "Temporada alta"},
        ],
    },
    8: {  # Agosto
        "harvest": [
            {"name": "Melocotones", "status": "Temporada"},
            {"name": "Melones", "status": "Temporada alta"},
            {"name": "Sandías", "status": "Temporada alta"},
            {"name": "Tomates", "status": "Temporada alta"},
            {"name": "Pimientos", "status": "Temporada"},
            {"name": "Calabacines", "status": "Temporada"},
        ],
        "planting": [
            {"name": "Lechugas de otoño", "status": "Siembra"},
            {"name": "Rúcula", "status": "Siembra"},
            {"name": "Espinacas", "status": "Siembra"},
        ],
        "maintenance": [
            {"name": "Riego", "status": "Temporada crítica"},
            {"name": "Podas de mantenimiento", "status": "Temporada"},
        ],
    },
    9: {  # Septiembre
        "harvest": [
            {"name": "Uvas", "status": "Temporada"},
            {"name": "Higos", "status": "Temporada"},
            {"name": "Tomates", "status": "Temporada"},
            {"name": "Pimientos", "status": "Temporada"},
            {"name": "Calabazas", "status": "Inicio temporada"},
        ],
        "planting": [
            {"name": "Ajo", "status": "Preparación"},
            {"name": "Cebolla", "status": "Preparación"},
            {"name": "Guisantes", "status": "Siembra"},
        ],
        "maintenance": [
            {"name": "Vendimia", "status": "Temporada alta"},
            {"name": "Preparación de otoño", "status": "Temporada"},
        ],
    },
    10: {  # Octubre
        "harvest": [
            {"name": "Uvas", "status": "Temporada"},
            {"name": "Granadas", "status": "Temporada"},
            {"name": "Caquis", "status": "Temporada"},
            {"name": "Calabazas", "status": "Temporada"},
            {"name": "Berenjenas", "status": "Temporada"},
        ],
        "planting": [
            {"name": "Ajo", "status": "Siembra directa"},
            {"name": "Cebolla", "status": "Siembra"},
            {"name": "Habones", "status": "Siembra"},
        ],
        "maintenance": [
            {"name": "Recolección y almacenamiento", "status": "Temporada"},
            {"name": "Limpieza de bancales", "status": "Temporada"},
        ],
    },
    11: {  # Noviembre
        "harvest": [
            {"name": "Caquis", "status": "Temporada"},
            {"name": "Castñas", "status": "Temporada"},
            {"name": "Calabazas", "status": "Temporada"},
            {"name": "Coles", "status": "Temporada"},
            {"name": "Coliflor", "status": "Temporada"},
        ],
        "planting": [
            {"name": "Ajo", "status": "Siembra directa"},
            {"name": "Guisantes", "status": "Siembra protegida"},
        ],
        "maintenance": [
            {"name": "Poda de árboles", "status": "Inicio temporada"},
            {"name": "Abonado de otoño", "status": "Temporada"},
        ],
    },
    12: {  # Diciembre
        "harvest": [
            {"name": "Naranjas", "status": "Inicio temporada"},
            {"name": "Mandarinas", "status": "Temporada"},
            {"name": "Limones", "status": "Temporada"},
            {"name": "Coles", "status": "Temporada"},
            {"name": "Coliflor", "status": "Temporada"},
        ],
        "planting": [
            {"name": "Semilleros de primavera", "status": "Preparación"},
        ],
        "maintenance": [
            {"name": "Poda", "status": "Temporada"},
            {"name": "Protección contra heladas", "status": "Temporada"},
        ],
    },
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


async def parse_rss_feed(feed_url: str, max_items: int = 10, timeout: int = 10) -> List[Dict[str, Any]]:
    """Parsea un feed RSS/Atom y devuelve una lista de artículos de forma asíncrona."""
    try:
        async with httpx.AsyncClient(timeout=float(timeout), follow_redirects=True) as client:
            response = await client.get(feed_url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; PantallaReloj/1.0)"
            })
            response.raise_for_status()
            content = response.text
        
        items: List[Dict[str, Any]] = []
        item_pattern = re.compile(r'<(?:item|entry)[^>]*>(.*?)</(?:item|entry)>', re.DOTALL | re.IGNORECASE)
        matches = item_pattern.findall(content)
        
        for match in matches[:max_items]:
            item: Dict[str, Any] = {}
            title_match = re.search(r'<(?:title|dc:title)[^>]*>(.*?)</(?:title|dc:title)>', match, re.DOTALL | re.IGNORECASE)
            if title_match:
                title = html.unescape(re.sub(r'<[^>]+>', '', title_match.group(1)).strip())
                item["title"] = title
            
            desc_match = re.search(r'<(?:description|summary|content|dc:description)[^>]*>(.*?)</(?:description|summary|content|dc:description)>', match, re.DOTALL | re.IGNORECASE)
            if desc_match:
                desc = html.unescape(re.sub(r'<[^>]+>', '', desc_match.group(1)).strip())
                item["summary"] = desc[:200] + "..." if len(desc) > 200 else desc
            
            link_match = re.search(r'<(?:link|guid)[^>]*>(.*?)</(?:link|guid)>', match, re.DOTALL | re.IGNORECASE)
            if link_match:
                item["link"] = link_match.group(1).strip()
            
            date_match = re.search(r'<(?:pubDate|published|dc:date)[^>]*>(.*?)</(?:pubDate|published|dc:date)>', match, re.DOTALL | re.IGNORECASE)
            if date_match:
                item["published_at"] = date_match.group(1).strip()
            
            parsed_url = urlparse(feed_url)
            item["source"] = parsed_url.netloc.replace("www.", "")
            
            if item.get("title"):
                items.append(item)
        
        return items
    except Exception as exc:
        logger.warning(f"Error parsing RSS feed {feed_url}: {exc}")
        return []


def get_harvest_data(
    custom_items: List[Dict[str, str]] = None,
    include_planting: bool = True,
    include_maintenance: bool = False
) -> Dict[str, List[Dict[str, str]]]:
    """Obtiene datos de hortalizas según el mes actual.
    
    Retorna un diccionario con información de cosecha, siembra y mantenimiento
    según la configuración solicitada. Mantiene retrocompatibilidad.
    
    Args:
        custom_items: Items personalizados a agregar (solo a harvest)
        include_planting: Incluir información de siembra
        include_maintenance: Incluir información de mantenimiento
    
    Returns:
        Diccionario con 'harvest', y opcionalmente 'planting' y 'maintenance'
    """
    today = date.today()
    month = today.month
    
    # Obtener datos estacionales del mes
    month_data = HARVEST_SEASON_DATA.get(month, {})
    
    # Extraer datos según estructura (nueva o antigua para compatibilidad)
    if isinstance(month_data, dict):
        # Nueva estructura con harvest/planting/maintenance
        harvest_items = month_data.get("harvest", [])
        planting_items = month_data.get("planting", [])
        maintenance_items = month_data.get("maintenance", [])
    else:
        # Estructura antigua (lista simple) - retrocompatibilidad
        harvest_items = month_data if isinstance(month_data, list) else []
        planting_items = []
        maintenance_items = []
    
    # Combinar harvest con items personalizados
    all_harvest = list(harvest_items)
    if custom_items:
        all_harvest.extend(custom_items)
    
    # Construir resultado
    result: Dict[str, List[Dict[str, str]]] = {
        "harvest": all_harvest,
    }
    
    if include_planting:
        result["planting"] = list(planting_items)
    
    if include_maintenance:
        result["maintenance"] = list(maintenance_items)
    
    return result


# Diccionario auxiliar con información enriquecida para santos principales
SAINTS_ENRICHED_INFO: Dict[str, Dict[str, Any]] = {
    "María, Madre de Dios": {
        "type": "solemnity",
        "patron_of": ["Madrid", "España"],
        "name_days": ["María", "Mariano", "Mariana", "Mari", "Mari Carmen"]
    },
    "José": {
        "type": "solemnity",
        "patron_of": ["Trabajadores", "Padres", "Carpinteros"],
        "name_days": ["José", "Pepe", "Jose", "Josefa", "Josefina"]
    },
    "José de Nazaret": {
        "type": "solemnity",
        "patron_of": ["Trabajadores", "Padres", "Carpinteros"],
        "name_days": ["José", "Pepe", "Jose", "Josefa", "Josefina"]
    },
    "Francisco de Asís": {
        "type": "memorial",
        "patron_of": ["Italia", "Animales", "Ecología"],
        "name_days": ["Francisco", "Fran", "Paco", "Francis", "Francisca"]
    },
    "Teresa de Ávila": {
        "type": "memorial",
        "patron_of": ["Escritores", "España"],
        "name_days": ["Teresa", "Tere", "Teresita"]
    },
    "Antonio de Padua": {
        "type": "memorial",
        "patron_of": ["Lisboa", "Objetos perdidos", "Pobres"],
        "name_days": ["Antonio", "Toño", "Anton", "Antonia"]
    },
    "Isidro Labrador": {
        "type": "memorial",
        "patron_of": ["Madrid", "Labradores", "Agricultores"],
        "name_days": ["Isidro", "Isidro", "Isidra"]
    },
    "Santiago": {
        "type": "feast",
        "patron_of": ["España", "Galicia"],
        "name_days": ["Santiago", "Jaime", "Diego", "Yago"]
    },
    "Pedro": {
        "type": "solemnity",
        "patron_of": ["Pescadores", "Roma"],
        "name_days": ["Pedro", "Perico", "Peter", "Piedad", "Pilar"]
    },
    "Pablo": {
        "type": "solemnity",
        "patron_of": ["Escritores", "Misioneros"],
        "name_days": ["Pablo", "Paula", "Pau"]
    },
    "Juan": {
        "type": "feast",
        "patron_of": ["Escritores", "Teólogos"],
        "name_days": ["Juan", "Juanito", "Jon", "Juana", "Iván"]
    },
    "María Magdalena": {
        "type": "memorial",
        "patron_of": ["Penitentes", "Perfumeros"],
        "name_days": ["Magdalena", "Magda", "Maite"]
    },
    "Valentín": {
        "type": "optional_memorial",
        "patron_of": ["Enamorados", "Apicultores"],
        "name_days": ["Valentín", "Valentina", "Val"]
    },
    "Lucas": {
        "type": "feast",
        "patron_of": ["Médicos", "Artistas", "Pintores"],
        "name_days": ["Lucas", "Luca"]
    },
    "Mateo": {
        "type": "feast",
        "patron_of": ["Banqueros", "Contadores"],
        "name_days": ["Mateo", "Mate", "Matías", "Matilde"]
    },
    "Jorge": {
        "type": "optional_memorial",
        "patron_of": ["Inglaterra", "Cataluña", "Caballeros"],
        "name_days": ["Jorge", "Jordi", "George"]
    },
    "Juan Bosco": {
        "type": "memorial",
        "patron_of": ["Jóvenes", "Editores", "Estudiantes"],
        "name_days": ["Juan", "Juanito"]
    },
    "Tomás de Aquino": {
        "type": "memorial",
        "patron_of": ["Escuelas", "Estudiantes", "Teólogos"],
        "name_days": ["Tomás", "Tomas", "Tomeu"]
    },
}


def get_saints_today(
    include_namedays: bool = True,
    locale: str = "es",
    include_info: bool = False
) -> Union[List[str], Dict[str, Any]]:
    """Obtiene los santos del día actual.
    
    Args:
        include_namedays: Incluir onomásticos asociados
        locale: Localización (actualmente solo "es")
        include_info: Si True, retorna estructura enriquecida con información adicional
    
    Returns:
        Si include_info=False: Lista de nombres de santos (retrocompatibilidad)
        Si include_info=True: Diccionario con 'saints' (lista enriquecida) y 'namedays' (lista)
    """
    today = date.today()
    date_key = f"{today.month:02d}-{today.day:02d}"
    
    saints_raw = SAINTS_BY_DATE.get(date_key, [])
    
    # Si se solicita información enriquecida
    if include_info:
        saints_enriched = []
        all_namedays = []
        
        for saint_name in saints_raw:
            # Buscar información enriquecida
            enriched = SAINTS_ENRICHED_INFO.get(saint_name, {})
            
            # Crear entrada del santo
            saint_entry: Dict[str, Any] = {
                "name": saint_name,
            }
            
            # Agregar información adicional si está disponible
            if enriched:
                saint_entry.update({
                    "type": enriched.get("type", "memorial"),
                    "patron_of": enriched.get("patron_of", []),
                })
                
                # Agregar onomásticos si se solicitan
                if include_namedays and enriched.get("name_days"):
                    saint_entry["name_days"] = enriched["name_days"]
                    all_namedays.extend(enriched["name_days"])
            else:
                # Si no hay información enriquecida, intentar extraer nombre base
                # para generar onomásticos básicos
                if include_namedays:
                    # Extraer primer nombre del santo
                    base_name = saint_name.split(",")[0].strip()
                    saint_entry["name_days"] = [base_name]
                    all_namedays.append(base_name)
            
            saints_enriched.append(saint_entry)
        
        return {
            "saints": saints_enriched,
            "namedays": sorted(list(set(all_namedays))) if include_namedays else [],
        }
    
    # Modo simple (retrocompatibilidad)
    saints = saints_raw
    
    # Si se solicitan onomásticos en modo simple, intentar extraerlos
    if include_namedays and locale == "es":
        namedays_set = set()
        for saint_name in saints:
            # Buscar en información enriquecida
            enriched = SAINTS_ENRICHED_INFO.get(saint_name, {})
            if enriched.get("name_days"):
                namedays_set.update(enriched["name_days"])
            else:
                # Fallback: usar primer nombre del santo
                base_name = saint_name.split(",")[0].split(" ")[0].strip()
                namedays_set.add(base_name)
        
        # En modo simple, agregar onomásticos como comentario en la lista
        # O retornar lista extendida (mantener compatibilidad)
        if namedays_set:
            # Para retrocompatibilidad, solo retornar nombres de santos
            # Los onomásticos se obtienen con include_info=True
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


def calculate_sun_times(lat: float, lng: float, tz_str: str = "Europe/Madrid", dt: Optional[date] = None, elevation: float = 0.0) -> Dict[str, Any]:
    """Calcula horas de salida y puesta del sol con alta precisión.
    
    Intenta usar la librería `astral` para máxima precisión (±1 minuto),
    con fallback a algoritmo simplificado si no está disponible.
    
    Args:
        lat: Latitud en grados (-90 a 90)
        lng: Longitud en grados (-180 a 180)
        tz_str: Zona horaria (ej: "Europe/Madrid")
        dt: Fecha (por defecto: hoy)
        elevation: Elevación sobre el nivel del mar en metros (opcional)
    
    Returns:
        Diccionario con sunrise, sunset, y opcionalmente solar_noon, dusk, dawn
    """
    if dt is None:
        dt = date.today()
    
    # Validar coordenadas
    if not (-90 <= lat <= 90):
        raise ValueError(f"Latitud inválida: {lat} (debe estar entre -90 y 90)")
    if not (-180 <= lng <= 180):
        raise ValueError(f"Longitud inválida: {lng} (debe estar entre -180 y 180)")
    
    # Intentar usar astral para máxima precisión
    try:
        from astral import LocationInfo
        from astral.sun import sun
        from zoneinfo import ZoneInfo
        
        # Validar zona horaria
        try:
            tz = ZoneInfo(tz_str)
        except Exception:
            # Fallback a Europe/Madrid si la zona horaria es inválida
            tz_str = "Europe/Madrid"
            tz = ZoneInfo(tz_str)
        
        location = LocationInfo(
            name="Location",
            region="Region",
            timezone=tz_str,
            latitude=lat,
            longitude=lng,
        )
        
        # Calcular eventos solares
        s = sun(location.observer, date=dt, tzinfo=tz)
        
        return {
            "sunrise": s["sunrise"].strftime("%H:%M"),
            "sunset": s["sunset"].strftime("%H:%M"),
            "solar_noon": s["noon"].strftime("%H:%M"),
            "dawn": s["dawn"].strftime("%H:%M"),
            "dusk": s["dusk"].strftime("%H:%M"),
            "precision": "high",  # Indicador de que se usó astral
        }
    
    except ImportError:
        # Fallback al algoritmo simplificado si astral no está disponible
        # Algoritmo simplificado de salida/puesta de sol
        day_of_year = dt.timetuple().tm_yday
        
        # Ecuación del tiempo (simplificada)
        eq_time = 4 * (
            0.000075 + 0.001868 * (day_of_year - 81) - 0.014615 * (day_of_year - 81) ** 2 / 365
        )
        
        # Declinación solar (simplificada)
        declination = 23.45 * (3.14159 / 180) * (360 / 365.0) * (day_of_year - 81)
        
        # Hora solar (simplificada, sin considerar horario de verano completamente)
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
            "precision": "low",  # Indicador de algoritmo simplificado
        }
    
    except Exception as e:
        # En caso de cualquier otro error, usar algoritmo simplificado
        # y registrar el error
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(f"Error usando astral, fallback a algoritmo simplificado: {e}")
        
        # Algoritmo simplificado
        day_of_year = dt.timetuple().tm_yday
        eq_time = 4 * (
            0.000075 + 0.001868 * (day_of_year - 81) - 0.014615 * (day_of_year - 81) ** 2 / 365
        )
        declination = 23.45 * (3.14159 / 180) * (360 / 365.0) * (day_of_year - 81)
        solar_noon = 12 - (lng / 15.0) - eq_time / 60.0
        hour_angle = abs(declination) * (3.14159 / 180) / 15.0
        
        sunrise_hour = solar_noon - hour_angle
        sunset_hour = solar_noon + hour_angle
        
        sunrise_str = f"{int(sunrise_hour):02d}:{int((sunrise_hour % 1) * 60):02d}"
        sunset_str = f"{int(sunset_hour):02d}:{int((sunset_hour % 1) * 60):02d}"
        
        return {
            "sunrise": sunrise_str,
            "sunset": sunset_str,
            "precision": "low",
            "error": str(e),
        }


def calculate_extended_astronomy(
    lat: float,
    lng: float,
    tz_str: str = "Europe/Madrid",
    days_ahead: int = 7,
    dt: Optional[date] = None
) -> Dict[str, Any]:
    """Calcula información astronómica extendida.
    
    Incluye fase lunar actual, próximas fases, duración del día,
    crepúsculos y mediodía solar.
    
    Args:
        lat: Latitud en grados
        lng: Longitud en grados
        tz_str: Zona horaria
        days_ahead: Días hacia adelante para calcular próximas fases
        dt: Fecha base (por defecto: hoy)
    
    Returns:
        Diccionario con información astronómica completa
    """
    if dt is None:
        dt = date.today()
    
    # Fase lunar actual (usar la misma fecha base que para los cálculos solares)
    dt_aware = datetime.combine(dt, datetime.min.time()).replace(tzinfo=timezone.utc)
    moon_data = calculate_moon_phase(dt_aware)
    
    # Calcular próximas fases lunares
    next_phases = []
    for i in range(min(days_ahead, 30)):  # Limitar a 30 días máximo
        future_date = dt + timedelta(days=i)
        future_dt = datetime.combine(future_date, datetime.min.time()).replace(tzinfo=timezone.utc)
        future_moon = calculate_moon_phase(future_dt)
        
        # Solo agregar si es un cambio de fase significativo
        # o si es el día actual o el siguiente
        phase_name = future_moon["moon_phase"]
        is_significant_phase = phase_name in [
            "Luna nueva", "Luna llena", "Cuarto creciente", "Cuarto menguante"
        ]
        
        if i == 0 or is_significant_phase:
            next_phases.append({
                "date": future_date.isoformat(),
                "phase": phase_name,
                "illumination": future_moon["moon_illumination"],
                "days_from_today": i,
            })
    
    # Calcular datos solares
    sun_data = calculate_sun_times(lat, lng, tz_str, dt)
    
    # Calcular duración del día (en horas)
    try:
        sunrise = datetime.strptime(sun_data["sunrise"], "%H:%M")
        sunset = datetime.strptime(sun_data["sunset"], "%H:%M")
        # Calcular diferencia (considerando que puede cruzar medianoche)
        if sunset > sunrise:
            day_duration = (sunset - sunrise).total_seconds() / 3600
        else:
            # Si sunset < sunrise, asumir que es al día siguiente
            day_duration = (timedelta(days=1) - (sunrise - sunset)).total_seconds() / 3600
    except (ValueError, KeyError):
        day_duration = None
    
    # Información adicional
    result = {
        "current_moon": moon_data,
        "sun_data": {
            "sunrise": sun_data.get("sunrise"),
            "sunset": sun_data.get("sunset"),
            "solar_noon": sun_data.get("solar_noon"),
            "dawn": sun_data.get("dawn"),
            "dusk": sun_data.get("dusk"),
            "precision": sun_data.get("precision", "unknown"),
        },
        "day_duration_hours": round(day_duration, 2) if day_duration is not None else None,
        "next_phases": next_phases[:5],  # Limitar a 5 próximas fases más relevantes
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    
    return result


def get_astronomical_events(
    start_date: date,
    end_date: date,
    lat: float = 39.986,
    lng: float = -0.051,
    tz_str: str = "Europe/Madrid"
) -> List[Dict[str, Any]]:
    """Calcula eventos astronómicos en un rango de fechas.
    
    Incluye fases lunares significativas (nueva, llena, cuartos)
    y opcionalmente solsticios/equinoccios si están en el rango.
    
    Args:
        start_date: Fecha de inicio
        end_date: Fecha de fin
        lat: Latitud para cálculos solares (opcional)
        lng: Longitud para cálculos solares (opcional)
        tz_str: Zona horaria (opcional)
    
    Returns:
        Lista de eventos astronómicos con fecha, tipo y descripción
    """
    events = []
    current_date = start_date
    
    # Fase lunar anterior para detectar cambios consecutivos
    # Rastrear la última fase significativa encontrada para evitar duplicados en días consecutivos
    prev_phase = None
    prev_phase_date = None
    
    while current_date <= end_date:
        current_dt = datetime.combine(current_date, datetime.min.time()).replace(tzinfo=timezone.utc)
        moon_data = calculate_moon_phase(current_dt)
        phase_name = moon_data["moon_phase"]
        
        # Detectar cambios de fase significativos
        significant_phases = [
            "Luna nueva",
            "Luna llena",
            "Cuarto creciente",
            "Cuarto menguante"
        ]
        
        if phase_name in significant_phases:
            # Solo agregar si:
            # 1. Es la primera fase significativa encontrada (prev_phase is None), O
            # 2. Es un cambio de fase (prev_phase != phase_name), O
            # 3. Es la misma fase pero han pasado >= 25 días (nuevo ciclo lunar)
            should_add = False
            
            if prev_phase is None:
                # Primera fase significativa encontrada
                should_add = True
            elif prev_phase != phase_name:
                # Cambio de fase significativa
                should_add = True
            elif prev_phase == phase_name and prev_phase_date:
                # Misma fase - verificar si han pasado suficientes días para un nuevo ciclo
                # Período sinódico de la luna: ~29.53 días, usar 25 días como umbral seguro
                days_since_last = (current_date - prev_phase_date).days
                if days_since_last >= 25:
                    # Nuevo ciclo lunar - misma fase en ciclo siguiente
                    should_add = True
            
            if should_add:
                events.append({
                    "date": current_date.isoformat(),
                    "type": "moon_phase",
                    "description": f"{phase_name} ({moon_data['moon_illumination']}% iluminada)",
                    "illumination": moon_data["moon_illumination"],
                    "moon_phase": phase_name,
                })
                prev_phase = phase_name
                prev_phase_date = current_date
        # Nota: No resetear prev_phase cuando encontramos una fase no significativa
        # Esto permite detectar correctamente cambios cuando vuelve una fase significativa
        # después de días con fases intermedias
        
        # Detectar solsticios y equinoccios (aproximados)
        # Usar rangos para cubrir años normales y bisiestos
        month = current_date.month
        day = current_date.day
        
        # Solsticio de verano (hemisferio norte): ~20-22 de junio
        # Día del año: 171-173 (año normal) o 172-174 (bisiesto)
        if month == 6 and 20 <= day <= 22:
            # Usar día específico (21 de junio es más común)
            if day == 21:
                events.append({
                    "date": current_date.isoformat(),
                    "type": "solstice",
                    "description": "Solsticio de verano (hemisferio norte)",
                    "season": "summer",
                })
        
        # Equinoccio de otoño: ~22-24 de septiembre
        # Día del año: 265-267 (año normal) o 266-268 (bisiesto)
        elif month == 9 and 22 <= day <= 24:
            # Usar día específico (23 de septiembre es más común)
            if day == 23:
                events.append({
                    "date": current_date.isoformat(),
                    "type": "equinox",
                    "description": "Equinoccio de otoño",
                    "season": "autumn",
                })
        
        # Solsticio de invierno: ~20-22 de diciembre
        # Día del año: 354-356 (año normal) o 355-357 (bisiesto)
        elif month == 12 and 20 <= day <= 22:
            # Usar día específico (21 de diciembre es más común)
            if day == 21:
                events.append({
                    "date": current_date.isoformat(),
                    "type": "solstice",
                    "description": "Solsticio de invierno (hemisferio norte)",
                    "season": "winter",
                })
        
        # Equinoccio de primavera: ~19-21 de marzo
        # Día del año: 78-80 (año normal) o 79-81 (bisiesto)
        elif month == 3 and 19 <= day <= 21:
            # Usar día específico (20 de marzo es más común)
            if day == 20:
                events.append({
                    "date": current_date.isoformat(),
                    "type": "equinox",
                    "description": "Equinoccio de primavera",
                    "season": "spring",
                })
        
        current_date += timedelta(days=1)
    
    return events


async def fetch_google_calendar_events(
    api_key: str,
    calendar_id: str,
    days_ahead: int = 14,
    max_results: int = 10,
    time_min: Optional[datetime] = None,
    time_max: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """Obtiene eventos de Google Calendar de forma asíncrona."""
    try:
        if time_min is None:
            time_min = datetime.now(timezone.utc)
        if time_max is None:
            time_max = time_min + timedelta(days=days_ahead)
        
        time_min_str = time_min.isoformat()
        time_max_str = time_max.isoformat()
        
        url = f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"
        params = {
            "key": api_key,
            "timeMin": time_min_str,
            "timeMax": time_max_str,
            "maxResults": max_results,
            "orderBy": "startTime",
            "singleEvents": "true",
        }
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
        
        events = []
        for item in data.get("items", []):
            event: Dict[str, Any] = {
                "title": item.get("summary", "Evento sin título"),
                "location": item.get("location", ""),
            }
            start = item.get("start", {})
            if "dateTime" in start:
                event["start"] = start["dateTime"]
                event["allDay"] = False 
            elif "date" in start:
                event["start"] = start["date"]
                event["allDay"] = True
            
            end = item.get("end", {})
            if "dateTime" in end:
                event["end"] = end["dateTime"]
            elif "date" in end:
                event["end"] = end["date"]
            else:
                event["end"] = event.get("start", "")
            
            events.append(event)
        return events
    except Exception as exc:
        logger.error(f"Error fetching Google Calendar events: {exc}")
        return []

