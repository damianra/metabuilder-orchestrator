import { ListOrdered, TriangleAlert } from 'lucide-react';
import { jobSummary } from '../util.js';

const chip = (status) =>
  status === 'done'
    ? 'bg-emerald-100 text-emerald-800'
    : status === 'failed'
      ? 'bg-red-100 text-red-800'
      : status === 'running'
        ? 'bg-sky-100 text-sky-800 animate-pulse'
        : 'bg-slate-100 text-slate-600';

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

export default function QueuePanel({ jobs, worker }) {
  const active = jobs.filter((j) => j.status === 'pending' || j.status === 'running');
  const recent = jobs.filter((j) => !active.includes(j)).slice(-5).reverse();
  const shown = [...active, ...recent];
  const stalled = active.some((j) => j.status === 'pending') && worker && !worker.alive;
  if (!shown.length) return null;

  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
        <ListOrdered size={16} className="text-slate-500" /> Cola ({active.length} activos)
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
          <li key={j.id} className="flex items-center gap-3">
            <span className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-semibold ${chip(j.status)}`}>
              {j.status}
            </span>
            <span className="truncate text-slate-600">
              #{j.id} {jobSummary(j.args)}
              <span className="text-slate-400">{progress(j)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
