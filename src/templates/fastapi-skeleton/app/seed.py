"""Datos iniciales — se insertan solo si la tabla está vacía (espejo
de server/seed-data.js). Para apps custom los escribe el builder;
un vertical puede proveer los suyos via overlay."""
from .models import Item

ITEMS = []


def seed_if_empty(db):
    if db.query(Item).count() == 0:
        db.add_all([Item(**row) for row in ITEMS])
        db.commit()
