// Tests fuer die Kollisionswellen (world/waves.js): Wandflaechen-Ausdehnung
// und die weglaufenden, verblassenden Linien.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collisionWave, waveSegments } from '../src/world/waves.js';
import { OPEN, WALL } from '../src/world/maze.js';
import { createMetric } from '../src/world/metric.js';

const THIN = { wall: 1, corridor: 5 };

// Gerader Nord-Sued-Gang wie im drive-Test: Spalte x=1 offen.
function corridorMaze() {
  const W = WALL, O = OPEN;
  return {
    n: 5,
    grid: [
      [W, W, W, W, W],
      [W, O, W, W, W],
      [W, O, W, W, W],
      [W, O, W, W, W],
      [W, W, W, W, W],
    ],
    metric: createMetric(THIN),
  };
}

const HEAD_ON = { axis: 'z', side: -1, plane: 1, wallCell: [1, 0], point: [3.5, 1], impact: 1 };

test('collisionWave: Ausdehnung = zusammenhaengende sichtbare Wandflaeche', () => {
  const wave = collisionWave(corridorMaze(), HEAD_ON, { unit: 1, eye: 2.5 });
  assert.equal(wave.axis, 'z');
  assert.equal(wave.plane, 1);
  assert.equal(wave.u0, 3.5);
  assert.equal(wave.y0, 2.5);
  // Nur Zelle x=1 hat davor offenen Gang -> Ausdehnung Einheiten [1, 6].
  assert.deepEqual(wave.extent, [1, 6]);
});

test('collisionWave: laengere Wand liefert breitere Ausdehnung, u0 wird geklemmt', () => {
  const W = WALL, O = OPEN;
  // Gang entlang Reihe y=1 ueber die Spalten 1..3 -> Wandreihe y=0 dreizellig.
  const m = {
    n: 5,
    grid: [
      [W, W, W, W, W],
      [W, O, O, O, W],
      [W, W, W, W, W],
      [W, W, W, W, W],
      [W, W, W, W, W],
    ],
    metric: createMetric(THIN),
  };
  const col = { axis: 'z', side: -1, plane: 1, wallCell: [2, 0], point: [20, 1], impact: 1 };
  const wave = collisionWave(m, col, { unit: 1, eye: 2.5 });
  // Spalten 1..3 sind offen davor -> Einheiten [toUnits(1), toUnits(4)] = [1, 12].
  assert.deepEqual(wave.extent, [1, 12]);
  assert.equal(wave.u0, 12, 'Auftreffpunkt wird auf die Flaeche geklemmt');
});

test('collisionWave-Sicherheitsnetz: offene Start-Zelle brueckt nicht ueber die Luecke', () => {
  const W = WALL, O = OPEN;
  // Zwei frei stehende Pfeiler (2,2) und (2,4) mit offener Luecke (2,3)
  // dazwischen. Eine (kuenstlich) falsche Wandzelle IN der Luecke darf die
  // Ausdehnung nicht bis zu den Pfeilern ausweiten -- sonst laufen die
  // Wellen-Linien quer durch die Luft der offenen Kreuzung.
  const n = 7;
  const grid = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) {
      const border = x === 0 || y === 0 || x === n - 1 || y === n - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      row.push(border || pillar ? W : O);
    }
    grid.push(row);
  }
  const m = { n, grid, metric: createMetric(THIN) };
  const bogus = { axis: 'x', side: -1, plane: 7, wallCell: [2, 3], point: [7, 9], impact: 1 };
  const wave = collisionWave(m, bogus, { unit: 1, eye: 2.5 });
  // Ohne Netz waere die Ausdehnung [6, 13] (Pfeiler..Pfeiler ueber die Luecke).
  assert.deepEqual(wave.extent, [7, 12], 'bleibt auf der Zellspanne der Start-Zelle');
});

test('waveSegments: beginnt als Kreuz am Auftreffpunkt (Alter 0, Halbarm `arm`)', () => {
  const wave = { axis: 'z', plane: 1, u0: 3.5, y0: 2.5, extent: [1, 6] };
  const geo = waveSegments(wave, 0, { height: 6, speed: 15, life: 0.8, arm: 1 });
  assert.ok(geo);
  assert.equal(geo.fade, 1, 'volle Helligkeit zu Beginn');
  assert.equal(geo.segments.length, 2, 'genau eine senkrechte + eine waagerechte Linie');
  const [v, h] = geo.segments[0][0][0] === geo.segments[0][1][0] ? geo.segments : [geo.segments[1], geo.segments[0]];
  assert.deepEqual(v, [[3.5, 1.5, 1], [3.5, 3.5, 1]], 'senkrechter Arm um den Auftreffpunkt');
  assert.deepEqual(h, [[2.5, 2.5, 1], [4.5, 2.5, 1]], 'waagerechter Arm um den Auftreffpunkt');
});

test('waveSegments: senkrechte Linien laufen seitlich, waagerechte auf/ab, Arme wachsen, geklippt', () => {
  const wave = { axis: 'z', plane: 1, u0: 3.5, y0: 2.5, extent: [1, 6] };
  const opts = { height: 6, speed: 15, life: 0.8, arm: 0 };

  const geo = waveSegments(wave, 0.1, opts); // r = 1.5, Halbarm = 1.5
  assert.ok(geo);
  assert.ok(Math.abs(geo.fade - (1 - 0.1 / 0.8)) < 1e-12, 'linear verblassend');
  // Senkrechte bei u = 2 und 5 (Arme y0 +- 1.5), waagerechte bei y = 1 und 4.
  const vertical = geo.segments.filter(([a, b]) => a[0] === b[0]);
  const horizontal = geo.segments.filter(([a, b]) => a[1] === b[1]);
  assert.equal(vertical.length, 2);
  assert.deepEqual(vertical.map(([a]) => a[0]).sort((p, q) => p - q), [2, 5]);
  for (const [a, b] of vertical) {
    assert.equal(a[1], 1, 'senkrechter Arm ab y0 - (arm+r)');
    assert.equal(b[1], 4, 'senkrechter Arm bis y0 + (arm+r)');
  }
  assert.equal(horizontal.length, 2);
  assert.deepEqual(horizontal.map(([a]) => a[1]).sort((p, q) => p - q), [1, 4]);
  for (const [a, b] of horizontal) {
    assert.equal(a[0], 2, 'waagerecht beginnt bei u0 - (arm+r)');
    assert.equal(b[0], 5, 'waagerecht endet bei u0 + (arm+r)');
  }
  // Alle Punkte liegen auf der Wandebene z = plane.
  for (const [a, b] of geo.segments) {
    assert.equal(a[2], 1);
    assert.equal(b[2], 1);
  }

  // Spaeter: r = 3 -> u = 0.5/6.5 ausserhalb [1,6], y = -0.5 unterhalb -> nur
  // die obere waagerechte (y = 5.5) bleibt, auf die Flaeche geklippt.
  const late = waveSegments(wave, 0.2, opts);
  assert.equal(late.segments.length, 1);
  const [[a, b]] = late.segments;
  assert.equal(a[1], 5.5);
  assert.deepEqual([a[0], b[0]], [1, 6], 'waagerecht auf die Flaechenausdehnung geklippt');
});

test('waveSegments: vor der Geburt und nach dem Verklingen null', () => {
  const wave = { axis: 'z', plane: 1, u0: 3.5, y0: 2.5, extent: [1, 6] };
  const opts = { height: 6, speed: 15, life: 0.8 };
  assert.equal(waveSegments(wave, -0.05, opts), null, 'noch nicht geboren');
  assert.equal(waveSegments(wave, 0.8, opts), null, 'Lebensdauer vorbei');
  assert.equal(waveSegments(wave, 0.5, opts), null, 'alle Linien aus der Flaeche gelaufen');
});

test('waveSegments axis x: Linien liegen auf der Ebene lx = plane', () => {
  const wave = { axis: 'x', plane: 7, u0: 3.5, y0: 2.5, extent: [1, 6] };
  const geo = waveSegments(wave, 0.1, { height: 6, speed: 15, life: 0.8 });
  assert.ok(geo.segments.length > 0);
  for (const [a, b] of geo.segments) {
    assert.equal(a[0], 7);
    assert.equal(b[0], 7);
  }
});
