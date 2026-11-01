import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
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
import { parseProposal } from '../util.js';
import LibraryPanel from './LibraryPanel.jsx';

const spin = <LoaderCircle size={15} className="animate-spin" />;

// Card de propuesta: el agente cierra su reply con un bloque fenced
// ```proposal (question + opciones) y se renderiza como botones —
// `reply` envía el texto como mensaje, `action` dispara una nativa.
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

// Pestaña "Diseñar app": chat iterativo con el agente sobre un
// workspace Vite (design-work/) + preview en vivo por dev server.
// El historial persiste en el server (design-state.json) — `inflight`
// cubre el ida y vuelta del mensaje en curso, que todavía no está
// persistido mientras el SSE streamea.
export default function DesignTab({ onSaved, attachSlug }) {
  const [status, setStatus] = useState(null); // GET /api/design
  const [input, setInput] = useState('');
  const [inflight, setInflight] = useState(null); // { user, reply }
  const [activity, setActivity] = useState('');
  const [busy, setBusy] = useState(''); // create|chat|dev|stop|save|discard
  const [error, setError] = useState(null);
  const [slug, setSlug] = useState('');
  // Attach (v10): al crear se puede elegir un proyecto backend — el
  // agente diseña contra su API real y guardar lo copia dentro de él.
  const [backends, setBackends] = useState([]);
  // `attachSlug` llega de #/design?attach=<slug> (botón "Agregar
  // frontend" en el detalle de un proyecto backend): preselecciona el
  // destino del attach en el select "para backend".
  const [backendFor, setBackendFor] = useState(attachSlug ?? '');
  const [stackFrontend, setStackFrontend] = useState('vite-react');
  const [frameKey, setFrameKey] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Form inline de archivar: nombre (vacío → "Diseño NNN" del backend)
  // + descripción opcional que quedan en meta.json de la entrada.
  const [archiveForm, setArchiveForm] = useState(null);
  const chatEnd = useRef(null);
  const slugRef = useRef(null);

  const refresh = useCallback(() => api.designStatus().then(setStatus).catch(() => {}), []);

  // Poll liviano: designStatus es sync (lee 2 archivos) y es la única
  // vía para enterarse de que vite ya imprimió su URL en dev-run.log.
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
  const attachTo = status?.backend?.slug ?? status?.attachTo ?? null;

  // Lista de backends attachables — solo se pide en la pantalla de
  // "nuevo diseño" (cuando no hay workspace).
  useEffect(() => {
    if (status && status.exists === false) {
      api
        .projects()
        .then((ps) => setBackends((ps ?? []).filter((p) => p.scope === 'backend')))
        .catch(() => setBackends([]));
    }
  }, [status?.exists]);

  // Navegación tardía: el slug de ?attach puede llegar con un workspace
  // ya abierto — solo aplica en pantalla de "nuevo diseño".
  useEffect(() => {
    if (attachSlug && status?.exists === false) setBackendFor(attachSlug);
  }, [attachSlug, status?.exists]);
  const devRunning = Boolean(status?.devRunning);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, inflight]);

  // `reference` = slug de la biblioteca (v15): el diseño nuevo nace
  // con .reference/<slug>/ + spec en el prompt del agente.
  const create = async (reference) => {
    setBusy('create');
    setError(null);
    try {
      await api.createDesign(backendFor || undefined, stackFrontend, reference || undefined);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  // Archivar en la biblioteca — a diferencia de descartar, conserva
  // workspace+historial+spec + screenshot (el archivar prende el
  // preview solo para capturar y siempre lo frena) + prompt.md del
  // agente. Pide nombre: vacío → el backend asigna "Diseño NNN".
  const archive = async () => {
    setBusy('archive');
    setError(null);
    try {
      const r = await api.archiveDesign({
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
    // Limpia el input solo cuando el texto venía de ahí — una propuesta
    // con `reply` no borra un borrador que el usuario estuviera armando.
    if (typeof text !== 'string') setInput('');
    setBusy('chat');
    setError(null);
    setActivity('');
    const pending = { user: t, reply: '' };
    setInflight(pending);
    try {
      const r = await api.designChat(t, {
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
    setError(null);
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
    if ((!attachTo && !s) || busy) return;
    setBusy('save');
    setError(null);
    try {
      const r = await api.designSave(s || undefined);
      onSaved?.(r.slug);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  // Actions nativas que una `proposal` del agente puede disparar —
  // extend se cablea al modal de backend en la tarea v9 #3; una
  // action desconocida cae al fallback reply con el label.
  const pickOption = (o) => {
    if (busy) return;
    if (o.reply) return send(o.reply);
    // En modo attach no hay input de slug — save/extend disparan el
    // guardado directo (el front se copia dentro del backend).
    if (o.action === 'save' || o.action === 'extend') {
      return attachTo ? save() : slugRef.current?.focus();
    }
    if (o.action === 'preview') return startPreview();
    send(o.label);
  };

  // Lifecycle del api del backend attachado (:4000) — reusa las
  // actions run-dev/stop-dev del proyecto (v10 #3).
  const toggleApi = async () => {
    const slug = status.backend?.slug;
    if (!slug || busy) return;
    setBusy('api');
    setError(null);
    try {
      await api.action(slug, { action: status.backend.apiRunning ? 'stop-dev' : 'run-dev' });
      await refresh();
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
      <section className="rounded-lg bg-slate-900 p-5 ring-1 ring-accent-500/40 glow-card">
        <p className="flex items-center gap-2 text-sm text-slate-400">{spin} cargando…</p>
      </section>
    );
  }

  if (!status.exists) {
    return (
      <section className="rounded-lg bg-slate-900 p-8 ring-1 ring-accent-500/40 glow-card">
        <div className="mx-auto max-w-md text-center">
          <Palette size={28} className="mx-auto text-accent-600" />
          <h2 className="mt-2 text-sm font-bold text-slate-200">Diseñar app</h2>
          <p className="mt-1 text-sm text-slate-400">
            Iterá un frontend chateando con el agente — el preview se levanta con un vite dev
            server y el resultado se puede guardar como app real.
          </p>
          <div className="mt-3 flex gap-2">
            <select
              data-testid="design-stack"
              value={stackFrontend}
              onChange={(e) => setStackFrontend(e.target.value)}
              className="w-full rounded-lg border border-accent-500/40 bg-slate-900 px-3 py-2 text-sm text-slate-300"
            >
              <option value="vite-react">React + Vite</option>
              <option value="nextjs">Next.js</option>
            </select>
            {backends.length > 0 && (
              <select
                data-testid="design-backend-for"
                value={backendFor}
                onChange={(e) => setBackendFor(e.target.value)}
                className="w-full rounded-lg border border-accent-500/40 bg-slate-900 px-3 py-2 text-sm text-slate-300"
              >
                <option value="">standalone</option>
                {backends.map((b) => (
                  <option key={b.slug} value={b.slug}>{b.slug}</option>
                ))}
              </select>
            )}
          </div>
          <button
            data-testid="design-create"
            onClick={() => create()}
            disabled={busy === 'create'}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-40"
          >
            {busy === 'create' ? spin : <Palette size={15} />} Nuevo diseño
          </button>
          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        </div>
        <LibraryPanel
          onRestore={() => refresh()}
          onReference={(it) => create(it.slug)}
        />
      </section>
    );
  }

  return (
    <section className="rounded-lg bg-slate-900 p-5 ring-1 ring-accent-500/40 glow-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200">
          <Palette size={16} className="text-accent-600" /> Diseñar app
        </h2>
        <span
          title="Stack elegido al crear el diseño"
          className="rounded-lg bg-accent-500/15 px-2 py-0.5 text-xs font-semibold text-accent-400 ring-1 ring-accent-500/40"
        >
          {{ 'vite-react': 'React + Vite', nextjs: 'Next.js' }[status.frontendStackId] ?? status.frontendStackId ?? 'React + Vite'}
        </span>
        {status.backend && (
          <span
            title={`El diseño se copia dentro de generated-apps/${status.backend.slug} al guardar`}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/40"
          >
            para backend: {status.backend.slug}
            <button
              title={
                status.backend.apiRunning
                  ? 'Frena npm run api (:4000) del backend'
                  : 'Levanta npm run api (:4000) — el preview pega contra la API real'
              }
              onClick={toggleApi}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 ring-emerald-500/50 hover:bg-emerald-500/15 disabled:opacity-40"
            >
              {busy === 'api' ? (
                <LoaderCircle size={9} className="animate-spin" />
              ) : status.backend.apiRunning ? (
                <Square size={9} />
              ) : (
                <Play size={9} />
              )}
              api {status.backend.apiRunning ? 'on :4000' : 'off'}
            </button>
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {previewUrl ? (
            <button
              data-testid="design-stop-preview"
              title="Frena el vite dev server del workspace"
              onClick={stopPreview}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 ring-1 ring-accent-500/50 hover:bg-slate-950 disabled:opacity-40"
            >
              {busy === 'stop' ? spin : <Square size={12} />} frenar preview
            </button>
          ) : (
            <button
              data-testid="design-preview"
              title="Levanta el vite dev server del workspace para el preview en vivo"
              onClick={startPreview}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-accent-300 ring-1 ring-accent-300 hover:bg-accent-500/15 disabled:opacity-40"
            >
              {busy === 'dev' ? spin : <Play size={12} />} preview
            </button>
          )}
          {!attachTo && (
            <input
              ref={slugRef}
              data-testid="design-save-name"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="nombre-app"
              className="w-36 rounded-lg border border-accent-500/40 bg-slate-950 text-slate-200 placeholder:text-slate-500 px-2 py-1 text-xs outline-none focus:border-accent-500"
            />
          )}
          <button
            title={
              attachTo
                ? `Copia el front dentro de generated-apps/${attachTo} → fullstack`
                : 'Mueve el workspace a generated-apps/<slug> como app real'
            }
            data-testid="design-save"
            onClick={save}
            disabled={Boolean(busy) || (!attachTo && !slug.trim())}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/50 hover:bg-emerald-500/15 disabled:opacity-40"
          >
            {busy === 'save' ? spin : <Save size={12} />}{' '}
            {attachTo ? `guardar en ${attachTo}` : 'guardar como app'}
          </button>
          <button
            title="Archiva el diseño en la biblioteca — conserva el código, el historial y un spec para reutilizar"
            data-testid="design-archive"
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
            data-testid="design-archive-name"
            autoFocus
            value={archiveForm.name}
            onChange={(e) => setArchiveForm({ ...archiveForm, name: e.target.value })}
            placeholder="Diseño 001 (se asigna si queda vacío)"
            className="w-full rounded-lg border border-accent-500/40 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 outline-none focus:border-accent-500"
          />
          <input
            data-testid="design-archive-desc"
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
                Arrancá describiendo la app: estilo, secciones, colores, contenido. El agente
                edita el código del workspace y el preview se actualiza solo (HMR).
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
              // Solo mensajes del agente pueden traer proposal — el
              // input del usuario nunca se parsea (guard-rail).
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
              data-testid="design-chat-input"
              placeholder="Pedile un cambio al diseñador…"
              disabled={busy === 'chat'}
              className="flex-1 rounded-lg border border-accent-500/40 bg-slate-950 text-slate-200 placeholder:text-slate-500 px-3 py-1.5 text-sm outline-none focus:border-accent-500 disabled:opacity-50"
            />
            <button
              data-testid="design-send"
              title="Enviar"
              onClick={() => send()}
              disabled={busy === 'chat' || !input.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-40"
            >
              {busy === 'chat' ? spin : <Send size={14} />}
            </button>
          </div>
        </div>
        <div className="flex min-h-[420px] flex-col overflow-hidden rounded-lg ring-1 ring-accent-500/40">
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
              <iframe
                key={frameKey}
                title="preview del diseño"
                src={previewUrl}
                className="w-full flex-1 bg-slate-900"
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <p className="max-w-xs text-xs text-slate-400">
                {devRunning || busy === 'dev'
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
