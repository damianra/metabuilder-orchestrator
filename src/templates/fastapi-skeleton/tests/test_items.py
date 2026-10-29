"""Tests pytest del skeleton — TestClient + sqlite de prueba.
DATABASE_URL se pisa ANTES de importar la app (el engine se arma al
importar app.db); init_db() corre en fixture porque el lifespan solo
dispara dentro de `with TestClient(app)`."""
import os

os.environ['DATABASE_URL'] = 'sqlite:///./test.db'

import pytest
from fastapi.testclient import TestClient

from app.db import init_db
from app.main import app

client = TestClient(app)


@pytest.fixture(scope='module', autouse=True)
def _db():
    init_db()
    yield
    if os.path.exists('test.db'):
        os.remove('test.db')


def test_health():
    assert client.get('/api/health').json() == {'ok': True}


def test_items_crud():
    r = client.post('/api/items', json={'name': 'demo', 'description': 'x'})
    assert r.status_code == 201
    item = r.json()
    assert item['id'] >= 1

    items = client.get('/api/items').json()
    assert any(i['name'] == 'demo' for i in items)

    r = client.put(f"/api/items/{item['id']}", json={'name': 'demo2', 'description': 'y'})
    assert r.status_code == 200
    assert r.json()['name'] == 'demo2'

    assert client.delete(f"/api/items/{item['id']}").status_code == 204
    assert client.get(f"/api/items/{item['id']}").status_code == 404
