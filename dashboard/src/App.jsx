import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Boxes, Cpu } from 'lucide-react';
import { api } from './api.js';
import { diffFinished, notifyFinished, snapshotStatuses } from './notifications.js';
import NewAppForm from './components/NewAppForm.jsx';
import ProjectList from './components/ProjectList.jsx';
import ProjectDetail from './components/ProjectDetail.jsx';
import QueuePanel from './components/QueuePanel.jsx';
import SetupGate from './components/SetupGate.jsx';
import DesignTab from './components/DesignTab.jsx';

const parseHash = () => {
  const m = window.location.hash.match(/^#\/p\/([a-z0-9-]+)/);
  if (m) return { view: 'detail', slug: m[1] };
  const c = window.location.hash.match(/[?&]clone=([a-z0-9-]+)/)?.[1] ?? null;
  if (window.location.hash.startsWith('#/design')) return { view: 'design' };
  if (window.location.hash.startsWith('#/fullstack')) return { view: 'fullstack', clone: c };
  return { view: 'list', clone: c };
};

export default function App() {
  const [route, setRoute] = useState(parseHash);
  const [projects, setProjects] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [worker, setWorker] = useState(null);
  const [apiDown, setApiDown] = useState(false);
  // undefined = cargando, null = sin motor configurado → setup gate
  const [engine, setEngine] = useState(undefined);
  const [gateOpen, setGateOpen] = useState(false);
  // null = aún no hubo poll de jobs → sin notificaciones en la 1ra carga
  const prevJobs = useRef(null);
  const [notifPerm, setNotifPerm] = useState(() =>
    'Notification' in window ? Notification.permission : 'unsupported',
  );

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Clone: enruta al tab según el scope del proyecto origen —
  // backend → tab Backend (#/), resto → tab Fullstack (#/fullstack).
  useEffect(() => {
    if (!route.clone) return;
    api
      .project(route.clone)
      .then((p) => {
        const want = p?.scope === 'fullstack' ? '#/fullstack' : '#/';
        if (!window.location.hash.startsWith(want)) {
          window.location.hash = `${want}?clone=${route.clone}`;
        }
      })
      .catch(() => {});
  }, [route.clone]);

  const refresh = useCallback(async () => {
    try {
      const [p, j, o] = await Promise.all([api.projects(), api.jobs(), api.options()]);
      setProjects(p);
      setJobs(j.jobs ?? []);
      setWorker(j.worker ?? null);
      setEngine(o.engine ?? null);
      setApiDown(false);
    } catch {
      setApiDown(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  // Cada poll compara con el snapshot anterior: el que pasó a terminal
  // dispara un Notification del OS (solo si el permiso está y la pestaña
  // está en background — si la mirás, ya ves el chip cambiar).
  useEffect(() => {
    for (const j of diffFinished(prevJobs.current, jobs)) notifyFinished(j);
    prevJobs.current = snapshotStatuses(jobs);
  }, [jobs]);

  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'pending').length;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <a href="#/" className="flex items-center gap-2 font-bold tracking-tight text-slate-900">
            <Boxes size={20} className="text-sky-600" /> MetaBuilder
          </a>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {notifPerm === 'default' && (
              <button
                title="Notificaciones del browser al terminar un run"
                onClick={async () => setNotifPerm(await Notification.requestPermission())}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                <Bell size={13} /> avisar al terminar
              </button>
            )}
            {notifPerm === 'granted' && (
              <span title="Notificaciones activas — avisa al terminar un run con la pestaña en background" className="inline-flex items-center gap-1 text-slate-400">
                <Bell size={13} className="text-emerald-600" /> avisos on
              </span>
            )}
            {notifPerm === 'denied' && (
              <span title="Notificaciones bloqueadas por el navegador" className="inline-flex items-center gap-1 text-slate-400">
                <BellOff size={13} />
              </span>
            )}
            {engine && (
              <button
                title="Cambiar motor de agente"
                onClick={() => setGateOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                <Cpu size={13} /> motor: {engine}
              </button>
            )}
            {running > 0 && <span className="text-sky-700 font-semibold">{running} corriendo</span>}
            {queued > 0 && <span>{queued} en cola</span>}
            <span className={`inline-flex items-center gap-1.5 ${apiDown ? 'text-red-600' : 'text-emerald-700'}`}>
              <span className={`h-2 w-2 rounded-full ${apiDown ? 'bg-red-500' : 'bg-emerald-500'}`} />
              api {apiDown ? 'caída' : 'ok'}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        {!apiDown && (engine === null || gateOpen) && engine !== undefined && (
          <SetupGate
            current={engine}
            onDone={(e) => {
              setEngine(e);
              setGateOpen(false);
              refresh();
            }}
          />
        )}
        {apiDown && (
          <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
            La API no responde — levantala con <code className="font-mono">npm run dashboard</code>.
          </p>
        )}
        {engine !== null && !gateOpen && route.view !== 'detail' && (
          <nav className="flex gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200 shadow-sm">
            {[
              ['list', 'Backend', '#/'],
              ['design', 'Diseñar app', '#/design'],
              ['fullstack', 'Fullstack', '#/fullstack'],
            ].map(([v, label, href]) => (
              <a
                key={v}
                href={href}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  route.view === v
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
        )}
        {engine !== null && !gateOpen && (
          route.view === 'detail' ? (
            <ProjectDetail slug={route.slug} onChanged={refresh} />
          ) : route.view === 'design' ? (
            <DesignTab
              onSaved={(slug) => {
                // Guardado → detalle del proyecto: ahí vive "agregar
                // backend" para completar el flujo diseño→fullstack.
                window.location.hash = `#/p/${slug}`;
                refresh();
              }}
            />
          ) : route.view === 'fullstack' ? (
            // Tab "Fullstack": el formulario existente, scope fijo —
            // genera front+back en un solo run (la vía rápida).
            <NewAppForm fixedScope="fullstack" onEnqueued={refresh} cloneSlug={route.clone} />
          ) : (
            <>
              <NewAppForm fixedScope="backend" onEnqueued={refresh} cloneSlug={route.clone} />
              <QueuePanel jobs={jobs} worker={worker} onChanged={refresh} />
              <ProjectList projects={projects} />
            </>
          )
        )}
      </main>
    </div>
  );
}
