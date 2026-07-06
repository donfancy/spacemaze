// Tests fuer den Kompass: die Rose in der Ego-Ansicht (render/compass.js)
// und die Himmelsrichtungs-Beschriftung am Kartenrand (mazeView.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compassLayout } from '../src/render/compass.js';
import { compassUnitPoints, CUBE_SIZE } from '../src/scenes/mazeView.js';
import { SIDE_FACES, mapUnitsToFace } from '../src/world/cubeFaces.js';
import { UNIFORM_METRIC, createMetric } from '../src/world/metric.js';
import { dot } from '../src/math/vec3.js';

const OPTS = { cx: 700, cy: 500, radius: 40 };

function labelByName(layout, name) {
  return layout.labels.find((l) => l.label === name);
}

test('Blick nach Norden (yaw=0): N oben, S unten, W links, E rechts', () => {
  const rose = compassLayout(0, OPTS);
  const n = labelByName(rose, 'N');
  const s = labelByName(rose, 'S');
  const w = labelByName(rose, 'W');
  const e = labelByName(rose, 'E');
  assert.ok(Math.abs(n.x - OPTS.cx) < 1e-9 && n.y < OPTS.cy, 'N oben');
  assert.ok(Math.abs(s.x - OPTS.cx) < 1e-9 && s.y > OPTS.cy, 'S unten');
  assert.ok(w.x < OPTS.cx && Math.abs(w.y - OPTS.cy) < 1e-9, 'W links');
  assert.ok(e.x > OPTS.cx && Math.abs(e.y - OPTS.cy) < 1e-9, 'E rechts');
  assert.ok(n.major && !s.major, 'nur N hervorgehoben');
});

test('Blick nach Westen (yaw=+90 Grad): W oben, N rechts, S links', () => {
  const rose = compassLayout(Math.PI / 2, OPTS);
  assert.ok(labelByName(rose, 'W').y < OPTS.cy, 'W oben');
  assert.ok(labelByName(rose, 'N').x > OPTS.cx, 'N rechts (Norden ist rechts, wenn man nach Westen blickt)');
  assert.ok(labelByName(rose, 'S').x < OPTS.cx, 'S links');
  assert.ok(labelByName(rose, 'E').y > OPTS.cy, 'E hinten/unten');
});

test('Rose: Kreis geschlossen und auf Radius, Buchstaben innerhalb', () => {
  const rose = compassLayout(0.7, OPTS);
  const [circle, lubber] = rose.polylines;
  assert.deepEqual(circle[0], circle[circle.length - 1], 'Kreis geschlossen');
  for (const [x, y] of circle) {
    assert.ok(Math.abs(Math.hypot(x - OPTS.cx, y - OPTS.cy) - OPTS.radius) < 1e-9);
  }
  assert.equal(lubber.length, 3, 'Peilmarke ist ein Dach aus 2 Segmenten');
  for (const l of rose.labels) {
    const d = Math.hypot(l.x - OPTS.cx, l.y - OPTS.cy);
    assert.ok(d < OPTS.radius, `${l.label} liegt im Kreis`);
  }
});

test('Scheibe rotiert als starre Einheit: Buchstaben radial nach aussen gerichtet', () => {
  for (const yaw of [0, 0.7, Math.PI / 2, Math.PI, -2.1]) {
    const rose = compassLayout(yaw, OPTS);
    for (const l of rose.labels) {
      // Oben-Richtung des Buchstabens (0,-1) um seinen Winkel gedreht ...
      const upX = Math.sin(l.angle);
      const upY = -Math.cos(l.angle);
      // ... muss radial nach aussen zeigen (vom Zentrum zum Buchstaben).
      const d = Math.hypot(l.x - OPTS.cx, l.y - OPTS.cy);
      const outX = (l.x - OPTS.cx) / d;
      const outY = (l.y - OPTS.cy) / d;
      assert.ok(Math.abs(upX - outX) < 1e-9 && Math.abs(upY - outY) < 1e-9,
        `${l.label} bei yaw=${yaw} radial ausgerichtet`);
    }
  }
});

test('der oben haengende Buchstabe steht aufrecht (Blick nach Westen -> W oben, Winkel 0)', () => {
  const rose = compassLayout(Math.PI / 2, OPTS);
  const w = labelByName(rose, 'W');
  assert.ok(w.y < OPTS.cy, 'W oben');
  assert.ok(Math.abs(w.angle) < 1e-9, 'W aufrecht');
});

test('vier Ticks haengen an der Kreis-Kante und rotieren mit', () => {
  const rose = compassLayout(0.4, OPTS);
  const ticks = rose.polylines.slice(2);
  assert.equal(ticks.length, 4);
  for (const [inner, outer] of ticks) {
    assert.ok(Math.abs(Math.hypot(outer[0] - OPTS.cx, outer[1] - OPTS.cy) - OPTS.radius) < 1e-9, 'Tick endet auf der Kante');
    assert.ok(Math.hypot(inner[0] - OPTS.cx, inner[1] - OPTS.cy) < OPTS.radius, 'Tick zeigt nach innen');
  }
  // Jeder Tick liegt auf der Linie Zentrum -> zugehoeriger Buchstabe.
  for (let i = 0; i < 4; i++) {
    const l = rose.labels[i];
    const [, outer] = ticks[i];
    const crossProd = (l.x - OPTS.cx) * (outer[1] - OPTS.cy) - (l.y - OPTS.cy) * (outer[0] - OPTS.cx);
    assert.ok(Math.abs(crossProd) < 1e-9, `Tick ${l.label} radial zum Buchstaben`);
  }
});

test('Kartenrand: N oben, S unten, W/E entlang der uAxis -- auf allen Flaechen', () => {
  const n = 11;
  const pts = compassUnitPoints(n, UNIFORM_METRIC);
  for (const face of SIDE_FACES) {
    const world = {};
    for (const [label, [ux, uy]] of Object.entries(pts)) {
      world[label] = mapUnitsToFace(ux, uy, UNIFORM_METRIC.total(n), CUBE_SIZE, face);
    }
    // vAxis ist auf allen Seitenflaechen [0,-1,0]: Norden liegt in Welt-y OBEN.
    assert.ok(world.N[1] > world.S[1], `Flaeche [${face.normal}]: N ueber S`);
    // Osten liegt in Richtung wachsender uAxis (im Bild rechts), Westen entgegen.
    assert.ok(dot(world.E, face.uAxis) > dot(world.W, face.uAxis), `Flaeche [${face.normal}]: E rechts von W`);
    // Alle vier liegen ausserhalb des Rahmens (Abstand vom Zentrum > halbe Kante).
    for (const label of ['N', 'S', 'W', 'E']) {
      const inPlane = [
        dot(world[label], face.uAxis),
        dot(world[label], face.vAxis),
      ];
      assert.ok(Math.max(...inPlane.map(Math.abs)) > CUBE_SIZE / 2, `${label} ausserhalb des Rahmens`);
    }
  }
});

test('Kartenrand-Punkte: mittig und mit festem Randabstand, auch bei schmalen Waenden', () => {
  const n = 9;
  for (const metric of [UNIFORM_METRIC, createMetric({ wall: 1, corridor: 5 })]) {
    const total = metric.total(n);
    const pts = compassUnitPoints(n, metric);
    // N/S mittig ueber/unter der Flaeche, W/E mittig links/rechts.
    assert.equal(pts.N[0], total / 2);
    assert.equal(pts.S[0], total / 2);
    assert.equal(pts.W[1], total / 2);
    assert.equal(pts.E[1], total / 2);
    // Der Abstand vom Rahmen ist ein fester Anteil der Gesamtbreite.
    assert.ok(Math.abs(pts.N[1] / total + 0.06) < 1e-9);
    assert.ok(Math.abs((pts.S[1] - total) / total - 0.06) < 1e-9);
  }
});
