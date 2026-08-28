// Tests fuer die gemeinsame Feind-Platzierung (world/foePlacement.js):
// corridorCandidates in einem ECHTEN generierten Level-Maze (die Sortierung
// "Weg-Gaenge zuerst, laengere zuerst" wird hier wirklich ausgeuebt --
// die Hand-Maze-Tests der Feindarten haben nur einen Kandidaten), dazu
// openSpan und die avoid-Ueberlappung.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALL, OPEN, generateMaze } from '../src/world/maze.js';
import { createMetric } from '../src/world/metric.js';
import {
  corridorCandidates, openSpan, spanOf, straightRuns,
} from '../src/world/foePlacement.js';

const THIN = { wall: 1, corridor: 5 };
const OPTS = { minChambers: 3, exclude: 3, unit: 1, cell: 5 };

function levelMaze() {
  // Wie ein Level-16-Maze: gross, lange Gaenge (straight 0.7).
  return generateMaze(35, { seed: 1234, metric: createMetric(THIN), straight: 0.7 });
}

test('corridorCandidates: Weg-Gaenge zuerst, dann laengere -- im generierten Maze', () => {
  const maze = levelMaze();
  const cands = corridorCandidates(maze, OPTS);
  assert.ok(cands.length > 5, 'ein grosses Maze hat viele Kandidaten');

  let seenOffPath = false;
  let prev = null;
  for (const c of cands) {
    assert.ok(c.chambers >= OPTS.minChambers, 'nur lange Gangstuecke');
    assert.ok(c.min < c.max, 'Spanne in Welt-Koordinaten geordnet');
    assert.equal(c.onPath, c.visits.length > 0, 'onPath folgt aus visits');
    if (!c.onPath) seenOffPath = true;
    else assert.ok(!seenOffPath, 'alle Weg-Gaenge stehen VOR den Abseits-Gaengen');
    if (prev && prev.onPath === c.onPath) {
      assert.ok(prev.chambers >= c.chambers, 'innerhalb der Gruppe: laengere zuerst');
    }
    prev = c;
  }
  assert.ok(cands.some((c) => c.onPath) && seenOffPath, 'beide Gruppen kommen vor');

  // Deterministisch: gleicher Aufruf, gleiches Ergebnis.
  assert.deepEqual(corridorCandidates(maze, OPTS), cands);
});

test('corridorCandidates: avoid ueberspringt belegte Gangstuecke (beide Feind-Formen)', () => {
  const maze = levelMaze();
  const [first] = corridorCandidates(maze, OPTS);
  // Ein "Flipper" (min/max) und ein "Spinner" (wall/dir/runLen) auf dem
  // besten Gang -- beide Formen muessen ihn sperren (spanOf normalisiert).
  const flipperLike = { axis: first.axis, cross: first.cross, min: first.min, max: first.max };
  const spinnerLike = {
    axis: first.axis, cross: first.cross,
    wall: first.max, dir: -1, runLen: first.max - first.min,
  };
  for (const avoid of [[flipperLike], [spinnerLike]]) {
    const rest = corridorCandidates(maze, { ...OPTS, avoid });
    assert.ok(!rest.some((c) => c.axis === first.axis && c.fix === first.fix && c.lo === first.lo),
      'der belegte Gang fehlt');
    assert.equal(rest.length, corridorCandidates(maze, OPTS).length - 1, 'genau einer faellt weg');
  }
  assert.deepEqual(spanOf(flipperLike), [first.min, first.max]);
});

test('openSpan zaehlt offene Zellen rueckwaerts/vorwaerts', () => {
  const n = 9;
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));
  for (let x = 1; x <= 7; x++) grid[3][x] = OPEN;
  const maze = { n, grid };
  assert.deepEqual(openSpan(maze, 4, 3, 1, 0), [3, 3], 'Reihe: je 3 offen');
  assert.deepEqual(openSpan(maze, 1, 3, 1, 0), [0, 6], 'am Rand: alles vorwaerts');
  assert.deepEqual(openSpan(maze, 4, 3, 0, 1), [0, 0], 'quer: geschlossen');
});

test('straightRuns: Spannen beginnen und enden auf Kammern', () => {
  const maze = levelMaze();
  for (const run of straightRuns(maze)) {
    assert.equal(run.lo % 2, 1, 'Beginn auf Kammer (ungerade)');
    assert.equal(run.hi % 2, 1, 'Ende auf Kammer (ungerade)');
    assert.equal(run.chambers, (run.hi - run.lo) / 2 + 1);
  }
});
