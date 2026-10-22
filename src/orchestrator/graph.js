import { StateGraph, START, END } from '@langchain/langgraph';
import { OrchestratorState } from './state.js';
import { preflightNode } from '../agents/preflight.js';
import { plannerNode } from '../agents/planner.js';
import { validatorNode } from '../agents/validator.js';
import { repairPlanNode } from '../agents/planner.js';
import { builderNode } from '../agents/builder.js';
import { verifierNode } from '../agents/verifier.js';
import { fixerNode } from '../agents/fixer.js';
import { finalizerNode } from '../agents/finalizer.js';
import { config } from '../config.js';

const log = (node, msg) => ({ ts: new Date().toISOString(), node, msg });

// ---------- Routers ----------

function afterPreflight(state) {
  return state.status === 'failed' ? END : 'plan';
}

function afterValidate(state) {
  if (state.validationErrors.length === 0) return 'build';
  if (state.planRetries < config.maxPlanRetries) return 'repairPlan';
  return END;
}

function afterBuild(state) {
  return state.status === 'failed' ? END : 'verify';
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
  return END;
}

function afterFix(state) {
  return state.status === 'failed' ? END : 'verify';
}

// ---------- Grafo ----------

export function buildGraph() {
  const graph = new StateGraph(OrchestratorState)
    .addNode('preflight', preflightNode)
    .addNode('plan', plannerNode)
    .addNode('validate', validatorNode)
    .addNode('repairPlan', repairPlanNode)
    .addNode('build', builderNode)
    .addNode('verify', verifierNode)
    .addNode('fix', fixerNode)
    .addNode('finalVerify', async (state) => ({
      verifying: 'final',
      history: [log('finalVerify', 'verificación final (stub)')],
    }))
    .addNode('finalize', finalizerNode)

    .addEdge(START, 'preflight')
    .addConditionalEdges('preflight', afterPreflight)
    .addEdge('plan', 'validate')
    .addEdge('repairPlan', 'validate')
    .addConditionalEdges('validate', afterValidate)
    .addConditionalEdges('build', afterBuild)
    .addConditionalEdges('verify', afterVerify)
    .addConditionalEdges('fix', afterFix)
    .addConditionalEdges('finalVerify', afterVerify)
    .addEdge('finalize', END);

  return graph.compile();
}
