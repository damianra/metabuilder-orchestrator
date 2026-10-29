"""App FastAPI base — espejo de `server/app.js` del api-skeleton
Express. Convención de auto-mount: cada `app/routers/<name>.py` que
exporte `router` (APIRouter) se monta en `/api/<name>` — agregar un
endpoint es agregar un archivo, no hay nada que registrar."""
import importlib
import os
import pkgutil
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

load_dotenv()

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# Rate limit in-memory por IP solo en métodos de escritura (espejo de
# server/security.js — 20 req/min; los 429 también quedan logueados).
RATE_WINDOW_S = 60
RATE_MAX = 20
_rate = {}


@asynccontextmanager
async def lifespan(_app):
    from .db import init_db

    await init_db()
    yield


app = FastAPI(title=os.getenv('APP_NAME', 'app'), lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.middleware('http')
async def log_rate_secure(request, call_next):
    ip = request.client.host if request.client else '?'
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and request.url.path.startswith('/api'):
        now = time.monotonic()
        hits = [t for t in _rate.get(ip, []) if now - t < RATE_WINDOW_S]
        if len(hits) >= RATE_MAX:
            res = JSONResponse({'error': 'rate limited'}, status_code=429)
            print(f'{request.method} {request.url.path} 429 0ms', flush=True)
            return res
        hits.append(now)
        _rate[ip] = hits
    t0 = time.monotonic()
    res = await call_next(request)
    res.headers.setdefault('X-Content-Type-Options', 'nosniff')
    res.headers.setdefault('X-Frame-Options', 'DENY')
    res.headers.setdefault('Referrer-Policy', 'no-referrer')
    ms = round((time.monotonic() - t0) * 1000)
    print(f'{request.method} {request.url.path} {res.status_code} {ms}ms', flush=True)
    return res


@app.get('/api/health')
def health():
    return {'ok': True}


# Auto-mount de routers: app/routers/<name>.py con `router` → /api/<name>
ROUTERS_DIR = HERE / 'routers'
for mod in pkgutil.iter_modules([str(ROUTERS_DIR)]):
    if mod.name.startswith('_'):
        continue
    module = importlib.import_module(f'app.routers.{mod.name}')
    router = getattr(module, 'router', None)
    if router is not None:
        app.include_router(router, prefix=f'/api/{mod.name}')


@app.api_route('/api/{_path:path}', methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], include_in_schema=False)
def api_not_found(_path: str):
    raise HTTPException(404, 'not found')


# Frontend build estático (fullstack): dist/ (Vite) u out/ (Next
# export) en la raíz del proyecto — el primero que exista, con SPA
# fallback para GETs que no son /api (mismo contrato que Express).
STATIC_DIR = next(
    (ROOT / name for name in ('dist', 'out') if (ROOT / name / 'index.html').exists()),
    None,
)


@app.get('/{_path:path}', include_in_schema=False)
def spa(_path: str):
    if STATIC_DIR and _path:
        candidate = (STATIC_DIR / _path).resolve()
        if candidate.is_file() and candidate.is_relative_to(STATIC_DIR.resolve()):
            return FileResponse(candidate)
    if STATIC_DIR and (STATIC_DIR / 'index.html').exists():
        return FileResponse(STATIC_DIR / 'index.html')
    raise HTTPException(404, 'not found')
