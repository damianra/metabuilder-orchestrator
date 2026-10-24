import { useCallback, useEffect, useState } from 'react';
import { Boxes } from 'lucide-react';
import { api } from './api.js';
import NewAppForm from './components/NewAppForm.jsx';
import ProjectList from './components/ProjectList.jsx';
import ProjectDetail from './components/ProjectDetail.jsx';
import QueuePanel from './components/QueuePanel.jsx';

const parseHash = () => {
  const m = window.location.hash.match(/^#\/p\/([a-z0-9-]+)/);
  return m ? { view: 'detail', slug: m[1] } : { view: 'list' };
};

export default function App() {
  const [route, setRoute] = useState(parseHash);
  const [projects, setProjects] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [worker, setWorker] = useState(null);
  const [apiDown, setApiDown] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [p, j] = await Promise.all([api.projects(), api.jobs()]);
      setProjects(p);
      setJobs(j.jobs ?? []);
      setWorker(j.worker ?? null);
      setApiDown(false);
    } catch {
      setApiDown(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'pending').length;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <a href="#/" className="flex items-center gap-2 font-bold tracking-tight text-slate-900">
            <Boxes size={20} className="text-sky-600" /> MetaBuilder
          </a>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {running > 0 && <span className="text-sky-700 font-semibold">{running} corriendo</span>}
            {queued > 0 && <span>{queued} en cola</span>}
            <span className={`inline-flex items-center gap-1.5 ${apiDown ? 'text-red-600' : 'text-emerald-700'}`}>
              <span className={`h-2 w-2 rounded-full ${apiDown ? 'bg-red-500' : 'bg-emerald-500'}`} />
              api {apiDown ? 'caída' : 'ok'}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        {apiDown && (
          <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
            La API no responde — levantala con <code className="font-mono">npm run dashboard</code>.
          </p>
        )}
        {route.view === 'detail' ? (
          <ProjectDetail slug={route.slug} onChanged={refresh} />
        ) : (
          <>
            <NewAppForm onEnqueued={refresh} />
            <QueuePanel jobs={jobs} worker={worker} />
            <ProjectList projects={projects} />
          </>
        )}
      </main>
    </div>
  );
}
