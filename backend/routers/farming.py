from fastapi import APIRouter
from datetime import datetime

router = APIRouter(prefix="/api/farming", tags=["farming"])

# Calendario de siembra y recolección (España/Hemisferio Norte)
# Simplificado para mostrar qué está de temporada/se puede sembrar este mes.
SEASONAL_CALENDAR = {
    1: {
        "fruits": ["Kiwi", "Limón", "Mandarina", "Manzana", "Naranja", "Plátano"],
        "vegetables": ["Acelga", "Apio", "Borraja", "Brócoli", "Calabaza", "Cardo", "Cebolla", "Coliflor", "Endibia", "Espinaca", "Guisante", "Haba", "Lechuga", "Nabo", "Puerro", "Remolacha", "Zanahoria"],
        "sowing": ["Ajo", "Guisante", "Haba", "Lechuga", "Rabanito", "Espinaca", "Zanahoria"]
    },
    2: {
        "fruits": ["Kiwi", "Limón", "Mandarina", "Naranja", "Plátano", "Fresón"],
        "vegetables": ["Acelga", "Apio", "Brócoli", "Colifor", "Endibia", "Espinaca", "Guisante", "Haba", "Lechuga", "Puerro"],
        "sowing": ["Ajo", "Guisante", "Haba", "Judía", "Lechuga", "Rabanito", "Remolacha", "Zanahoria"]
    },
    3: {
        "fruits": ["Limón", "Mandarina", "Naranja", "Plátano", "Fresón"],
        "vegetables": ["Acelga", "Alcachofa", "Apio", "Brócoli", "Coliflor", "Endibia", "Espárrago", "Espinaca", "Guisante", "Haba", "Lechuga"],
        "sowing": ["Calabacín", "Calabaza", "Melón", "Pepino", "Pimiento", "Tomate", "Berenjena", "Lechuga", "Zanahoria"]
    },
    4: {
        "fruits": ["Fresa", "Limón", "Naranja", "Níspero", "Plátano"],
        "vegetables": ["Acelga", "Alcachofa", "Apio", "Brócoli", "Espárrago", "Espinaca", "Guisante", "Haba", "Lechuga", "Zanahoria"],
        "sowing": ["Acelga", "Apio", "Calabacín", "Calabaza", "Lechuga", "Melón", "Pepino", "Pimiento", "Sandía", "Tomate", "Zanahoria"]
    },
    5: {
        "fruits": ["Albaricoque", "Cereza", "Fresa", "Limón", "Melocotón", "Nectarina", "Níspero", "Plátano"],
        "vegetables": ["Acelga", "Alcachofa", "Apio", "Calabacín", "Espárrago", "Espinaca", "Guisante", "Haba", "Judía", "Lechuga", "Zanahoria"],
        "sowing": ["Apio", "Calabacín", "Coliflor", "Lechuga", "Melón", "Pepino", "Sandía", "Zanahoria"]
    },
    6: {
        "fruits": ["Albaricoque", "Breva", "Cereza", "Ciruela", "Frambuesa", "Melocotón", "Melón", "Nectarina", "Plátano", "Sandía"],
        "vegetables": ["Acelga", "Ajo", "Calabacín", "Calabaza", "Cebolla", "Ejote", "Lechuga", "Pepino", "Pimiento", "Tomate", "Zanahoria"],
        "sowing": ["Acelga", "Brócoli", "Coliflor", "Escarola", "Lechuga", "Zanahoria", "Judía"]
    },
    7: {
        "fruits": ["Albaricoque", "Breva", "Ciruela", "Frambuesa", "Higo", "Melocotón", "Melón", "Nectarina", "Paraguaya", "Pera", "Plátano", "Sandía"],
        "vegetables": ["Acelga", "Ajo", "Berenjena", "Calabacín", "Calabaza", "Cebolla", "Ejote", "Lechuga", "Pepino", "Pimiento", "Tomate", "Zanahoria"],
        "sowing": ["Acelga", "Brócoli", "Col", "Coliflor", "Escarola", "Espinaca", "Lechuga", "Nabo", "Zanahoria"]
    },
    8: {
        "fruits": ["Ciruela", "Frambuesa", "Higo", "Mango", "Manzana", "Melocotón", "Melón", "Membrillo", "Nectarina", "Paraguaya", "Pera", "Plátano", "Sandía", "Uva"],
        "vegetables": ["Acelga", "Berenjena", "Calabacín", "Calabaza", "Cebolla", "Ejote", "Lechuga", "Pepino", "Pimiento", "Tomate", "Zanahoria"],
        "sowing": ["Acelga", "Cebolla", "Col", "Coliflor", "Escarola", "Espinaca", "Haba", "Lechuga", "Nabo", "Zanahoria"]
    },
    9: {
        "fruits": ["Caqui", "Ciruela", "Granada", "Higo", "Mango", "Manzana", "Melocotón", "Melón", "Membrillo", "Pera", "Plátano", "Uva"],
        "vegetables": ["Acelga", "Berenjena", "Calabaza", "Cebolla", "Espinaca", "Lechuga", "Pepino", "Pimiento", "Puerro", "Tomate", "Zanahoria"],
        "sowing": ["Acelga", "Apio", "Cebolla", "Espinaca", "Guisante", "Haba", "Lechuga", "Perejil", "Rabanito", "Zanahoria"]
    },
    10: {
        "fruits": ["Caqui", "Chirimoya", "Granada", "Kiwi", "Limón", "Mandarina", "Mango", "Manzana", "Membrillo", "Pera", "Plátano", "Uva"],
        "vegetables": ["Acelga", "Alcachofa", "Apio", "Batata", "Berenjena", "Brocoli", "Calabaza", "Cebolla", "Col", "Coliflor", "Endibia", "Espinaca", "Lechuga", "Pimiento", "Puerro", "Zanahoria"],
        "sowing": ["Acelga", "Ajo", "Apio", "Cebolla", "Espinaca", "Guisante", "Haba", "Lechuga", "Rabanito", "Zanahoria"]
    },
    11: {
        "fruits": ["Caqui", "Chirimoya", "Granada", "Kiwi", "Limón", "Mandarina", "Mango", "Manzana", "Naranja", "Pera", "Plátano", "Uva"],
        "vegetables": ["Acelga", "Alcachofa", "Apio", "Batata", "Borraja", "Brócoli", "Calabaza", "Cardo", "Cebolla", "Col", "Coliflor", "Endibia", "Escarola", "Espinaca", "Guisante", "Lechuga", "Nabo", "Puerro", "Zanahoria"],
        "sowing": ["Ajo", "Apio", "Cebolla", "Espinaca", "Guisante", "Haba", "Lechuga", "Rabanito", "Zanahoria"]
    },
    12: {
        "fruits": ["Caqui", "Chirimoya", "Kiwi", "Limón", "Mandarina", "Manzana", "Naranja", "Pera", "Plátano", "Uva"],
        "vegetables": ["Acelga", "Alcachofa", "Apio", "Brócoli", "Calabaza", "Cardo", "Col", "Coliflor", "Endibia", "Escarola", "Espinaca", "Guisante", "Haba", "Lechuga", "Nabo", "Puerro", "Remolacha", "Zanahoria"],
        "sowing": ["Ajo", "Cebolla", "Espinaca", "Guisante", "Haba", "Lechuga", "Rabanito", "Tomate (semillero)", "Zanahoria"]
    }
}

@router.get("/current")
def get_current_farming_info():
    """
    Devuelve la información de cultivo (frutas, verduras, siembra) para el mes actual.
    """
    month = datetime.now().month
    data = SEASONAL_CALENDAR.get(month, {})
    
    return {
        "month": month,
        "fruits": data.get("fruits", []),
        "vegetables": data.get("vegetables", []),
        "sowing": data.get("sowing", [])
    }
