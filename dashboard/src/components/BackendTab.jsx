import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, Play, Save, Send, ServerCog, Square, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { parseProposal } from '../util.js';

const spin = <LoaderCircle size={14} className="animate-spin" />;

function ProposalCard({ proposal, onPick, disabled }) {
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
      {proposal.question && (
        <p className="text-xs font-semibold text-slate-600">{proposal.question}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {proposal.options.map((o, i) => (
          <button
            key={i}
            disabled={disabled}
            onClick={() => onPick(o)}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-300 hover:bg-sky-50 disabled:opacity-40"
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
      await api.createBackend();
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
      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 shadow-sm">
        <p className="flex items-center gap-2 text-sm text-slate-500">{spin} cargando…</p>
      </section>
    );
  }

  if (!status.exists) {
    return (
      <section className="rounded-2xl bg-white p-8 ring-1 ring-slate-200 shadow-sm">
        <div className="mx-auto max-w-md text-center">
          <ServerCog size={28} className="mx-auto text-sky-600" />
          <h2 className="mt-2 text-sm font-bold text-slate-800">Backend</h2>
          <p className="mt-1 text-sm text-slate-500">
            Describí tu dominio y un agente backend-experto construye la API (Express +
            SQLite) iterando con vos — con propuestas, schema, rutas y tests.
          </p>
          <button
            onClick={create}
            disabled={busy === 'create'}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
          >
            {busy === 'create' ? spin : <ServerCog size={15} />} Nueva API
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
          <ServerCog size={16} className="text-sky-600" /> Backend
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            title={
              status.apiRunning
                ? 'Frena npm run api (:4000)'
                : 'Levanta npm run api (:4000) del workspace'
            }
            onClick={toggleDev}
            disabled={Boolean(busy)}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ring-1 disabled:opacity-40 ${
              status.apiRunning
                ? 'text-slate-600 ring-slate-300 hover:bg-slate-50'
                : 'text-sky-700 ring-sky-300 hover:bg-sky-50'
            }`}
          >
            {busy === 'dev' ? spin : status.apiRunning ? <Square size={12} /> : <Play size={12} />}
            {status.apiRunning ? 'api on :4000' : 'api off'}
          </button>
          <input
            ref={slugRef}
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
            title={confirmDiscard ? 'Confirmá para borrar el workspace' : 'Descarta la sesión y borra el workspace'}
            onClick={discard}
            disabled={Boolean(busy)}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ring-1 disabled:opacity-40 ${
              confirmDiscard
                ? 'bg-red-600 text-white ring-red-600 hover:bg-red-700'
                : 'text-red-600 ring-red-200 hover:bg-red-50'
            }`}
          >
            {busy === 'discard' ? spin : <Trash2 size={12} />}
            {confirmDiscard ? 'confirmar' : 'descartar'}
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
                Describí el dominio: entidades, relaciones, reglas. El experto propone el
                modelo, schema, rutas y tests — y podés levantar la API para probarla.
              </p>
            )}
            {messages.map((m, i) => {
              if (m.role === 'user') {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-sky-600 px-3 py-2 text-sm text-white">
                      {m.text}
                    </div>
                  </div>
                );
              }
              const { text, proposal } = parseProposal(m.text);
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[85%]">
                    <div className="whitespace-pre-wrap rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">
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
              placeholder="Pedile un cambio al experto backend…"
              disabled={busy === 'chat'}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-sky-500 disabled:opacity-50"
            />
            <button
              title="Enviar"
              onClick={() => send()}
              disabled={busy === 'chat' || !input.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
            >
              {busy === 'chat' ? spin : <Send size={14} />}
            </button>
          </div>
        </div>
        <div className="flex min-h-[420px] flex-col overflow-hidden rounded-xl ring-1 ring-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            API surface{status.apiRunning ? ' · corriendo en :4000' : ''}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {apiSurface.length ? (
              <ul className="space-y-1 text-sm">
                {apiSurface.map((e, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span
                      className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-semibold ${
                        e.method === 'GET' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'
                      }`}
                    >
                      {e.method}
                    </span>
                    <code className="text-slate-700">{e.path}</code>
                    <span className="text-xs text-slate-400">{e.file}</span>
                    {status.apiRunning && e.method === 'GET' && (
                      <button
                        title={`GET ${e.path} (proxy via dashboard)`}
                        onClick={() => probeEndpoint(e.path)}
                        className="ml-auto shrink-0 rounded-lg px-2 py-0.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-300 hover:bg-sky-50"
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
