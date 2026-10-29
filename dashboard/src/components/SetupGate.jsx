import { useEffect, useState } from 'react';
import { CircleCheckBig, Cpu, ExternalLink, RefreshCw, Wrench } from 'lucide-react';
import { api } from '../api.js';

// Setup gate obligatorio: sin engine elegido la app no genera nada —
// la primera pantalla es elegir el motor de agente (Devin u OpenCode).
// Cada card muestra el estado real del probe (bin en PATH + handshake
// ACP, via GET /api/engines) y el hint de instalación si falta. La
// elección se persiste en settings.json via POST /api/settings.
const STATUS = {
  ok: { text: 'listo', cls: 'text-emerald-400 bg-emerald-500/15 ring-emerald-500/40' },
  fail: { text: 'sin auth', cls: 'text-amber-400 bg-amber-500/10 ring-amber-500/40' },
  missing: { text: 'no instalado', cls: 'text-red-300 bg-red-500/10 ring-red-500/40' },
};

const statusOf = (e) => (!e.installed ? STATUS.missing : e.auth === 'ok' ? STATUS.ok : STATUS.fail);

// Link a la doc oficial del engine — stopPropagation para que el click
// no seleccione la card (vive dentro del <button>).
const DocsLink = ({ url }) => (
  <a
    href={url}
    target="_blank"
    rel="noreferrer"
    className="inline-flex items-center gap-0.5 text-accent-300 underline"
    onClick={(ev) => ev.stopPropagation()}
  >
    docs <ExternalLink size={10} />
  </a>
);

export default function SetupGate({ current, onDone }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(current ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () =>
    api
      .engines()
      .then(setData)
      .catch(() => setData({ engines: [] }));
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveSettings({ engine: selected });
      onDone?.(selected);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const card =
    'cursor-pointer rounded-lg bg-slate-900 p-5 ring-1 ring-accent-500/40 glow-card text-left transition ' +
    'focus:outline-none';

  return (
    <div className="mx-auto max-w-2xl py-10">
      <div className="flex items-center gap-2">
        <Cpu size={20} className="text-accent-600" />
        <h1 className="text-xl font-bold tracking-tight text-slate-100">
          {current ? 'Cambiar motor de agente' : 'Elegí el motor de agente'}
        </h1>
      </div>
      <p className="mt-2 text-sm text-slate-400">
        MetaBuilder delega la escritura de código a un agente CLI via ACP. Sin motor elegido no se
        puede generar nada — la elección queda en <code className="rounded bg-slate-800 px-1">settings.json</code>.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {(data?.engines ?? []).map((e) => {
          const st = statusOf(e);
          const active = selected === e.id;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => setSelected(e.id)}
              className={`${card} ${active ? 'bg-accent-500/15 ring-2 ring-accent-600 shadow-md' : 'hover:ring-accent-400'}`}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-bold text-slate-100">
                  {e.label}
                  {active && <CircleCheckBig size={16} className="text-accent-600" />}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold ring-1 ${st.cls}`}
                >
                  {st.text}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-slate-400">{e.bin} acp</p>
              {e.detail && e.auth !== 'ok' && (
                <p className="mt-2 text-xs text-amber-400">{e.detail}</p>
              )}
              {!e.installed && (
                <p className="mt-2 text-xs text-slate-400">
                  instalación: <code className="rounded bg-slate-800 px-1">{e.installHint}</code>{' '}
                  <DocsLink url={e.docsUrl} />
                </p>
              )}
              {e.installed && e.auth === 'fail' && (e.authHint || e.installHint) && (
                <p className="mt-2 text-xs text-slate-400">
                  auth: <code className="rounded bg-slate-800 px-1">{e.authHint ?? e.installHint}</code>{' '}
                  <DocsLink url={e.docsUrl} />
                </p>
              )}
            </button>
          );
        })}
      </div>
      {data && !data.engines?.length && (
        <p className="mt-4 rounded-lg bg-amber-500/10 px-4 py-2 text-sm text-amber-300 ring-1 ring-amber-500/40">
          La API no respondió — verificá que el dashboard esté corriendo.
        </p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!selected || busy}
          className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Wrench size={15} /> Usar este motor
        </button>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-slate-400 ring-1 ring-accent-500/50 hover:bg-slate-950"
        >
          <RefreshCw size={14} /> re-chequear
        </button>
        {current && (
          <button
            type="button"
            onClick={() => onDone?.(current)}
            className="text-sm font-semibold text-slate-400 hover:text-slate-300"
          >
            cancelar
          </button>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>
    </div>
  );
}
