// Tests fuer den Kompass: die Rose in der Ego-Ansicht (render/compass.js)
// und die Himmelsrichtungs-Beschriftung am Kartenrand (mazeView.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compassLayout } from '../src/render/compass.js';
import { compassGridPoints, CUBE_SIZE } from '../src/scenes/mazeView.js';
import { SIDE_FACES, mapGridToFace } from '../src/world/cubeFaces.js';
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

test('Kartenrand: N oben, S unten, W/E entlang der uAxis -- auf allen Flaechen', () => {
  const n = 11;
  const pts = compassGridPoints(n);
  for (const face of SIDE_FACES) {
    const world = {};
    for (const [label, [gx, gy]] of Object.entries(pts)) {
      world[label] = mapGridToFace(gx, gy, n, CUBE_SIZE, face);
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
