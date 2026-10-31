import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CircleCheckBig, CloudUpload, Container, Copy, ExternalLink, FileText, FlaskConical, GitBranch, Globe, LoaderCircle, Play, Plus, RotateCcw, Square, Trash2 } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { api } from '../api.js';
import { timeAgo } from '../util.js';

// lazy: xterm.js pesa — solo se baja cuando se entra a un detalle
const TerminalPanel = lazy(() => import('./TerminalPanel.jsx'));

const btn =
  'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-slate-200 ring-1 ring-accent-500/50 bg-slate-900 hover:bg-slate-950 disabled:text-slate-500 disabled:opacity-60 disabled:cursor-not-allowed';

export default function ProjectDetail({ slug, onChanged }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  // qué acción está en vuelo ('resume'|'dockerize'|...) — el spinner va
  // en el botón correspondiente; el resto queda deshabilitado igual.
  const [busy, setBusy] = useState(null);
  // Remoto del proyecto: {repoUrl, pagesUrl} — va aparte del poll
  // (ls-remote pega en la red). Se refetchea tras `publish`.
  const [repoInfo, setRepoInfo] = useState(null);
  const [pubOpen, setPubOpen] = useState(false);
  const [withPages, setWithPages] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [logData, setLogData] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [withE2e, setWithE2e] = useState(false);
  const [showTestOut, setShowTestOut] = useState(false);
  const [testOut, setTestOut] = useState(null);
  const [hostPort, setHostPort] = useState('');
  const [showContainerLog, setShowContainerLog] = useState(false);
  const [containerLog, setContainerLog] = useState(null);
  const [showDevLog, setShowDevLog] = useState(false);
  const [devLog, setDevLog] = useState(null);
  const [showPubLog, setShowPubLog] = useState(false);
  const [pubLog, setPubLog] = useState(null);
  const [notice, setNotice] = useState(null);
  // Modal "agregar backend" (v9): scope frontend → --extend a fullstack.
  const [backendOpen, setBackendOpen] = useState(false);
  const [backendForm, setBackendForm] = useState({ idea: '', arch: 'flat', stackBackend: 'express-sqlite', github: false, ghpages: false });
  const [stackOptions, setStackOptions] = useState([]);
  const [archOptions, setArchOptions] = useState([]);
  const [githubOk, setGithubOk] = useState(true); // true=fail-open hasta que options() resuelva
  // Superficie de API: endpoints escaneados de server/routes/ + probe.
  const [apiSurface, setApiSurface] = useState(null);
  const [probe, setProbe] = useState(null); // {path, status, body}

  // Flag GitHub al montar — no solo al abrir el modal de backend
  // (ese botón no existe en proyectos fullstack/backend y el flag
  // quedaba fail-open: el disable del publish nunca se activaba).
  useEffect(() => {
    api.options().then((o) => setGithubOk(Boolean(o.github))).catch(() => {});
  }, []);

  const load = () =>
    api.project(slug).then(setProject).catch((e) => setError(e.message));

  const loadRepo = () =>
    api.repoInfo(slug).then(setRepoInfo).catch(() => setRepoInfo({ repoUrl: null, pagesUrl: null }));

  useEffect(() => {
    load();
    loadRepo();
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

  // Log del dev run local: polling con el acordeón abierto O mientras
  // el run esté vivo — trae las URLs parseadas del output (vite/next
  // imprimen su puerto real si el convencional estaba ocupado).
  const devLive = project?.devRun?.status === 'running' && !project?.devRun?.stale;
  useEffect(() => {
    if (!showDevLog && !devLive) return;
    const loadDev = () => api.devLog(slug).then(setDevLog).catch(() => {});
    loadDev();
    const t = setInterval(loadDev, 4000);
    return () => clearInterval(t);
  }, [showDevLog, devLive, slug]);

  // Log del publish (publish.log): lazy, solo con el acordeón abierto.
  useEffect(() => {
    if (!showPubLog) return;
    api.publishLog(slug).then(setPubLog).catch(() => {});
  }, [showPubLog, slug]);

  // API surface: endpoints escaneados de server/routes/ (auto-mount
  // /api/<file>) — solo cuando el proyecto tiene backend.
  useEffect(() => {
    setProbe(null); // el componente no remonta al cambiar de slug
    setApiSurface(null);
    if (!project || project.scope === 'frontend') return;
    api.apiSurface(slug).then(setApiSurface).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, project?.scope]);

  // Publish es async: el POST solo confirma el inicio (202) — el
  // resultado llega via project.publish en el poll de 5s. En la
  // transición running→terminal se limpia el "en curso" del notice y
  // se refetchea repoInfo (los links quedan renderizados abajo).
  const prevPubStatus = useRef(undefined);
  useEffect(() => {
    const st = project?.publish?.status;
    if (prevPubStatus.current === 'running' && st && st !== 'running') {
      setNotice(null);
      if (st === 'done') loadRepo();
    }
    prevPubStatus.current = st;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.publish?.status]);

  const act = async (body, okMsg) => {
    setBusy(body.action);
    setNotice(null);
    try {
      const res = await api.action(slug, body);
      setNotice(okMsg?.(res) ?? 'listo');
      await load();
      onChanged?.();
    } catch (err) {
      setNotice(`error: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  // Borrar va al listado — el modal de confirmación es el único gate
  // (no hay undo). Se abre con setConfirmDel(true).
  const del = async () => {
    setBusy('delete');
    setNotice(null);
    try {
      await api.action(slug, { action: 'delete' });
      window.location.hash = '#/proyectos';
    } catch (err) {
      setNotice(`error: ${err.message}`);
      setBusy(null);
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

  // Publicar (async): crea el repo si falta + push main (+ gh-pages si
  // se pidió). El server responde 202 al instante — repoUrl/pagesUrl
  // llegan después via project.publish en el poll.
  const pub = async () => {
    setBusy('publish');
    setNotice(null);
    try {
      await api.action(slug, { action: 'publish', ghpages: withPages });
      setNotice('publish en curso…');
      await load();
      onChanged?.();
    } catch (err) {
      setNotice(`error: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const spin = <LoaderCircle size={15} className="animate-spin" />;

  const deleteModal = confirmDel && (
    <DeleteConfirmModal
      slug={slug}
      busy={busy}
      spin={spin}
      onCancel={() => setConfirmDel(false)}
      onConfirm={del}
    />
  );

  // El detalle da 404 en dirs sin plan.json (run muerto en preflight) —
  // justo el caso de limpieza: ofrecer eliminar igual desde acá.
  if (error) {
    return (
      <div className="space-y-4">
        <a href="#/proyectos" className="inline-flex items-center gap-1.5 text-sm text-accent-300 hover:underline">
          <ArrowLeft size={15} /> proyectos
        </a>
        <p className="text-sm text-red-300">error: {error}</p>
        <button
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-red-400 ring-1 ring-red-500/40 bg-slate-900 hover:bg-red-500/10 disabled:opacity-40"
          disabled={busy}
          onClick={() => setConfirmDel(true)}
        >
          {busy === 'delete' ? spin : <Trash2 size={15} />} Eliminar la carpeta
        </button>
        {deleteModal}
      </div>
    );
  }
  if (!project) return <p className="text-sm text-slate-400">cargando…</p>;

  const build = project.dockerBuild;
  const testRun = project.testRun;
  // 'running' + stale = proceso muerto (dashboard caído) → se puede relanzar.
  const testRunning = testRun?.status === 'running' && !testRun.stale;
  const runtime = project.runtime;
  const engine = runtime?.engine ?? null;
  const container = runtime?.container ?? null;
  const suggestedPort = runtime?.suggested?.suggestedHostPort ?? 4000;
  // imagen <slug>:local — la fuente es `image inspect` (server), no
  // docker-build.json: cubre builds por podman o hechas a mano por CLI.
  const imageReady = runtime?.image === true;
  const building = build?.status === 'running';
  const hasTestScript = (project.scripts ?? []).some((s) => s.name === 'test');
  const hasE2eScript = (project.scripts ?? []).some((s) => s.name === 'test:e2e');
  // done = pipeline terminado; no-plan = sin plan.json (resume imposible).
  const canResume = project.status !== 'done' && project.status !== 'no-plan';
  // Dev local: devTargets viene del server (scripts dev/api presentes).
  const devTargets = project.devTargets ?? [];
  const devRun = project.devRun;
  const devRunning = devRun?.status === 'running' && !devRun.stale;
  // repoInfo llega async (ls-remote) — hasta entonces el repoUrl del
  // detalle alcanza para renderizar el botón sin flash.
  const repoUrl = repoInfo?.repoUrl ?? project.repoUrl;
  const hasFrontend = project.scope !== 'backend';
  const hasBackend = project.scope !== 'frontend';

  const probeEndpoint = async (path) => {
    setProbe({ path, status: '…', body: '' });
    try {
      const r = await api.probe(slug, path);
      setProbe({ path, status: r.status, body: (r.body ?? '').slice(0, 800) });
    } catch (e) {
      setProbe({ path, status: 'ERR', body: e.message });
    }
  };
  // publish llega en el detalle (publish.json del server): running
  // → spinner, done → anchors, failed → error.
  const publish = project.publish;
  const publishing = publish?.status === 'running';

  return (
    <div className="space-y-4">
      <a href="#/proyectos" className="inline-flex items-center gap-1.5 text-sm text-accent-300 hover:underline">
        <ArrowLeft size={15} /> proyectos
      </a>

      <section className="rounded-lg bg-slate-900 p-6 ring-1 ring-accent-500/40 glow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-100">{project.name}</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {project.slug} · actualizado {timeAgo(project.updatedAt)}
            </p>
            {project.idea && (
              <p className="mt-2 max-w-2xl text-sm text-slate-400 line-clamp-2">{project.idea}</p>
            )}
          </div>
          <StatusBadge status={project.status} />
          {project.timings?.startedAt && project.timings?.finishedAt && (
            <span className="rounded-full bg-slate-800 px-2.5 py-1 font-medium text-slate-400 ring-1 ring-accent-500/40">
              ⏱ {Math.round((new Date(project.timings.finishedAt) - new Date(project.timings.startedAt)) / 60000)}min
            </span>
          )}
        </div>
        {project.lastError && (
          <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{project.lastError}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className={btn}
            disabled={busy || !canResume}
            title={canResume ? 'Retoma el pipeline desde plan.json' : 'El proyecto ya terminó (o no tiene plan.json)'}
            data-testid="project-resume"
            onClick={() => act({ action: 'resume' }, () => 'resume encolado')}
          >
            {busy === 'resume' ? spin : <Play size={15} />} Resume
          </button>
          {project.scope === 'frontend' && (
            <button
              className={btn}
              disabled={Boolean(busy)}
              title="Agrega backend al proyecto (--extend): el agente lee la UI y diseña la API"
              onClick={async () => {
                setBackendOpen(true);
                if (!archOptions.length)
                  api.options()
                    .then((o) => {
                      setArchOptions(o.archs ?? []);
                      setStackOptions(o.backendStacks ?? []);
                      setGithubOk(Boolean(o.github));
                    })
                    .catch(() => {});
              }}
            >
              <Plus size={15} /> Agregar backend
            </button>
          )}
          <button
            className={btn}
            disabled={busy || building}
            title={building ? 'Build en curso — mirá docker-build.log' : 'Escribe Dockerfile y buildea la imagen'}
            onClick={() =>
              act({ action: 'dockerize' }, (r) =>
                r.build.status === 'skipped'
                  ? `Dockerfile ${r.variant} escrito — ${r.build.reason ?? 'sin engine'}`
                  : `build ${r.build.tag} iniciado`,
              )
            }
          >
            {busy === 'dockerize' || building ? spin : <Container size={15} />}
            {building ? 'Buildeando…' : 'Dockerize'}
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
            data-testid="project-test-run"
            onClick={() => act({ action: 'test', e2e: withE2e }, () => 'test run iniciado')}
          >
            {busy === 'test' || testRunning ? spin : <FlaskConical size={15} />}
            {testRunning ? 'Corriendo tests…' : 'Ejecutar tests'}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={withE2e}
              disabled={!hasE2eScript}
              title={hasE2eScript ? 'También corre npm run test:e2e' : 'El proyecto no tiene script "test:e2e"'}
              onChange={(e) => setWithE2e(e.target.checked)}
            />
            + e2e
          </label>
          {repoUrl ? (
            <>
              <button className={btn} onClick={openRepo} title="Abrir el repo en una pestaña nueva">
                <ExternalLink size={15} /> Abrir repo
              </button>
              {repoInfo?.pagesUrl && (
                <button
                  className={btn}
                  title={repoInfo.pagesUrl}
                  onClick={() => window.open(repoInfo.pagesUrl, '_blank', 'noopener')}
                >
                  <Globe size={15} /> Pages
                </button>
              )}
            </>
          ) : (
            <button
              className={btn}
              title="Crear el repo en GitHub y pushear main"
              onClick={() => setPubOpen((v) => !v)}
            >
              <GitBranch size={15} /> GitHub
            </button>
          )}
          {project.scope === 'fullstack' && (
            <button
              className={btn}
              title="Nueva app con la misma config (scope/vertical/arch/stacks)"
              onClick={() => { window.location.hash = `#/fullstack?clone=${slug}`; }}
            >
              <Copy size={15} /> Nueva app igual
            </button>
          )}
          <button
            className="ml-auto inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-red-400 ring-1 ring-red-500/40 bg-slate-900 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={busy}
            title="Borra generated-apps/<slug> + container + imagen (si hay engine)"
            onClick={() => setConfirmDel(true)}
          >
            {busy === 'delete' ? spin : <Trash2 size={15} />} Eliminar
          </button>
        </div>
        {pubOpen && !repoUrl && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-950 px-4 py-3 text-sm ring-1 ring-accent-500/40">
            <p className="text-slate-300">¿Subir el proyecto a GitHub como repo público?</p>
            {hasFrontend && (
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={withPages}
                  onChange={(e) => setWithPages(e.target.checked)}
                />
                + publicar el build en GitHub Pages
              </label>
            )}
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-40"
              disabled={busy === 'publish' || publishing || !githubOk}
              title={githubOk ? '' : 'sin GITHUB_TOKEN en .env'}
              onClick={pub}
            >
              {busy === 'publish' || publishing ? spin : <CloudUpload size={14} />}
              {publishing ? 'publicando…' : 'Subir'}
            </button>
          </div>
        )}
        {notice && <p className="mt-2 text-sm text-slate-400">{notice}</p>}
        {publishing && !notice && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-400">{spin} publicando…</p>
        )}
        {publish?.status === 'done' && (publish.repoUrl || publish.pagesUrl) && (
          <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-400">
            <CircleCheckBig size={14} className="text-emerald-400" /> publicado:
            {publish.repoUrl && (
              <a
                href={publish.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-300 underline"
              >
                {publish.repoUrl}
              </a>
            )}
            {publish.pagesUrl && (
              <a
                href={publish.pagesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-300 underline"
              >
                {publish.pagesUrl}
              </a>
            )}
          </p>
        )}
        {publish?.status === 'done' && publish.pagesError && (
          <p className="mt-1 text-xs text-amber-400">Pages: {publish.pagesError}</p>
        )}
        {(publish?.status === 'done' || publish?.status === 'failed') && (
          <button
            className="mt-1 text-xs text-slate-400 hover:underline"
            onClick={() => setShowPubLog((v) => !v)}
          >
            publish log {showPubLog ? '▾' : '▸'}
          </button>
        )}
        {showPubLog &&
          (pubLog?.log ? (
            <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100 whitespace-pre-wrap">
              {pubLog.log.lines.join('\n')}
            </pre>
          ) : (
            <p className="mt-1 text-xs text-slate-400">sin publish.log todavía</p>
          ))}
        {publish?.status === 'failed' && (
          <p className="mt-2 text-sm text-red-300">
            publish falló{publish.error ? `: ${publish.error}` : ''}
          </p>
        )}
        {build && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
            {building && spin} último docker build: <b>{build.status}</b>
            {build.tag ? ` (${build.tag})` : ''}
            {build.exitCode !== undefined ? ` exit ${build.exitCode}` : ''}
            {build.reason ? ` — ${build.reason}` : ''}
          </p>
        )}
        {testRun && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
            {testRunning && spin} último test run:{' '}
            <b>{testRun.stale ? `${testRun.status} (interrumpido)` : testRun.status}</b>
            {testRun.command ? ` (${testRun.command})` : ''}
            {testRun.exitCode !== undefined ? ` exit ${testRun.exitCode}` : ''}
          </p>
        )}
      </section>

      <section className="rounded-lg bg-slate-900 p-6 ring-1 ring-accent-500/40 glow-card">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
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
            <p className="text-xs text-slate-400">
              corriendo ({engine}) ·{' '}
              <a
                href={`http://localhost:${container.hostPort ?? suggestedPort}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-accent-300 hover:underline"
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
                {busy === 'stop-container' ? spin : <Square size={15} />} Detener
              </button>
            </div>
            {showContainerLog &&
              (containerLog?.log ? (
                <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100 whitespace-pre-wrap">
                  {containerLog.log.lines.join('\n')}
                </pre>
              ) : (
                <p className="mt-3 text-xs text-slate-400">
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
              className="w-24 rounded-lg border border-accent-500/40 bg-slate-900 text-slate-200 placeholder:text-slate-500 px-2 py-1.5 text-sm outline-none ring-1 ring-accent-500/50"
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
              {busy === 'run-container' ? spin : <Container size={15} />}
              {busy === 'run-container' ? 'Creando…' : 'Crear contenedor'}
            </button>
            {!imageReady && <span className="text-xs text-slate-400">primero Dockerize</span>}
          </div>
        )}
      </section>

      {hasBackend && (
        <section className="rounded-lg bg-slate-900 p-6 ring-1 ring-accent-500/40 glow-card">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Globe size={16} className="text-slate-400" /> API
          </h3>
            {apiSurface?.endpoints?.length ? (
              <ul className="mt-3 space-y-1 text-sm">
                {apiSurface.endpoints.map((e, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-semibold ${e.method === 'GET' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-accent-500/20 text-accent-300'}`}>{e.method}</span>
                    <code className="text-slate-300">{e.path}</code>
                    <span className="text-xs text-slate-400">{e.file}</span>
                    {devRunning && e.method === 'GET' && (
                      <button
                        data-testid={`project-probe${e.path.replaceAll("/", "-")}`}
                        title={`GET ${e.path} contra el dev-run (proxy via dashboard)`}
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
              <p className="mt-2 text-xs text-slate-400">sin endpoints detectados en server/routes/</p>
            )}
            {probe && (
              <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-200 font-mono">
                GET {probe.path} → {probe.status}
                {'\n'}{probe.body}
              </pre>
            )}
        </section>
      )}

      {(devTargets.length > 0 || devRun) && (
        <section className="rounded-lg bg-slate-900 p-6 ring-1 ring-accent-500/40 glow-card">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Play size={16} /> Dev local <span className="font-normal text-slate-400">sin containers</span>
          </h3>
          {devRunning ? (
            <div className="mt-2">
              <p className="text-xs text-slate-400">
                corriendo ·{' '}
                {(devLog?.urls?.length ? devLog.urls : devRun.procs.filter((p) => p.alive).map((p) => `http://localhost:${p.port}`)).map(
                  (u) => (
                    <a
                      key={u}
                      href={u}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mr-3 font-medium text-accent-300 hover:underline"
                    >
                      {u}
                    </a>
                  ),
                )}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button className={btn} onClick={() => setShowDevLog((v) => !v)}>
                  <FileText size={15} /> Ver logs {showDevLog ? '▾' : '▸'}
                </button>
                <button
                  className={btn}
                  disabled={busy}
                  onClick={() => act({ action: 'stop-dev' }, () => 'dev detenido')}
                >
                  {busy === 'stop-dev' ? spin : <Square size={15} />} Detener
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <button
                className={btn}
                disabled={busy || !devTargets.length}
                title={
                  devTargets.length
                    ? `Corre ${devTargets.map((t) => t.cmd).join(' + ')} en background`
                    : 'El proyecto no tiene comando dev/api detectable'
                }
                data-testid="project-run-dev"
                onClick={() => act({ action: 'run-dev' }, () => 'dev run iniciado')}
              >
                {busy === 'run-dev' ? spin : <Play size={15} />} Correr en dev
              </button>
              {devRun && (
                <button
                  className="text-xs text-slate-400 hover:underline"
                  onClick={() => setShowDevLog((v) => !v)}
                >
                  último dev run: <b>{devRun.stale ? `${devRun.status} (interrumpido)` : devRun.status}</b>
                  {devRun.finishedAt ? ` · ${timeAgo(devRun.finishedAt)}` : ''} · log {showDevLog ? '▾' : '▸'}
                </button>
              )}
            </div>
          )}
          {showDevLog &&
            (devLog?.log ? (
              <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100 whitespace-pre-wrap">
                {devLog.log.lines.join('\n')}
              </pre>
            ) : (
              <p className="mt-3 text-xs text-slate-400">sin output todavía — el dev server está arrancando</p>
            ))}
        </section>
      )}

      {/* lazy: xterm.js pesa — solo se baja cuando se entra a un detalle */}
      <Suspense fallback={null}>
        <TerminalPanel slug={slug} />
      </Suspense>

      <section className="rounded-lg bg-slate-900 p-6 ring-1 ring-accent-500/40 glow-card">
        <button
          className="flex items-center gap-2 text-sm font-bold text-slate-200"
          onClick={() => setShowLog((v) => !v)}
        >
          <FileText size={16} /> Log del run {showLog ? '▾' : '▸'}
        </button>
        {showLog &&
          (logData?.log ? (
            <>
              <p className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                job #{logData.jobId} · {logData.jobStatus}
                {logData.log.truncated ? ' · (últimas líneas — log truncado)' : ''}
                {(logData.jobStatus === 'failed' || logData.jobStatus === 'cancelled') && (
                  <button
                    disabled={busy === 'requeue-job'}
                    onClick={async () => {
                      setBusy('requeue-job');
                      try {
                        await api.requeueJob(logData.jobId);
                      } finally {
                        setBusy(null);
                        api.projectLog(slug).then(setLogData).catch(() => {});
                        onChanged?.();
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-slate-400 ring-1 ring-accent-500/50 hover:bg-slate-950 disabled:opacity-40"
                  >
                    {busy === 'requeue-job' ? (
                      <LoaderCircle size={11} className="animate-spin" />
                    ) : (
                      <RotateCcw size={10} />
                    )}
                    reintentar
                  </button>
                )}
                {(logData.jobStatus === 'pending' || logData.jobStatus === 'running') && (
                  <button
                    disabled={busy === 'cancel-job'}
                    onClick={async () => {
                      setBusy('cancel-job');
                      try {
                        await api.cancelJob(logData.jobId);
                      } finally {
                        setBusy(null);
                        api.projectLog(slug).then(setLogData).catch(() => {});
                        onChanged?.();
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-red-400 ring-1 ring-red-500/40 hover:bg-red-500/10 disabled:opacity-40"
                  >
                    {busy === 'cancel-job' ? (
                      <LoaderCircle size={11} className="animate-spin" />
                    ) : (
                      <Square size={10} />
                    )}
                    cancelar job
                  </button>
                )}
              </p>
              <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100 whitespace-pre-wrap">
                {logData.log.lines.join('\n')}
              </pre>
            </>
          ) : (
            <p className="mt-2 text-xs text-slate-400">
              sin log todavía — aparece cuando un worker corre un job de este proyecto
            </p>
          ))}
      </section>

      <section className="rounded-lg bg-slate-900 p-6 ring-1 ring-accent-500/40 glow-card">
        <button
          className="flex items-center gap-2 text-sm font-bold text-slate-200"
          onClick={() => setShowPrompt((v) => !v)}
        >
          <FileText size={16} /> Prompt original {showPrompt ? '▾' : '▸'}
        </button>
        {showPrompt && (
          <div className="mt-3 space-y-3">
            <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-4 text-sm text-slate-300 whitespace-pre-wrap">
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
                  <span key={k} className="rounded-full bg-slate-800 px-2.5 py-1 font-medium text-slate-400 ring-1 ring-accent-500/40">
                    {k}: {v}
                  </span>
                ))}
            </div>
          </div>
        )}
      </section>

      {(project.scripts ?? []).length > 0 && (
        <section className="rounded-lg bg-slate-900 p-6 ring-1 ring-accent-500/40 glow-card">
          <h3 className="text-sm font-bold text-slate-200">Comandos</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <tbody>
                {project.scripts.map((s) => (
                  <tr key={s.name} className="border-t border-slate-100 first:border-t-0">
                    <td className="py-2 pr-4 font-mono text-xs font-semibold text-slate-300 whitespace-nowrap">
                      npm run {s.name}
                    </td>
                    <td className="py-2 text-xs text-slate-400 font-mono">{s.command}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {testRun && (
        <section className="rounded-lg bg-slate-900 p-6 ring-1 ring-accent-500/40 glow-card">
          <button
            className="flex items-center gap-2 text-sm font-bold text-slate-200"
            onClick={() => setShowTestOut((v) => !v)}
          >
            <FlaskConical size={16} /> Output de tests {showTestOut ? '▾' : '▸'}
          </button>
          {showTestOut &&
            (testOut?.log ? (
              <>
                <p className="mt-2 text-xs text-slate-400">
                  {testOut.testRun?.command}
                  {testOut.log.truncated ? ' · (últimas líneas — output truncado)' : ''}
                </p>
                <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100 whitespace-pre-wrap">
                  {testOut.log.lines.join('\n')}
                </pre>
              </>
            ) : (
              <p className="mt-2 text-xs text-slate-400">sin output todavía — el run está arrancando</p>
            ))}
        </section>
      )}

      {project.report && (
        <section className="rounded-lg bg-slate-900 p-6 ring-1 ring-accent-500/40 glow-card">
          <button
            className="flex items-center gap-2 text-sm font-bold text-slate-200"
            onClick={() => setShowReport((v) => !v)}
          >
            <FileText size={16} /> Reporte del último run {showReport ? '▾' : '▸'}
          </button>
          {showReport && (
            <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-300 whitespace-pre-wrap">
              {project.report}
            </pre>
          )}
        </section>
      )}

      {backendOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-24"
          onClick={() => setBackendOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-slate-900 p-5 ring-1 ring-accent-500/40 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-slate-200">Agregar backend a {slug}</h3>
            <p className="mt-1 text-xs text-slate-400">
              El agente lee el frontend existente y diseña la API sobre el stack elegido,
              la integración UI↔API y los tests — todo sobre este mismo proyecto.
            </p>
            <textarea
              value={backendForm.idea}
              onChange={(e) => setBackendForm((f) => ({ ...f, idea: e.target.value }))}
              placeholder="¿Qué datos maneja tu app? (ej. productos, pedidos, posts — vacío = lo infiere de la UI)"
              rows={3}
              className="mt-3 w-full rounded-lg border border-accent-500/40 bg-slate-950 text-slate-200 placeholder:text-slate-500 px-3 py-2 text-sm outline-none focus:border-accent-500"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="text-xs text-slate-400">
                Stack{' '}
                <select
                  value={backendForm.stackBackend}
                  onChange={(e) => setBackendForm((f) => ({ ...f, stackBackend: e.target.value }))}
                  className="rounded-lg border border-accent-500/40 bg-slate-950 text-slate-200 placeholder:text-slate-500 px-2 py-1"
                >
                  {(stackOptions.length ? stackOptions : [{ id: 'express-sqlite', label: 'Express + SQLite' }]).map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-400">
                Arquitectura{' '}
                <select
                  value={backendForm.arch}
                  onChange={(e) => setBackendForm((f) => ({ ...f, arch: e.target.value }))}
                  className="rounded-lg border border-accent-500/40 bg-slate-950 text-slate-200 placeholder:text-slate-500 px-2 py-1"
                >
                  {(archOptions.length ? archOptions : ['flat']).map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={backendForm.github}
                  disabled={!githubOk}
                  title={githubOk ? '' : 'sin GITHUB_TOKEN en .env'}
                  onChange={(e) => setBackendForm((f) => ({ ...f, github: e.target.checked }))}
                />
                github
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={backendForm.ghpages}
                  disabled={!backendForm.github || !githubOk}
                  onChange={(e) => setBackendForm((f) => ({ ...f, ghpages: e.target.checked }))}
                />
                gh-pages
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setBackendOpen(false)} className={btn}>
                cancelar
              </button>
              <button
                disabled={busy === 'add-backend'}
                onClick={() => {
                  setBackendOpen(false);
                  act(
                    {
                      action: 'add-backend',
                      idea: backendForm.idea.trim() || undefined,
                      arch: backendForm.arch,
                      stackBackend: backendForm.stackBackend,
                      github: backendForm.github,
                      ghpages: backendForm.ghpages,
                    },
                    () => 'extend encolado — el agente diseña la API sobre tu frontend',
                  );
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-40"
              >
                {busy === 'add-backend' ? spin : <Plus size={15} />} generar backend
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModal}
    </div>
  );
}

// Modal de confirmación del delete — definido una vez y renderizado en
// las dos vistas del detalle (normal y error-sin-plan.json): un solo
// punto de verdad para el flujo destructivo.
function DeleteConfirmModal({ slug, busy, spin, onCancel, onConfirm }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-24"
          data-testid="delete-confirm-modal"
          onClick={() => busy !== 'delete' && onCancel()}
        >
          <div
            className="w-full max-w-md rounded-lg bg-slate-900 p-5 ring-1 ring-red-500/40 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-slate-200">¿Eliminar {slug}?</h3>
            <p className="mt-2 text-xs text-slate-400">
              Se borra <code className="font-mono text-slate-300">generated-apps/{slug}</code> entero,
              más su container y la imagen <code className="font-mono text-slate-300">{slug}:local</code> si
              existen. No hay vuelta atrás.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                data-testid="delete-confirm-cancel"
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-slate-300 ring-1 ring-accent-500/40 bg-slate-900 hover:bg-slate-950 disabled:opacity-40"
                disabled={busy === 'delete'}
                onClick={onCancel}
              >
                Cancelar
              </button>
              <button
                data-testid="delete-confirm-accept"
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-red-300 ring-1 ring-red-500/50 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={busy === 'delete'}
                onClick={onConfirm}
              >
                {busy === 'delete' ? spin : <Trash2 size={15} />} Eliminar
              </button>
            </div>
          </div>
        </div>
  );
}
