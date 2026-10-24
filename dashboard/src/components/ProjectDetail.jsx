import { useEffect, useState } from 'react';
import { ArrowLeft, Container, ExternalLink, FileText, FlaskConical, Play, Square } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { api } from '../api.js';
import { timeAgo } from '../util.js';

const btn =
  'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ring-1 ring-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed';

export default function ProjectDetail({ slug, onChanged }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [withGithub, setWithGithub] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [logData, setLogData] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [withE2e, setWithE2e] = useState(false);
  const [showTestOut, setShowTestOut] = useState(false);
  const [testOut, setTestOut] = useState(null);
  const [hostPort, setHostPort] = useState('');
  const [showContainerLog, setShowContainerLog] = useState(false);
  const [containerLog, setContainerLog] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = () =>
    api.project(slug).then(setProject).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Log del run del pipeline: solo se pide con el acordeón abierto —
  // polling para ver el avance en vivo mientras el job corre.
  useEffect(() => {
    if (!showLog) return;
    const loadLog = () => api.projectLog(slug).then(setLogData).catch(() => {});
    loadLog();
    const t = setInterval(loadLog, 4000);
    return () => clearInterval(t);
  }, [showLog, slug]);

  // Output del test run: solo con el acordeón abierto — polling para
  // seguir la corrida en vivo.
  useEffect(() => {
    if (!showTestOut) return;
    const loadOut = () => api.projectTestLog(slug).then(setTestOut).catch(() => {});
    loadOut();
    const t = setInterval(loadOut, 4000);
    return () => clearInterval(t);
  }, [showTestOut, slug]);

  // Logs del container en vivo: solo con el acordeón abierto y
  // mientras el container siga corriendo.
  useEffect(() => {
    if (!showContainerLog) return;
    const loadCLog = () => api.containerLog(slug).then(setContainerLog).catch(() => {});
    loadCLog();
    const t = setInterval(loadCLog, 4000);
    return () => clearInterval(t);
  }, [showContainerLog, slug]);

  const act = async (body, okMsg) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.action(slug, body);
      setNotice(okMsg?.(res) ?? 'listo');
      await load();
      onChanged?.();
    } catch (err) {
      setNotice(`error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const openRepo = async () => {
    try {
      const { url } = await api.action(slug, { action: 'open-repo' });
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setNotice(`error: ${err.message}`);
    }
  };

  if (error) return <p className="text-sm text-red-700">error: {error}</p>;
  if (!project) return <p className="text-sm text-slate-500">cargando…</p>;

  const build = project.dockerBuild;
  const testRun = project.testRun;
  // 'running' + stale = proceso muerto (dashboard caído) → se puede relanzar.
  const testRunning = testRun?.status === 'running' && !testRun.stale;
  const runtime = project.runtime;
  const engine = runtime?.engine ?? null;
  const container = runtime?.container ?? null;
  const suggestedPort = runtime?.suggested?.suggestedHostPort ?? 4000;
  // imagen <slug>:local existe solo si dockerize terminó un build ok
  const imageReady = build?.status === 'done';
  const hasTestScript = (project.scripts ?? []).some((s) => s.name === 'test');
  const hasE2eScript = (project.scripts ?? []).some((s) => s.name === 'test:e2e');
  // done = pipeline terminado; no-plan = sin plan.json (resume imposible).
  const canResume = project.status !== 'done' && project.status !== 'no-plan';

  return (
    <div className="space-y-4">
      <a href="#/" className="inline-flex items-center gap-1.5 text-sm text-sky-700 hover:underline">
        <ArrowLeft size={15} /> proyectos
      </a>

      <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">{project.name}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {project.slug} · actualizado {timeAgo(project.updatedAt)}
            </p>
            {project.idea && (
              <p className="mt-2 max-w-2xl text-sm text-slate-600 line-clamp-2">{project.idea}</p>
            )}
          </div>
          <StatusBadge status={project.status} />
        </div>
        {project.lastError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{project.lastError}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className={btn}
            disabled={busy || !canResume}
            title={canResume ? 'Retoma el pipeline desde plan.json' : 'El proyecto ya terminó (o no tiene plan.json)'}
            onClick={() => act({ action: 'resume', github: withGithub }, () => 'resume encolado')}
          >
            <Play size={15} /> Resume
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={withGithub}
              disabled={!canResume}
              onChange={(e) => setWithGithub(e.target.checked)}
            />
            con GitHub
          </label>
          <button
            className={btn}
            disabled={busy}
            onClick={() =>
              act({ action: 'dockerize' }, (r) =>
                r.build.status === 'skipped' ? `Dockerfile ${r.variant} escrito — sin daemon docker` : `build ${r.build.tag} iniciado`,
              )
            }
          >
            <Container size={15} /> Dockerize
          </button>
          <button
            className={btn}
            disabled={busy || !hasTestScript || testRunning}
            title={
              !hasTestScript
                ? 'El proyecto no tiene script "test"'
                : testRunning
                  ? 'Ya hay un test run en curso'
                  : 'Corre npm test sobre la app (en background)'
            }
            onClick={() => act({ action: 'test', e2e: withE2e }, () => 'test run iniciado')}
          >
            <FlaskConical size={15} /> Ejecutar tests
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={withE2e}
              disabled={!hasE2eScript}
              title={hasE2eScript ? 'También corre npm run test:e2e' : 'El proyecto no tiene script "test:e2e"'}
              onChange={(e) => setWithE2e(e.target.checked)}
            />
            + e2e
          </label>
          {project.repoUrl && (
            <button className={btn} onClick={openRepo}>
              <ExternalLink size={15} /> Abrir repo
            </button>
          )}
        </div>
        {notice && <p className="mt-2 text-sm text-slate-600">{notice}</p>}
        {build && (
          <p className="mt-2 text-xs text-slate-500">
            último docker build: <b>{build.status}</b>
            {build.tag ? ` (${build.tag})` : ''}
            {build.exitCode !== undefined ? ` exit ${build.exitCode}` : ''}
            {build.reason ? ` — ${build.reason}` : ''}
          </p>
        )}
        {testRun && (
          <p className="mt-2 text-xs text-slate-500">
            último test run: <b>{testRun.stale ? `${testRun.status} (interrumpido)` : testRun.status}</b>
            {testRun.command ? ` (${testRun.command})` : ''}
            {testRun.exitCode !== undefined ? ` exit ${testRun.exitCode}` : ''}
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Container size={16} /> Contenedor
        </h3>
        {!engine ? (
          <div className="mt-3 flex items-center gap-2">
            <button className={btn} disabled title="docker/podman no instalado en esta máquina">
              <Container size={15} /> Crear contenedor
            </button>
            <span className="text-xs text-slate-400">docker/podman no instalado</span>
          </div>
        ) : container ? (
          <div className="mt-2">
            <p className="text-xs text-slate-500">
              corriendo ({engine}) ·{' '}
              <a
                href={`http://localhost:${container.hostPort ?? suggestedPort}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sky-700 hover:underline"
              >
                localhost:{container.hostPort ?? suggestedPort}
              </a>
              {container.containerPort ? ` → :${container.containerPort}` : ''}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button className={btn} onClick={() => setShowContainerLog((v) => !v)}>
                <FileText size={15} /> Ver logs {showContainerLog ? '▾' : '▸'}
              </button>
              <button
                className={btn}
                disabled={busy}
                onClick={() => act({ action: 'stop-container' }, () => 'container detenido')}
              >
                <Square size={15} /> Detener
              </button>
            </div>
            {showContainerLog &&
              (containerLog?.log ? (
                <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100 whitespace-pre-wrap">
                  {containerLog.log.lines.join('\n')}
                </pre>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  {containerLog?.error ?? 'sin output todavía — el container está arrancando'}
                </p>
              ))}
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="65535"
              placeholder={String(suggestedPort)}
              value={hostPort}
              onChange={(e) => setHostPort(e.target.value)}
              className="w-24 rounded-lg px-2 py-1.5 text-sm ring-1 ring-slate-300"
              title="Puerto host (default sugerido según la variante)"
            />
            <button
              className={btn}
              disabled={busy || !imageReady}
              title={
                !imageReady
                  ? 'Primero Dockerize — no hay imagen buildeada'
                  : `docker/podman run -d -p <host>:<container>`
              }
              onClick={() =>
                act(
                  { action: 'run-container', port: hostPort ? Number(hostPort) : undefined },
                  (r) => `container corriendo en localhost:${r.container.hostPort}`,
                )
              }
            >
              <Container size={15} /> Crear contenedor
            </button>
            {!imageReady && <span className="text-xs text-slate-400">primero Dockerize</span>}
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 shadow-sm">
        <button
          className="flex items-center gap-2 text-sm font-bold text-slate-800"
          onClick={() => setShowLog((v) => !v)}
        >
          <FileText size={16} /> Log del run {showLog ? '▾' : '▸'}
        </button>
        {showLog &&
          (logData?.log ? (
            <>
              <p className="mt-2 text-xs text-slate-500">
                job #{logData.jobId} · {logData.jobStatus}
                {logData.log.truncated ? ' · (últimas líneas — log truncado)' : ''}
              </p>
              <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100 whitespace-pre-wrap">
                {logData.log.lines.join('\n')}
              </pre>
            </>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              sin log todavía — aparece cuando un worker corre un job de este proyecto
            </p>
          ))}
      </section>

      <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 shadow-sm">
        <button
          className="flex items-center gap-2 text-sm font-bold text-slate-800"
          onClick={() => setShowPrompt((v) => !v)}
        >
          <FileText size={16} /> Prompt original {showPrompt ? '▾' : '▸'}
        </button>
        {showPrompt && (
          <div className="mt-3 space-y-3">
            <pre className="max-h-72 overflow-auto rounded-lg bg-slate-50 p-4 text-sm text-slate-700 whitespace-pre-wrap">
              {project.idea ?? '—'}
            </pre>
            <div className="flex flex-wrap gap-2 text-xs">
              {[
                ['scope', project.scope],
                ['vertical', project.appType],
                ['arch', project.arch],
                ['front', project.stacks?.frontend],
                ['back', project.stacks?.backend],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <span key={k} className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                    {k}: {v}
                  </span>
                ))}
            </div>
          </div>
        )}
      </section>

      {(project.scripts ?? []).length > 0 && (
        <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 shadow-sm">
          <h3 className="text-sm font-bold text-slate-800">Comandos</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <tbody>
                {project.scripts.map((s) => (
                  <tr key={s.name} className="border-t border-slate-100 first:border-t-0">
                    <td className="py-2 pr-4 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">
                      npm run {s.name}
                    </td>
                    <td className="py-2 text-xs text-slate-500 font-mono">{s.command}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {testRun && (
        <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 shadow-sm">
          <button
            className="flex items-center gap-2 text-sm font-bold text-slate-800"
            onClick={() => setShowTestOut((v) => !v)}
          >
            <FlaskConical size={16} /> Output de tests {showTestOut ? '▾' : '▸'}
          </button>
          {showTestOut &&
            (testOut?.log ? (
              <>
                <p className="mt-2 text-xs text-slate-500">
                  {testOut.testRun?.command}
                  {testOut.log.truncated ? ' · (últimas líneas — output truncado)' : ''}
                </p>
                <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100 whitespace-pre-wrap">
                  {testOut.log.lines.join('\n')}
                </pre>
              </>
            ) : (
              <p className="mt-2 text-xs text-slate-500">sin output todavía — el run está arrancando</p>
            ))}
        </section>
      )}

      {project.report && (
        <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 shadow-sm">
          <button
            className="flex items-center gap-2 text-sm font-bold text-slate-800"
            onClick={() => setShowReport((v) => !v)}
          >
            <FileText size={16} /> Reporte del último run {showReport ? '▾' : '▸'}
          </button>
          {showReport && (
            <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-50 p-4 text-xs text-slate-700 whitespace-pre-wrap">
              {project.report}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
