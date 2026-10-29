"""Tests pytest del skeleton — TestClient + mongomock (sin mongo real,
self-contained como el resto de los skeletons). `get_engine` se
overridea con un engine sobre AsyncMongoMockClient; el lifespan no
corre porque el client no se usa como context manager."""
import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient
from odmantic import AIOEngine

from app.db import get_engine
from app.main import app


client = AsyncMongoMockClient()
engine = AIOEngine(client=client, database='test')
_db = client['test']

# mongomock no soporta sessions y ODMantic las usa solo en writes —
# save/save_all/delete se reimplementan directo sobre la collection
# (upsert/delete por _id, sin session); reads (find/find_one/count)
# corren contra el engine real. Semántica CRUD idéntica para el test.


async def _save(instance):
    col = _db[type(instance).__collection__]
    await col.replace_one({'_id': instance.id}, instance.model_dump_doc(), upsert=True)
    return instance


async def _save_all(instances):
    return [await _save(i) for i in instances]


async def _delete(instance):
    col = _db[type(instance).__collection__]
    await col.delete_one({'_id': instance.id})
    return instance


engine.save = _save
engine.save_all = _save_all
engine.delete = _delete
app.dependency_overrides[get_engine] = lambda: engine

client = TestClient(app)


def test_health():
    assert client.get('/api/health').json() == {'ok': True}


def test_items_crud():
    r = client.post('/api/items', json={'name': 'demo', 'description': 'x'})
    assert r.status_code == 201
    item = r.json()
    assert item['id']

    items = client.get('/api/items').json()
    assert any(i['name'] == 'demo' for i in items)

    r = client.put(f"/api/items/{item['id']}", json={'name': 'demo2', 'description': 'y'})
    assert r.status_code == 200
    assert r.json()['name'] == 'demo2'

    assert client.delete(f"/api/items/{item['id']}").status_code == 204
    assert client.get(f"/api/items/{item['id']}").status_code == 404
