#!/usr/bin/env node
// Board spike (#443), point 5: how long does a fight last before a unit breaks?
// Runs the real engine over many seeds, once per rule variant, and prints the stages of each fight.
//
//   npm run build -w packages/engine && node tools/board-spike/battle-length.mjs
//   SEEDS=400 node tools/board-spike/battle-length.mjs
//
// Each variant runs on its own copy of `packages/engine/dist` in a temporary directory, with the
// variant's numbers written into that copy (parsed rule objects, or a one-line source patch for a
// rule the data cannot express yet). The engine in the repository is not changed.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SEEDS = Number(process.env.SEEDS ?? 200);
const DIST = fileURLToPath(new URL('../../packages/engine/dist', import.meta.url));

/**
 * The variants compared in docs/board-spike.md. `morale` overrides MORALE_RULES; `shockCap` caps
 * the morale a unit can lose to fire and shock in one 2-minute tick (a new rule); `underFire` is
 * a flat morale loss for every tick a unit takes any casualties (a new rule: the strain of standing
 * under fire, counted inside the cap); `longRange` replaces the share of fire effect left at the
 * edge of range.
 */
const VARIANTS = [
  { name: 'current' },
  { name: 'cap 8', shockCap: 8 },
  { name: 'cap 6, long range 0.5', shockCap: 6, longRange: 0.5 },
  {
    name: 'PROPOSAL: cap 6, long range 0.5, under fire 1',
    shockCap: 6,
    longRange: 0.5,
    underFire: 1,
  },
  { name: 'cap 6, long range 0.5, under fire 2', shockCap: 6, longRange: 0.5, underFire: 2 },
  { name: 'cap 5, long range 0.5, under fire 2', shockCap: 5, longRange: 0.5, underFire: 2 },
];

/** Copy the built engine and apply a variant; returns the copy's index module. */
async function engineFor(v) {
  const dir = mkdtempSync(join(tmpdir(), 'ks-battle-'));
  cpSync(DIST, dir, { recursive: true });
  const patch = (file, from, to) => {
    const p = join(dir, file);
    const src = readFileSync(p, 'utf8');
    if (!src.includes(from)) throw new Error(`${file}: patch target not found: ${from}`);
    writeFileSync(p, src.replace(from, to));
  };
  if (v.shockCap !== undefined || v.underFire !== undefined) {
    patch(
      'combat.js',
      'let morale = Math.max(0, round2(u.morale - shock));',
      `let morale = Math.max(0, round2(u.morale - Math.min(shock + ${v.underFire ?? 0}, ${v.shockCap ?? Infinity})));`,
    );
  }
  if (v.longRange !== undefined) {
    patch(
      'contact.js',
      'export const LONG_RANGE_FACTOR = FIRE_RULES.longRangeFactor;',
      `export const LONG_RANGE_FACTOR = ${v.longRange};`,
    );
  }
  const e = await import(pathToFileURL(join(dir, 'index.js')).href);
  Object.assign(e.MORALE_RULES, v.morale ?? {});
  return { e, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Two 600-man line battalions face to face, `gap` metres apart; red attacks when `attack`. */
function duel(e, seed, { gap, attack, morale }) {
  const g = e.loadScenario({
    id: 'spike-duel',
    name: 'Spike duel',
    seed,
    map: {
      width: 2000,
      height: 2000,
      features: [{ id: 'bridge', kind: 'bridge', at: { x: 100, y: 100 }, radius: 40 }],
    },
    sides: [
      { id: 'blue', name: 'Blue', controller: 'human', hq: { x: 1000, y: 1990 } },
      { id: 'red', name: 'Red', controller: 'human', hq: { x: 1000, y: 10 } },
    ],
    units: [
      {
        id: 'b',
        name: 'b',
        side: 'blue',
        kind: 'infantry',
        strength: 600,
        morale,
        facingDeg: 0,
        at: { x: 1000, y: 1000 + gap / 2 },
      },
      {
        id: 'r',
        name: 'r',
        side: 'red',
        kind: 'infantry',
        strength: 600,
        morale,
        facingDeg: 180,
        at: { x: 1000, y: 1000 - gap / 2 },
      },
    ],
    victory: {
      objective: [
        [70, 70],
        [130, 70],
        [130, 130],
        [70, 130],
      ],
      defender: 'blue',
      attacker: 'red',
      holdMinutes: 600,
    },
  });
  let s = e.startGame(e.createState(g.seed, g, 0));
  if (attack) s = e.issueAttack(s, 'r', 'b');
  return s;
}

/**
 * The shipped scenario with each red unit attacking its blue opposite number, and the objective
 * made untakeable so the game does not end before the fights do.
 */
function bridge(e, seed) {
  const victory = { ...e.holdTheBridge.victory, holdMinutes: 600, takeMinutes: 600 };
  const g = e.loadScenario({ ...e.holdTheBridge, victory, seed });
  let s = e.startGame(e.createState(seed, g, 0));
  for (const [r, b] of [
    ['red-1', 'blue-1'],
    ['red-2', 'blue-2'],
    ['red-3', 'blue-3'],
  ]) {
    s = e.issueAttack(s, r, b);
  }
  return s;
}

/**
 * Run for three hours and time each unit's stages from its own first exchange of fire:
 * taking losses (5% down), wavering (morale under 45), broken. One sample per unit that broke.
 */
function stages(e, s) {
  const reg = new e.EventRegistry();
  e.registerMovement(reg);
  e.registerCombat(reg);
  const start = new Map(s.world.units.map((u) => [u.id, u]));
  const first = new Map();
  const at = { losses: new Map(), wavering: new Map(), broken: new Map() };
  let fires = 0;
  let melee = 0;
  const { emitted } = e.advanceTo(s, 180 * e.MS_PER_MINUTE, reg);
  for (const ev of emitted) {
    if (ev.type === 'combat.fire') {
      const p = ev.payload;
      fires++;
      if (p.melee) melee++;
      for (const id of [p.attacker, p.target]) if (!first.has(id)) first.set(id, ev.time);
      const u0 = start.get(p.target);
      if (p.targetStrength < u0.strength * 0.95 && !at.losses.has(p.target))
        at.losses.set(p.target, ev.time);
      if (p.targetMorale < 45 && !at.wavering.has(p.target)) at.wavering.set(p.target, ev.time);
    }
    if (ev.type === 'unit.broken' && !at.broken.has(ev.payload.unitId))
      at.broken.set(ev.payload.unitId, ev.time);
  }
  const mins = (m) => [...m].map(([id, t]) => (t - (first.get(id) ?? t)) / e.MS_PER_MINUTE);
  return {
    losses: mins(at.losses),
    wavering: mins(at.wavering),
    broken: mins(at.broken),
    unbroken: s.world.units.length - at.broken.size,
    melee: fires ? melee / fires : 0,
  };
}

const pct = (xs, p) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))] : '-';
};
const band = (xs) => `${pct(xs, 10)}/${pct(xs, 50)}/${pct(xs, 90)}`.padEnd(12);

const CASES = [
  [
    'firefight 150 m, morale 80',
    (e, seed) => duel(e, seed, { gap: 150, attack: false, morale: 80 }),
  ],
  ['red attacks from 400 m', (e, seed) => duel(e, seed, { gap: 400, attack: true, morale: 80 })],
  ['Hold the Bridge, all attack', bridge],
];

console.log(
  `${SEEDS} seeds; minutes from a unit's first exchange, p10/p50/p90; a '-' is never within 3 h`,
);
for (const v of VARIANTS) {
  const { e, cleanup } = await engineFor(v);
  console.log(`\n${v.name}`);
  console.log(
    `  ${'case'.padEnd(30)}${'losses'.padEnd(13)}${'wavering'.padEnd(13)}${'broken'.padEnd(13)}breaks  melee`,
  );
  for (const [label, make] of CASES) {
    // A run the engine throws on is counted, not fatal: see the follow-up issue on zero-casualty shots.
    let crashed = 0;
    const runs = [];
    for (let i = 1; i <= SEEDS; i++) {
      try {
        runs.push(stages(e, make(e, i)));
      } catch {
        crashed++;
      }
    }
    const all = (k) => runs.flatMap((r) => r[k]);
    const breaks = all('broken').length;
    console.log(
      `  ${label.padEnd(30)}${band(all('losses'))} ${band(all('wavering'))} ${band(all('broken'))} ${String(breaks).padEnd(7)} ${Math.round(
        pct(
          runs.map((r) => r.melee),
          50,
        ) * 100,
      )}%${crashed ? `  (${crashed} runs threw)` : ''}`,
    );
  }
  cleanup();
}
