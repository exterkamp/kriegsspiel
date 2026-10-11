import {
  COORDINATES,
  HARD_LIMITS,
  PRECISION_POLICY,
  SCHEMA_VERSION,
  type MapAsset,
} from '../contract.js';
import { preflightAsset } from '../resources.js';
import { parseSettings } from '../validation.js';
import { deriveSeed } from '../overrides.js';
import { canonicalizeAsset } from '../canonical.js';
import { importAsset } from '../import.js';
import { generateElevation, extractContours } from '../terrain/index.js';
import { generateGeography } from '../geography/index.js';
import {
  createPlanningCertificates,
  generatePlanning,
  reconcileLocalJoins,
  type PlanningInput,
} from '../planning/index.js';
import { bounded, compositionLimits, configurationData, Meter, requireValue } from './budget.js';
import { assembleLayouts } from './assemble.js';
import { compactLocalStreets } from './compact.js';
import { createLocalLayouts, type CallbackState } from './settlements.js';
import { settlementFrame } from './frame.js';
import { CURRENT_GENERATOR, CONSUMED_FORK } from './identity.js';
import { validateBattlefield } from './validate.js';
import type { BattlefieldInput, BattlefieldResult } from './types.js';

export function generateBattlefield(raw: BattlefieldInput): BattlefieldResult {
  return bounded(() => {
    const limits = compositionLimits(
        configurationData(raw, 'limits') as BattlefieldInput['limits'],
      ),
      meter = new Meter(limits.maxConstraintWork, 'aggregate constrained work'),
      state: CallbackState = { charged: 0 };
    preflightAsset(
      raw,
      HARD_LIMITS,
      () => meter.take(),
      () => meter.take(),
    );
    const settings = parseSettings(raw.settings),
      seed = raw.seed;
    deriveSeed(seed, 'composition:validate-seed');
    const overrides = structuredClone(raw.overrides ?? []),
      bounds = {
        minX: 0 as const,
        minY: 0 as const,
        maxX: settings.widthM,
        maxY: settings.heightM,
      };
    const source = requireValue(generateElevation(settings, seed)),
      geo = requireValue(generateGeography(source, bounds, settings, seed));
    const contours = requireValue(extractContours(geo.elevation, bounds, settings));
    const size = settings.settlements.farmSite;
    const preferredFarm = Math.max(
      size.minExtentM,
      Math.sqrt(size.minAreaM2),
      Math.min(50, size.maxExtentM, Math.sqrt(size.maxAreaM2)),
    );
    const input: PlanningInput = {
      settings,
      seed,
      bounds,
      elevation: geo.elevation,
      water: geo.water,
      cover: geo.cover,
      crossingCandidates: geo.crossingCandidates,
      overrides,
      requireBridge: settings.hydrology.requireRiver,
      preferredSiteExtentM: { farm: preferredFarm },
    };
    let plan = requireValue(generatePlanning(input));
    const certificates = requireValue(
      createPlanningCertificates(input, (n) => {
        state.active?.take(n, 'world certificate');
        meter.take(n);
        state.charged += n;
      }),
    );
    const layouts = createLocalLayouts(plan, geo.water, settings, seed, certificates, meter, state);
    const joins = layouts.flatMap((l) =>
      l.model.constraints!.entrances.map((e) => ({
        siteId: l.site.id,
        entranceId: e.id,
        endpoint: settlementFrame(l.site).world(e.endpoint),
        bearingDeg: (e.bearingDeg + l.site.rotationDeg) % 360,
        widthM: e.widthM,
      })),
    );
    const changed = joins.some((j) => {
      const e = plan.sites
        .find((s) => s.id === j.siteId)!
        .entrances.find((e) => e.id === j.entranceId)!;
      return (
        e.endpoint[0] !== j.endpoint[0] ||
        e.endpoint[1] !== j.endpoint[1] ||
        e.bearingDeg !== j.bearingDeg ||
        e.widthM !== j.widthM
      );
    });
    if (changed) {
      const r = reconcileLocalJoins(input, plan, joins);
      meter.take(r.work);
      if (!r.ok) return r;
      plan = r.value.plan;
      for (const l of layouts) l.site = plan.sites.find((s) => s.id === l.site.id)!;
    }
    const asset: MapAsset = {
      schema: 'kriegsspiel/local-map',
      schemaVersion: SCHEMA_VERSION,
      precisionPolicy: PRECISION_POLICY,
      coordinates: { ...COORDINATES },
      name: `Battlefield ${seed}`,
      provenance: {
        seed,
        generator: structuredClone(CURRENT_GENERATOR),
        fork: { ...CONSUMED_FORK },
      },
      settings,
      overrides,
      bounds,
      elevation: geo.elevation,
      drainage: geo.drainage,
      layers: {
        cover: geo.cover,
        water: geo.water,
        roadNodes: plan.roadNodes,
        roads: plan.roads,
        crossings: plan.crossings,
        sites: plan.sites,
        buildings: [],
        landmarks: [],
        contours,
      },
      diagnostics: [],
    };
    assembleLayouts(asset.layers, layouts, settings, meter);
    compactLocalStreets(asset.layers, meter);
    // Canonical geometry, rather than an unrounded trial, is the acceptance surface.
    const normalized = importAsset(canonicalizeAsset(asset));
    const validation = validateBattlefield(normalized, {
      maxValidationWork: limits.maxValidationWork,
    });
    if (!validation.ok) return validation;
    return { ok: true, value: normalized, diagnostics: normalized.diagnostics };
  });
}
