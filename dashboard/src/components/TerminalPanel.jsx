import { useEffect, useRef, useState } from 'react';
import { Square, Terminal as TerminalIcon } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api } from '../api.js';

// Terminal de agente embebida: abre una sesión del TUI del engine
// (`devin` / `opencode`) en el dir de la app via WS
// /api/projects/:slug/terminal?engine=<id>. Colapsar NO mata la sesión
// — el server la mantiene viva ~5min sin clientes y el scrollback se
// reenvía al reabrir (reattach). "Cerrar sesión" sí la mata.
// El selector usa GET /api/engines (probe real de instalación) —
// default = engine configurado del dashboard.

const btn =
  'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ring-1 ring-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed';
const select =
  'rounded-lg bg-white px-2 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-300 outline-none';

export default function TerminalPanel({ slug }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [engines, setEngines] = useState(null);
  const [engine, setEngine] = useState(null);
  const boxRef = useRef(null);
  const wsRef = useRef(null);

  // Probe de engines (una vez por apertura del panel): define el
  // default (engine configurado) y cuáles están instalados.
  useEffect(() => {
    if (!open || engines) return;
    api
      .engines()
      .then((d) => {
        setEngines(d.engines ?? []);
        setEngine((e) => e ?? d.engine ?? d.engines?.[0]?.id ?? null);
      })
      .catch(() => setEngines([]));
  }, [open, engines]);

  useEffect(() => {
    // Espera el probe de engines (null = cargando); si falla o no hay
    // engine resuelto conecta igual sin ?engine — el server defaultea.
    if (!open || engines === null || !boxRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      scrollback: 2000,
      theme: { background: '#0f172a' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(boxRef.current);
    fit.fit();
    setStatus('conectando…');

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(
      `${proto}://${location.host}/api/projects/${slug}/terminal?cols=${term.cols}&rows=${term.rows}${engine ? `&engine=${engine}` : ''}`,
    );
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'out') {
        setStatus(null);
        term.write(m.d);
      } else if (m.t === 'status') {
        setStatus(m.msg);
        term.writeln(`\x1b[2m— ${m.msg} —\x1b[0m`);
      } else if (m.t === 'error') {
        setStatus(m.msg);
        term.writeln(`\x1b[31m${m.msg}\x1b[0m`);
      } else if (m.t === 'exit') {
        setStatus('sesión terminada');
        term.writeln(
          `\r\n\x1b[2m— sesión terminada${m.code != null ? ` (exit ${m.code})` : ''} —\x1b[0m`,
        );
      }
    };
    ws.onclose = () => setStatus((s) => s ?? 'desconectado');
    ws.onerror = () => setStatus('error de conexión');
    term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'in', d }));
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }));
    });
    ro.observe(boxRef.current);

    return () => {
      ro.disconnect();
      ws.close();
      term.dispose();
      wsRef.current = null;
    };
  }, [open, slug, engine, engines]);

  const cerrarSesion = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ t: 'close' }));
    setOpen(false);
  };

  const engineLabel = engines?.find((e) => e.id === engine)?.label ?? engine ?? 'agente';

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left font-bold tracking-tight text-slate-900"
      >
        <TerminalIcon size={16} /> Terminal {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs text-slate-500">
              sesión{' '}
              {engines?.length ? (
                <select
                  className={select}
                  value={engine ?? ''}
                  onChange={(e) => setEngine(e.target.value)}
                >
                  {engines.map((en) => (
                    <option key={en.id} value={en.id} disabled={!en.installed}>
                      {en.label}
                      {!en.installed ? ' (no instalado)' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <code className="rounded bg-slate-100 px-1">{engineLabel}</code>
              )}{' '}
              en el directorio de la app{status ? ` · ${status}` : ''}
            </p>
            <button onClick={cerrarSesion} className={btn}>
              <Square size={14} /> Cerrar sesión
            </button>
          </div>
          <div
            ref={boxRef}
            className="mt-2 h-96 overflow-hidden rounded-xl bg-slate-900 p-2"
          />
        </div>
      )}
    </section>
  );
}
