import type { GenerationResult } from '../contract.js';
import { bounded } from './budget.js';
import { Context } from './context.js';
import { placeSites } from './sites.js';
import { Router } from './router.js';
import { assemble } from './network.js';
import { validate } from './validation.js';
import type { PlanningInput, RegionalPlanningOutput } from './types.js';
export function generatePlanning(input: PlanningInput): GenerationResult<RegionalPlanningOutput> {
  return bounded(() => {
    const c = new Context(input),
      { sites, sizes } = placeSites(c),
      router = new Router(c, sites);
    router.attachSites();
    router.attachBoundary();
    router.attachBridges();
    const plan = assemble(c, router, sites, sizes);
    validate(c, plan);
    plan.evidence = {
      candidateWork: c.candidates.used,
      validationWork: c.validation.used,
      heapWork: c.heap.used,
      expansions: c.expansions,
      placementAttempts: c.placementAttempts,
      planningCells: c.cells,
    };
    return plan;
  });
}
export * from './types.js';
export { certifyFootprint, certifyRoadSegment, directionalGrade } from './certificates.js';
export { certifyBridge } from './bridges.js';
export { validatePlanning, validateRoadPath } from './validation.js';
export { reconcileLocalJoins } from './reconcile.js';
export { createPlanningCertificates, type PlanningCertificates } from './session.js';
