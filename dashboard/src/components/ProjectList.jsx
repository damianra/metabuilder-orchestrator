import { Container, FolderOpen } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { timeAgo } from '../util.js';

export default function ProjectList({ projects }) {
  if (!projects.length) {
    return (
      <div className="rounded-2xl bg-white p-10 text-center ring-1 ring-slate-200">
        <FolderOpen size={32} className="mx-auto text-slate-300" />
        <p className="mt-3 text-sm text-slate-500">Todavía no hay proyectos en generated-apps/.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => {
        const pct = p.steps.total ? Math.round((p.steps.done / p.steps.total) * 100) : 0;
        return (
          <a
            key={p.slug}
            href={`#/p/${p.slug}`}
            className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 shadow-sm hover:shadow-md transition block"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold tracking-tight text-slate-900 truncate">{p.name}</h3>
              <StatusBadge status={p.status} />
            </div>
            <p className="mt-1 text-xs text-slate-500 truncate">{p.slug}</p>

            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              {p.scope && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{p.scope}</span>}
              {p.appType && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{p.appType}</span>}
              {p.arch && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">arch {p.arch}</span>}
              {p.hasDockerfile && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">
                  <Container size={11} /> docker
                </span>
              )}
            </div>

            <div className="mt-4">
              <div className="flex justify-between text-xs text-slate-500">
                <span>pasos {p.steps.done}/{p.steps.total}</span>
                <span>{timeAgo(p.updatedAt)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${p.steps.failed ? 'bg-red-500' : 'bg-sky-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            {p.lastError && <p className="mt-2 text-xs text-red-600 truncate">{p.lastError}</p>}
          </a>
        );
      })}
    </div>
  );
}
