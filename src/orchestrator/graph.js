import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { OrchestratorState } from './state.js';
import { preflightNode } from '../agents/preflight.js';
import { plannerNode } from '../agents/planner.js';
import { validatorNode } from '../agents/validator.js';
import { repairPlanNode } from '../agents/planner.js';
import { builderNode } from '../agents/builder.js';
import { verifierNode } from '../agents/verifier.js';
import { fixerNode } from '../agents/fixer.js';
import { confirmNode } from '../agents/confirm.js';
import { reviewerNode } from '../agents/reviewer.js';
import { finalVerifyNode, finalizerNode } from '../agents/finalizer.js';
import { smokeNode } from '../agents/smoke.js';
import { config } from '../config.js';

// ---------- Routers ----------

function afterPreflight(state) {
  return state.status === 'failed' ? 'fail' : 'planner';
}

function afterPlanner(state) {
  // Fallo de transporte/timeout de Devin → cortar; plan.json
  // ausente/inválido con respuesta OK → validate decide (repairPlan).
  return state.status === 'failed' ? 'fail' : 'validate';
}

function afterValidate(state) {
  if (state.validationErrors.length === 0) return 'confirm';
  if (state.planRetries < config.maxPlanRetries) return 'repairPlan';
  return 'fail';
}

function afterConfirm(state) {
  if (state.status === 'failed') return 'fail';
  // Resume con todos los pasos 'done' (o plan vacío) → directo a
  // la verificación final, sin pasar por un paso inexistente.
  return hasMoreSteps(state) ? 'build' : 'finalVerify';
}

function afterBuild(state) {
  return state.status === 'failed' ? 'fail' : 'verify';
}

function hasMoreSteps(state) {
  return state.currentStepIndex < (state.plan?.steps?.length ?? 0);
}

function afterVerify(state) {
  if (!state.lastError) {
    // paso OK; verificación final OK → gate determinístico (smoke)
    // ANTES del review: no gastar tokens del QA en apps que no bootean.
    if (state.verifying === 'final') return 'smoke';
    return hasMoreSteps(state) ? 'build' : 'finalVerify';
  }
  // falló la verificación
  const retries = state.verifying === 'final' ? state.finalRetries : state.stepRetries;
  if (retries < config.maxStepRetries) return 'fix';
  if (state.keepGoing && hasMoreSteps(state)) return 'build';
  return 'fail';
}

function afterFix(state) {
  if (state.status === 'failed') return 'fail';
  return state.verifying === 'final' ? 'finalVerify' : 'verify';
}

function afterReview(state) {
  if (state.status === 'failed') return 'fail';
  // Review OK (sobre una app que ya booteó) → finalize.
  if (!state.lastError) return 'finalize';
  // Issues de QA → el fixer los corrige y se re-verifica (finalVerify).
  return state.finalRetries < config.maxStepRetries ? 'fix' : 'fail';
}

function afterSmoke(state) {
  // Smoke falló (strict, DB embebida o wiring roto) → terminal, sin
  // gastar el review. Si bootea → sub-agente QA antes de finalize.
  return state.status === 'failed' ? 'fail' : 'review';
}

// ---------- Grafo ----------

export function buildGraph() {
  const graph = new StateGraph(OrchestratorState)
    .addNode('preflight', preflightNode)
    .addNode('planner', plannerNode)
    .addNode('validate', validatorNode)
    .addNode('repairPlan', repairPlanNode)
    .addNode('build', builderNode)
    .addNode('verify', verifierNode)
    .addNode('fix', fixerNode)
    .addNode('confirm', confirmNode)
    .addNode('finalVerify', finalVerifyNode)
    .addNode('review', reviewerNode)
    .addNode('smoke', smokeNode)
    .addNode('finalize', finalizerNode)
    .addNode('fail', async (state) => ({
      status: 'failed',
      history: [{ ts: new Date().toISOString(), node: 'fail', msg: state.lastError ?? 'fallo sin error registrado' }],
    }))

    .addEdge(START, 'preflight')
    .addConditionalEdges('preflight', afterPreflight)
    .addConditionalEdges('planner', afterPlanner)
    .addEdge('repairPlan', 'validate')
    .addConditionalEdges('validate', afterValidate)
    .addConditionalEdges('confirm', afterConfirm)
    .addConditionalEdges('build', afterBuild)
    .addConditionalEdges('verify', afterVerify)
    .addConditionalEdges('fix', afterFix)
    .addConditionalEdges('finalVerify', afterVerify)
    .addConditionalEdges('review', afterReview)
    .addConditionalEdges('smoke', afterSmoke)
    .addEdge('finalize', END)
    .addEdge('fail', END);

  // Checkpointer requerido para interrupt() del nodo confirm.
  return graph.compile({ checkpointer: new MemorySaver() });
}
