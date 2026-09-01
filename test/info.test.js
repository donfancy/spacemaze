// Info-Seite "HOW TO PLAY" (core/hud.js + Startscreen): I blendet sie im
// Orbit ein, I/X schliessen, Andocken raeumt sie weg; manuell geoeffnet
// haelt sie die Attract-Uhr an, der Attract-Mode zeigt sie automatisch
// in der Orbit-Pause zwischen den Demos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { State } from '../src/core/states.js';
import { INFO_TITLE, INFO_LINES } from '../src/core/hud.js';
import { TITLE } from '../src/world/title.js';

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
    flash() {},
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

test('INFO_LINES folgen der Tasten-Stringenz: S/X/R/I sind erklaert', () => {
  assert.equal(INFO_TITLE, 'HOW TO PLAY');
  const keys = INFO_LINES.map(([k]) => k);
  for (const k of ['ARROWS', 'SPACE', 'S', 'X', 'R', 'M', 'I']) {
    assert.ok(keys.includes(k), `Taste ${k} wird erklaert`);
  }
  assert.ok(!keys.includes('Q'), 'Q existiert nicht mehr');
});

test('I oeffnet die Info-Seite im Orbit, I und X schliessen sie', () => {
  const g = new Game();
  const r = fakeRenderer();
  assert.equal(g.current.viewState().info, false, 'startet zu');

  g.handleKey('I');
  advance(g, r, 0.05);
  assert.equal(g.current.viewState().info, true, 'I oeffnet');
  assert.ok(r.texts.includes(INFO_TITLE), '1980 zeichnet den Titel');
  assert.ok(!r.texts.some((s) => /^LEVEL \d+$/.test(String(s))),
    'Level-Auswahl weicht der Info-Seite');

  g.handleKey('I');
  assert.equal(g.current.viewState().info, false, 'I schliesst (Toggle)');

  g.handleKey('I');
  g.handleKey('X');
  assert.equal(g.current.viewState().info, false, 'X schliesst (Exit-Regel)');
  assert.equal(g.stateKey, State.STARTSCREEN, 'X verlaesst den Startscreen nicht');
});

test('Andocken raeumt die Info-Seite weg; S startet auch bei offener Seite', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.handleKey('I');
  g.handleKey('S');
  advance(g, r, 0.1);
  assert.equal(g.current.viewState().info, false, 'Flugphasen zeigen keine Info');
  advance(g, r, 2.0);
  assert.equal(g.stateKey, State.MAZE_GEN, 'S startet normal durch');
});

test('offene Info-Seite haelt die Attract-Uhr an', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.handleKey('I');
  advance(g, r, 35, 0.1); // laenger als DEMO_IDLE (30 s)
  assert.equal(g.stateKey, State.STARTSCREEN, 'keine Demo waehrend des Lesens');
  assert.equal(g.demo, false);
  assert.equal(g.current.viewState().info, true, 'Seite steht noch');
});

test('Attract-Pause im Orbit: Ruhe, dann Titel, dann Info-Seite, dann Demo', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.beginDemo(); // Demo-Modus, Szene steht noch im Orbit
  advance(g, r, 0.1);
  let v = g.current.viewState();
  assert.equal(v.titleT, null, 'erst die RUHIGE Nur-Wuerfel-Zeit (kein Titel)');
  assert.equal(v.info, false, '... und keine Info');
  advance(g, r, 19); // mitten in der Ruhe (ORBIT_CALM 20 s): immer noch still
  v = g.current.viewState();
  assert.equal(v.titleT, null, 'die Ruhe traegt (Boris: 20 s Nur-Wuerfel-Zeit)');
  advance(g, r, 1.2); // ORBIT_CALM voll -> der Titel uebernimmt
  v = g.current.viewState();
  assert.ok(v.titleT != null, 'nach der Ruhe kommt der Titel');
  assert.equal(v.info, false, 'Info kommt erst nach dem Titel');
  advance(g, r, TITLE.dur); // Titel durchlaufen lassen
  v = g.current.viewState();
  assert.equal(v.titleT, null, 'Titel vorbei');
  // 1s Luecke vor der Info (Boris: "kommt hart"): noch keine Karte, aber
  // die Mitte bleibt verdraengt (hold) -- kein Text blitzt ein.
  assert.equal(v.info, false, 'erst eine Sekunde Luft');
  assert.equal(v.hold, true, 'die Attract-Sequenz haelt die Mitte frei');
  advance(g, r, 1.1); // INFO_GAP (1 s) vorbei
  v = g.current.viewState();
  assert.equal(v.info, true, 'jetzt steht die Info-Karte');
  advance(g, r, 0.6); // die 2026-Blende laeuft hoch (INFO_FADE 0.5 s)
  assert.ok(g.current.viewState().infoA > 0.95, 'Info voll eingeblendet (infoA)');
  advance(g, r, 5.1); // ATTRACT_INFO (6 s) laeuft ab -> Ausblende beginnt
  v = g.current.viewState();
  assert.equal(v.info, false, 'Info-Zeit vorbei');
  assert.equal(v.phase, 'orbiting', 'das Andocken wartet die Ausblende ab');
  advance(g, r, 0.6); // INFO_FADE (0.5 s) -> jetzt dockt die naechste Demo an
  assert.equal(g.current.viewState().phase, 'docking');
  assert.ok(g.current.viewState().infoA < 0.2, 'die Info ist ausgeblendet, nicht ausgeknipst');
});
