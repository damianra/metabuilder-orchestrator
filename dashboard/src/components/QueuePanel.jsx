import { ListOrdered } from 'lucide-react';
import { jobSummary } from '../util.js';

export default function QueuePanel({ jobs }) {
  const active = jobs.filter((j) => j.status === 'pending' || j.status === 'running');
  const recent = jobs.filter((j) => !active.includes(j)).slice(-5).reverse();
  const shown = [...active, ...recent];
  if (!shown.length) return null;

  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
        <ListOrdered size={16} className="text-slate-500" /> Cola ({active.length} activos)
      </h2>
      <ul className="mt-3 space-y-1.5 text-sm">
        {shown.map((j) => (
          <li key={j.id} className="flex items-center gap-3">
            <span
              className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-semibold ${
                j.status === 'done'
                  ? 'bg-emerald-100 text-emerald-800'
                  : j.status === 'failed'
                    ? 'bg-red-100 text-red-800'
                    : j.status === 'running'
                      ? 'bg-sky-100 text-sky-800 animate-pulse'
                      : 'bg-slate-100 text-slate-600'
              }`}
            >
              {j.status}
            </span>
            <span className="truncate text-slate-600">#{j.id} {jobSummary(j.args)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
