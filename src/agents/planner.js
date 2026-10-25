import { config } from '../config.js';
import { applyArch, archRuleBullet, resolveArch, resolveArchSafe } from '../arch/index.js';
import { resolveStacks, stackIds, stackRuleBullets } from '../stacks/index.js';
import { runDevinPrompt } from '../tools/devin.js';
import { getVertical } from '../verticals/index.js';
import { activity, log, loadPrompt, readPlan, runLogPath, textFeed, writePlan } from './common.js';

/**
 * Genera plan.json. Tres caminos en orden:
 * 1. Si ya existe plan.json (resume) → reutilizar.
 * 2. Si appType es un vertical conocido → template determinístico (0 Devin).
 * 3. appType 'custom' → planner LLM vía Devin ACP.
 */
export async function plannerNode(state) {
  const existing = readPlan(state.projectDir);
  if (existing?.steps?.length) {
    // plan.json pre-existente ⇒ resume. Los pasos que no llegaron a
    // 'done' vuelven a 'pending' (un paso 'building' murió a medio
    // construir) y el índice retoma en el primero pendiente.
    let resumeIndex = existing.steps.length;
    for (let i = 0; i < existing.steps.length; i++) {
      if (existing.steps[i].status !== 'done') {
        existing.steps[i].status = 'pending';
        if (resumeIndex === existing.steps.length) resumeIndex = i;
      }
    }
    // Los datos del run original mandan sobre los defaults del CLI;
    // --idea explícita tiene prioridad sobre la guardada en el plan.
    existing.idea = state.idea || existing.idea || '';
    existing.projectName = state.projectSlug || existing.projectName;
    // Arquitectura: la del plan guardado manda; --arch explícita solo
    // aplica si el plan no declara una (planes pre-arch → se parchean).
    const arch = resolveArchSafe(existing.arch, state.arch);
    applyArch(existing, arch);
    // Stacks: idem — plan.stacks manda; planes pre-stacks reciben los
    // del run actual (flags o defaults), sobre el scope del plan.
    if (!existing.stacks) {
      existing.stacks = stackIds(existing.scope ?? state.scope, {
        frontend: state.stackFrontend ?? undefined,
        backend: state.stackBackend ?? undefined,
      });
    }
    writePlan(state.projectDir, existing);
    const done = existing.steps.filter((s) => s.status === 'done').length;
    return {
      plan: existing,
      idea: existing.idea,
      scope: existing.scope ?? state.scope,
      appType: existing.appType ?? state.appType,
      currentStepIndex: resumeIndex,
      stepRetries: 0,
      verifying: 'step',
      lastError: null,
      arch: arch.id,
      status: 'planned',
      history: [
        log(
          'planner',
          `plan.json reanudado: ${done}/${existing.steps.length} pasos done, ` +
            `retomando ${resumeIndex < existing.steps.length ? `en paso ${existing.steps[resumeIndex].id}` : 'en verificación final'}`,
        ),
      ],
    };
  }

  const vertical = getVertical(state.appType);
  const stackOv = {
    frontend: state.stackFrontend ?? undefined,
    backend: state.stackBackend ?? undefined,
  };
  const stacks = resolveStacks(state.scope, stackOv);
  if (vertical) {
    const plan = vertical.buildPlan({
      projectName: state.projectSlug,
      idea: state.idea,
      scope: state.scope,
      phone: state.whatsappPhone,
      stacks,
    });
    plan.scope = state.scope;
    plan.projectName = state.projectSlug;
    plan.idea = state.idea;
    plan.stacks = { frontend: stacks.frontend?.id ?? null, backend: stacks.backend?.id ?? null };
    applyArch(plan, resolveArch(state.arch));
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
  const arch = resolveArch(state.arch);
  const prompt = loadPrompt('planner', {
    idea: state.idea,
    scope: state.scope,
    slug: state.projectSlug,
    stackRules: stackRuleBullets(state.scope, stackOv),
    archRules: archRuleBullet(arch),
  });

  const feed = textFeed();
  const res = await runDevinPrompt({
    prompt,
    cwd: state.projectDir,
    timeoutMs: config.devinTimeoutMs,
    logPath: runLogPath(state, 'planner'),
    onActivity: activity,
    onText: feed.onText,
  });
  feed.flush();

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
  plan.idea = state.idea;
  plan.stacks = { frontend: stacks.frontend?.id ?? null, backend: stacks.backend?.id ?? null };
  applyArch(plan, arch);
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
    stackRules: stackRuleBullets(state.scope, {
      frontend: state.plan?.stacks?.frontend ?? state.stackFrontend ?? undefined,
      backend: state.plan?.stacks?.backend ?? state.stackBackend ?? undefined,
    }),
  });

  const feed = textFeed();
  const res = await runDevinPrompt({
    prompt,
    cwd: state.projectDir,
    timeoutMs: config.devinTimeoutMs,
    logPath: runLogPath(state, `repair-${state.planRetries + 1}`),
    onActivity: activity,
    onText: feed.onText,
  });
  feed.flush();

  let plan = null;
  try {
    plan = readPlan(state.projectDir);
  } catch {
    /* queda null */
  }

  // Devin reescribió plan.json — si perdió `arch`/`stacks` o las
  // menciones en los pasos backend, se re-aplica lo del run.
  if (plan) {
    applyArch(plan, resolveArch(state.arch));
    plan.stacks ??= state.plan?.stacks;
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
