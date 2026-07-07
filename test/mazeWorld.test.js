import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, OPEN, WALL } from '../src/world/maze.js';
import { corridorOutline, mergeCollinear } from '../src/world/mazeGeometry.js';
import { mazeWalls, wallFootprints, cellAt, cellCenter, isWalkable, tryMove, startFacingYaw } from '../src/world/mazeWorld.js';

// Mini-Labyrinth fuer praezise Kollisionstests: nur Mitte (1,1) offen.
function tiny() {
  return { n: 3, grid: [[WALL, WALL, WALL], [WALL, OPEN, WALL], [WALL, WALL, WALL]] };
}

test('mazeWalls: lange Unter-/Oberkante je Wandzug, Pfosten an jedem Gitter-Vertex', () => {
  const m = generateMaze(11, { seed: 5 });
  const height = 1.2;
  const walls = mazeWalls(m, { unit: 1, height });
  const runs = mergeCollinear(corridorOutline(m));
  // Pro Zug: Unterkante + Oberkante + (Laenge+1) Pfosten.
  const runLen = ([[x1, y1], [x2, y2]]) => Math.abs(x2 - x1) + Math.abs(y2 - y1);
  const expected = runs.reduce((sum, r) => sum + 2 + runLen(r) + 1, 0);
  assert.equal(walls.length, expected);

  let posts = 0;
  for (const [a, b] of walls) {
    if (a[1] === b[1]) {
      assert.ok(a[1] === 0 || a[1] === height, 'horizontale Kante unten oder oben');
    } else {
      posts++;
      assert.ok(a[0] === b[0] && a[2] === b[2], 'Pfosten senkrecht');
      assert.equal(Math.min(a[1], b[1]), 0);
      assert.equal(Math.max(a[1], b[1]), height);
    }
  }
  // Der Zellen-Rhythmus bleibt: genauso viele Pfosten-Positionen wie die
  // feine Kontur Gitter-Vertices je Zug hat.
  assert.equal(posts, runs.reduce((sum, r) => sum + runLen(r) + 1, 0));
});

test('wallFootprints: zusammengefasste Zuege, gleiche Gesamtlaenge, alle bei y=0', () => {
  const m = generateMaze(11, { seed: 5 });
  const fp = wallFootprints(m, { unit: 1 });
  const fine = corridorOutline(m);
  assert.equal(fp.length, mergeCollinear(fine).length);
  assert.ok(fp.length < fine.length, 'weniger Verdecker als feine Kontur');
  const fpLen = fp.reduce((s, [a, b]) => s + Math.abs(b[0] - a[0]) + Math.abs(b[2] - a[2]), 0);
  const fineLen = fine.reduce((s, [a, b]) => s + Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]), 0);
  assert.equal(fpLen, fineLen, 'Geometrie-Union unveraendert (Gesamtlaenge gleich)');
  for (const [a, b] of fp) {
    assert.equal(a[1], 0);
    assert.equal(b[1], 0);
  }
});

test('cellAt / cellCenter sind zueinander konsistent', () => {
  const t = tiny(); // uniforme Metrik (Fallback)
  assert.deepEqual(cellAt(t, 0.5, 0.5, 1), [0, 0]);
  assert.deepEqual(cellAt(t, 2.9, 1.1, 1), [2, 1]);
  assert.deepEqual(cellCenter(t, 3, 4, 1), [3.5, 4.5]);
  const [cx, cz] = cellCenter(t, 2, 5, 2);
  assert.deepEqual(cellAt(t, cx, cz, 2), [2, 5]);
});

test('isWalkable: offen begehbar, Wand und Aussenraum nicht', () => {
  const t = tiny();
  assert.ok(isWalkable(t, 1.5, 1.5, 1));   // Mitte offen
  assert.ok(!isWalkable(t, 0.5, 0.5, 1));  // Ecke Wand
  assert.ok(!isWalkable(t, -0.5, 1.5, 1)); // ausserhalb
  assert.ok(!isWalkable(t, 1.5, 3.5, 1));  // ausserhalb
});

test('isWalkable im echten Maze: Start offen, Pfeiler Wand', () => {
  const m = generateMaze(11, { seed: 5 });
  const [sx, sy] = m.start;
  assert.ok(isWalkable(m, sx + 0.5, sy + 0.5, 1));
  assert.ok(!isWalkable(m, 0.5, 0.5, 1)); // (0,0) ist Pfeiler/Rand
});

test('tryMove: Bewegung innerhalb der offenen Zelle ist erlaubt', () => {
  const t = tiny();
  const [nx, nz] = tryMove(t, 1.5, 1.5, 0.2, 0, { unit: 1, radius: 0.2 });
  assert.ok(Math.abs(nx - 1.7) < 1e-9);
  assert.equal(nz, 1.5);
});

test('tryMove: Wand blockiert die betroffene Achse, andere gleitet', () => {
  const t = tiny();
  // Nach +x gegen die Wand (Zelle 2,1 ist Wand): x bleibt, aber...
  const [nx] = tryMove(t, 1.5, 1.5, 0.5, 0, { unit: 1, radius: 0.2 });
  assert.equal(nx, 1.5, 'x sollte an der Wand blockieren');
  // Diagonale: x blockiert (Wand), z ebenfalls (Wand) -> beide bleiben.
  const [bx, bz] = tryMove(t, 1.5, 1.5, 0.5, 0.5, { unit: 1, radius: 0.2 });
  assert.equal(bx, 1.5);
  assert.equal(bz, 1.5);
});

test('tryMove: seitliches Vorbeirutschen an einem Wandende bleibt auf Abstand radius', () => {
  // Kreuzungs-Szenario: Gang entlang Reihe 0, offener Abzweig bei (0,1),
  // Zelle (1,1) ist Wand. Wer im Abzweig nahe der Kante steht (z=0.95) und
  // seitwaerts (+x) in den Gang laeuft, kaeme der Wand bei z=1 auf 0.05 nahe --
  // naeher als die Render-Near-Plane: die Wand verdeckt dann nichts mehr und
  // dahinterliegende Linien erscheinen ganz hell (Boris' Rueckwand-Bug).
  const m = {
    n: 3,
    grid: [
      [OPEN, OPEN, OPEN],
      [OPEN, WALL, WALL],
      [WALL, WALL, WALL],
    ],
  };
  // Zu nah an der Wandkante (z=0.95): +x wird blockiert (Ecke z+radius in der Wand).
  const [bx] = tryMove(m, 0.8, 0.95, 0.1, 0, { unit: 1, radius: 0.25 });
  assert.equal(bx, 0.8, 'x muss blockieren, sonst unterschreitet man radius');
  // Mit genug Abstand (z=0.5) ist derselbe Schritt erlaubt.
  const [nx] = tryMove(m, 0.8, 0.5, 0.1, 0, { unit: 1, radius: 0.25 });
  assert.ok(Math.abs(nx - 0.9) < 1e-9, 'mit Abstand gleitet man normal weiter');
});

test('tryMove haelt das ganze Spieler-Quadrat in offenen Zellen (deterministischer Zufallslauf)', () => {
  const m = generateMaze(11, { seed: 7 });
  const unit = 1;
  const radius = 0.25;
  let [x, z] = cellCenter(m, m.start[0], m.start[1], unit);
  let yaw = startFacingYaw(m);
  for (let i = 0; i < 5000; i++) {
    yaw += Math.sin(i * 0.7) * 0.3; // pseudo-zufaellige, reproduzierbare Drehung
    const step = 0.05;
    [x, z] = tryMove(m, x, z, -Math.sin(yaw) * step, -Math.cos(yaw) * step, { unit, radius });
    // Alle 4 Ecken offen <=> Abstand zu jeder Wand >= radius (Quadrat < Zellgroesse).
    for (const [ox, oz] of [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]]) {
      assert.ok(isWalkable(m, x + ox, z + oz, unit), `Schritt ${i}: Ecke bei (${(x + ox).toFixed(3)}, ${(z + oz).toFixed(3)}) in der Wand`);
    }
  }
});

test('tryMove: ohne Bewegung bleibt die Position', () => {
  const t = tiny();
  assert.deepEqual(tryMove(t, 1.5, 1.5, 0, 0, { unit: 1 }), [1.5, 1.5]);
});

test('startFacingYaw blickt in den offenen Startgang', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const m = generateMaze(11, { seed });
    const yaw = startFacingYaw(m);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const [sx, sy] = m.start;
    // Die Zelle direkt vor dem Blick muss offen sein.
    const nx = sx + Math.round(fx);
    const ny = sy + Math.round(fz);
    assert.equal(m.grid[ny][nx], OPEN, `seed ${seed}: Blick nicht in den Gang`);
  }
});
