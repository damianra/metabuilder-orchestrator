// Notificación del browser cuando un job transiciona a estado terminal
// (roadmap v3 #8): encolás una generación, te vas a otra pestaña y el
// Notification te avisa al terminar en vez de volver a chequear a ciegas.
//
// Estado terminal detectado por diff entre polls de GET /api/jobs — la
// primera carga NO notifica (no hay transición). Solo se dispara si el
// usuario habilitó el permiso (botón campana en el header) y la pestaña
// está en background: si la estás mirando, ya ves el chip cambiar.

import { jobSummary } from './util.js';

const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export const snapshotStatuses = (jobs) => new Map(jobs.map((j) => [j.id, j.status]));

// Jobs que transicionaron a terminal desde el snapshot previo.
// `prev` null (primer poll) → [] para no spamear con la historia.
export const diffFinished = (prev, jobs) =>
  !prev
    ? []
    : jobs.filter((j) => prev.has(j.id) && !TERMINAL.has(prev.get(j.id)) && TERMINAL.has(j.status));

const LABELS = { done: 'terminó', failed: 'falló', cancelled: 'fue cancelado' };

export function notifyFinished(j) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted' || !document.hidden) return;
  const n = new Notification(`Job #${j.id} ${LABELS[j.status] ?? j.status}`, {
    body: jobSummary(j.args),
    tag: `job-${j.id}`,
  });
  n.onclick = () => window.focus();
}
