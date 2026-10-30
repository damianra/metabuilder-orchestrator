import { config } from '../config.js';
import { applyArch, archRuleBullet, resolveArch, resolveArchSafe } from '../arch/index.js';
import {
  applyCompliance,
  complianceFor,
  complianceRuleBullets,
} from '../compliance/index.js';
import { getStack, resolveStacks, stackIds, stackRuleBullets } from '../stacks/index.js';
import { runAgentPrompt } from '../tools/acp.js';
import { normalizeExtendedPlan } from '../tools/extend-plan.js';
import { frontApiScan } from '../tools/front-api-scan.js';
import { getVertical } from '../verticals/index.js';
import { activity, log, loadPrompt, readPlan, runLogPath, textFeed, writePlan } from './common.js';

/**
 * Genera plan.json. Tres caminos en orden:
 * 1. Si ya existe plan.json (resume) → reutilizar.
 * 2. Si appType es un vertical conocido → template determinístico (0 Devin).
 * 3. appType 'custom' → planner LLM vía Devin ACP.
 */
export async function plannerNode(state) {
  let existing = readPlan(state.projectDir);
  if (existing?.steps?.length) {
    // Entradas de log previas al resume común (hoy: extend) — se
    // anteponen a la entrada "reanudado" del return.
    const history = [];
    // ---- --extend: el agente appendea pasos backend al plan de un
    // frontend existente, y cae al resume común (validate→build).
    if (state.extend) {
      const extArch = resolveArchSafe(existing.arch, state.arch);
      // Contrato front→API (extend acelerado): los endpoints que el
      // front YA llama — el agente no infiere, implementa la spec.
      const contract = frontApiScan(state.projectDir)
        .map((e) => `${e.method} ${e.path} (${e.file})`)
        .join('\n');
      // Fast-path: contrato front→API claro → plan fijo sin sesión del
      // planner (el scanner ya dice qué endpoints implementar). Los
      // pasos se appendean a `existing` y caen al bloque común de
      // resume (currentStepIndex, arch, compliance, sellado) — mismo
      // tratamiento que los pasos escritos por el agente.
      if (contract) {
        const backendId = state.stackBackend ?? 'express-sqlite';
        const backendLabel = getStack(backendId)?.label ?? backendId;
        const nextId = Math.max(0, ...(existing.steps ?? []).map((s) => s.id ?? 0)) + 1;
        const eps = contract.split('\n');
        existing.steps = [
          ...(existing.steps ?? []),
          { id: nextId, type: 'backend',
            description: `Backend ${backendLabel}: implementar en server/ (skeleton ya copiado) los endpoints que el front ya llama — ${eps.join(' · ')}. Schema/seed del dominio; el sample items se reemplaza por el recurso real.`,
            verify: 'npm run build', status: 'pending', attempts: 0 },
          { id: nextId + 1, type: 'frontend',
            description: 'Integración UI↔API: la UI ya llama estos endpoints — verificar/ajustar lib/api.js y componentes al contrato real (loadings, errores, privacidad+consent en forms).',
            verify: 'npm run build', status: 'pending', attempts: 0 },
          { id: nextId + 2, type: 'test',
            description: 'Tests Vitest de las rutas nuevas y de la integración.',
            verify: 'npx vitest run', status: 'pending', attempts: 0 },
        ];
        normalizeExtendedPlan(existing, {
          dir: state.projectDir,
          stackBackend: backendId,
        });
        history.push(
          log('planner', `extend: plan fijo por contrato (${eps.length} endpoints) — sesión del planner saltada`),
        );
      } else {
      const prompt = loadPrompt('extend-backend', {
        idea: state.idea || existing.idea || '',
        frontContract:
          contract ||
          '(el front no llama /api/* todavía — diseñar la API desde la idea)',
        stackRules: [
          stackRuleBullets('fullstack', {
            frontend: existing.stacks?.frontend ?? state.stackFrontend ?? undefined,
            backend: state.stackBackend ?? undefined,
          }),
          ...complianceRuleBullets(
            complianceFor({
              idea: state.idea || existing.idea,
              scope: 'fullstack',
              flag: state.compliance,
              plan: existing,
            }),
          ).map((b) => `- ${b}`),
        ].join('\n'),
        archRules: archRuleBullet(extArch),
      });
      const feed = textFeed();
      const res = await runAgentPrompt({
        agent: state.agent,
        prompt,
        cwd: state.projectDir,
        timeoutMs: config.devinTimeoutMs,
        logPath: runLogPath(state, 'extend'),
        onActivity: activity,
        onText: feed.onText,
      });
      feed.flush();
      if (!res.ok) {
        return {
          status: 'failed',
          lastError: `extend falló: ${res.error}`,
          history: [log('planner', `extend: ${res.engine ?? 'engine'} falló — ${res.error}`)],
        };
      }
      // Merge defensivo: del archivo que escribió el agente solo se
      // toma la COLA de steps (los done originales quedan verbatim,
      // aunque el agente haya reordenado o reescrito el plan).
      const extended = readPlan(state.projectDir);
      const before = existing.steps.length;
      if (extended?.steps?.length > before) {
        // Los appendeados entran siempre pending — si el agente les
        // puso status:'done' se saltean silenciosamente en el build.
        existing.steps = [
          ...existing.steps,
          ...extended.steps.slice(before).map((s) => ({ ...s, status: 'pending' })),
        ];
      }
      normalizeExtendedPlan(existing, {
        dir: state.projectDir,
        stackBackend: state.stackBackend ?? 'express-sqlite',
      });
      history.push(
        log(
          'planner',
          `extend: ${existing.steps.length - before} pasos nuevos (scope → fullstack)`,
        ),
      );
      }
    }
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
    // Compliance: plan.compliance manda; planes pre-compliance se
    // parchean con la inferencia actual (idea+scope) + --compliance.
    applyCompliance(
      existing,
      complianceFor({
        idea: existing.idea,
        scope: existing.scope ?? state.scope,
        flag: state.compliance,
        plan: existing,
      }),
    );
    // Engine: se sella el efectivo de este run (state.agent ya viene
    // resuelto por preflight — flag/--agent incluido, si lo hubo).
    existing.agent = state.agent || existing.agent;
    // Deploy: lo efectivo de ESTE run manda — sin flags explícitos,
    // index.js ya restauró plan.deploy a state (mismo valor); con
    // --github/--no-push explícitos, el override queda persistido.
    existing.deploy = { github: state.deployGithub, pages: state.deployPages };
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
        ...history,
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
    plan.agent = state.agent || null;
    plan.deploy = { github: state.deployGithub, pages: state.deployPages };
    applyArch(plan, resolveArch(state.arch));
    applyCompliance(
      plan,
      complianceFor({
        idea: plan.idea,
        scope: plan.scope,
        flag: state.compliance,
      }),
    );
    writePlan(state.projectDir, plan);
    return {
      plan,
      appType: vertical.name,
      status: 'planned',
      history: [
        log('planner', `plan template "${vertical.name}": ${plan.steps.length} pasos (sin agente)`),
      ],
    };
  }

  // ---- appType custom → planner LLM ----
  const arch = resolveArch(state.arch);
  const prompt = loadPrompt('planner', {
    idea: state.idea,
    scope: state.scope,
    slug: state.projectSlug,
    stackRules: [
      stackRuleBullets(state.scope, stackOv),
      ...complianceRuleBullets(
        complianceFor({ idea: state.idea, scope: state.scope, flag: state.compliance }),
      ).map((b) => `- ${b}`),
    ].join('\n'),
    archRules: archRuleBullet(arch),
  });

  const feed = textFeed();
  const res = await runAgentPrompt({
    agent: state.agent,
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
      history: [log('planner', `error ${res.engine ?? 'engine'}: ${res.error}`)],
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
  plan.agent = state.agent || null;
  plan.deploy = { github: state.deployGithub, pages: state.deployPages };
  applyArch(plan, arch);
  applyCompliance(
    plan,
    complianceFor({ idea: plan.idea, scope: plan.scope, flag: state.compliance }),
  );
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
  // Hint del/los pasos que fallaron — el agente corrige esos sin
  // releer el plan entero (los errores ya los nombran).
  const steps = Array.isArray(state.plan?.steps) ? state.plan.steps : [];
  const failedSteps = steps
    .map((s, i) =>
      state.validationErrors.some(
        (e) =>
          e.includes(`step[${i}]`) ||
          e.includes(`paso ${s.id}`) ||
          e.includes(`step ${s.id}`) ||
          e.includes(`id ${s.id}`),
      )
        ? s.id
        : null,
    )
    .filter((id) => id != null)
    .join(', ');
  const prompt = loadPrompt('plan-repair', {
    errors: errors + (failedSteps ? `\n\nPasos con error (corregí SOLO esos): ${failedSteps}` : ''),
    scope: state.scope,
    slug: state.projectSlug,
    stackRules: [
      stackRuleBullets(state.scope, {
        frontend: state.plan?.stacks?.frontend ?? state.stackFrontend ?? undefined,
        backend: state.plan?.stacks?.backend ?? state.stackBackend ?? undefined,
      }),
      ...complianceRuleBullets(
        complianceFor({
          idea: state.idea,
          scope: state.scope,
          flag: state.compliance,
          plan: state.plan,
        }),
      ).map((b) => `- ${b}`),
    ].join('\n'),
  });

  const feed = textFeed();
  const res = await runAgentPrompt({
    agent: state.agent,
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

  // Devin reescribió plan.json — si perdió `arch`/`stacks`/`agent` o
  // las menciones en los pasos backend, se re-aplica lo del run.
  if (plan) {
    applyArch(plan, resolveArch(state.arch));
    applyCompliance(
      plan,
      complianceFor({
        idea: plan.idea ?? state.idea,
        scope: plan.scope ?? state.scope,
        flag: state.compliance,
        plan,
      }),
    );
    plan.stacks ??= state.plan?.stacks;
    plan.agent ??= state.plan?.agent ?? state.agent;
    plan.deploy ??= state.plan?.deploy;
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
          : `${res.engine ?? 'engine'} falló al reparar: ${res.error}`,
      ),
    ],
  };
}
