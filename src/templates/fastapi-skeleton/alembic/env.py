"""Alembic env — resolución de URL por prioridad:

1. `config.attributes['engine']` — cuando init_db() corre las
   migraciones con el engine ya construido (tests/app en proceso).
2. `DATABASE_URL` de env/.env — uso por CLI (`alembic upgrade head`).
3. `sqlalchemy.url` del alembic.ini (sqlite local de fallback).
"""
import os
from logging.config import fileConfig

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import Connection, engine_from_config, pool

load_dotenv()

config = context.config
if config.config_file_name is not None and config.get_section('loggers'):
    fileConfig(config.config_file_name)

from app.db import Base, DATABASE_URL  # noqa: E402
import app.models  # noqa: E402,F401 — registra las entities en metadata

target_metadata = Base.metadata


def _url():
    return (os.getenv('DATABASE_URL')
            or config.get_main_option('sqlalchemy.url')
            or DATABASE_URL)


def run_migrations_offline():
    context.configure(url=_url(), target_metadata=target_metadata,
                      literal_binds=True,
                      dialect_opts={'paramstyle': 'named'})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = config.attributes.get('engine')
    if connectable is None:
        url = _url()
        connect_args = ({'check_same_thread': False}
                        if url.startswith('sqlite') else {})
        connectable = engine_from_config(
            {'sqlalchemy.url': url}, prefix='sqlalchemy.',
            poolclass=pool.NullPool, connect_args=connect_args)
    if isinstance(connectable, Connection):
        context.configure(connection=connectable,
                          target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
        return
    with connectable.connect() as connection:
        context.configure(connection=connection,
                          target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
