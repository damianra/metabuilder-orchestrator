import { StateGraph, START, END } from '@langchain/langgraph';
import { OrchestratorState } from './state.js';
import { preflightNode } from '../agents/preflight.js';
import { plannerNode } from '../agents/planner.js';
import { validatorNode } from '../agents/validator.js';
import { repairPlanNode } from '../agents/planner.js';
import { builderNode } from '../agents/builder.js';
import { verifierNode } from '../agents/verifier.js';
import { fixerNode } from '../agents/fixer.js';
import { finalVerifyNode, finalizerNode } from '../agents/finalizer.js';
import { config } from '../config.js';

// ---------- Routers ----------

function afterPreflight(state) {
  return state.status === 'failed' ? 'fail' : 'planner';
}

function afterValidate(state) {
  if (state.validationErrors.length === 0) return 'build';
  if (state.planRetries < config.maxPlanRetries) return 'repairPlan';
  return 'fail';
}

function afterBuild(state) {
  return state.status === 'failed' ? 'fail' : 'verify';
}

function hasMoreSteps(state) {
  return state.currentStepIndex < (state.plan?.steps?.length ?? 0);
}

function afterVerify(state) {
  if (!state.lastError) {
    // paso OK
    if (state.verifying === 'final') return 'finalize';
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
    .addNode('finalVerify', finalVerifyNode)
    .addNode('finalize', finalizerNode)
    .addNode('fail', async (state) => ({
      status: 'failed',
      history: [{ ts: new Date().toISOString(), node: 'fail', msg: state.lastError ?? 'fallo sin error registrado' }],
    }))

    .addEdge(START, 'preflight')
    .addConditionalEdges('preflight', afterPreflight)
    .addEdge('planner', 'validate')
    .addEdge('repairPlan', 'validate')
    .addConditionalEdges('validate', afterValidate)
    .addConditionalEdges('build', afterBuild)
    .addConditionalEdges('verify', afterVerify)
    .addConditionalEdges('fix', afterFix)
    .addConditionalEdges('finalVerify', afterVerify)
    .addEdge('finalize', END)
    .addEdge('fail', END);

  return graph.compile();
}
