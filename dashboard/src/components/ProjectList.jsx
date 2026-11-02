import { useState } from 'react';
import { Container, FolderOpen, GitBranch, Search, Smartphone } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { timeAgo } from '../util.js';

export default function ProjectList({ projects }) {
  const [q, setQ] = useState('');
  if (!projects.length) {
    return (
      <div className="rounded-lg bg-slate-900 p-10 text-center ring-1 ring-accent-500/40">
        <FolderOpen size={32} className="mx-auto text-slate-300" />
        <p className="mt-3 text-sm text-slate-400">Todavía no hay proyectos en generated-apps/.</p>
      </div>
    );
  }

  // Filtro por slug o status (case-insensitive, substring).
  const query = q.trim().toLowerCase();
  const filtered = query
    ? projects.filter(
        (p) =>
          p.slug.toLowerCase().includes(query) ||
          (p.status ?? '').toLowerCase().includes(query),
      )
    : projects;

  return (
    <div>
      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filtrar por slug o status…"
          className="w-full rounded-lg bg-slate-900 py-2 pl-9 pr-3 text-sm ring-1 ring-accent-500/50 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
      </div>
      {!filtered.length && (
        <p className="mt-4 rounded-lg bg-slate-900 p-8 text-center text-sm text-slate-400 ring-1 ring-accent-500/40">
          sin resultados para '{q}'
        </p>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => {
          const pct = p.steps.total ? Math.round((p.steps.done / p.steps.total) * 100) : 0;
          return (
            <a
              key={p.slug}
              href={`#/p/${p.slug}`}
              className="rounded-lg bg-slate-900 p-5 ring-1 ring-accent-500/40 glow-card hover:shadow-md transition block"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold tracking-tight text-slate-100 truncate">{p.name}</h3>
                <StatusBadge status={p.status} />
              </div>
              <p className="mt-1 text-xs text-slate-400 truncate">{p.slug}</p>

              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                {p.scope && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-400">{p.scope}</span>}
                {p.appType && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-400">{p.appType}</span>}
                {p.arch && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-400">arch {p.arch}</span>}
                {p.mobile && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/15 px-2 py-0.5 text-accent-300">
                    <Smartphone size={11} /> mobile
                  </span>
                )}
                {p.hasDockerfile && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/15 px-2 py-0.5 text-accent-300">
                    <Container size={11} /> docker
                  </span>
                )}
                {p.hasRemote && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/15 px-2 py-0.5 text-accent-300">
                    <GitBranch size={11} /> repo
                  </span>
                )}
              </div>

              <div className="mt-4">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>pasos {p.steps.done}/{p.steps.total}</span>
                  <span>{timeAgo(p.updatedAt)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${p.steps.failed ? 'bg-red-500' : 'bg-accent-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              {p.lastError && <p className="mt-2 text-xs text-red-400 truncate">{p.lastError}</p>}
            </a>
          );
        })}
      </div>
    </div>
  );
}
