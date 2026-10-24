import { Annotation } from '@langchain/langgraph';

// OJO: `??` conservaba el valor viejo con null — un nodo que devolvía
// lastError:null nunca limpiaba el error (loop infinito fix→verify).
// Solo `undefined` (clave ausente del output) conserva; null/'' limpian.
const replace = (a, b) => (b === undefined ? a : b);
const append = (a, b) => [...(a ?? []), ...(b ?? [])];

export const OrchestratorState = Annotation.Root({
  // Entrada del usuario
  idea: Annotation({ reducer: replace, default: () => '' }),
  scope: Annotation({ reducer: replace, default: () => 'fullstack' }),
  appType: Annotation({ reducer: replace, default: () => 'custom' }),
  // Patrón de arquitectura de backend (src/arch/) — aplica a los pasos backend
  arch: Annotation({ reducer: replace, default: () => 'flat' }),

  // Proyecto generado
  projectSlug: Annotation({ reducer: replace, default: () => '' }),
  projectDir: Annotation({ reducer: replace, default: () => '' }),
  runDir: Annotation({ reducer: replace, default: () => '' }),
  // --resume <dir>: reanudar un run desde su plan.json
  resumeDir: Annotation({ reducer: replace, default: () => '' }),

  // plan.json
  plan: Annotation({ reducer: replace, default: () => null }),
  validationErrors: Annotation({ reducer: replace, default: () => [] }),
  planRetries: Annotation({ reducer: replace, default: () => 0 }),

  // Loop de ejecución
  currentStepIndex: Annotation({ reducer: replace, default: () => 0 }),
  stepRetries: Annotation({ reducer: replace, default: () => 0 }),
  finalRetries: Annotation({ reducer: replace, default: () => 0 }),
  lastError: Annotation({ reducer: replace, default: () => null }),
  lastOutput: Annotation({ reducer: replace, default: () => '' }),

  // finalize puede reintentar sobre el resultado de finalVerify
  verifying: Annotation({ reducer: replace, default: () => 'step' }), // 'step' | 'final'

  // Flags CLI
  noPush: Annotation({ reducer: replace, default: () => false }),
  keepGoing: Annotation({ reducer: replace, default: () => false }),
  confirmPlan: Annotation({ reducer: replace, default: () => false }),
  deployGithub: Annotation({ reducer: replace, default: () => false }),
  deployPages: Annotation({ reducer: replace, default: () => false }),
  whatsappPhone: Annotation({ reducer: replace, default: () => '' }),
  // --verify-docker: en finalVerify corre `docker build` si hay daemon
  verifyDocker: Annotation({ reducer: replace, default: () => false }),
  // --stack-frontend/--stack-backend: overrides del registry de stacks
  // (src/stacks/). plan.stacks los persiste y manda en resume.
  stackFrontend: Annotation({ reducer: replace, default: () => null }),
  stackBackend: Annotation({ reducer: replace, default: () => null }),

  status: Annotation({ reducer: replace, default: () => 'pending' }),
  history: Annotation({ reducer: append, default: () => [] }),
});
