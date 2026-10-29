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
  publishLog: (slug, tail = 200) => req(`/api/projects/${slug}/publish-log?tail=${tail}`),
  apiSurface: (slug) => req(`/api/projects/${slug}/api-surface`),
  probe: (slug, path) => req(`/api/projects/${slug}/probe?path=${encodeURIComponent(path)}`),
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
  designStatus: () => req('/api/design'),
  createDesign: (forSlug) =>
    req('/api/design', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(forSlug ? { for: forSlug } : {}),
    }),
  discardDesign: () => req('/api/design', { method: 'DELETE' }),
  designDev: () => req('/api/design/dev', { method: 'POST' }),
  designStopDev: () => req('/api/design/stop-dev', { method: 'POST' }),
  designSave: (slug) =>
    req('/api/design/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(slug ? { slug } : {}),
    }),

  backendStatus: () => req('/api/backend'),
  createBackend: ({ framework, db } = {}) =>
    req('/api/backend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(framework ? { framework, db } : {}),
    }),
  discardBackend: () => req('/api/backend', { method: 'DELETE' }),
  backendDev: () => req('/api/backend/dev', { method: 'POST' }),
  backendStopDev: () => req('/api/backend/stop-dev', { method: 'POST' }),
  backendProbe: (path) => req(`/api/backend/probe?path=${encodeURIComponent(path)}`),
  backendSave: (slug) =>
    req('/api/backend/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    }),
  backendChat: async (text, { onChunk = () => {}, onActivity = () => {} } = {}) => {
    const res = await fetch('/api/backend/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let last = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = raw.match(/^event: (\w+)/m)?.[1];
        const data = raw.match(/^data: (.*)$/m)?.[1];
        if (!ev || !data) continue;
        const obj = JSON.parse(data);
        if (ev === 'chunk') onChunk(obj.text ?? '');
        else if (ev === 'activity') onActivity(obj.text ?? '');
        else last = obj;
      }
    }
    return last ?? { ok: false, error: 'stream vacío' };
  },

  // Chat SSE por POST — EventSource no sirve (solo GET). Se lee el
  // stream y se parsean bloques "event: X\ndata: {…}\n\n" (el server
  // manda un JSON de una línea por evento, sin multi-data).
  designChat: async (text, { onChunk = () => {}, onActivity = () => {} } = {}) => {
    const res = await fetch('/api/design/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let result = { ok: false, error: 'stream cerrado sin respuesta' };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = block.match(/^event: (.+)$/m)?.[1];
        let data = {};
        try {
          data = JSON.parse(block.match(/^data: (.*)$/m)?.[1] ?? '{}');
        } catch {
          /* data malformado → {} */
        }
        if (ev === 'chunk') onChunk(data.text ?? '');
        else if (ev === 'activity') onActivity(data.text ?? '');
        else if (ev === 'done') result = { ok: true, text: data.text ?? '' };
        else if (ev === 'error') result = { ok: false, error: data.error ?? 'error del agente' };
      }
    }
    return result;
  },
};
