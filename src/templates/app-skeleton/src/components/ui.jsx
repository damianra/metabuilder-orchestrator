// Kit de componentes pre-styled (MetaBuilder) — bloques genéricos que
// el agente compone y parametriza en vez de escribir Tailwind desde
// cero. Paleta: neutra (slate) + acento configurable via `accent`
// (mapa de clases completas — Tailwind necesita literales para
// generarlas, nunca strings dinámicos).
import {
  AlertCircle,
  ArrowRight,
  Inbox,
  Sparkles,
} from 'lucide-react';

export const ACCENTS = {
  indigo: {
    text: 'text-indigo-600',
    bg: 'bg-indigo-600',
    bgSoft: 'bg-indigo-50',
    ring: 'ring-indigo-200',
    gradient: 'from-indigo-50 via-white to-white',
    hover: 'hover:bg-indigo-700',
  },
  emerald: {
    text: 'text-emerald-600',
    bg: 'bg-emerald-600',
    bgSoft: 'bg-emerald-50',
    ring: 'ring-emerald-200',
    gradient: 'from-emerald-50 via-white to-white',
    hover: 'hover:bg-emerald-700',
  },
  amber: {
    text: 'text-amber-600',
    bg: 'bg-amber-600',
    bgSoft: 'bg-amber-50',
    ring: 'ring-amber-200',
    gradient: 'from-amber-50 via-white to-white',
    hover: 'hover:bg-amber-700',
  },
};

const a = (accent) => ACCENTS[accent] ?? ACCENTS.indigo;

/** Sección estándar — contenedor centrado con padding vertical. */
export function Section({ id, children, className = '', wide = false }) {
  return (
    <section id={id} className={`py-16 ${className}`}>
      <div className={`${wide ? 'max-w-7xl' : 'max-w-6xl'} mx-auto px-6`}>{children}</div>
    </section>
  );
}

/** Navbar simple — nombre/logo + links de ancla. */
export function Navbar({ brand, links = [], accent = 'indigo' }) {
  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-slate-200">
      <nav className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-6">
        <a href="#top" className="font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Sparkles size={16} className={a(accent).text} /> {brand}
        </a>
        <div className="ml-auto flex items-center gap-4">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-sm text-slate-600 hover:text-slate-900">
              {l.label}
            </a>
          ))}
        </div>
      </nav>
    </header>
  );
}

/** Hero — gradiente sutil + badge + título + CTA. Nunca un div vacío. */
export function Hero({ badge, title, subtitle, cta, accent = 'indigo' }) {
  return (
    <section className={`bg-gradient-to-b ${a(accent).gradient}`}>
      <div className="max-w-6xl mx-auto px-6 py-24 text-center">
        {badge && (
          <span className={`inline-flex items-center gap-2 rounded-full ${a(accent).bgSoft} ${a(accent).text} px-3 py-1 text-xs font-semibold ring-1 ${a(accent).ring}`}>
            <Sparkles size={13} /> {badge}
          </span>
        )}
        <h1 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-4 text-base text-slate-600 max-w-2xl mx-auto">{subtitle}</p>}
        {cta && (
          <a
            href={cta.href}
            className={`mt-8 inline-flex items-center gap-2 rounded-full ${a(accent).bg} px-6 py-3 text-sm font-semibold text-white ${a(accent).hover} transition`}
          >
            {cta.label} <ArrowRight size={15} />
          </a>
        )}
      </div>
    </section>
  );
}

/** Card estándar — ring + shadow + hover. */
export function Card({ icon: Icon, title, children, className = '', accent = 'indigo' }) {
  return (
    <div className={`rounded-2xl bg-white p-6 ring-1 ring-slate-200 shadow-sm hover:shadow-md transition ${className}`}>
      {Icon && <Icon size={20} className={`${a(accent).text} mb-3`} />}
      {title && <h3 className="font-semibold text-slate-900">{title}</h3>}
      <div className="mt-1 text-sm text-slate-600">{children}</div>
    </div>
  );
}

/** Stat — label + valor grande (+ opcional icon). */
export function StatCard({ label, value, icon: Icon, accent = 'indigo' }) {
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        {Icon && <Icon size={16} className={a(accent).text} />}
      </div>
      <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
    </div>
  );
}

/** Empty state — la UI nunca queda en blanco ante datos vacíos. */
export function EmptyState({ icon: Icon = Inbox, title = 'Sin datos', message, action }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-10 text-center ring-1 ring-slate-200">
      <Icon size={28} className="mx-auto text-slate-400" />
      <h3 className="mt-3 font-semibold text-slate-700">{title}</h3>
      {message && <p className="mt-1 text-sm text-slate-500">{message}</p>}
      {action}
    </div>
  );
}

/** Error state — feedback legible, nunca el error crudo. */
export function ErrorState({ title = 'Algo salió mal', message, action }) {
  return (
    <div className="rounded-2xl bg-red-50 p-6 ring-1 ring-red-200">
      <div className="flex items-start gap-3">
        <AlertCircle size={20} className="text-red-500 mt-0.5" />
        <div>
          <h3 className="font-semibold text-red-800">{title}</h3>
          {message && <p className="mt-1 text-sm text-red-700">{message}</p>}
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}

/** FormShell — wrapper con submit gateado (disabled hasta válido). */
export function FormShell({ title, children, onSubmit, submitLabel = 'Guardar', disabled = true, accent = 'indigo' }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSubmit?.(e);
      }}
      className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 shadow-sm space-y-4"
    >
      {title && <h3 className="font-semibold text-slate-900">{title}</h3>}
      {children}
      <button
        type="submit"
        disabled={disabled}
        className={`inline-flex items-center gap-2 rounded-full ${a(accent).bg} px-5 py-2.5 text-sm font-semibold text-white ${a(accent).hover} transition disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {submitLabel}
      </button>
    </form>
  );
}

/** CTA — banda final con acento. */
export function CTA({ title, subtitle, cta, accent = 'indigo' }) {
  return (
    <section className={`${a(accent).bg}`}>
      <div className="max-w-6xl mx-auto px-6 py-16 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-white">{title}</h2>
        {subtitle && <p className="mt-2 text-white/80 text-sm">{subtitle}</p>}
        {cta && (
          <a
            href={cta.href}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition"
          >
            {cta.label} <ArrowRight size={15} />
          </a>
        )}
      </div>
    </section>
  );
}
