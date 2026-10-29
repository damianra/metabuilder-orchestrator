"""Capa de datos: SQLAlchemy 2 sobre `DATABASE_URL` (env, default
sqlite local). Espejo de `server/db.js` del api-skeleton Express:
engine único, `get_db` como dependencia FastAPI y `init_db()`
idempotente (create_all + seed solo si la tabla está vacía)."""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///./app.db')

# sqlite necesita check_same_thread=False con el thread pool de
# FastAPI; los engines TCP (postgres/mysql) no aceptan ese arg.
connect_args = {'check_same_thread': False} if DATABASE_URL.startswith('sqlite') else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    # Importar models/seed acá registra las entities en Base.metadata
    # antes del create_all (evita el import circular arriba).
    from . import models, seed

    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        seed.seed_if_empty(db)
    finally:
        db.close()
