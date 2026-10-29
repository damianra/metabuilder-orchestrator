"""Schemas Pydantic del dominio — In para payloads de escritura,
Out para respuestas (from_attributes lee directo de las entities)."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ItemIn(BaseModel):
    name: str
    description: str = ''


class ItemOut(ItemIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
