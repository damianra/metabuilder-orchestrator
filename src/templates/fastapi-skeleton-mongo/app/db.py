"""Capa de datos: MongoDB via ODMantic/Motor — espejo de
`api-skeleton-mongo` (driver nativo, schemaless, mismo contrato de
env vars `MONGO_URI`/`MONGO_DB`). `engine` único, `get_engine` como
dependencia FastAPI (los tests la overridean con mongomock) y
`init_db()` async — schemaless: solo seed idempotente."""
import os

from motor.motor_asyncio import AsyncIOMotorClient
from odmantic import AIOEngine

MONGO_URI = os.getenv('MONGO_URI', 'mongodb://localhost:27017')
MONGO_DB = os.getenv('MONGO_DB', 'app')

client = AsyncIOMotorClient(MONGO_URI)
engine = AIOEngine(client=client, database=MONGO_DB)


def get_engine():
    return engine


async def init_db():
    from . import seed

    await seed.seed_if_empty(engine)
