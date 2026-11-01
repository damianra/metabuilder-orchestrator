import { useEffect, useState } from 'react';
import {
  ArrowLeft,
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

// Detalle de una entrada archivada (#/lib/<slug>) — header con nombre +
// acciones (las mismas de la card), captura completa y el prompt de
// diseño legible/copiable con badge de fuente (agente/spec).
export default function LibraryDetail({ slug }) {
  const [meta, setMeta] = useState(undefined); // undefined=cargando, null=no existe
  const [prompt, setPrompt] = useState(null); // {text, source}
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .libraryEntry(slug)
      .then((m) => setMeta(m?.ok === false ? null : m))
      .catch(() => setMeta(null));
    api
      .libraryPrompt(slug)
      .then((r) => setPrompt(r?.ok ? r : null))
      .catch(() => setPrompt(null));
  }, [slug]);

  const act = async (fn, after) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn(slug);
      if (r?.ok === false) setError(r.error ?? 'falló la acción');
      else after?.(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const goTab = () => {
    window.location.hash = meta?.kind === 'mobile' ? '#/mobile' : '#/';
  };

  const reference = async () => {
    setBusy(true);
    setError(null);
    try {
      const r =
        meta.kind === 'mobile'
          ? await api.createMobile(slug)
          : await api.createDesign(undefined, 'vite-react', slug);
      if (!r?.ok) return setError(r?.error ?? 'no se pudo crear el diseño');
      goTab();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    if (!prompt?.text) return;
    await navigator.clipboard.writeText(prompt.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const remove = () => {
    if (!confirmDel) {
      setConfirmDel(true);
      setTimeout(() => setConfirmDel(false), 4000);
      return;
    }
    act(api.deleteLibrary, () => {
      window.location.hash = '#/archivados';
    });
  };

  if (meta === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-400">
        <LoaderCircle size={14} className="animate-spin" /> cargando…
      </p>
    );
  }
  if (meta === null) {
    return (
      <section>
        <a href="#/archivados" className="inline-flex items-center gap-1 text-sm text-accent-300 hover:underline">
          <ArrowLeft size={14} /> archivados
        </a>
        <p className="mt-3 text-sm text-slate-400">La entrada <code className="font-mono">{slug}</code> no existe o fue eliminada.</p>
      </section>
    );
  }

  return (
    <section>
      <a href="#/archivados" className="inline-flex items-center gap-1 text-sm text-accent-300 hover:underline">
        <ArrowLeft size={14} /> archivados
      </a>

      <header className="mt-2 flex flex-wrap items-center gap-3">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            meta.kind === 'mobile'
              ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/50'
              : 'bg-accent-500/20 text-accent-300 ring-1 ring-accent-500/50'
          }`}
        >
          {meta.kind === 'mobile' ? 'mobile' : 'diseño'}
        </span>
        <h2 className="font-display text-lg text-slate-100">{meta.name}</h2>
        {meta.created && (
          <span className="text-xs text-slate-500">
            {new Date(meta.created).toLocaleDateString('es-AR')}
          </span>
        )}
      </header>
      {meta.description && <p className="mt-1 text-sm text-slate-400">{meta.description}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          disabled={busy}
          onClick={() => act(api.restoreLibrary, goTab)}
          className="inline-flex items-center gap-1 rounded bg-accent-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-40"
        >
          {busy ? spin : <PackageOpen size={12} />} restaurar
        </button>
        <button
          disabled={busy}
          onClick={reference}
          className="inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-semibold text-accent-300 ring-1 ring-accent-400/50 hover:bg-accent-500/10 disabled:opacity-40"
        >
          <Sparkles size={12} /> usar como referencia
        </button>
        <button
          disabled={busy || !prompt?.text}
          onClick={copyPrompt}
          className="inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-slate-500/50 hover:bg-slate-800 disabled:opacity-40"
        >
          {copied ? <ClipboardCheck size={12} className="text-emerald-400" /> : <Clipboard size={12} />}
          {copied ? '¡copiado!' : 'copiar prompt'}
        </button>
        <button
          disabled={busy}
          onClick={remove}
          className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-semibold ring-1 disabled:opacity-40 ${
            confirmDel
              ? 'bg-red-600 text-white ring-red-600'
              : 'text-red-400 ring-red-500/40 hover:bg-red-500/10'
          }`}
        >
          <Trash2 size={12} /> {confirmDel ? '¿seguro?' : 'eliminar'}
        </button>
      </div>
      {error && (
        <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300 ring-1 ring-red-500/40">
          {error}
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-lg bg-slate-950 ring-1 ring-accent-500/30">
        {meta.hasShot ? (
          <img
            src={api.libraryShot(slug)}
            alt={meta.name}
            className="w-full object-contain"
          />
        ) : (
          <div className="flex h-48 items-center justify-center text-slate-700">
            {meta.kind === 'mobile' ? <Smartphone size={42} /> : <MonitorSmartphone size={42} />}
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg bg-slate-950 p-3 ring-1 ring-accent-500/30">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          Prompt de diseño
          {prompt?.source && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] normal-case text-slate-400">
              {prompt.source === 'agent' ? 'generado por el agente' : 'spec heurístico'}
            </span>
          )}
        </h3>
        {prompt?.text ? (
          <pre className="mt-2 max-h-[60vh] overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-300">
            {prompt.text}
          </pre>
        ) : (
          <p className="mt-2 text-xs text-slate-500">sin prompt disponible para esta entrada</p>
        )}
      </div>
    </section>
  );
}
