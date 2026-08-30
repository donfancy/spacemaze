// Integrationstests des Attract-Mode (Animate): nach Idle startet eine
// Autopilot-Demo (ohne Controls, Overlay bleibt), Pfeiltasten aendern nur
// die Auswahl, S springt ueber die heilende Karte ins normale Fraesen des
// gewaehlten Levels, der Zyklus laeuft weiter -- headless wie game.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { State, GameEvent } from '../src/core/states.js';
import { displayLevel } from '../src/core/hud.js';

function fakeRenderer() {
  return {
    width: 800,
    height: 600,
    calls: 0,
    texts: [],
    beginFrame() { this.texts = []; },
    drawText(text) { this.calls++; this.texts.push(text); },
    drawPolylines() { this.calls++; },
    renderScene() { this.calls++; },
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

// Bis in die Demo-Ego-Ansicht laufen lassen (Idle 30s -> Andocken ->
// MazeGen -> Reinfallen -> Playing).
function idleIntoDemo(g, r) {
  advance(g, r, 31); // Idle-Schwelle + Andock-Beginn
  assert.equal(g.demo, true, 'nach 30s Idle laeuft die Demo');
  for (let t = 0; t < 40 && g.stateKey !== State.PLAYING; t += 0.5) advance(g, r, 0.5);
  assert.equal(g.stateKey, State.PLAYING, 'die Demo erreicht die Ego-Ansicht');
}

test('nach 30s Idle startet die Demo: Autopilot faehrt, Overlay bleibt', () => {
  const g = new Game();
  const r = fakeRenderer();
  assert.equal(g.demo, false);
  advance(g, r, 20);
  assert.equal(g.demo, false, 'vor der Schwelle keine Demo');

  idleIntoDemo(g, r);
  assert.notEqual(g.level, 1, 'die Demo spielt ein Level aus der Rotation');
  assert.equal(g.demoSavedLevel, 1, 'die Auswahl des Spielers bleibt gemerkt');
  assert.equal(displayLevel(g), 1, 'angezeigt wird die AUSWAHL, nicht das Demo-Level');

  // Der Autopilot bewegt den Spieler ohne jede User-Taste.
  const start = { ...g.playerState };
  advance(g, r, 2);
  assert.ok(Math.hypot(g.playerState.px - start.px, g.playerState.pz - start.pz) > 0.01,
    'der Autopilot faehrt los');

  // Das Demo-Overlay wird ueber der Ego-Szene gezeichnet (PRESS S blinkt).
  advance(g, r, 0.2);
  assert.ok(r.texts.some((t) => String(t).startsWith('LEVEL ')), 'LEVEL-Zeile im Overlay');
  assert.ok(r.texts.some((t) => t === '1980'), 'Engine-Schalter im Overlay');
});

test('Pfeiltasten in der Demo aendern nur die Auswahl, Q/X tun nichts', () => {
  const g = new Game();
  const r = fakeRenderer();
  idleIntoDemo(g, r);
  const demoLevel = g.level;

  g.handleKey('ArrowRight');
  g.handleKey('ArrowRight');
  assert.equal(g.demoSavedLevel, 3, 'Auswahl wandert auf 3');
  assert.equal(g.level, demoLevel, 'das Demo-Level bleibt unberuehrt');
  assert.equal(displayLevel(g), 3);

  g.handleKey('Q'); // keine Controls in der Demo
  advance(g, r, 0.1);
  assert.equal(g.stateKey, State.PLAYING, 'Q wird in der Demo geschluckt');
});

test('S in der Demo: Karte heilt zu, dann Fraesen des GEWAEHLTEN Levels', () => {
  const g = new Game();
  const r = fakeRenderer();
  idleIntoDemo(g, r);
  g.handleKey('ArrowRight'); // Auswahl: Level 2
  g.handleKey('S');
  assert.equal(g.demo, false, 'S beendet die Demo');
  assert.equal(g.level, 2, 'zurueck zur Auswahl');
  advance(g, r, 0.1);
  assert.equal(g.stateKey, State.RISING, 'aus der Ego-Demo hinauf zur Karte');
  advance(g, r, 2.0);
  assert.equal(g.stateKey, State.MAP, 'Karte erreicht');
  advance(g, r, 1.2); // EXIT_FADE (Flaeche heilt) -> Fraesen
  assert.equal(g.stateKey, State.MAZE_GEN, 'das gewaehlte Level waechst');
  assert.equal(g.maze.n, 11, 'Level 2 -> n=11');
  assert.equal(g.demoStart, false, 'demoStart ist verbraucht');
});

test('der Demo-Zyklus laeuft weiter: Karte -> Orbit -> naechste Demo', () => {
  const g = new Game();
  const r = fakeRenderer();
  idleIntoDemo(g, r);
  const firstDemoLevel = g.level;

  // Demo-Lauf abkuerzen: direkt abheben (statt das Ziel abzuwarten).
  g.dispatch(GameEvent.EXIT);
  advance(g, r, 2.0);
  assert.equal(g.stateKey, State.MAP);
  assert.equal(g.demo, true, 'die Demo laeuft auf der Karte weiter');

  advance(g, r, 6.5); // DEMO_AUTO_EXIT (5s) + Ausblenden -> Abdocken
  assert.equal(g.stateKey, State.STARTSCREEN);
  assert.equal(g.demo, true, 'der Zyklus haelt die Demo am Leben');

  // Abdock-Flug (~1.6s) + kurze Schleifen-Pause (7s) -> naechste Demo.
  for (let t = 0; t < 15 && g.stateKey !== State.MAZE_GEN; t += 0.5) advance(g, r, 0.5);
  assert.equal(g.stateKey, State.MAZE_GEN, 'die naechste Demo beginnt von selbst');
  assert.notEqual(g.level, firstDemoLevel, 'die Rotation nimmt das naechste Demo-Level');
});

test('normales Spielen bleibt unberuehrt: Tasten verhindern die Demo', () => {
  const g = new Game();
  const r = fakeRenderer();
  advance(g, r, 20);
  g.handleKey('ArrowRight'); // Aktivitaet -> Idle-Uhr auf 0
  advance(g, r, 20);
  assert.equal(g.demo, false, 'keine Demo, solange Tasten kommen');
  g.handleKey('S');
  advance(g, r, 1.8);
  assert.equal(g.stateKey, State.MAZE_GEN);
  assert.equal(g.demo, false);
  assert.equal(g.level, 2);
});
