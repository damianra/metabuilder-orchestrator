import { useEffect, useState } from 'react';
import { Plus, Send } from 'lucide-react';
import { api } from '../api.js';

const EMPTY = {
  idea: '',
  scope: 'backend',
  appType: '',
  arch: 'flat',
  stackFrontend: 'vite-react',
  stackBackend: 'express-sqlite',
  name: '',
  phone: '',
  github: false,
  ghpages: false,
  verifyDocker: false,
  agent: '', // '' = engine configurado del dashboard (settings.json)
  compliance: [], // perfiles explícitos; base (privacidad/404) va siempre
};

// Perfiles base: los aplica el orquestador siempre que hay frontend —
// se muestran marcados y deshabilitados, no viajan en el body.
const BASE_COMPLIANCE = new Set(['privacidad', 'notfound']);
// 'menores' no se ofrece como opción manual — el agente la infiere
// del dominio de la app (igual que en los chats de diseño/backend).
const HIDDEN_COMPLIANCE = new Set(['menores']);

// Form "Nueva app" — los pickers se alimentan de GET /api/options
// (registries del orquestador), nada hardcodeado. `cloneSlug` (viene de
// #/?clone=<slug>) pre-llena scope/vertical/arch/stacks con la config de
// ese proyecto — idea y nombre quedan como los tenga el usuario.
// Desde v10 el form vive en dos tabs: `fixedScope="backend"` (tab
// Backend) y `fixedScope="fullstack"` (tab Fullstack rápido) — sin
// prop queda el picker filtrado. El frontend se construye en Diseñar
// app; el CLI sigue aceptando --scope frontend por retrocompat.
export default function NewAppForm({ onEnqueued, cloneSlug, fixedScope }) {
  const [options, setOptions] = useState(null);
  const fresh = () => ({ ...EMPTY, scope: fixedScope ?? EMPTY.scope });
  const [form, setForm] = useState(fresh);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [clonedFrom, setClonedFrom] = useState(null);

  useEffect(() => {
    api.options().then(setOptions).catch(() => setOptions({ scopes: [], appTypes: [], archs: [] }));
  }, []);

  useEffect(() => {
    if (!cloneSlug) return;
    api
      .project(cloneSlug)
      .then((p) => {
        setForm((f) => ({
          ...f,
          // clonar un proyecto frontend → backend (el front se diseña
          // en la otra pestaña, no desde este form); con fixedScope el
          // tab decide.
          scope: fixedScope ?? (p.scope === 'frontend' ? 'backend' : (p.scope ?? f.scope)),
          appType: p.appType ?? f.appType,
          arch: p.arch ?? f.arch,
          stackFrontend: p.stacks?.frontend ?? f.stackFrontend,
          stackBackend: p.stacks?.backend ?? f.stackBackend,
          agent: p.agent ?? f.agent,
          compliance: (p.compliance ?? []).filter(
            (id) => !BASE_COMPLIANCE.has(id) && !HIDDEN_COMPLIANCE.has(id),
          ),
        }));
        setClonedFrom(cloneSlug);
      })
      .catch(() => {});
  }, [cloneSlug]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const hasBackend = form.scope !== 'frontend';
  const hasFrontend = form.scope !== 'backend';
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
      if (hasFrontend && form.stackFrontend) body.stackFrontend = form.stackFrontend;
      if (hasBackend && form.stackBackend) body.stackBackend = form.stackBackend;
      if (form.name.trim()) body.name = form.name.trim();
      if (form.phone.trim()) body.phone = form.phone.trim();
      if (form.github) body.github = true;
      if (form.ghpages) body.ghpages = true;
      if (form.verifyDocker) body.verifyDocker = true;
      if (form.agent) body.agent = form.agent;
      if (form.compliance.length) body.compliance = form.compliance.join(',');
      const { job } = await api.enqueueRun(body);
      setFeedback({ ok: true, text: `job #${job.id} encolado — corre \`npm run worker\` si no está corriendo` });
      setForm(fresh());
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
        {clonedFrom && (
          <span className="rounded-lg bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-200">
            config de {clonedFrom}
          </span>
        )}
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
          <label className={label} htmlFor="name">Nombre (slug)</label>
          <input id="name" className={input} placeholder="auto" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        {!fixedScope && (
          <div>
            <label className={label} htmlFor="scope">Scope</label>
            <select id="scope" className={input} value={form.scope} onChange={(e) => set('scope', e.target.value)}>
              {(options?.scopes ?? [])
                .filter((s) => s !== 'frontend')
                .map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={label} htmlFor="appType">Vertical</label>
          <select
            id="appType"
            className={input}
            value={form.appType}
            disabled={hasBackend && form.stackBackend !== 'express-sqlite'}
            title={
              form.stackBackend !== 'express-sqlite'
                ? 'Los verticales solo aplican a stack express-sqlite — con otra base el vertical es custom'
                : undefined
            }
            onChange={(e) => set('appType', e.target.value)}
          >
            <option value="">auto (inferir)</option>
            <option value="custom">custom</option>
            {(options?.appTypes ?? [])
              .filter((t) => t !== 'custom')
              .map((t) => <option key={t} value={t}>{t}</option>)}
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
          <label className={label} htmlFor="stackFrontend">Stack front</label>
          <select
            id="stackFrontend"
            className={input}
            value={form.stackFrontend}
            disabled={!hasFrontend}
            onChange={(e) => set('stackFrontend', e.target.value)}
          >
            {(options?.stacks?.frontend ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={label} htmlFor="stackBackend">Stack back</label>
          <select
            id="stackBackend"
            className={input}
            value={form.stackBackend}
            disabled={!hasBackend}
            onChange={(e) => {
              set('stackBackend', e.target.value);
              // Los verticales son overlays sqlite — con otro stack el
              // vertical queda en custom (gate también server-side).
              if (e.target.value !== 'express-sqlite') set('appType', 'custom');
            }}
          >
            {formBackendStacks(options?.stacks?.backend ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="phone">WhatsApp</label>
          <input id="phone" className={input} placeholder="54911…" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="agent">Motor</label>
          <select id="agent" className={input} value={form.agent} onChange={(e) => set('agent', e.target.value)}>
            <option value="">configurado{options?.engine ? ` (${options.engine})` : ''}</option>
            {(options?.engines ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {(options?.compliance ?? []).length > 0 && (
        <div className="mt-3">
          <span className={label}>Cumplimiento</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {(options.compliance ?? [])
              .filter((id) => !HIDDEN_COMPLIANCE.has(id))
              .map((id) => {
              const base = BASE_COMPLIANCE.has(id);
              const checked = base || form.compliance.includes(id);
              return (
                <label
                  key={id}
                  className={`flex items-center gap-2 text-sm ${base ? 'text-slate-400' : 'text-slate-700'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={base}
                    onChange={(e) =>
                      set(
                        'compliance',
                        e.target.checked
                          ? [...form.compliance, id]
                          : form.compliance.filter((c) => c !== id),
                      )
                    }
                  />
                  {id}
                </label>
              );
            })}
            <span className="text-xs text-slate-400 self-center">
              {hasFrontend
                ? 'privacidad + 404 van siempre; la idea puede inferir más'
                : 'la idea puede inferir perfiles extra'}
            </span>
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.github} onChange={(e) => set('github', e.target.checked)} />
          repo en GitHub
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.ghpages} disabled={!form.github || !hasFrontend} onChange={(e) => set('ghpages', e.target.checked)} />
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
