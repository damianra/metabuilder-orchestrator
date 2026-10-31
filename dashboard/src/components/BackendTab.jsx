import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, Play, Save, Send, ServerCog, Square, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { parseProposal } from '../util.js';

const spin = <LoaderCircle size={14} className="animate-spin" />;

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

// Tab "Backend": chat iterativo con un agente backend-experto sobre un
// workspace api-skeleton (backend-work/). El "preview" es la API
// corriendo en :4000 + su api-surface con botón "probar".
export default function BackendTab({ onSaved }) {
  const [status, setStatus] = useState(null);
  const [input, setInput] = useState('');
  const [inflight, setInflight] = useState(null);
  const [activity, setActivity] = useState('');
  const [busy, setBusy] = useState(''); // create|chat|dev|stop|save|discard|api
  const [error, setError] = useState(null);
  const [slug, setSlug] = useState('');
  const [probe, setProbe] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const chatEnd = useRef(null);
  const slugRef = useRef(null);

  const refresh = useCallback(() => api.backendStatus().then(setStatus).catch(() => {}), []);
  const [options, setOptions] = useState(null);
  const [dims, setDims] = useState({ framework: 'express', db: 'sqlite', arch: 'flat' });
  useEffect(() => { api.options().then(setOptions).catch(() => {}); }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const messages = status?.messages ?? [];
  const apiSurface = status?.apiSurface ?? [];

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, inflight]);

  const create = async () => {
    setBusy('create');
    setError(null);
    try {
      await api.createBackend(dims);
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
      const r = await api.backendChat(t, {
        onChunk: (c) => {
          pending.reply += c;
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
      refresh();
    }
  };

  const toggleDev = async () => {
    setBusy('dev');
    setError(null);
    try {
      if (status.apiRunning) await api.backendStopDev();
      else await api.backendDev();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const probeEndpoint = async (path) => {
    setProbe({ path, status: '…', body: '' });
    try {
      const r = await api.backendProbe(path);
      setProbe({ path, status: r.status, body: (r.body ?? '').slice(0, 800) });
    } catch (e) {
      setProbe({ path, status: 'ERR', body: e.message });
    }
  };

  const save = async () => {
    const s = slug.trim();
    if (!s || busy) return;
    setBusy('save');
    setError(null);
    try {
      const r = await api.backendSave(s);
      onSaved?.(r.slug);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const pickOption = (o) => {
    if (busy) return;
    if (o.reply) return send(o.reply);
    if (o.action === 'save') return slugRef.current?.focus();
    if (o.action === 'preview') return toggleDev();
    send(o.label);
  };

  const discard = async () => {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setBusy('discard');
    setError(null);
    try {
      await api.discardBackend();
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
          <ServerCog size={28} className="mx-auto text-accent-600" />
          <h2 className="mt-2 text-sm font-bold text-slate-200">Backend</h2>
          <p className="mt-1 text-sm text-slate-400">
            Describí tu dominio y un agente backend-experto construye la API sobre el
            stack que elijas — con propuestas, schema, rutas y tests.
          </p>
          <div className="mt-3 flex gap-2">
            <select
              data-testid="backend-framework"
              value={dims.framework}
              onChange={(e) => {
                const fw = e.target.value;
                setDims({ framework: fw, db: options?.backendMatrix?.[fw]?.dbs[0]?.id ?? 'sqlite' });
              }}
              className="w-full rounded-lg border border-accent-500/40 bg-slate-900 px-3 py-2 text-sm text-slate-300"
            >
              {Object.entries(options?.backendMatrix ?? {}).map(([id, f]) => (
                <option key={id} value={id}>{f.label}</option>
              ))}
            </select>
            <select
              data-testid="backend-db"
              value={dims.db}
              onChange={(e) => setDims((d) => ({ ...d, db: e.target.value }))}
              className="w-full rounded-lg border border-accent-500/40 bg-slate-900 px-3 py-2 text-sm text-slate-300"
            >
              {(options?.backendMatrix?.[dims.framework]?.dbs ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
            <select
              data-testid="backend-arch"
              title="Arquitectura del backend — viaja al prompt del experto y al plan.json"
              value={dims.arch}
              onChange={(e) => setDims((d) => ({ ...d, arch: e.target.value }))}
              className="w-full rounded-lg border border-accent-500/40 bg-slate-900 px-3 py-2 text-sm text-slate-300"
            >
              {(options?.archs ?? []).map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <button
            data-testid="backend-create"
            onClick={create}
            disabled={busy === 'create'}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-40"
          >
            {busy === 'create' ? spin : <ServerCog size={15} />} Nueva API
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
          <ServerCog size={16} className="text-accent-600" /> Backend
          {status.stackId && (
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400 ring-1 ring-accent-500/40">
              {status.stackId}
            </span>
          )}
          {status.arch && (
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400 ring-1 ring-accent-500/40">
              {status.arch}
            </span>
          )}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            title={
              status.apiRunning
                ? 'Frena npm run api (:4000)'
                : 'Levanta npm run api (:4000) del workspace'
            }
            data-testid="backend-api-toggle"
            onClick={toggleDev}
            disabled={Boolean(busy)}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ring-1 disabled:opacity-40 ${
              status.apiRunning
                ? 'text-slate-400 ring-accent-500/50 hover:bg-slate-950'
                : 'text-accent-300 ring-accent-300 hover:bg-accent-500/15'
            }`}
          >
            {busy === 'dev' ? spin : status.apiRunning ? <Square size={12} /> : <Play size={12} />}
            {status.apiRunning ? 'api on :4000' : 'api off'}
          </button>
          <input
            ref={slugRef}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            data-testid="backend-save-name"
            placeholder="nombre-app"
            className="w-36 rounded-lg border border-accent-500/40 bg-slate-950 text-slate-200 placeholder:text-slate-500 px-2 py-1 text-xs outline-none focus:border-accent-500"
          />
          <button
            title="Mueve el workspace a generated-apps/<slug> como app real"
            data-testid="backend-save"
            onClick={save}
            disabled={Boolean(busy) || !slug.trim()}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/50 hover:bg-emerald-500/15 disabled:opacity-40"
          >
            {busy === 'save' ? spin : <Save size={12} />} guardar como app
          </button>
          <button
            title={confirmDiscard ? 'Confirmá para borrar el workspace' : 'Descarta la sesión y borra el workspace'}
            onClick={discard}
            disabled={Boolean(busy)}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ring-1 disabled:opacity-40 ${
              confirmDiscard
                ? 'bg-red-600 text-white ring-red-600 hover:bg-red-700'
                : 'text-red-400 ring-red-500/40 hover:bg-red-500/10'
            }`}
          >
            {busy === 'discard' ? spin : <Trash2 size={12} />}
            {confirmDiscard ? 'confirmar' : 'descartar'}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300 ring-1 ring-red-500/40">
          {error}
        </p>
      )}
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="flex min-h-[420px] flex-col rounded-lg ring-1 ring-accent-500/40">
          <div className="flex-1 space-y-3 overflow-y-auto p-3" style={{ maxHeight: '55vh' }}>
            {messages.length === 0 && !inflight && (
              <p className="p-3 text-xs text-slate-400">
                Describí el dominio: entidades, relaciones, reglas. El experto propone el
                modelo, schema, rutas y tests — y podés levantar la API para probarla.
              </p>
            )}
            {messages.map((m, i) => {
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
              data-testid="backend-chat-input"
              placeholder="Pedile un cambio al experto backend…"
              disabled={busy === 'chat'}
              className="flex-1 rounded-lg border border-accent-500/40 bg-slate-950 text-slate-200 placeholder:text-slate-500 px-3 py-1.5 text-sm outline-none focus:border-accent-500 disabled:opacity-50"
            />
            <button
              data-testid="backend-send"
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
          <div className="border-b border-accent-500/40 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-400">
            API surface{status.apiRunning ? ' · corriendo en :4000' : ''}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {apiSurface.length ? (
              <ul className="space-y-1 text-sm">
                {apiSurface.map((e, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span
                      className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-semibold ${
                        e.method === 'GET' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-accent-500/20 text-accent-300'
                      }`}
                    >
                      {e.method}
                    </span>
                    <code className="text-slate-300">{e.path}</code>
                    <span className="text-xs text-slate-400">{e.file}</span>
                    {status.apiRunning && e.method === 'GET' && (
                      <button
                        data-testid={`backend-probe${e.path.replaceAll("/", "-")}`}
                        title={`GET ${e.path} (proxy via dashboard)`}
                        onClick={() => probeEndpoint(e.path)}
                        className="ml-auto shrink-0 rounded-lg px-2 py-0.5 text-xs font-semibold text-accent-300 ring-1 ring-accent-300 hover:bg-accent-500/15"
                      >
                        probar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">
                Todavía no hay endpoints — el experto los va creando en
                server/routes/ a medida que charlan.
              </p>
            )}
            {probe && (
              <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-200">
                GET {probe.path} → {probe.status}
                {'\n'}
                {probe.body}
              </pre>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
