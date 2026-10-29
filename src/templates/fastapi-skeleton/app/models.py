"""Entities SQLAlchemy — un recurso nuevo = una clase Base acá +
su router en app/routers/ + schemas en app/schemas.py."""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String

from .db import Base


class Item(Base):
    __tablename__ = 'items'

    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    description = Column(String(500), default='')
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
