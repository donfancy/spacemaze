// Tests fuer den Sternenhimmel (world/stars.js): deterministische Erzeugung,
// Richtungs-Mathe und die Wand-Silhouette (skylineElevation-Raycast), die
// Sterne hinter nahen Waenden untergehen laesst.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALL, OPEN } from '../src/world/maze.js';
import { createMetric } from '../src/world/metric.js';
import {
  STARS, createStars, starDirection, skylineElevation, starTwinkle,
} from '../src/world/stars.js';

const THIN = { wall: 1, corridor: 5 };
const CELL = 5;
const EYE = 0.5 * CELL;
const WALL_H = 1.2 * CELL;

// Langer Gang in Reihe y=1 (wie in spinners/flippers.test): Kammern x=1..11,
// Welt-Einheiten [1..36] laengs, [1..6] quer.
function corridorMaze() {
  const n = 13;
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));
  for (let x = 1; x <= 11; x++) grid[1][x] = OPEN;
  return { n, grid, start: [1, 1], goal: [11, 1], seed: 42, metric: createMetric(THIN) };
}

test('createStars: deterministisch, richtige Anzahl, Werte in den Grenzen', () => {
  const a = createStars(1234);
  assert.equal(a.length, STARS.count);
  assert.deepEqual(createStars(1234), a, 'gleicher Seed -> gleicher Himmel');
  assert.notDeepEqual(createStars(99), a, 'anderer Seed -> anderer Himmel');
  for (const s of a) {
    assert.ok(s.az >= 0 && s.az < 2 * Math.PI, 'Azimut im Kreis');
    assert.ok(s.el >= STARS.minElevation - 1e-9 && s.el <= Math.PI / 2 + 1e-9,
      'Elevation zwischen Horizont-Schranke und Zenit');
    assert.ok(s.size > 0 && s.size <= STARS.maxSize, 'Pixel-Groesse im Rahmen');
  }
  // Nicht alle am Zenit, nicht alle am Horizont (Flaechen-Gleichverteilung).
  assert.ok(a.some((s) => s.el < 0.5) && a.some((s) => s.el > 1.0), 'Elevationen streuen');
});

test('starDirection: Einheitsvektor, Hoehen-Anteil = sin(el)', () => {
  for (const [az, el] of [[0, 0.2], [1.3, 0.9], [4.5, Math.PI / 2 - 0.01]]) {
    const d = starDirection(az, el);
    assert.ok(Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) < 1e-9, 'Laenge 1');
    assert.ok(Math.abs(d[1] - Math.sin(el)) < 1e-9, 'Hoehe = sin(el)');
  }
  // az-Konvention wie der Raycast: az=0 -> +z, az=PI/2 -> +x.
  assert.ok(Math.abs(starDirection(0, 0)[2] - 1) < 1e-9);
  assert.ok(Math.abs(starDirection(Math.PI / 2, 0)[0] - 1) < 1e-9);
});

test('skylineElevation ist EXAKT: Distanz bis zur Wand-KANTE, nicht bis in die Wand hinein', () => {
  const maze = corridorMaze();
  const opts = { unit: 1, cell: CELL, eye: EYE, wallHeight: WALL_H };
  const mid = { px: 18.5, pz: 3.5 }; // Gang-Mitte

  // Quer zum Gang (az=0 -> +z): Wandflaeche exakt bei z=6, Abstand 2.5.
  // (Regression: der alte Abtast-Raycast traf erst IN der Wand -- die
  // Silhouette war zu niedrig, Sterne schienen durch die Wand.)
  const near = skylineElevation(maze, mid.px, mid.pz, 0, opts);
  assert.ok(Math.abs(near - Math.atan2(WALL_H - EYE, 2.5)) < 1e-9, 'exakt atan(3.5/2.5)');

  // Diagonal (az=PI/4): dieselbe Wandflaeche, Weg um 1/cos(45) laenger.
  const diag = skylineElevation(maze, mid.px, mid.pz, Math.PI / 4, opts);
  assert.ok(Math.abs(diag - Math.atan2(WALL_H - EYE, 2.5 * Math.SQRT2)) < 1e-9, 'diagonal exakt');

  // Laengs (az=PI/2 -> +x): End-Wand bei x=36, Abstand 17.5 -- flach.
  const far = skylineElevation(maze, mid.px, mid.pz, Math.PI / 2, opts);
  assert.ok(Math.abs(far - Math.atan2(WALL_H - EYE, 17.5)) < 1e-9, 'ferne Wand exakt');
  assert.ok(near > diag && diag > far, 'naeher = steiler');

  // Vom West-Ende nach Ost: die End-Wand (32.5 Einheiten) liegt AUSSERHALB
  // der Reichweite (6 Gangbreiten = 30) -> offener Horizont.
  assert.equal(skylineElevation(maze, 3.5, 3.5, Math.PI / 2, opts), 0);
});

test('skylineElevation verfehlt schraeg gestreifte 1-Einheit-Waende nicht (DDA statt Abtasten)', () => {
  const maze = corridorMaze();
  const opts = { unit: 1, cell: CELL, eye: EYE, wallHeight: WALL_H };
  // Fast laengs den Gang, minimal quer geneigt: der Strahl streift die
  // Seitenwand (z=6) weit vorn unter sehr flachem Winkel -- der alte
  // 0.5er-Abtaster konnte solche duennen Querungen ueberspringen.
  const px = 4.5, pz = 3.5;
  const az = Math.atan2(20, 2.4); // dx/dz: nach 20 laengs erst 2.4 quer
  const el = skylineElevation(maze, px, pz, az, opts);
  // Eintritt in die Wandspur exakt bei quer=2.5 -> d = 2.5/sin(atan-Winkel...)
  const d = 2.5 / (2.4 / Math.hypot(20, 2.4));
  assert.ok(Math.abs(el - Math.atan2(WALL_H - EYE, d)) < 1e-9, 'flache Streifung exakt getroffen');
});

test('starTwinkle: sanft, beschraenkt und zeitveraenderlich', () => {
  const star = { phase: 1.7 };
  let min = 1;
  let max = 0;
  for (let t = 0; t < 5; t += 0.05) {
    const v = starTwinkle(star, t);
    assert.ok(v >= 0.2 && v <= 1, 'Helligkeit in [0.2, 1]');
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  assert.ok(max - min > 0.2, 'es funkelt (Helligkeit schwankt spuerbar)');
});
