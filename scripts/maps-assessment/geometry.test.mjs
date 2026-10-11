import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  corridorPieces,
  toWorld,
  toLocal,
  planeGrade,
  pointSegmentDistance,
  multiPolygonArea,
} from './geometry.mjs';

test('asymmetric metre coordinates rotate clockwise in y-down and round-trip', () => {
  const frame = { anchor: [3456, 1234], clockwiseRadians: Math.PI / 2 };
  assert.deepEqual(toWorld([137, -241], frame), [3697, 1371]);
  const local = toLocal([3697, 1371], frame);
  assert.ok(Math.abs(local[0] - 137) < 1e-10 && Math.abs(local[1] + 241) < 1e-10);
  assert.deepEqual(toWorld([137, -241], { anchor: [3456, 1234], metresPerUnit: 3 }), [3867, 511]);
});

test('known plane is queried in world metres after inverse local transform', () => {
  const frame = { anchor: [3456, 1234], clockwiseRadians: Math.PI / 2 };
  const worldHeight = ([x, y]) => 120 + 0.012 * x + 0.034 * y;
  const a = [137, -241],
    b = [237, -241];
  const wa = toWorld(a, frame),
    wb = toWorld(b, frame);
  assert.ok(Math.abs(worldHeight(wa) - 210.978) < 1e-10);
  assert.ok(Math.abs((worldHeight(wb) - worldHeight(wa)) / 100 - 0.034) < 1e-10);
  assert.ok(Math.abs(planeGrade(wa, wb, [0.012, 0.034]) - 0.034) < 1e-10);
});

test('segment diagnostic handles interior nearest points and zero-length paths', () => {
  assert.equal(pointSegmentDistance([5, 3], [0, 0], [10, 0]), 3);
  assert.equal(pointSegmentDistance([3, 4], [0, 0], [0, 0]), 5);
  assert.equal(planeGrade([0, 0], [100, 0], [0.12, 0.05]), 0.12);
  assert.equal(planeGrade([0, 0], [0, 100], [0.12, 0.05]), 0.05);
});

test('overlap areas preserve holes', () => {
  assert.equal(
    multiPolygonArea([
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        [
          [2, 2],
          [4, 2],
          [4, 4],
          [2, 4],
        ],
      ],
    ]),
    96,
  );
});

test('corridor covers complete segment width and conservative round caps', () => {
  const pieces = corridorPieces(
    [
      [0, 0],
      [100, 0],
    ],
    12,
  );
  assert.equal(pieces.length, 3);
  assert.deepEqual(pieces[2][0], [
    [0, 6],
    [100, 6],
    [100, -6],
    [0, -6],
  ]);
  for (const [x, y] of pieces[0][0]) {
    assert.ok(Math.hypot(x, y) >= 6);
    assert.ok(Math.hypot(x, y) <= 6 * 1.00484);
  }
  assert.deepEqual(
    corridorPieces(
      [
        [0, 0],
        [100, 0],
      ],
      0,
    ),
    [],
  );
});
