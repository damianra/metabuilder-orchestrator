"""Capa de datos: SQLAlchemy 2 sobre `DATABASE_URL` (env, default
sqlite local). Espejo de `server/db.js` del api-skeleton Express:
engine único, `get_db` como dependencia FastAPI e `init_db()`
idempotente (migraciones Alembic a head + seed solo si está vacío).

Migraciones: `run_migrations()` aplica `alembic upgrade head` con el
mismo engine (alembic/env.py lo toma de config.attributes). Sin
revisiones en alembic/versions todavía cae a `create_all` (mismo
comportamiento que antes de Alembic); una DB legacy con tablas pero
sin alembic_version se completa con create_all y se marca con
`stamp head` — así conviven upgrades reales y schemas pre-Alembic."""
import os
from pathlib import Path

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///./app.db')
ALEMBIC_INI = Path(__file__).resolve().parent.parent / 'alembic.ini'
ALEMBIC_VERSIONS = ALEMBIC_INI.parent / 'alembic' / 'versions'

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


def _has_revisions():
    return ALEMBIC_VERSIONS.is_dir() and any(
        p.suffix == '.py' and not p.name.startswith('_')
        for p in ALEMBIC_VERSIONS.iterdir())


def run_migrations(eng=None):
    from alembic import command
    from alembic.config import Config

    eng = eng or engine
    if not _has_revisions():
        # Todavía no se generó la baseline (skeleton recién copiado):
        # schema por metadata, como antes de Alembic.
        Base.metadata.create_all(eng)
        return
    cfg = Config(str(ALEMBIC_INI))
    cfg.attributes['engine'] = eng
    insp = inspect(eng)
    if not insp.has_table('alembic_version') and insp.get_table_names():
        # Schema legacy pre-Alembic: completar drift (create_all solo
        # agrega tablas faltantes) y marcar como migrada a head.
        Base.metadata.create_all(eng)
        command.stamp(cfg, 'head')
    else:
        command.upgrade(cfg, 'head')


def init_db():
    # Importar models/seed acá registra las entities en Base.metadata
    # antes de migrar (evita el import circular arriba).
    from . import models, seed

    run_migrations()
    db = SessionLocal()
    try:
        seed.seed_if_empty(db)
    finally:
        db.close()
