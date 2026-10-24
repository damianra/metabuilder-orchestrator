import { useEffect, useState } from 'react';
import { ArrowLeft, Container, ExternalLink, FileText, Play } from 'lucide-react';
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
            {project.idea && <p className="mt-2 max-w-2xl text-sm text-slate-600">{project.idea}</p>}
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
        <h3 className="text-sm font-bold text-slate-800">Pasos del plan ({project.planSteps.length})</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="pb-2 pr-3">#</th>
                <th className="pb-2 pr-3">tipo</th>
                <th className="pb-2 pr-3">status</th>
                <th className="pb-2 pr-3">intentos</th>
                <th className="pb-2">verify</th>
              </tr>
            </thead>
            <tbody>
              {project.planSteps.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3 text-slate-400">{s.id}</td>
                  <td className="py-2 pr-3">{s.type}</td>
                  <td className="py-2 pr-3"><StatusBadge status={s.status} /></td>
                  <td className="py-2 pr-3 text-slate-600">{s.attempts ?? 0}</td>
                  <td className="py-2 text-xs text-slate-500 font-mono">{s.verify}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
