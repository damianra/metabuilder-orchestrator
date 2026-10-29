"""Models ODMantic — son pydantic: van directo como response_model en
los routers (no hace falta schemas.py separado como en el stack SQL).
Un recurso nuevo = una clase Model acá + su router en app/routers/."""
from datetime import datetime, timezone

from odmantic import Field, Model


class Item(Model):
    name: str = Field(max_length=120)
    description: str = ''
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
