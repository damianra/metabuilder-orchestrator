// Cliente mínimo de la API del dashboard — el proxy de Vite manda
// /api → 127.0.0.1:4100 en dev.
const req = async (path, opts) => {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
};

export const api = {
  options: () => req('/api/options'),
  engines: () => req('/api/engines'),
  saveSettings: (body) =>
    req('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  projects: () => req('/api/projects'),
  project: (slug) => req(`/api/projects/${slug}`),
  jobs: () => req('/api/jobs'),
  cancelJob: (id) => req(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  jobLog: (id, tail = 200) => req(`/api/jobs/${id}/log?tail=${tail}`),
  requeueJob: (id) => req(`/api/jobs/${id}/requeue`, { method: 'POST' }),
  clearJobs: () => req('/api/jobs/clear', { method: 'POST' }),
  repoInfo: (slug) => req(`/api/projects/${slug}/repo`),
  projectLog: (slug, tail = 200) => req(`/api/projects/${slug}/log?tail=${tail}`),
  projectTestLog: (slug, tail = 200) => req(`/api/projects/${slug}/test-log?tail=${tail}`),
  containerLog: (slug, tail = 200) => req(`/api/projects/${slug}/container-log?tail=${tail}`),
  devLog: (slug, tail = 200) => req(`/api/projects/${slug}/dev-log?tail=${tail}`),
  enqueueRun: (body) =>
    req('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  action: (slug, body) =>
    req(`/api/projects/${slug}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
};
