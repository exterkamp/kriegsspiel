import { describe, expect, it } from 'vitest';
import { spikeScenario } from './fixture';
import { detailFor, separate } from './layout';
import { chiefOfStaffReport } from './report';
import { Battle, CONTACT_M, TURN_MINUTES, dist, sizeBand, stageOf, type Turn } from './sim';

const unit = (t: Turn, id: string) => t.units.find((u) => u.id === id)!;

function play(turns: number, contactLine = true) {
  const b = new Battle(spikeScenario(), { contactLine });
  for (let i = 0; i < turns; i++) b.play();
  return b;
}

describe('board spike sim', () => {
  it('is the same battle every time', () => {
    expect(JSON.stringify(play(4).turns)).toBe(JSON.stringify(play(4).turns));
  });

  it('records where every unit was at each minute of the turn', () => {
    const t = play(1).current;
    expect(t.to - t.from).toBe(TURN_MINUTES);
    for (const u of t.units) expect(t.tracks[u.id]).toHaveLength(TURN_MINUTES + 1);
    // 1st Battalion marched north towards the bridge.
    const b1 = t.tracks['b1']!;
    expect(b1[0]!.y).toBeGreaterThan(b1[b1.length - 1]!.y + 300);
  });

  it('stops units at the contact line instead of letting them march through', () => {
    const line = play(3).current;
    const through = play(3, false).current;
    const gap = (t: Turn) => dist(unit(t, 'b1').pos, unit(t, 'r1').pos);
    expect(gap(line)).toBeGreaterThanOrEqual(CONTACT_M - 1);
    expect(gap(through)).toBeLessThan(CONTACT_M / 2);
    expect(unit(line, 'b1').contact).toBe('r1');
  });

  it('shows a fight in stages over several turns before a unit breaks', () => {
    const b = play(5);
    const stages = b.turns.map((t) => stageOf(unit(t, 'b1')));
    expect(stages).toContain('losses');
    expect(stages).toContain('wavering');
    const broke = b.turns
      .flatMap((t) => t.events)
      .find((e) => e.kind === 'broken' && e.unit === 'b1');
    const met = b.turns
      .flatMap((t) => t.events)
      .find((e) => e.kind === 'contact' && e.unit === 'b1');
    expect(met).toBeDefined();
    expect(broke).toBeDefined();
    // The owner's target: a fight should last roughly 20 to 40 minutes before a unit breaks.
    expect(broke!.minute - met!.minute).toBeGreaterThanOrEqual(15);
    expect(broke!.minute - met!.minute).toBeLessThanOrEqual(40);
  });

  it('knows an enemy only as seen: a letter, a size band, the time it was last seen', () => {
    const t = play(1).current;
    const c = t.contacts.find((x) => x.id === 'r1')!;
    expect(c.letter).toMatch(/^[A-Z]$/);
    expect(c.size[0]).toBeLessThan(650);
    expect(c.size[1]).toBeGreaterThan(650);
    // The battalion that went into the wood was lost to sight and is known only as it was.
    const wood = t.contacts.find((x) => x.id === 'r2')!;
    expect(wood.seenAt).toBeLessThan(t.to);
    // Its seen positions this turn stop where it was lost.
    expect(t.enemyTracks['r2']!.length).toBeLessThan(TURN_MINUTES);
  });

  it('keeps letters stable from turn to turn', () => {
    const b = play(3);
    const letters = (t: Turn) => Object.fromEntries(t.contacts.map((c) => [c.id, c.letter]));
    expect(letters(b.turns[3]!)).toMatchObject(letters(b.turns[1]!));
  });

  it('obeys a player order given for the turn, routing over the bridge', () => {
    const b = new Battle(spikeScenario());
    b.play({ b2: { verb: 'move', waypoints: [{ x: 1800, y: 700 }] } });
    const t = b.play();
    const track = [...b.turns[1]!.tracks['b2']!, ...t.tracks['b2']!];
    // It went to the bridge (x 1500) to cross rather than wading the river.
    expect(track.some((p) => Math.abs(p.x - 1500) < 60 && Math.abs(p.y - 1000) < 80)).toBe(true);
  });

  it('routes an attack on a target over the bridge', () => {
    const b = new Battle(spikeScenario());
    b.play({ b1: { verb: 'attack', target: 'r2', waypoints: [] } });
    b.play();
    b.play();
    const track = b.turns.slice(1).flatMap((t) => t.tracks['b1']!);
    const bank = (p: { x: number; y: number }) => Math.sign(p.y - b.scenario.riverY(p.x));
    const crossings = track.filter((p, i) => i > 0 && bank(p) !== bank(track[i - 1]!));
    expect(crossings.length).toBeGreaterThan(0);
    for (const p of crossings) expect(Math.abs(p.x - 1500)).toBeLessThan(60);
  });

  it('falls back over the bridge when a unit breaks on the far bank', () => {
    const s = spikeScenario();
    // A weak battalion across the river and far east of the bridge, next to the enemy, with its home on the south bank.
    const b1 = s.units.find((u) => u.id === 'b1')!;
    Object.assign(b1, {
      pos: { x: 2600, y: 450 },
      home: { x: 2600, y: 1960 },
      strength: 250,
      morale: 45,
    });
    const b = new Battle(s);
    b.play({ b1: { verb: 'attack', target: 'r3', waypoints: [] } });
    for (let i = 0; i < 6; i++) b.play();
    const broke = b.turns.findIndex((t) =>
      t.events.some((e) => e.kind === 'broken' && e.unit === 'b1'),
    );
    expect(broke).toBeGreaterThan(0);
    const track = b.turns.slice(broke).flatMap((t) => t.tracks['b1']!);
    const bank = (p: { x: number; y: number }) => Math.sign(p.y - s.riverY(p.x));
    const crossings = track.filter((p, i) => i > 0 && bank(p) !== bank(track[i - 1]!));
    expect(crossings.length).toBeGreaterThan(0);
    for (const p of crossings) expect(Math.abs(p.x - 1500)).toBeLessThan(60);
  });

  it('draws an enemy trail only from where it was seen this turn', () => {
    const b = play(4);
    // Nothing marches faster than broken cavalry, 220 m a minute and a third more; a longer step was never seen.
    for (const t of b.turns.slice(1))
      for (const track of Object.values(t.enemyTracks))
        track
          .slice(1)
          .forEach((p, i) => expect(dist(p, track[i]!)).toBeLessThanOrEqual(220 * 1.3 + 1));
  });

  it('bands strength estimates', () => {
    expect(sizeBand(600)).toEqual([450, 700]);
    expect(sizeBand(60)).toEqual([50, 100]);
  });
});

describe('chief of staff report', () => {
  it('summarises the fight, names our units and links the enemy by its letter', () => {
    const b = play(3);
    const r = chiefOfStaffReport(b.scenario, b.turns[2]!, b.turns[3]!);
    expect(r.heading).toBe('Turn 3, 10:20 to 10:30');
    expect(r.gist).toMatch(/1st Battalion is wavering/);
    const text = r.paragraphs.map((p) => p.map((x) => x.text).join('')).join('\n');
    expect(text).toMatch(
      /1st Battalion is fighting enemy infantry [A-Z] \(\d+–\d+\) [^;]*; lost \d+ men, it is wavering\./,
    );
    const linked = r.paragraphs.flat().filter((x) => x.unit);
    expect(linked.map((x) => x.unit)).toEqual(expect.arrayContaining(['b1', 'r1']));
    // Never the enemy's own name or strength.
    expect(JSON.stringify(r)).not.toMatch(/Vanguard|Uhlan|650 men/);
    expect(r.enemy.length).toBe(b.turns[3]!.contacts.length);
  });

  it('says when a unit is under fire without being in contact', () => {
    const b = play(1);
    const r = chiefOfStaffReport(b.scenario, b.turns[0]!, b.turns[1]!);
    const text = r.paragraphs.map((p) => p.map((x) => x.text).join('')).join('\n');
    expect(text).toMatch(/1st Battalion came under fire .* and lost 1 man;/);
    expect(r.enemy.filter((l) => l[0]!.text === 'New: ')).toHaveLength(4);
  });
  it('still names a broken unit as broken on the turns after it broke', () => {
    const b = play(5);
    expect(unit(b.turns[4]!, 'b1').stage).toBe('broken');
    const r = chiefOfStaffReport(b.scenario, b.turns[4]!, b.turns[5]!);
    const text = r.paragraphs.map((p) => p.map((x) => x.text).join('')).join('\n');
    expect(text).not.toMatch(/1st Battalion (holds|moved)/);
    expect(text).toMatch(/1st Battalion is still broken, /);
  });

  it('does not report "lost 0 men"', () => {
    const b = play(8);
    for (const t of b.turns)
      for (const e of t.events) if (e.kind === 'losses') expect(e.lost).toBeGreaterThan(0);
  });
});

describe('counter layout', () => {
  it('pushes overlapping counters apart and leaves the rest alone', () => {
    const placed = separate(
      [
        { id: 'a', at: { x: 0, y: 0 } },
        { id: 'b', at: { x: 10, y: 0 } },
        { id: 'c', at: { x: 500, y: 500 } },
      ],
      60,
      40,
    );
    const [a, b, c] = placed;
    expect(Math.abs(a!.at.x - b!.at.x) >= 60 || Math.abs(a!.at.y - b!.at.y) >= 40).toBe(true);
    expect(c!.at).toEqual({ x: 500, y: 500 });
    expect(a!.true).toEqual({ x: 0, y: 0 });
  });

  it('does not move a pinned counter', () => {
    const [a] = separate(
      [
        { id: 'a', at: { x: 0, y: 0 } },
        { id: 'b', at: { x: 10, y: 0 } },
      ],
      60,
      40,
      new Set(['a']),
    );
    expect(a!.at).toEqual({ x: 0, y: 0 });
  });

  it('chooses the level of detail by the width of the view', () => {
    expect(detailFor(4000)).toBe('far');
    expect(detailFor(3000)).toBe('mid');
    expect(detailFor(1000)).toBe('near');
  });
});
