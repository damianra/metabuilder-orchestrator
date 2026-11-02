import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
  ExternalLink,
  LoaderCircle,
  Play,
  RotateCcw,
  Save,
  Send,
  Smartphone,
  Square,
  Trash2,
} from 'lucide-react';
import { api } from '../api.js';
import { parseProposal } from '../util.js';
import MobilePreview from './MobilePreview.jsx';

const spin = <LoaderCircle size={15} className="animate-spin" />;

// Card de propuesta — idéntica a la del Diseñar app: el agente cierra
// su reply con ```proposal (question + opciones) y se renderiza como
// botones.
function ProposalCard({ proposal, onPick, disabled }) {
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-slate-900 p-3 ring-1 ring-accent-500/40">
      {proposal.question && (
        <p className="text-xs font-semibold text-slate-400">{proposal.question}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {proposal.options.map((o, i) => (
          <button
            key={i}
            disabled={disabled}
            onClick={() => onPick(o)}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-accent-300 ring-1 ring-accent-300 hover:bg-accent-500/15 disabled:opacity-40"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Pestaña "Mobile": chat iterativo con el agente sobre un workspace
// Expo (mobile-work/) — espejo del tab Diseñar app pero el preview es
// `npm run web` (:8081) servido dentro del marco de teléfono.
// El historial persiste en el server (mobile-state.json).
export default function MobileTab({ onSaved }) {
  const [status, setStatus] = useState(null); // GET /api/mobile
  const [input, setInput] = useState('');
  const [inflight, setInflight] = useState(null); // { user, reply }
  const [activity, setActivity] = useState('');
  const [busy, setBusy] = useState(''); // create|chat|dev|stop|save|discard
  const [error, setError] = useState(null);
  const [slug, setSlug] = useState('');
  const [frameKey, setFrameKey] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Form inline de archivar: nombre (vacío → "Diseño NNN" del backend)
  // + descripción opcional que quedan en meta.json de la entrada.
  const [archiveForm, setArchiveForm] = useState(null);
  const chatEnd = useRef(null);
  const slugRef = useRef(null);

  const refresh = useCallback(() => api.mobileStatus().then(setStatus).catch(() => {}), []);

  // Poll liviano: mobileStatus es sync y es la única vía de enterarse
  // de que Expo ya imprimió su URL en dev-run.log.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const messages = status?.messages ?? [];
  // El server persiste el msg user al INICIAR el turno — si el poll ya
  // lo trajo a `messages`, no repetirlo mientras `inflight` lo muestra.
  const visible = inflight
    ? messages.filter(
        (m, i) =>
          !(i === messages.length - 1 && m.role === 'user' && m.text === inflight.user),
      )
    : messages;
  const previewUrl = status?.urls?.[0] ?? null;
  const devRunning = Boolean(status?.devRunning);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, inflight]);

  // `reference` = slug de la biblioteca (v15): el diseño nuevo nace
  // con .reference/<slug>/ + spec en el prompt del agente (acepta
  // referencias web — el agente las traduce a RN/NativeWind).
  const create = async (reference) => {
    setBusy('create');
    setError(null);
    try {
      await api.createMobile(typeof reference === 'string' ? reference : undefined);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  // Archivar en la biblioteca — conserva workspace+historial+spec +
  // screenshot (el archivar prende el preview Expo Web solo para
  // capturar y siempre lo frena) + prompt.md del agente. Pide nombre:
  // vacío → el backend asigna "Diseño NNN".
  const archive = async () => {
    setBusy('archive');
    setError(null);
    try {
      const r = await api.archiveMobile({
        name: archiveForm?.name?.trim() ?? '',
        description: archiveForm?.description?.trim() ?? '',
      });
      if (!r.ok) setError(r.error);
      else setArchiveForm(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const send = async (text) => {
    const t = (typeof text === 'string' ? text : input).trim();
    if (!t || busy) return;
    if (typeof text !== 'string') setInput('');
    setBusy('chat');
    setError(null);
    setActivity('');
    const pending = { user: t, reply: '' };
    setInflight(pending);
    try {
      const r = await api.mobileChat(t, {
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
      refresh(); // el par user+agent ya quedó en mobile-state.json
    }
  };

  const startPreview = async () => {
    setBusy('dev');
    setError(null);
    try {
      await api.mobileDev();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const stopPreview = async () => {
    setBusy('stop');
    setError(null);
    try {
      await api.mobileStopDev();
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
      const r = await api.mobileSave(s);
      onSaved?.(r.slug);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  // Actions nativas que una `proposal` del agente puede disparar.
  const pickOption = (o) => {
    if (busy) return;
    if (o.reply) return send(o.reply);
    if (o.action === 'save') return slugRef.current?.focus();
    if (o.action === 'preview') return startPreview();
    send(o.label);
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
      await api.discardMobile();
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
      <section className="rounded-lg bg-slate-900 p-5 ring-1 ring-accent-500/40 glow-card">
        <p className="flex items-center gap-2 text-sm text-slate-400">{spin} cargando…</p>
      </section>
    );
  }

  if (!status.exists) {
    return (
      <section className="rounded-lg bg-slate-900 p-8 ring-1 ring-accent-500/40 glow-card">
        <div className="mx-auto max-w-md text-center">
          <Smartphone size={28} className="mx-auto text-accent-600" />
          <h2 className="mt-2 text-sm font-bold text-slate-200">Diseñar app móvil</h2>
          <p className="mt-1 text-sm text-slate-400">
            Iterá una app React Native chateando con el agente — el preview corre Expo Web
            (:8081) dentro del marco de teléfono y el resultado se guarda como app real.
          </p>
          <button
            data-testid="mobile-create"
            onClick={create}
            disabled={busy === 'create'}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-40"
          >
            {busy === 'create' ? spin : <Smartphone size={15} />} Nuevo diseño mobile
          </button>
          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg bg-slate-900 p-5 ring-1 ring-accent-500/40 glow-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200">
          <Smartphone size={16} className="text-accent-600" /> Diseñar app móvil
        </h2>
        <span
          title="Stack del workspace mobile"
          className="rounded-lg bg-accent-500/15 px-2 py-0.5 text-xs font-semibold text-accent-400 ring-1 ring-accent-500/40"
        >
          Expo + React Native
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {previewUrl ? (
            <button
              data-testid="mobile-stop-preview"
              title="Frena el dev server Expo del workspace"
              onClick={stopPreview}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 ring-1 ring-accent-500/50 hover:bg-slate-950 disabled:opacity-40"
            >
              {busy === 'stop' ? spin : <Square size={12} />} frenar preview
            </button>
          ) : (
            <button
              data-testid="mobile-preview"
              title="Levanta npm run web (:8081) del workspace para el preview en vivo"
              onClick={startPreview}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-accent-300 ring-1 ring-accent-300 hover:bg-accent-500/15 disabled:opacity-40"
            >
              {busy === 'dev' ? spin : <Play size={12} />} preview
            </button>
          )}
          <input
            ref={slugRef}
            data-testid="mobile-save-name"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="nombre-app"
            className="w-36 rounded-lg border border-accent-500/40 bg-slate-950 text-slate-200 placeholder:text-slate-500 px-2 py-1 text-xs outline-none focus:border-accent-500"
          />
          <button
            title="Mueve el workspace a generated-apps/<slug> como app real"
            data-testid="mobile-save"
            onClick={save}
            disabled={Boolean(busy) || !slug.trim()}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/50 hover:bg-emerald-500/15 disabled:opacity-40"
          >
            {busy === 'save' ? spin : <Save size={12} />} guardar como app
          </button>
          <button
            title="Archiva el diseño en la biblioteca — conserva el código, el historial y un spec para reutilizar"
            data-testid="mobile-archive"
            onClick={() => setArchiveForm({ name: '', description: '' })}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-accent-300 ring-1 ring-accent-400/50 hover:bg-accent-500/10 disabled:opacity-40"
          >
            {busy === 'archive' ? spin : <Archive size={12} />} archivar
          </button>
          <button
            title={confirmDiscard ? 'Confirmá para borrar el workspace' : 'Descarta el diseño y borra el workspace'}
            onClick={discard}
            disabled={Boolean(busy)}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ring-1 disabled:opacity-40 ${
              confirmDiscard
                ? 'bg-red-600 text-white ring-red-600 hover:bg-red-700'
                : 'text-red-400 ring-red-500/40 hover:bg-red-500/10'
            }`}
          >
            {busy === 'discard' ? spin : <Trash2 size={12} />}
            {confirmDiscard ? '¿seguro?' : 'descartar'}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300 ring-1 ring-red-500/40">
          {error}
        </p>
      )}
      {archiveForm && (
        <div className="mt-3 space-y-2 rounded-lg bg-slate-900 p-3 ring-1 ring-accent-500/40">
          <p className="text-xs font-semibold text-slate-400">Archivar en la biblioteca</p>
          <input
            data-testid="mobile-archive-name"
            autoFocus
            value={archiveForm.name}
            onChange={(e) => setArchiveForm({ ...archiveForm, name: e.target.value })}
            placeholder="Diseño 001 (se asigna si queda vacío)"
            className="w-full rounded-lg border border-accent-500/40 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 outline-none focus:border-accent-500"
          />
          <input
            data-testid="mobile-archive-desc"
            value={archiveForm.description}
            onChange={(e) => setArchiveForm({ ...archiveForm, description: e.target.value })}
            placeholder="descripción (opcional)"
            className="w-full rounded-lg border border-accent-500/40 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 outline-none focus:border-accent-500"
          />
          <div className="flex gap-1.5">
            <button
              onClick={archive}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1 rounded bg-accent-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-40"
            >
              {busy === 'archive' ? spin : <Archive size={12} />} archivar
            </button>
            <button
              onClick={() => setArchiveForm(null)}
              disabled={Boolean(busy)}
              className="rounded px-2.5 py-1 text-xs font-semibold text-slate-400 ring-1 ring-slate-500/50 hover:bg-slate-800 disabled:opacity-40"
            >
              cancelar
            </button>
          </div>
        </div>
      )}
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="flex min-h-[420px] max-h-[75vh] flex-col rounded-lg ring-1 ring-accent-500/40">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {visible.length === 0 && !inflight && (
              <p className="p-3 text-xs text-slate-400">
                Describí la app: qué hace, pantallas, estilo, datos. El agente edita el
                código del workspace Expo y el preview se actualiza solo.
              </p>
            )}
            {visible.map((m, i) => {
              if (m.role === 'user') {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-accent-600 px-3 py-2 text-sm text-white">
                      {m.text}
                    </div>
                  </div>
                );
              }
              const { text, proposal } = parseProposal(m.text);
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[85%]">
                    <div className="whitespace-pre-wrap rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300">
                      {text}
                    </div>
                    {proposal && (
                      <ProposalCard proposal={proposal} onPick={pickOption} disabled={Boolean(busy)} />
                    )}
                  </div>
                </div>
              );
            })}
            {inflight && (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-accent-600 px-3 py-2 text-sm text-white">
                    {inflight.user}
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300">
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
          <div className="flex items-center gap-2 border-t border-accent-500/40 p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              data-testid="mobile-chat-input"
              placeholder="Pedile un cambio al diseñador mobile…"
              disabled={busy === 'chat'}
              className="flex-1 rounded-lg border border-accent-500/40 bg-slate-950 text-slate-200 placeholder:text-slate-500 px-3 py-1.5 text-sm outline-none focus:border-accent-500 disabled:opacity-50"
            />
            <button
              data-testid="mobile-send"
              title="Enviar"
              onClick={() => send()}
              disabled={busy === 'chat' || !input.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-40"
            >
              {busy === 'chat' ? spin : <Send size={14} />}
            </button>
          </div>
        </div>
        {/* Preview: marco Android 390×844 con el Expo Web adentro — el
            iframe ES el viewport mobile (scroll si la ventana es baja). */}
        <div className="flex min-h-[420px] flex-col rounded-lg ring-1 ring-accent-500/40">
          {previewUrl ? (
            <>
              <div className="flex items-center gap-2 border-b border-accent-500/40 bg-slate-950 px-3 py-1.5">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 truncate text-xs text-accent-300 hover:underline"
                >
                  <ExternalLink size={12} /> {previewUrl}
                </a>
                <button
                  title="Recargar el iframe"
                  onClick={() => setFrameKey((k) => k + 1)}
                  className="ml-auto text-slate-400 hover:text-slate-400"
                >
                  <RotateCcw size={13} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto bg-slate-950/60 py-4" key={frameKey}>
                <MobilePreview url={previewUrl} />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <p className="max-w-xs text-xs text-slate-400">
                {devRunning || busy === 'dev'
                  ? 'levantando Expo Web… (Metro tarda ~30s la primera vez)'
                  : 'Sin preview todavía — el botón "preview" corre npm run web del workspace y lo sirve acá dentro del marco.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
