// Titel-Display "SPACE MAZE" (world/title.js, pur) + Startscreen-Einbindung:
// Boot-Titel beim allerersten Laden, Attract-Auftakt, jede Taste raeumt ihn
// weg; 5x7-Voxel-Layout mit HALBER Wort-Luecke (Boris' Spec).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TITLE, TITLE_WORD, titleCells, voxelOrigin, voxelProgress, voxelBurst,
  voxelSize, titleColor, titleFlash, titleZoom, titleAlpha,
} from '../src/world/title.js';
import { FIREWORK_COLORS } from '../src/world/fireworks.js';
import { Game } from '../src/core/game.js';
import { State } from '../src/core/states.js';

test('Phasen-Summe stimmt mit der Gesamtdauer ueberein', () => {
  assert.ok(Math.abs(TITLE.assemble + TITLE.hold + TITLE.finale - TITLE.dur) < 1e-9);
});

test('titleCells: SPACE MAZE zentriert, mit HALBER Wort-Luecke', () => {
  assert.equal(TITLE_WORD, 'SPACE MAZE');
  const cells = titleCells();
  assert.ok(cells.length > 100, `genug Voxel fuer 9 Buchstaben (${cells.length})`);

  // Zentriert: x- und y-Spannen symmetrisch um 0.
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 1e-9, 'x zentriert');
  assert.equal(Math.min(...ys), -3);
  assert.equal(Math.max(...ys), 3, '7 Zeilen hoch');

  // Belegte Spalten: Luecken ZWISCHEN Buchstaben sind 1 Spalte breit, die
  // Wort-Luecke ist 4 Spalten (halbes Blank: 3 + Buchstaben-Luecke) --
  // deutlich kleiner als ein volles Blank (7).
  const cols = [...new Set(xs)].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < cols.length; i++) {
    if (cols[i] - cols[i - 1] > 1) gaps.push(cols[i] - cols[i - 1] - 1);
  }
  assert.equal(Math.max(...gaps), 4, 'die groesste Luecke ist die halbe Wort-Luecke');
  assert.equal(gaps.filter((g) => g === 4).length, 1, 'genau EINE Wort-Luecke');
});

test('voxelProgress: alle starten am Wuerfel und kommen puenktlich an', () => {
  const n = titleCells().length;
  for (let i = 0; i < n; i++) {
    assert.equal(voxelProgress(0, i), 0, 'bei t=0 noch am Wuerfel');
    assert.ok(voxelProgress(TITLE.assemble, i) > 0.999, 'am Aufbau-Ende angekommen');
    // monoton steigend
    let prev = 0;
    for (let t = 0; t <= TITLE.assemble + 1e-9; t += 0.1) {
      const p = voxelProgress(t, i);
      assert.ok(p >= prev - 1e-12);
      prev = p;
    }
  }
});

test('voxelSize: unsichtbar bis zum eigenen Start (kein Teppich auf dem Wuerfel)', () => {
  const n = titleCells().length;
  for (let i = 0; i < n; i++) {
    assert.equal(voxelSize(0, i), 0, 'bei t=0 ist KEIN Voxel sichtbar');
    assert.ok(voxelSize(TITLE.assemble, i) > 0.999, 'voll da am Aufbau-Ende');
  }
});

test('voxelOrigin liegt auf der Wuerfel-Oberflaeche (Einheitswuerfel)', () => {
  for (let i = 0; i < 200; i++) {
    const o = voxelOrigin(i);
    const m = Math.max(Math.abs(o.x), Math.abs(o.y), Math.abs(o.z));
    assert.ok(Math.abs(m - 1) < 1e-9, 'Maximumsnorm 1 = auf einer Flaeche');
  }
});

test('voxelBurst: ruht bis zum Finale, dann auseinander und ausgeblendet', () => {
  const cell = { x: 5, y: 2 };
  const before = voxelBurst(TITLE.assemble + TITLE.hold - 0.01, 7, cell);
  assert.deepEqual(before, { dx: 0, dy: 0, dz: 0, fade: 1 });
  const mid = voxelBurst(TITLE.assemble + TITLE.hold + TITLE.finale / 2, 7, cell);
  assert.ok(Math.hypot(mid.dx, mid.dy) > 1, 'fliegt radial weg');
  assert.ok(mid.fade < 1 && mid.fade > 0);
  const end = voxelBurst(TITLE.dur, 7, cell);
  assert.ok(end.fade < 1e-9, 'am Ende unsichtbar');
});

test('titleColor zykelt durch die Feuerwerks-Palette, das Finale ist weiss', () => {
  const seen = new Set();
  for (let t = 0; t < TITLE.assemble + TITLE.hold; t += 0.05) {
    const c = titleColor(t);
    assert.ok(FIREWORK_COLORS.includes(c), 'Farbe aus der Palette');
    seen.add(c);
  }
  assert.equal(seen.size, FIREWORK_COLORS.length, 'ALLE Farben kommen dran');
  assert.equal(titleColor(TITLE.assemble + TITLE.hold + 0.01), '#ffffff');
  // Echo-Ringe (1980) sind gegeneinander verschoben.
  assert.notEqual(titleColor(1, 0), titleColor(1, 1));
});

test('Zoom, Blitz und Deckkraft folgen den Phasen', () => {
  assert.ok(titleZoom(0) < 0.1, 'startet winzig (aus der Tiefe)');
  assert.ok(titleZoom(TITLE.assemble) > 0.999, 'voll da am Aufbau-Ende');
  assert.equal(titleFlash(TITLE.assemble + TITLE.hold - 0.1), 0, 'kein Blitz vor dem Finale');
  assert.ok(titleFlash(TITLE.assemble + TITLE.hold) > 0.99, 'Blitz am Finale-Beginn');
  assert.ok(titleFlash(TITLE.dur) < 1e-9, 'Blitz verglommen');
  assert.equal(titleAlpha(1), 1);
  assert.ok(titleAlpha(TITLE.dur) < 1e-9, 'Titel am Ende ausgeblendet');
});

// --- Startscreen-Einbindung --------------------------------------------------

function fakeRenderer() {
  return {
    width: 800,
    height: 600,
    texts: [],
    beginFrame() { this.texts = []; },
    drawText(s) { this.texts.push(s); },
    drawPolylines() {},
    renderScene() {},
    worldToScreen() { return { x: 400, y: 300 }; },
    pushSway() {},
    popSway() {},
    pushShatter() {},
    popShatter() {},
    flash() { this.flashed = true; },
  };
}

function advance(game, renderer, seconds, dt = 1 / 60) {
  let elapsed = 0;
  while (elapsed < seconds) {
    game.update(dt);
    renderer.beginFrame();
    game.render(renderer);
    elapsed += dt;
  }
}

test('Boot-Titel: laeuft beim Laden einmal, 1980 zeichnet beide Woerter', () => {
  const g = new Game();
  const r = fakeRenderer();
  assert.equal(g.current.viewState().titleT, 0, 'Titel steht sofort an');
  advance(g, r, 0.2);
  assert.ok(r.texts.includes('SPACE') && r.texts.includes('MAZE'),
    'beide Woerter einzeln gesetzt (halbe Luecke)');
  assert.ok(!r.texts.some((s) => /^LEVEL \d+$/.test(String(s))),
    'Level-Auswahl weicht dem Titel');
  advance(g, r, TITLE.dur);
  assert.equal(g.current.viewState().titleT, null, 'Boot-Titel vorbei');
  advance(g, r, 0.1);
  assert.ok(r.texts.some((s) => /^LEVEL \d+$/.test(String(s))),
    'danach wieder die normale Level-Auswahl');
});

test('jede Taste raeumt den Titel weg; S startet mitten im Titel durch', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.handleKey('ArrowRight');
  assert.equal(g.current.viewState().titleT, null, 'Pfeiltaste beendet den Titel');

  const g2 = new Game();
  g2.handleKey('S');
  advance(g2, r, 0.1);
  assert.equal(g2.current.viewState().phase, 'docking', 'S dockt sofort an');
});

test('Attract-Beginn nach 30s Idle: Titel zuerst, eine Taste bricht ab', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.handleKey('X'); // Boot-Titel weg, Idle-Uhr definiert auf 0
  advance(g, r, 30.5); // Idle-Schwelle
  const v = g.current.viewState();
  assert.ok(v.titleT != null, 'die Attract-Sequenz beginnt mit dem Titel');
  assert.equal(g.demo, false, 'die Demo selbst startet erst nach der Sequenz');

  g.handleKey('ArrowLeft'); // Spieler ist da: Sequenz abbrechen
  assert.equal(g.current.viewState().titleT, null);
  advance(g, r, 2);
  assert.equal(g.demo, false, 'keine Demo direkt nach dem Abbruch');
  assert.equal(g.stateKey, State.STARTSCREEN);
});
