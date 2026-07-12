// Tests fuer das Bildraum-Zerbersten (render/shatter.js): reine Geometrie,
// deterministisch -- die Invarianten, auf denen der Crash-Effekt beruht.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHATTER, shatterPolylines } from '../src/render/shatter.js';

const OPTS = { amount: 1, cx: 400, cy: 300, scale: 200 };

// Testbild: ein Rahmen (lange Linien -> zerbricht in Splitter) + kurze Striche.
function testPolylines() {
  return [
    [[100, 100], [700, 100], [700, 500], [100, 500], [100, 100]],
    [[380, 280], [420, 320]],
    [[400, 50], [400, 90]],
  ];
}

function totalLength(polylines) {
  let sum = 0;
  for (const poly of polylines) {
    for (let i = 1; i < poly.length; i++) {
      sum += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
    }
  }
  return sum;
}

test('amount 0 laesst das Bild unveraendert (und kopiert nichts unnoetig)', () => {
  const polys = testPolylines();
  assert.equal(shatterPolylines(polys, { ...OPTS, amount: 0 }), polys);
});

test('deterministisch: gleiche Eingabe -> exakt gleiche Scherben', () => {
  const a = shatterPolylines(testPolylines(), OPTS);
  const b = shatterPolylines(testPolylines(), OPTS);
  assert.deepEqual(a, b);
});

test('lange Linien zerbrechen in Splitter <= chunk; Gesamtlaenge bleibt erhalten', () => {
  const out = shatterPolylines(testPolylines(), OPTS);
  assert.ok(out.length > 20, 'der Rahmen zerbricht in viele Splitter');
  for (const piece of out) {
    assert.equal(piece.length, 2, 'jede Scherbe ist ein einzelner Strich');
    const len = Math.hypot(piece[1][0] - piece[0][0], piece[1][1] - piece[0][1]);
    assert.ok(len <= SHATTER.chunk + 1e-9, 'kein Splitter laenger als chunk');
  }
  // Drehen + Verschieben aendern keine Laengen: die Linienmasse bleibt gleich.
  assert.ok(Math.abs(totalLength(out) - totalLength(testPolylines())) < 1e-6);
});

test('Scherben fliegen mit wachsendem amount weiter, im Mittel vom Zentrum weg', () => {
  const mids = (polys) => polys.map((p) => [
    (p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2,
  ]);
  // Referenz: amount minimal -> Scherben praktisch an Ort und Stelle.
  const base = mids(shatterPolylines(testPolylines(), { ...OPTS, amount: 1e-9 }));
  let drift = { 0.3: 0, 1: 0 };
  let radial = 0;
  for (const amount of [0.3, 1]) {
    const moved = mids(shatterPolylines(testPolylines(), { ...OPTS, amount }));
    assert.equal(moved.length, base.length, 'amount aendert nur die Lage, nicht die Stueckelung');
    for (let i = 0; i < base.length; i++) {
      const dx = moved[i][0] - base[i][0];
      const dy = moved[i][1] - base[i][1];
      drift[amount] += Math.hypot(dx, dy) / base.length;
      if (amount === 1) {
        // Radial-Anteil relativ zum Zentrum (cx, cy).
        const rx = base[i][0] - OPTS.cx;
        const ry = base[i][1] - OPTS.cy;
        const rl = Math.hypot(rx, ry) || 1;
        radial += (dx * rx + dy * ry) / rl / base.length;
      }
    }
  }
  assert.ok(drift[1] > 2 * drift[0.3], 'volle Wucht wirft deutlich weiter');
  assert.ok(radial > 0.3 * drift[1], 'im Mittel fliegt es vom Einschlag weg');
});

test('raeumlicher Hash: eine Scherbe fliegt gleich, egal was sonst im Bild ist', () => {
  const solo = shatterPolylines([[[380, 280], [420, 320]]], OPTS);
  const all = shatterPolylines(testPolylines(), OPTS);
  // Dasselbe Original-Stueck findet sich mit identischer Scherben-Lage wieder
  // (stabile Flugbahnen: nichts wuerfelt pro Frame oder pro Nachbarschaft neu).
  const match = all.some((piece) => piece.every((pt, i) =>
    Math.abs(pt[0] - solo[0][i][0]) < 1e-9 && Math.abs(pt[1] - solo[0][i][1]) < 1e-9));
  assert.ok(match);
});
