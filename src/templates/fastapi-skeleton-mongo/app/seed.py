"""Datos iniciales — se insertan solo si la colección está vacía
(espejo de server/seed-data.js). Para apps custom los escribe el
builder; un vertical puede proveer los suyos via overlay."""
from .models import Item

ITEMS = []


async def seed_if_empty(engine):
    if await engine.count(Item) == 0:
        await engine.save_all([Item(**row) for row in ITEMS])
