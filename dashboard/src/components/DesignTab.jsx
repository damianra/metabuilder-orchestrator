import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  LoaderCircle,
  Palette,
  Play,
  RotateCcw,
  Save,
  Send,
  Square,
  Trash2,
} from 'lucide-react';
import { api } from '../api.js';

const spin = <LoaderCircle size={15} className="animate-spin" />;

// Pestaña "Diseñar app": chat iterativo con el agente sobre un
// workspace Vite (design-work/) + preview en vivo por dev server.
// El historial persiste en el server (design-state.json) — `inflight`
// cubre el ida y vuelta del mensaje en curso, que todavía no está
// persistido mientras el SSE streamea.
export default function DesignTab({ onSaved }) {
  const [status, setStatus] = useState(null); // GET /api/design
  const [input, setInput] = useState('');
  const [inflight, setInflight] = useState(null); // { user, reply }
  const [activity, setActivity] = useState('');
  const [busy, setBusy] = useState(''); // create|chat|dev|stop|save|discard
  const [error, setError] = useState(null);
  const [slug, setSlug] = useState('');
  const [frameKey, setFrameKey] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const chatEnd = useRef(null);

  const refresh = useCallback(() => api.designStatus().then(setStatus).catch(() => {}), []);

  // Poll liviano: designStatus es sync (lee 2 archivos) y es la única
  // vía para enterarse de que vite ya imprimió su URL en dev-run.log.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const messages = status?.messages ?? [];
  const previewUrl = status?.urls?.[0] ?? null;

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, inflight]);

  const create = async () => {
    setBusy('create');
    setError(null);
    try {
      await api.createDesign();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy('chat');
    setError(null);
    setActivity('');
    const pending = { user: text, reply: '' };
    setInflight(pending);
    try {
      const r = await api.designChat(text, {
        onChunk: (t) => {
          pending.reply += t;
          setInflight({ ...pending });
        },
        onActivity: setActivity,
      });
      if (!r.ok) setError(r.error);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
      setInflight(null);
      setActivity('');
      refresh(); // el par user+agent ya quedó en design-state.json
    }
  };

  const startPreview = async () => {
    setBusy('dev');
    setError(null);
    try {
      await api.designDev();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const stopPreview = async () => {
    setBusy('stop');
    try {
      await api.designStopDev();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    const s = slug.trim();
    if (!s || busy) return;
    setBusy('save');
    setError(null);
    try {
      const r = await api.designSave(s);
      onSaved?.(r.slug);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const discard = async () => {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      setTimeout(() => setConfirmDiscard(false), 4000);
      return;
    }
    setBusy('discard');
    setError(null);
    try {
      await api.discardDesign();
      setSlug('');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
      setConfirmDiscard(false);
    }
  };

  if (!status) {
    return (
      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 shadow-sm">
        <p className="flex items-center gap-2 text-sm text-slate-500">{spin} cargando…</p>
      </section>
    );
  }

  if (!status.exists) {
    return (
      <section className="rounded-2xl bg-white p-8 ring-1 ring-slate-200 shadow-sm">
        <div className="mx-auto max-w-md text-center">
          <Palette size={28} className="mx-auto text-sky-600" />
          <h2 className="mt-2 text-sm font-bold text-slate-800">Diseñar app</h2>
          <p className="mt-1 text-sm text-slate-500">
            Iterá un frontend chateando con el agente — el preview se levanta con un vite dev
            server y el resultado se puede guardar como app real.
          </p>
          <button
            onClick={create}
            disabled={busy === 'create'}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
          >
            {busy === 'create' ? spin : <Palette size={15} />} Nuevo diseño
          </button>
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Palette size={16} className="text-sky-600" /> Diseñar app
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {previewUrl ? (
            <button
              title="Frena el vite dev server del workspace"
              onClick={stopPreview}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-40"
            >
              {busy === 'stop' ? spin : <Square size={12} />} frenar preview
            </button>
          ) : (
            <button
              title="Levanta el vite dev server del workspace para el preview en vivo"
              onClick={startPreview}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-300 hover:bg-sky-50 disabled:opacity-40"
            >
              {busy === 'dev' ? spin : <Play size={12} />} preview
            </button>
          )}
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="nombre-app"
            className="w-36 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-sky-500"
          />
          <button
            title="Mueve el workspace a generated-apps/<slug> como app real"
            onClick={save}
            disabled={Boolean(busy) || !slug.trim()}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-300 hover:bg-emerald-50 disabled:opacity-40"
          >
            {busy === 'save' ? spin : <Save size={12} />} guardar como app
          </button>
          <button
            title={confirmDiscard ? 'Confirmá para borrar el workspace' : 'Descarta el diseño y borra el workspace'}
            onClick={discard}
            disabled={busy === 'discard'}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ring-1 disabled:opacity-40 ${
              confirmDiscard
                ? 'bg-red-600 text-white ring-red-600 hover:bg-red-700'
                : 'text-red-600 ring-red-200 hover:bg-red-50'
            }`}
          >
            {busy === 'discard' ? spin : <Trash2 size={12} />}
            {confirmDiscard ? '¿seguro?' : 'descartar'}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">
          {error}
        </p>
      )}
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="flex min-h-[420px] flex-col rounded-xl ring-1 ring-slate-200">
          <div className="flex-1 space-y-3 overflow-y-auto p-3" style={{ maxHeight: '55vh' }}>
            {messages.length === 0 && !inflight && (
              <p className="p-3 text-xs text-slate-400">
                Arrancá describiendo la app: estilo, secciones, colores, contenido. El agente
                edita el código del workspace y el preview se actualiza solo (HMR).
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {inflight && (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-sky-600 px-3 py-2 text-sm text-white">
                    {inflight.user}
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">
                    {inflight.reply || <LoaderCircle size={14} className="animate-spin text-slate-400" />}
                  </div>
                </div>
              </>
            )}
            <div ref={chatEnd} />
          </div>
          {activity && (
            <p className="truncate border-t border-slate-100 px-3 py-1 text-xs text-slate-400">
              {activity}
            </p>
          )}
          <div className="flex items-center gap-2 border-t border-slate-200 p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Pedile un cambio al diseñador…"
              disabled={busy === 'chat'}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-sky-500 disabled:opacity-50"
            />
            <button
              title="Enviar"
              onClick={send}
              disabled={busy === 'chat' || !input.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
            >
              {busy === 'chat' ? spin : <Send size={14} />}
            </button>
          </div>
        </div>
        <div className="flex min-h-[420px] flex-col overflow-hidden rounded-xl ring-1 ring-slate-200">
          {previewUrl ? (
            <>
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 truncate text-xs text-sky-700 hover:underline"
                >
                  <ExternalLink size={12} /> {previewUrl}
                </a>
                <button
                  title="Recargar el iframe"
                  onClick={() => setFrameKey((k) => k + 1)}
                  className="ml-auto text-slate-400 hover:text-slate-600"
                >
                  <RotateCcw size={13} />
                </button>
              </div>
              <iframe
                key={frameKey}
                title="preview del diseño"
                src={previewUrl}
                className="w-full flex-1 bg-white"
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <p className="max-w-xs text-xs text-slate-400">
                {busy === 'dev'
                  ? 'levantando el dev server…'
                  : 'Sin preview todavía — el botón "preview" corre el vite del workspace y lo sirve acá en vivo.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
