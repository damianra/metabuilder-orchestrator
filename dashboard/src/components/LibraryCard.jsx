import { useState } from 'react';
import {
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

// Card de una entrada de la biblioteca — compartida entre
// LibraryPanel (pantalla "nuevo diseño" de los tabs) y LibraryTab
// (#/archivados). Cada card maneja su propio estado busy/copied/
// confirmDel. Si llega `onOpen`, el click en la card navega al
// detalle #/lib/<slug> (los botones internos hacen stopPropagation).
export default function LibraryCard({ it, onOpen, onRestore, onReference, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [copied, setCopied] = useState(false);

  const act = async (fn, after) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn(it.slug);
      if (r?.ok === false) setError(r.error ?? 'falló la acción');
      else after?.(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    setError(null);
    try {
      const r = await api.libraryPrompt(it.slug);
      if (!r?.ok) return setError(r?.error ?? 'sin prompt disponible');
      await navigator.clipboard.writeText(r.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = () => {
    if (!confirmDel) {
      setConfirmDel(true);
      setTimeout(() => setConfirmDel(false), 4000);
      return;
    }
    setConfirmDel(false);
    act(api.deleteLibrary, () => onDeleted?.(it));
  };

  const stop = (e) => e.stopPropagation();

  return (
    <div
      onClick={onOpen ? () => onOpen(it) : undefined}
      className={`overflow-hidden rounded-lg bg-slate-950 ring-1 ring-accent-500/30 ${
        onOpen ? 'cursor-pointer transition hover:ring-accent-400/70' : ''
      }`}
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
        {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5" onClick={stop}>
          <button
            title="Devuelve la sesión a su tab — el chat sigue donde quedó"
            disabled={busy}
            onClick={() => act(api.restoreLibrary, () => onRestore?.(it))}
            className="inline-flex items-center gap-1 rounded bg-accent-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-accent-700 disabled:opacity-40"
          >
            {busy ? spin : <PackageOpen size={11} />} restaurar
          </button>
          <button
            title="Crea un diseño nuevo que usa estilos/animaciones de este (referencia)"
            disabled={busy}
            onClick={() => onReference?.(it)}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-accent-300 ring-1 ring-accent-400/50 hover:bg-accent-500/10 disabled:opacity-40"
          >
            <Sparkles size={11} /> usar como referencia
          </button>
          <button
            title="Copia el spec de diseño (paleta/componentes/animaciones) para pegarlo en cualquier agente"
            disabled={busy}
            onClick={copyPrompt}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-slate-300 ring-1 ring-slate-500/50 hover:bg-slate-800 disabled:opacity-40"
          >
            {copied ? <ClipboardCheck size={11} className="text-emerald-400" /> : <Clipboard size={11} />}
            {copied ? '¡copiado!' : 'copiar prompt'}
          </button>
          <button
            title="Borra la entrada de la biblioteca"
            disabled={busy}
            onClick={remove}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold ring-1 disabled:opacity-40 ${
              confirmDel
                ? 'bg-red-600 text-white ring-red-600'
                : 'text-red-400 ring-red-500/40 hover:bg-red-500/10'
            }`}
          >
            <Trash2 size={11} /> {confirmDel ? '¿seguro?' : 'eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}
