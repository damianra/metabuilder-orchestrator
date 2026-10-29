// Helpers puros de formato — sin dependencias de React (testeables).

export const STATUS_META = {
  done: { label: 'done', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-300' },
  running: { label: 'running', cls: 'bg-accent-500/20 text-accent-300 ring-accent-300 animate-pulse' },
  pending: { label: 'pending', cls: 'bg-slate-800 text-slate-300 ring-accent-500/50' },
  failed: { label: 'failed', cls: 'bg-red-100 text-red-800 ring-red-300' },
  cancelled: { label: 'cancelled', cls: 'bg-slate-800 text-slate-400 ring-accent-500/50' },
  cancelling: { label: 'cancelling', cls: 'bg-amber-500/15 text-amber-300 ring-amber-300 animate-pulse' },
  verified: { label: 'verified', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-300' },
};

export const statusMeta = (status) =>
  STATUS_META[status] ?? { label: status ?? 'desconocido', cls: 'bg-slate-800 text-slate-400 ring-accent-500/50' };

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

// Extrae el bloque fenced ```proposal de una respuesta del agente del
// chat de diseño. Devuelve {text, proposal|null}: text sin el bloque
// (lo que va al bubble) y proposal saneado — question + hasta 4
// opciones con label. JSON malformado o sin opciones válidas → null
// (degrada a texto plano; el bloque se oculta igual).
export function parseProposal(text) {
  const m = (text ?? '').match(/```proposal\s*\n([\s\S]*?)```/);
  if (!m) return { text, proposal: null };
  const clean = text.replace(m[0], '').trim();
  try {
    const p = JSON.parse(m[1]);
    const options = (Array.isArray(p.options) ? p.options : [])
      .filter((o) => o && typeof o.label === 'string' && o.label.trim())
      .slice(0, 4);
    if (!options.length) return { text: clean, proposal: null };
    return {
      text: clean,
      proposal: { question: typeof p.question === 'string' ? p.question : '', options },
    };
  } catch {
    return { text: clean, proposal: null };
  }
}
