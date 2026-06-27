import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, OPEN, WALL } from '../src/world/maze.js';
import { corridorOutline } from '../src/world/mazeGeometry.js';
import { mazeWalls, wallFootprints, cellAt, cellCenter, isWalkable, tryMove, startFacingYaw } from '../src/world/mazeWorld.js';

// Mini-Labyrinth fuer praezise Kollisionstests: nur Mitte (1,1) offen.
function tiny() {
  return { n: 3, grid: [[WALL, WALL, WALL], [WALL, OPEN, WALL], [WALL, WALL, WALL]] };
}

test('mazeWalls: 4 Kanten je Konturensegment, alle zwischen y=0 und y=height', () => {
  const m = generateMaze(11, { seed: 5 });
  const walls = mazeWalls(m, { cell: 1, height: 1.2 });
  assert.equal(walls.length, corridorOutline(m).length * 4);
  for (const [a, b] of walls) {
    assert.ok((a[1] === 0 || a[1] === 1.2) && (b[1] === 0 || b[1] === 1.2));
  }
});

test('wallFootprints: ein xz-Segment je Korridor-Kontur, alle bei y=0', () => {
  const m = generateMaze(11, { seed: 5 });
  const fp = wallFootprints(m, { cell: 1 });
  assert.equal(fp.length, corridorOutline(m).length);
  for (const [a, b] of fp) {
    assert.equal(a[1], 0);
    assert.equal(b[1], 0);
  }
});

test('cellAt / cellCenter sind zueinander konsistent', () => {
  assert.deepEqual(cellAt(0.5, 0.5, 1), [0, 0]);
  assert.deepEqual(cellAt(2.9, 1.1, 1), [2, 1]);
  assert.deepEqual(cellCenter(3, 4, 1), [3.5, 4.5]);
  const [cx, cz] = cellCenter(2, 5, 2);
  assert.deepEqual(cellAt(cx, cz, 2), [2, 5]);
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
  const [nx, nz] = tryMove(t, 1.5, 1.5, 0.2, 0, { cell: 1, radius: 0.2 });
  assert.ok(Math.abs(nx - 1.7) < 1e-9);
  assert.equal(nz, 1.5);
});

test('tryMove: Wand blockiert die betroffene Achse, andere gleitet', () => {
  const t = tiny();
  // Nach +x gegen die Wand (Zelle 2,1 ist Wand): x bleibt, aber...
  const [nx] = tryMove(t, 1.5, 1.5, 0.5, 0, { cell: 1, radius: 0.2 });
  assert.equal(nx, 1.5, 'x sollte an der Wand blockieren');
  // Diagonale: x blockiert (Wand), z ebenfalls (Wand) -> beide bleiben.
  const [bx, bz] = tryMove(t, 1.5, 1.5, 0.5, 0.5, { cell: 1, radius: 0.2 });
  assert.equal(bx, 1.5);
  assert.equal(bz, 1.5);
});

test('tryMove: ohne Bewegung bleibt die Position', () => {
  const t = tiny();
  assert.deepEqual(tryMove(t, 1.5, 1.5, 0, 0, { cell: 1 }), [1.5, 1.5]);
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
