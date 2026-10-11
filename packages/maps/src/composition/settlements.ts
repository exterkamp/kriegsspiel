import {
  createConstrainedSettlementModel,
  DEFAULT_CONSTRAINT_LIMITS,
  type ConstraintBudget,
  type ConstraintCertificate,
  type SettlementModel,
  type SettlementConstraints,
} from '@kriegsspiel/settlemaker';
import type { MapSettings, Polygon, Site, Water } from '../contract.js';
import type { PlanningCertificates, RegionalPlanningOutput } from '../planning/index.js';
import { deriveSeed } from '../overrides.js';
import { settlementFrame } from './frame.js';
import { CompositionFailure, Meter, requireValue } from './budget.js';
import { COMPOSITION_VERSION } from './types.js';
import { clipLocalWater } from './windows.js';

export interface LocalLayout {
  site: Site;
  model: SettlementModel;
  work: number;
}
export interface CallbackState {
  active?: ConstraintBudget;
  charged: number;
}
export function createLocalLayouts(
  plan: RegionalPlanningOutput,
  water: Water[],
  settings: MapSettings,
  seed: number,
  cert: PlanningCertificates,
  meter: Meter,
  state: CallbackState,
): LocalLayout[] {
  const layouts: LocalLayout[] = [];
  let attempts = 0;
  for (const site of plan.sites) {
    const permissibleVertices =
      site.placementArea.outer.length + site.placementArea.holes.reduce((n, r) => n + r.length, 0);
    meter.take(permissibleVertices * 3 + site.entrances.length * 12);
    const f = settlementFrame(site),
      local = f.localPolygon(site.placementArea);
    const xs = local.outer.map((p) => p.x),
      ys = local.outer.map((p) => p.y),
      padding = settings.roads.maxReservedWidthM + settings.roads.minimumAbutmentM + 5;
    const box = {
      min_x: Math.min(...xs) - padding,
      min_y: Math.min(...ys) - padding,
      max_x: Math.max(...xs) + padding,
      max_y: Math.max(...ys) + padding,
    };
    const window: Polygon = {
      outer: [
        [box.min_x, box.min_y],
        [box.max_x, box.min_y],
        [box.max_x, box.max_y],
        [box.min_x, box.max_y],
        [box.min_x, box.min_y],
      ],
      holes: [],
    };
    const localWater = clipLocalWater(
      water,
      f,
      window,
      permissibleVertices + site.entrances.length,
      meter,
      site.id,
    );
    const constraints: SettlementConstraints = {
      version: 1,
      terrainIdentity: `${COMPOSITION_VERSION}:${seed}`,
      mode: site.kind,
      bounds: {
        min_x: Math.min(...xs),
        min_y: Math.min(...ys),
        max_x: Math.max(...xs),
        max_y: Math.max(...ys),
      },
      permissible: local,
      exclusions: [],
      water: localWater,
      crossings: [],
      entrances: site.entrances.map((e) => {
        const road = plan.roads.find((r) => r.id === e.roadId)!;
        return {
          id: e.id,
          routeIds: [e.routeId],
          endpoint: f.local(e.endpoint),
          bearingDeg: f.localBearing(e.bearingDeg),
          widthM: e.widthM,
          surfaceWidthM: road.surfaceWidthM,
          setbackM: road.setbackM,
        };
      }),
      maxFoundationGradient: settings.settlements.maxBuildingGradient,
      maxRoadGrade: settings.roads.maxGrade,
      localWidthM: 4,
      localSurfaceWidthM: 2.4,
      localSetbackM: 0.3,
      planningSpacingM: 5,
      frontageSpacingM: 7,
      streetSpacingM: 18,
      joinToleranceM: settings.geometry.joinToleranceM,
      certifyFootprint: (req, budget): ConstraintCertificate =>
        withBudget(budget, () => {
          const r = requireValue(cert.footprint(f.worldPolygon(req.polygon)));
          return {
            ok: r.suitable,
            maxGradient: r.maxGradient,
            ...(!r.suitable
              ? { code: 'WORLD_FOOTPRINT', message: `Whole footprint fails ${r.reason}` }
              : {}),
          };
        }),
      certifyCorridor: (req, budget): ConstraintCertificate =>
        withBudget(budget, () => {
          let max = 0;
          for (let i = 1; i < req.path.length; i++) {
            const r = requireValue(
              cert.roadSegment(f.world(req.path[i - 1]!), f.world(req.path[i]!), req.widthM),
            );
            max = Math.max(max, r.maxDirectionalGrade);
            if (!r.traversable)
              return {
                ok: false,
                maxGrade: max,
                code: 'WORLD_CORRIDOR',
                message: `Whole corridor fails ${r.reason}`,
              };
          }
          return { ok: true, maxGrade: max };
        }),
      heightAt: (p, budget) => withBudget(budget, () => cert.heightAt(...f.world(p))),
    };
    function withBudget<T>(budget: ConstraintBudget, run: () => T): T {
      const previous = state.active;
      state.active = budget;
      try {
        return run();
      } finally {
        state.active = previous;
      }
    }
    let accepted: LocalLayout | undefined;
    for (let attempt = 0; attempt < settings.settlements.maxAttemptsPerSite; attempt++) {
      if (++attempts > settings.settlements.maxGlobalPlacementAttempts)
        throw new CompositionFailure(
          'COMPOSITION_RESOURCE_LIMIT',
          'global local-layout attempts',
          'Placement attempt cap exceeded.',
          site.id,
        );
      const before = state.charged;
      const remaining = Math.min(DEFAULT_CONSTRAINT_LIMITS.maxWork, meter.remaining);
      constraints.limits = { maxWork: remaining };
      if (remaining < 1) meter.take(1);
      const result = createConstrainedSettlementModel(
        {
          name: site.name,
          population: site.population.requested,
          port: false,
          citadel: false,
          walls: false,
          plaza: false,
          temple: false,
          shanty: false,
          capital: false,
          trade: false,
        },
        {
          development: { preset: 'village', edgeOccupancy: 4 },
          seed: deriveSeed(
            seed,
            `settlements:${COMPOSITION_VERSION}`,
            `${site.id}:attempt:${attempt}`,
          ),
          landscape: false,
          constraints,
        },
      );
      meter.take(result.work.total - (state.charged - before));
      if (result.ok) {
        accepted = { site, model: result.model, work: result.work.total };
        break;
      }
      if (result.diagnostics.some((d) => /LIMIT|BUDGET/.test(d.code)))
        throw new CompositionFailure(
          'COMPOSITION_RESOURCE_LIMIT',
          'local settlement work',
          result.diagnostics.map((d) => d.message).join('; '),
          site.id,
        );
      if (attempt + 1 === settings.settlements.maxAttemptsPerSite)
        throw new CompositionFailure(
          'SETTLEMENT_INFEASIBLE',
          'complete local capacity',
          result.diagnostics.map((d) => `${d.code}: ${d.message}`).join('; '),
          site.id,
        );
    }
    layouts.push(accepted!);
  }
  return layouts;
}
