import { useEffect, useState } from 'react';
import {
  Archive,
  Clipboard,
  ClipboardCheck,
  LoaderCircle,
  MonitorSmartphone,
  PackageOpen,
  Smartphone,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api } from '../api.js';

const spin = <LoaderCircle size={13} className="animate-spin" />;

// Biblioteca de diseños archivados (v15) — se muestra en la pantalla
// de "nuevo diseño" de los tabs Diseñar/Mobile. Cada card: thumbnail
// (screenshot del preview si Playwright capturó al archivar), chip
// web/mobile, y acciones:
//   · Restaurar            → devuelve la sesión a su tab (same-kind)
//   · Usar como referencia → crea un diseño NUEVO con el código
//                            archivado en .reference/<slug>/ + spec
//                            inyectado al prompt del agente
//   · Eliminar             → borra la entrada de design-library/
export default function LibraryPanel({ onRestore, onReference, refreshKey = 0 }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(''); // slug accionando
  const [error, setError] = useState(null);
  const [confirmDel, setConfirmDel] = useState('');
  const [copied, setCopied] = useState(''); // slug con prompt copiado

  const load = () => api.library().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, [refreshKey]);

  const act = async (slug, fn, after) => {
    setBusy(slug);
    setError(null);
    try {
      const r = await fn(slug);
      if (r?.ok === false) setError(r.error ?? 'falló la acción');
      else after?.(r);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  // Copia el spec de sistema de diseño (prompt.md del agente, o
  // spec.md heurístico de fallback) al portapapeles — reusable en
  // cualquier agente sin restaurar la sesión.
  const copyPrompt = async (slug) => {
    setError(null);
    try {
      const r = await api.libraryPrompt(slug);
      if (!r?.ok) return setError(r?.error ?? 'sin prompt disponible');
      await navigator.clipboard.writeText(r.text);
      setCopied(slug);
      setTimeout(() => setCopied(''), 2000);
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = (slug) => {
    if (confirmDel !== slug) {
      setConfirmDel(slug);
      setTimeout(() => setConfirmDel(''), 4000);
      return;
    }
    setConfirmDel('');
    act(slug, api.deleteLibrary);
  };

  if (items === null) {
    return <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">{spin} biblioteca…</p>;
  }
  if (items.length === 0) return null; // sin entradas — el panel no molesta

  return (
    <div className="mt-4">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
        <Archive size={13} className="text-accent-500" /> Diseños archivados
      </h3>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <div
            key={it.slug}
            className="overflow-hidden rounded-lg bg-slate-950 ring-1 ring-accent-500/30"
          >
            <div className="relative h-28 bg-slate-900">
              {it.hasShot ? (
                <img
                  src={api.libraryShot(it.slug)}
                  alt={it.name}
                  className="h-full w-full object-cover object-top"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-slate-700">
                  {it.kind === 'mobile' ? <Smartphone size={28} /> : <MonitorSmartphone size={28} />}
                </div>
              )}
              <span
                className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  it.kind === 'mobile'
                    ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/50'
                    : 'bg-accent-500/20 text-accent-300 ring-1 ring-accent-500/50'
                }`}
              >
                {it.kind === 'mobile' ? 'mobile' : 'diseño'}
              </span>
            </div>
            <div className="p-2.5">
              <p className="truncate text-xs font-semibold text-slate-200" title={it.name}>
                {it.name}
              </p>
              {it.description && (
                <p className="mt-0.5 truncate text-[11px] text-slate-500" title={it.description}>
                  {it.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  title="Devuelve la sesión a su tab — el chat sigue donde quedó"
                  disabled={Boolean(busy)}
                  onClick={() => act(it.slug, api.restoreLibrary, () => onRestore?.(it))}
                  className="inline-flex items-center gap-1 rounded bg-accent-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-accent-700 disabled:opacity-40"
                >
                  {busy === it.slug ? spin : <PackageOpen size={11} />} restaurar
                </button>
                <button
                  title="Crea un diseño nuevo que usa estilos/animaciones de este (referencia)"
                  disabled={Boolean(busy)}
                  onClick={() => onReference?.(it)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-accent-300 ring-1 ring-accent-400/50 hover:bg-accent-500/10 disabled:opacity-40"
                >
                  <Sparkles size={11} /> usar como referencia
                </button>
                <button
                  title="Copia el spec de diseño (paleta/componentes/animaciones) para pegarlo en cualquier agente"
                  disabled={Boolean(busy)}
                  onClick={() => copyPrompt(it.slug)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-slate-300 ring-1 ring-slate-500/50 hover:bg-slate-800 disabled:opacity-40"
                >
                  {copied === it.slug ? <ClipboardCheck size={11} className="text-emerald-400" /> : <Clipboard size={11} />}
                  {copied === it.slug ? '¡copiado!' : 'copiar prompt'}
                </button>
                <button
                  title="Borra la entrada de la biblioteca"
                  disabled={Boolean(busy)}
                  onClick={() => remove(it.slug)}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold ring-1 disabled:opacity-40 ${
                    confirmDel === it.slug
                      ? 'bg-red-600 text-white ring-red-600'
                      : 'text-red-400 ring-red-500/40 hover:bg-red-500/10'
                  }`}
                >
                  <Trash2 size={11} /> {confirmDel === it.slug ? '¿seguro?' : 'eliminar'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
