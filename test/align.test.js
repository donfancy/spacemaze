// Tests fuer den Lenk-Assistenten "Ausrichten" (world/align.js): Pfeil
// runter im Fahrt-Modus haelt den Kurs auf die MITTE des Gangendes --
// beendet das Wand-zu-Wand-Federn, greift aber nur, wenn die naechste
// Achsen-Richtung wirklich in einen Gang fuehrt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALIGN, alignTurn } from '../src/world/align.js';
import { DRIVE, createDriveState, driveStep } from '../src/world/drive.js';
import { createMetric } from '../src/world/metric.js';
import { OPEN, WALL } from '../src/world/maze.js';

const THIN = { wall: 1, corridor: 5 };
// Gangbreite bei unit=1 und corridor=5: cell = 5, Spielerradius = 0.25 * cell.
const OPTS = { unit: 1, cell: 5, radius: 1.25 };

// Gerader Nord-Sued-Gang wie in drive.test.js: Spalte x=1 offen
// (Einheiten x 1..6, z 1..12; Gangmitte x = 3.5).
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

test('zielt auf die Mitte des Gangendes: seitlicher Versatz ergibt Schraegkurs zur Mitte', () => {
  const m = corridorMaze();
  // Links der Mitte, Blick geradeaus (-z): das Gangende (Zelle (1,1),
  // Mitte x=3.5) liegt rechts voraus -> Lenk-Eingabe nach rechts (negativ).
  const right = alignTurn(m, { px: 2.4, pz: 11, yaw: 0 }, OPTS);
  assert.ok(right !== null && right < 0, `links der Mitte -> lenkt rechts (${right})`);
  // Spiegelbildlich rechts der Mitte -> links (positiv).
  const left = alignTurn(m, { px: 4.6, pz: 11, yaw: 0 }, OPTS);
  assert.ok(left !== null && left > 0, `rechts der Mitte -> lenkt links (${left})`);
  // Exakt auf der Mittellinie mit exaktem Kurs: nichts zu tun.
  const straight = alignTurn(m, { px: 3.5, pz: 11, yaw: 0 }, OPTS);
  assert.ok(Math.abs(straight) < 1e-9, 'auf Kurs -> Lenk-Eingabe 0');
});

test('grosse Abweichung lenkt voll, kleine proportional (weiches Einschwenken)', () => {
  const m = corridorMaze();
  const hard = alignTurn(m, { px: 3.5, pz: 11, yaw: ALIGN.soft * 2 }, OPTS);
  assert.equal(hard, -1, 'weit verdreht -> volle Lenk-Eingabe');
  const gentle = alignTurn(m, { px: 3.5, pz: 11, yaw: ALIGN.soft / 2 }, OPTS);
  assert.ok(gentle < 0 && gentle > -1, `nahe dran -> proportional (${gentle})`);
});

test('quer zum Gang (naechste Achsen-Richtung fuehrt in die Wand): kein Eingriff', () => {
  const m = corridorMaze();
  // Blick nach +x (yaw -90 Grad): Nachbarzelle (2,y) ist Wand.
  assert.equal(alignTurn(m, { px: 3.5, pz: 8, yaw: -Math.PI / 2 }, OPTS), null);
  // Blick nach -x ebenso (Zelle (0,y) ist Wand).
  assert.equal(alignTurn(m, { px: 3.5, pz: 8, yaw: Math.PI / 2 }, OPTS), null);
});

test('dicht am Gangende: kein Eingriff mehr (Zielwinkel wuerde umschlagen)', () => {
  const m = corridorMaze();
  // In der letzten Zelle vor der Wand: nichts mehr auszurichten.
  assert.equal(alignTurn(m, { px: 3.5, pz: 3.5, yaw: 0 }, OPTS), null);
  // Kurz davor, naeher als minDist an der Gangende-Mitte (Zelle (1,1), 3.5):
  assert.equal(alignTurn(m, { px: 3.5, pz: 6.2, yaw: 0 }, OPTS), null);
});

test('gehalten: der Assistent schwenkt weich ein und beendet das Wand-Pinball', () => {
  const m = corridorMaze();
  const dt = 1 / 60;
  // Schraeg Richtung Wand unterwegs (yaw 0.45 driftet nach -x; steil genug,
  // dass der Aufprall ueber minImpact liegt -- flacher wuerde nur geglitten).
  // Referenz OHNE Assistent: der Kurs endet im Wand-Federn.
  const run = (assisted) => {
    const state = createDriveState();
    state.vel = DRIVE.cruise;
    // pz 10.5: das Spieler-Quadrat (Radius 1.25) braucht Luft zur Suedwand
    // (der Gang endet bei Einheit 12).
    let pose = { px: 3.2, pz: 10.5, yaw: 0.45 };
    let collisions = 0;
    for (let i = 0; i < 60 * 3 && pose.pz > 4.6; i++) {
      const turn = assisted ? (alignTurn(m, pose, OPTS) ?? 0) : 0;
      const r = driveStep(m, state, pose, turn, dt, OPTS);
      pose = { px: r.px, pz: r.pz, yaw: r.yaw };
      if (r.collision) collisions++;
    }
    return { pose, collisions };
  };
  const free = run(false);
  assert.ok(free.collisions >= 1, 'ohne Assistent federt der Kurs an der Wand');
  const aided = run(true);
  assert.equal(aided.collisions, 0, 'mit Assistent kein Wandkontakt');
  assert.ok(Math.abs(aided.pose.px - 3.5) < 0.8,
    `kommt nahe der Gangmitte an (${aided.pose.px.toFixed(2)})`);
});
