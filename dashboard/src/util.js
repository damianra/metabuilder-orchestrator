// Helpers puros de formato — sin dependencias de React (testeables).

export const STATUS_META = {
  done: { label: 'done', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-300' },
  running: { label: 'running', cls: 'bg-sky-100 text-sky-800 ring-sky-300 animate-pulse' },
  pending: { label: 'pending', cls: 'bg-slate-100 text-slate-700 ring-slate-300' },
  failed: { label: 'failed', cls: 'bg-red-100 text-red-800 ring-red-300' },
  cancelled: { label: 'cancelled', cls: 'bg-slate-100 text-slate-500 ring-slate-300' },
  cancelling: { label: 'cancelling', cls: 'bg-amber-100 text-amber-800 ring-amber-300 animate-pulse' },
  verified: { label: 'verified', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-300' },
};

export const statusMeta = (status) =>
  STATUS_META[status] ?? { label: status ?? 'desconocido', cls: 'bg-slate-100 text-slate-600 ring-slate-300' };

// "hace 3m" / "hace 2h" / "hace 4d" — null si el timestamp es inválido.
export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'hace un momento';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

// Resume los args de un job a algo legible: "--idea 'blog' --scope x"
// — las parejas --flag valor se conservan juntas (solo --idea/--resume
// se extraen como label, el resto va tal cual).
export function jobSummary(args = []) {
  const rest = [];
  let idea = null;
  let resume = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--idea') idea = args[++i];
    else if (args[i] === '--resume') resume = args[++i];
    else rest.push(args[i]);
  }
  if (resume) return `resume ${resume} ${rest.join(' ')}`.trim();
  const label = idea ? `"${idea.slice(0, 60)}${idea.length > 60 ? '…' : ''}"` : '(sin idea)';
  return `${label} ${rest.join(' ')}`.trim();
}
