"""CRUD de muestra async. Convención de auto-mount: este archivo se
monta solo en `/api/items` porque exporta `router` — agregar un
endpoint es agregar un archivo en app/routers/."""
from fastapi import APIRouter, Depends, HTTPException
from odmantic import AIOEngine, ObjectId

from ..db import get_engine
from ..models import Item

router = APIRouter()


@router.get('', response_model=list[Item])
async def list_items(engine: AIOEngine = Depends(get_engine)):
    return await engine.find(Item)


@router.post('', response_model=Item, status_code=201)
async def create_item(item: Item, engine: AIOEngine = Depends(get_engine)):
    await engine.save(item)
    return item


@router.get('/{item_id}', response_model=Item)
async def get_item(item_id: ObjectId, engine: AIOEngine = Depends(get_engine)):
    item = await engine.find_one(Item, Item.id == item_id)
    if item is None:
        raise HTTPException(404, 'item not found')
    return item


@router.put('/{item_id}', response_model=Item)
async def update_item(item_id: ObjectId, payload: Item, engine: AIOEngine = Depends(get_engine)):
    item = await engine.find_one(Item, Item.id == item_id)
    if item is None:
        raise HTTPException(404, 'item not found')
    item.name = payload.name
    item.description = payload.description
    await engine.save(item)
    return item


@router.delete('/{item_id}', status_code=204)
async def delete_item(item_id: ObjectId, engine: AIOEngine = Depends(get_engine)):
    item = await engine.find_one(Item, Item.id == item_id)
    if item is None:
        raise HTTPException(404, 'item not found')
    await engine.delete(item)
