"""CRUD de muestra. Convención de auto-mount: este archivo se monta
solo en `/api/items` porque exporta `router` — agregar un endpoint es
agregar un archivo en app/routers/, no hay nada que registrar."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Item
from ..schemas import ItemIn, ItemOut

router = APIRouter()


@router.get('', response_model=list[ItemOut])
def list_items(db: Session = Depends(get_db)):
    return db.query(Item).order_by(Item.id).all()


@router.post('', response_model=ItemOut, status_code=201)
def create_item(payload: ItemIn, db: Session = Depends(get_db)):
    item = Item(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get('/{item_id}', response_model=ItemOut)
def get_item(item_id: int, db: Session = Depends(get_db)):
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, 'item not found')
    return item


@router.put('/{item_id}', response_model=ItemOut)
def update_item(item_id: int, payload: ItemIn, db: Session = Depends(get_db)):
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, 'item not found')
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete('/{item_id}', status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db)):
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, 'item not found')
    db.delete(item)
    db.commit()
