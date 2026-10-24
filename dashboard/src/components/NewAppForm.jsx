import { useEffect, useState } from 'react';
import { Plus, Send } from 'lucide-react';
import { api } from '../api.js';

const EMPTY = {
  idea: '',
  scope: 'fullstack',
  appType: '',
  arch: 'flat',
  name: '',
  phone: '',
  github: false,
  ghpages: false,
  verifyDocker: false,
};

// Form "Nueva app" — los pickers se alimentan de GET /api/options
// (registries del orquestador), nada hardcodeado.
export default function NewAppForm({ onEnqueued }) {
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    api.options().then(setOptions).catch(() => setOptions({ scopes: [], appTypes: [], archs: [] }));
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const hasBackend = form.scope !== 'frontend';
  const canSubmit = form.idea.trim().length > 0 && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setFeedback(null);
    try {
      const body = { idea: form.idea.trim(), scope: form.scope };
      if (form.appType) body.appType = form.appType;
      if (hasBackend && form.arch) body.arch = form.arch;
      if (form.name.trim()) body.name = form.name.trim();
      if (form.phone.trim()) body.phone = form.phone.trim();
      if (form.github) body.github = true;
      if (form.ghpages) body.ghpages = true;
      if (form.verifyDocker) body.verifyDocker = true;
      const { job } = await api.enqueueRun(body);
      setFeedback({ ok: true, text: `job #${job.id} encolado — corre \`npm run worker\` si no está corriendo` });
      setForm(EMPTY);
      onEnqueued?.();
    } catch (err) {
      setFeedback({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-sky-500 outline-none';
  const label = 'block text-xs font-semibold text-slate-600 mb-1';

  return (
    <form onSubmit={submit} className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 shadow-sm">
      <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900">
        <Plus size={18} className="text-sky-600" /> Nueva app
      </h2>

      <div className="mt-4">
        <label className={label} htmlFor="idea">Idea</label>
        <textarea
          id="idea"
          rows={2}
          className={input}
          placeholder="Ej: landing para una veterinaria con formulario de contacto"
          value={form.idea}
          onChange={(e) => set('idea', e.target.value)}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={label} htmlFor="scope">Scope</label>
          <select id="scope" className={input} value={form.scope} onChange={(e) => set('scope', e.target.value)}>
            {(options?.scopes ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="appType">Vertical</label>
          <select id="appType" className={input} value={form.appType} onChange={(e) => set('appType', e.target.value)}>
            <option value="">auto (inferir)</option>
            {(options?.appTypes ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="arch">Arquitectura</label>
          <select
            id="arch"
            className={input}
            value={form.arch}
            disabled={!hasBackend}
            onChange={(e) => set('arch', e.target.value)}
          >
            {(options?.archs ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="name">Nombre (slug)</label>
          <input id="name" className={input} placeholder="auto" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={label} htmlFor="phone">WhatsApp</label>
          <input id="phone" className={input} placeholder="54911…" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.github} onChange={(e) => set('github', e.target.checked)} />
          repo en GitHub
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.ghpages} disabled={!form.github} onChange={(e) => set('ghpages', e.target.checked)} />
          + Pages
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.verifyDocker} onChange={(e) => set('verifyDocker', e.target.checked)} />
          verificar Dockerfile
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send size={15} /> Encolar generación
        </button>
        {feedback && (
          <p className={`text-sm ${feedback.ok ? 'text-emerald-700' : 'text-red-700'}`}>{feedback.text}</p>
        )}
      </div>
    </form>
  );
}
