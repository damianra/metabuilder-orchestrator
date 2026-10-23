import { config } from '../config.js';
import { runDevinPrompt } from '../tools/devin.js';
import { getVertical } from '../verticals/index.js';
import { activity, log, loadPrompt, readPlan, runLogPath, writePlan } from './common.js';

/**
 * Genera plan.json. Tres caminos en orden:
 * 1. Si ya existe plan.json (resume) → reutilizar.
 * 2. Si appType es un vertical conocido → template determinístico (0 Devin).
 * 3. appType 'custom' → planner LLM vía Devin ACP.
 */
export async function plannerNode(state) {
  const existing = readPlan(state.projectDir);
  if (existing?.steps?.length) {
    existing.scope = state.scope;
    existing.projectName = state.projectSlug;
    return {
      plan: existing,
      appType: existing.appType ?? state.appType,
      status: 'planned',
      history: [log('planner', `plan.json existente reutilizado (${existing.steps.length} pasos)`)],
    };
  }

  const vertical = getVertical(state.appType);
  if (vertical) {
    const plan = vertical.buildPlan({
      projectName: state.projectSlug,
      idea: state.idea,
      scope: state.scope,
      phone: state.whatsappPhone,
    });
    plan.scope = state.scope;
    plan.projectName = state.projectSlug;
    writePlan(state.projectDir, plan);
    return {
      plan,
      appType: vertical.name,
      status: 'planned',
      history: [
        log('planner', `plan template "${vertical.name}": ${plan.steps.length} pasos (sin Devin)`),
      ],
    };
  }

  // ---- appType custom → planner LLM ----
  const prompt = loadPrompt('planner', {
    idea: state.idea,
    scope: state.scope,
    slug: state.projectSlug,
  });

  const res = await runDevinPrompt({
    prompt,
    cwd: state.projectDir,
    timeoutMs: config.devinTimeoutMs,
    logPath: runLogPath(state, 'planner'),
    onActivity: activity,
  });

  if (!res.ok) {
    return {
      status: 'failed',
      lastError: `planner falló: ${res.error}`,
      history: [log('planner', `error Devin: ${res.error}`)],
    };
  }

  let plan;
  try {
    plan = readPlan(state.projectDir);
  } catch (e) {
    plan = null;
  }
  if (!plan) {
    // Devin respondió OK pero no dejó plan.json → el validador
    // genera el error y repairPlan lo reintenta.
    return {
      plan: null,
      history: [log('planner', 'plan.json ausente o JSON inválido → validate → repair')],
    };
  }

  // El scope y el nombre los manda el usuario, no el planner.
  plan.scope = state.scope;
  plan.projectName = state.projectSlug;
  writePlan(state.projectDir, plan);

  return {
    plan,
    status: 'planned',
    history: [log('planner', `plan generado: ${plan.steps?.length ?? 0} pasos, appType=${plan.appType}`)],
    appType: plan.appType ?? 'custom',
  };
}

/**
 * Repara plan.json según los errores del validador, vía Devin.
 */
export async function repairPlanNode(state) {
  const errors = state.validationErrors.map((e) => `- ${e}`).join('\n');
  const prompt = loadPrompt('plan-repair', {
    errors,
    scope: state.scope,
    slug: state.projectSlug,
  });

  const res = await runDevinPrompt({
    prompt,
    cwd: state.projectDir,
    timeoutMs: config.devinTimeoutMs,
    logPath: runLogPath(state, `repair-${state.planRetries + 1}`),
  });

  let plan = null;
  try {
    plan = readPlan(state.projectDir);
  } catch {
    /* queda null */
  }

  return {
    plan: plan ?? state.plan,
    planRetries: state.planRetries + 1,
    lastError: res.ok ? null : `repairPlan falló: ${res.error}`,
    history: [
      log(
        'repairPlan',
        res.ok
          ? `plan reescrito (intento ${state.planRetries + 1}/${config.maxPlanRetries})`
          : `Devin falló al reparar: ${res.error}`,
      ),
    ],
  };
}
