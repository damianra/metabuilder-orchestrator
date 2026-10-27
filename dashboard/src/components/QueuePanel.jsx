import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ListOrdered, LoaderCircle, RotateCcw, Square, Trash2, TriangleAlert } from 'lucide-react';
import { api } from '../api.js';
import { jobSummary, timeAgo } from '../util.js';

const chip = (j) =>
  j.cancelRequested
    ? 'bg-amber-100 text-amber-800 animate-pulse'
    : j.status === 'done'
      ? 'bg-emerald-100 text-emerald-800'
      : j.status === 'failed'
        ? 'bg-red-100 text-red-800'
        : j.status === 'running'
          ? 'bg-sky-100 text-sky-800 animate-pulse'
          : 'bg-slate-100 text-slate-600';

// pending → borrar; running → flag cancelRequested y el worker mata el
// árbol del run. Mientras se procesa se muestra "cancelando".
const canCancel = (j) =>
  (j.status === 'pending' || j.status === 'running') && !j.cancelRequested;

// Terminado mal → re-encola los mismos args (cubre "murió en preflight"
// donde no hay app que resumir). 'done' no: regenerar sobre una app
// terminada casi nunca es lo que se quiere.
const canRetry = (j) => j.status === 'failed' || j.status === 'cancelled';

// Texto del stepper: pending → running (nodo + paso del pipeline) →
// done/failed. progress viene del status.json de la app (lo enriquece
// GET /api/jobs).
const progress = (j) => {
  if (j.status === 'running' && j.progress?.totalSteps) {
    const where = j.progress.node ? ` · ${j.progress.node}` : '';
    return ` paso ${j.progress.step}/${j.progress.totalSteps}${where}`;
  }
  if (j.status === 'running') return ' iniciando…';
  if (j.status === 'pending') return ' en cola';
  return '';
};

// Duración createdAt→finishedAt de un job terminado: "5m 12s".
// null si falta alguna punta, no parsea o viene invertida.
const duration = (j) => {
  const a = Date.parse(j.createdAt);
  const b = Date.parse(j.finishedAt);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  const s = Math.floor((b - a) / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
};

function JobRow({ j, onChanged }) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const running = j.status === 'running';

  // Log del job: fetch on-demand al abrir el acordeón; refresh cada 4s
  // solo mientras siga corriendo (terminado → una sola lectura).
  useEffect(() => {
    if (!open) return;
    const load = () => api.jobLog(j.id, 15).then(setLog).catch(() => {});
    load();
    if (!running) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [open, running, j.id]);

  const lines = log?.log?.lines?.slice(-15) ?? null;
  const dur = j.finishedAt ? duration(j) : null;

  return (
    <li>
      <div className="flex items-center gap-3">
        <button
          title={open ? 'Ocultar log del job' : 'Ver log del job'}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-slate-400 hover:text-slate-600"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-semibold ${chip(j)}`}>
          {j.cancelRequested ? 'cancelando' : j.status}
        </span>
        <span className="truncate text-slate-600">
          #{j.id} {jobSummary(j.args)}
          <span className="inline-flex items-center gap-1 text-slate-400">
            {j.status === 'running' && <LoaderCircle size={13} className="animate-spin" />}
            {progress(j)}
          </span>
        </span>
        <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-slate-400">
          {timeAgo(j.createdAt)}
          {dur ? ` (${dur})` : ''}
        </span>
        {canCancel(j) && (
          <button
            title="Cancelar job"
            disabled={cancelBusy}
            onClick={async () => {
              setCancelBusy(true);
              try {
                await api.cancelJob(j.id);
              } finally {
                setCancelBusy(false);
                onChanged?.();
              }
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-40"
          >
            {cancelBusy ? (
              <LoaderCircle size={12} className="animate-spin" />
            ) : (
              <Square size={11} />
            )}
            cancelar
          </button>
        )}
        {canRetry(j) && (
          <button
            title="Re-encola los mismos args"
            disabled={retryBusy}
            onClick={async () => {
              setRetryBusy(true);
              try {
                await api.requeueJob(j.id);
              } finally {
                setRetryBusy(false);
                onChanged?.();
              }
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-40"
          >
            {retryBusy ? (
              <LoaderCircle size={12} className="animate-spin" />
            ) : (
              <RotateCcw size={11} />
            )}
            reintentar
          </button>
        )}
      </div>
      {open &&
        (lines?.length ? (
          <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-200 font-mono">
            {lines.join('\n')}
          </pre>
        ) : (
          <p className="mt-1 text-xs text-slate-400">
            sin log todavía — aparece cuando el worker escribe jobs/{j.id}.log
          </p>
        ))}
    </li>
  );
}

export default function QueuePanel({ jobs, worker, onChanged }) {
  const [clearBusy, setClearBusy] = useState(false);
  const isActive = (j) => j.status === 'pending' || j.status === 'running';
  const active = jobs.filter(isActive);
  const finished = jobs.filter((j) => !isActive(j));
  const recent = finished.slice(-5).reverse();
  const hidden = finished.length - recent.length;
  const shown = [...active, ...recent];
  const stalled = active.some((j) => j.status === 'pending') && worker && !worker.alive;
  if (!shown.length) return null;

  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
        <ListOrdered size={16} className="text-slate-500" /> Cola ({active.length} activos)
        {finished.length > 0 && (
          <button
            title="Borra los jobs terminados (done/failed/cancelled) — los activos no se tocan"
            disabled={clearBusy}
            onClick={async () => {
              setClearBusy(true);
              try {
                await api.clearJobs();
              } finally {
                setClearBusy(false);
                onChanged?.();
              }
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-40"
          >
            {clearBusy ? (
              <LoaderCircle size={12} className="animate-spin" />
            ) : (
              <Trash2 size={12} />
            )}
            limpiar terminados
          </button>
        )}
      </h2>
      {stalled && (
        <p className="mt-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          <TriangleAlert size={14} /> sin worker consumiendo la cola — levantá
          <code className="font-mono">npm run dashboard</code> o
          <code className="font-mono">npm run worker</code>
        </p>
      )}
      <ul className="mt-3 space-y-1.5 text-sm">
        {shown.map((j) => (
          <JobRow key={j.id} j={j} onChanged={onChanged} />
        ))}
      </ul>
      {hidden > 0 && (
        <p className="mt-2 text-xs text-slate-400">…y {hidden} terminados más</p>
      )}
    </section>
  );
}
