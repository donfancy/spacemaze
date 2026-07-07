// Tests fuer Ziel-Zone und Ziel-Leuchtfeuer (world/goal.js): eingerueckte
// Zone (Kante reicht nicht), Boden-Quadrat, Leucht-Linien, Flimmern.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  goalZone, inGoalZone, goalMarkerSegments, goalBeamFeet, beamWander, beamFlicker,
  beamOcclusionCut,
} from '../src/world/goal.js';
import { createMetric } from '../src/world/metric.js';

const THIN = { wall: 1, corridor: 5 };

// Minimales "Maze": nur goal + Metrik werden von goal.js gelesen.
function mazeWithGoal(goal, metric) {
  return { n: 5, goal, metric };
}

test('goalZone: Zielfeld-Rechteck mit Einrueckung (uniforme Metrik)', () => {
  const m = mazeWithGoal([2, 3], undefined); // Blockwelt: 1 Einheit pro Zelle
  const z = goalZone(m, 10, 2.5); // unit 10, inset 1/4 der Feldgroesse
  assert.deepEqual(z, { x0: 22.5, x1: 27.5, z0: 32.5, z1: 37.5 });
});

test('goalZone: schmale Waende -- Zielfeld ist die GANG-Kammer der Metrik', () => {
  const m = mazeWithGoal([1, 3], createMetric(THIN));
  // toUnits(1)=1, toUnits(2)=6 (x); toUnits(3)=7, toUnits(4)=12 (z); Feld 5x5.
  const z = goalZone(m, 1, 1.25);
  assert.deepEqual(z, { x0: 2.25, x1: 4.75, z0: 8.25, z1: 10.75 });
});

test('inGoalZone: die Kante des Zielfelds reicht NICHT, 1/4 drinnen schon', () => {
  const m = mazeWithGoal([1, 3], createMetric(THIN));
  const inset = 1.25; // 1/4 der Feldgroesse 5
  assert.ok(!inGoalZone(m, 1.01, 9.5, 1, inset), 'knapp hinter der Feldkante: noch nicht am Ziel');
  assert.ok(!inGoalZone(m, 2.2, 9.5, 1, inset), 'kurz vor der Zonen-Kante: noch nicht am Ziel');
  assert.ok(inGoalZone(m, 2.25, 9.5, 1, inset), 'genau auf der Zonen-Kante: am Ziel');
  assert.ok(inGoalZone(m, 3.5, 9.5, 1, inset), 'Feldmitte: am Ziel');
  assert.ok(!inGoalZone(m, 3.5, 10.9, 1, inset), 'im Feld, aber zu nah an der Gegenkante');
});

test('goalMarkerSegments: geschlossenes Quadrat auf dem Boden (y=0)', () => {
  const segs = goalMarkerSegments({ x0: 1, x1: 3, z0: 5, z1: 7 });
  assert.equal(segs.length, 4);
  for (const [a, b] of segs) {
    assert.equal(a[1], 0, 'liegt auf dem Boden');
    assert.equal(b[1], 0, 'liegt auf dem Boden');
  }
  // Geschlossen: jedes Segment endet, wo das naechste beginnt.
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(segs[i][1], segs[(i + 1) % 4][0], `Kante ${i} schliesst an`);
  }
});

test('goalBeamFeet: jeder Strahl bleibt zu jeder Zeit auf seiner Kante', () => {
  const zone = { x0: 1, x1: 3, z0: 5, z1: 7 };
  // Kante 0: z=z0, Kante 1: x=x1, Kante 2: z=z1, Kante 3: x=x0 (Umlauf der Ecken).
  const onEdge = [
    ([x, z]) => z === zone.z0 && x >= zone.x0 && x <= zone.x1,
    ([x, z]) => x === zone.x1 && z >= zone.z0 && z <= zone.z1,
    ([x, z]) => z === zone.z1 && x >= zone.x0 && x <= zone.x1,
    ([x, z]) => x === zone.x0 && z >= zone.z0 && z <= zone.z1,
  ];
  for (const time of [0, 0.37, 1.2, 5, 42.7]) {
    const feet = goalBeamFeet(zone, { perEdge: 2, time });
    assert.equal(feet.length, 4 * 3, '4 Kanten x 3 Strahlen');
    feet.forEach((foot, i) => {
      const e = Math.floor(i / 3);
      assert.ok(onEdge[e](foot), `t=${time}: Strahl ${i} auf Kante ${e} (${foot})`);
    });
  }
});

test('goalBeamFeet: Strahlen wandern ueber die Zeit, unabhaengig voneinander', () => {
  const zone = { x0: 0, x1: 4, z0: 0, z1: 4 };
  const a = goalBeamFeet(zone, { perEdge: 2, time: 0.2, rate: 1 });
  const b = goalBeamFeet(zone, { perEdge: 2, time: 0.7, rate: 1 });
  const moved = a.filter(([x, z], i) => Math.hypot(x - b[i][0], z - b[i][1]) > 1e-3);
  assert.ok(moved.length >= a.length / 2, `die meisten Strahlen bewegen sich (${moved.length}/${a.length})`);
  // Unabhaengig: nicht alle Strahlen einer Kante am selben Punkt.
  const edge0 = a.slice(0, 3).map(([x]) => x.toFixed(4));
  assert.ok(new Set(edge0).size > 1, 'Strahlen einer Kante an verschiedenen Positionen');
  // Deterministisch: gleiche Zeit -> gleiche Fuesse.
  assert.deepEqual(a, goalBeamFeet(zone, { perEdge: 2, time: 0.2, rate: 1 }));
});

test('beamWander: bleibt in [0,1] und gleitet innerhalb eines Takts monoton', () => {
  for (let i = 0; i < 6; i++) {
    let prev = null;
    for (let t = 0; t < 3; t += 0.01) {
      const u = beamWander(i, t, { rate: 1 });
      assert.ok(u >= 0 && u <= 1, `in [0,1] (${u})`);
      // Innerhalb eines Takts (hier 1s) interpoliert smoothstep monoton
      // zwischen zwei Stuetzstellen -> keine Spruenge.
      if (prev !== null && Math.floor(t) === Math.floor(t - 0.01)) {
        assert.ok(Math.abs(u - prev) < 0.1, `gleitet statt springt (${Math.abs(u - prev)})`);
      }
      prev = u;
    }
  }
});

test('beamOcclusionCut: Wand dazwischen verdeckt bis eye + (h-eye)/t, darueber frei', () => {
  const eye = 0.5, wallHeight = 1.2;
  // Kamera bei (0,0), Strahl bei (10,0), Wand quer bei x=4 (t=0.4).
  const wall = [[[4, 0, -1], [4, 0, 1]]];
  const cut = beamOcclusionCut(wall, [0, 0], [10, 0], { eye, wallHeight });
  assert.ok(Math.abs(cut - (eye + (wallHeight - eye) / 0.4)) < 1e-9, `cut=${cut}`);
  assert.ok(cut > wallHeight, 'Schnitt liegt ueber der Wandhoehe (Strahl ragt heraus)');
});

test('beamOcclusionCut: keine Wand dazwischen -> 0; mehrere Waende -> Maximum', () => {
  const opts = { eye: 0.5, wallHeight: 1.2 };
  const behind = [[[12, 0, -1], [12, 0, 1]]];   // hinter dem Strahl
  const aside = [[[4, 0, 2], [4, 0, 3]]];       // seitlich, Sichtlinie verfehlt
  const along = [[[2, 0, 0], [8, 0, 0]]];       // parallel AUF der Sichtlinie
  assert.equal(beamOcclusionCut(behind, [0, 0], [10, 0], opts), 0);
  assert.equal(beamOcclusionCut(aside, [0, 0], [10, 0], opts), 0);
  assert.equal(beamOcclusionCut(along, [0, 0], [10, 0], opts), 0);
  // Zwei Waende: die naehere (kleineres t) schneidet HOEHER -> Maximum zaehlt.
  const two = [[[4, 0, -1], [4, 0, 1]], [[2, 0, -1], [2, 0, 1]]];
  const cut = beamOcclusionCut(two, [0, 0], [10, 0], opts);
  assert.ok(Math.abs(cut - (0.5 + 0.7 / 0.2)) < 1e-9, `naechste Wand dominiert (${cut})`);
});

test('beamFlicker: deterministisch, im Bereich [min,max], variiert ueber Zeit und Strahl', () => {
  assert.equal(beamFlicker(3, 1.7), beamFlicker(3, 1.7), 'gleiche Inputs -> gleicher Wert');
  const values = [];
  for (let i = 0; i < 8; i++) {
    for (let k = 0; k < 32; k++) {
      const v = beamFlicker(i, k / 24 + 1e-6, { min: 0.2, max: 0.9 });
      assert.ok(v >= 0.2 && v <= 0.9, `im Bereich (${v})`);
      values.push(v);
    }
  }
  assert.ok(new Set(values.map((v) => v.toFixed(6))).size > 100, 'flimmert (viele verschiedene Werte)');
  // Innerhalb eines Ticks stabil (kein Frame-Rauschen, sondern Flacker-Takt).
  assert.equal(beamFlicker(0, 0.001), beamFlicker(0, 0.02), 'gleicher Tick -> gleicher Wert');
});
