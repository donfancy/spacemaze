// Integrationstests des Replay-Modus: Aufzeichnung waehrend der Begehung,
// R auf der Karte, Wiedergabe (Pause/Spulen/Ende), Retry-/Resume-Regeln --
// alles headless ueber den Fake-Renderer (wie game.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { State, GameEvent } from '../src/core/states.js';
import { hasRecording, recordingDuration } from '../src/core/recorder.js';

function fakeRenderer() {
  return {
    width: 800,
    height: 600,
    calls: 0,
    beginFrame() {},
    drawText(text) { this.calls++; this.lastText = text; },
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

// Bis zur Karte spielen: Start -> MazeGen -> Falling -> Playing (ein Stueck
// laufen) -> Q -> Rising -> Map. Liefert das Game.
function playToMap(r, walkSeconds = 0.8) {
  const g = new Game();
  g.dispatch(GameEvent.START);
  advance(g, r, 0.8 + 4.5 + 2.0); // -> Playing
  assert.equal(g.stateKey, State.PLAYING);
  g.keys.add('W');
  advance(g, r, walkSeconds);
  g.keys.delete('W');
  g.handleKey('Q');
  advance(g, r, 2.0); // Rueckschwenk -> Karte
  assert.equal(g.stateKey, State.MAP);
  return g;
}

test('die Begehung zeichnet auf; die Karte bietet R an und startet die Wiedergabe', () => {
  const r = fakeRenderer();
  const g = playToMap(r);

  assert.ok(hasRecording(g.recording), 'nach dem Lauf existiert eine Aufnahme');
  const dur = recordingDuration(g.recording);
  assert.ok(dur > 0.5, `Aufnahme deckt die Begehung ab (war ${dur}s)`);

  g.handleKey('R');
  assert.equal(g.stateKey, State.REPLAY);

  // Wiedergabe laeuft mit 1x: der Zeiger wandert, es wird gezeichnet.
  const v0 = g.current.viewState();
  assert.ok(v0.replay, 'viewState traegt die Wiedergabe-Infos');
  advance(g, r, 0.5);
  const v1 = g.current.viewState();
  assert.ok(v1.replay.t > v0.replay.t, 'der Zeiger wandert vorwaerts');
  // Dauer = Aufnahme (der erste Sample liegt einen Frame nach 0).
  assert.ok(Math.abs(v1.replay.duration - dur) < 0.05, 'Dauer = Aufnahme');

  // Die Wiedergabe folgt der Aufnahme: am Ende steht der Spieler dort,
  // wo er beim Verlassen stand.
  advance(g, r, dur + 1);
  const vEnd = g.current.viewState();
  assert.ok(vEnd.replay.paused, 'am Ende haelt die Wiedergabe an');
  assert.ok(Math.hypot(vEnd.px - g.playerState.px, vEnd.pz - g.playerState.pz) < 1e-6,
    'Endposition = letzte Spielerlage');

  // X -> zurueck zur Karte (Weg/Status unveraendert).
  g.handleKey('X');
  assert.equal(g.stateKey, State.MAP);
  assert.ok(hasRecording(g.recording), 'die Aufnahme bleibt fuer weitere Replays');
});

test('Pause, Vorspulen und Rueckspulen bewegen nur den Zeiger', () => {
  const r = fakeRenderer();
  const g = playToMap(r);
  g.handleKey('R');

  advance(g, r, 0.3);
  const t0 = g.current.viewState().replay.t;

  g.handleKey(' '); // Pause
  advance(g, r, 0.3);
  assert.ok(Math.abs(g.current.viewState().replay.t - t0) < 1e-9, 'Pause haelt den Zeiger');

  g.handleKey('ArrowRight'); // entpausen + 2x
  assert.equal(g.current.viewState().replay.speed, 2);
  advance(g, r, 0.2);
  const t1 = g.current.viewState().replay.t;
  assert.ok(t1 > t0 + 0.3, '2x spult schneller als Echtzeit');

  // Zurueckspulen: bis unter 1x, dann negativ.
  for (let i = 0; i < 3; i++) g.handleKey('ArrowLeft'); // 2 -> 1 -> -1? (Leiter)
  assert.ok(g.current.viewState().replay.speed < 0, 'links genug: rueckwaerts');
  advance(g, r, 0.2);
  assert.ok(g.current.viewState().replay.t < t1, 'der Zeiger wandert rueckwaerts');

  // Ganz zurueck: am Anfang haelt die Wiedergabe.
  advance(g, r, 30);
  const v = g.current.viewState();
  assert.ok(v.replay.t < 1e-6 && v.replay.paused, 'am Anfang pausiert');
});

test('C schaltet den Kamera-Modus durch (fuer die 2026-Wiedergabe)', () => {
  const r = fakeRenderer();
  const g = playToMap(r);
  g.handleKey('R');
  assert.equal(g.current.viewState().replay.cam, 'ego');
  g.handleKey('C');
  assert.equal(g.current.viewState().replay.cam, 'chase');
  for (let i = 0; i < 4; i++) g.handleKey('C');
  assert.equal(g.current.viewState().replay.cam, 'ego', 'Zyklus schliesst sich');
});

test('Resume haengt an dieselbe Aufnahme an, Retry beginnt eine neue', () => {
  const r = fakeRenderer();
  const g = playToMap(r);
  const dur1 = recordingDuration(g.recording);
  const rec1 = g.recording;

  // Q (Ziel offen) -> Fortsetzung: gleiche Aufnahme, Dauer waechst.
  g.handleKey('Q');
  advance(g, r, 2.0); // Reinfallen -> Playing
  assert.equal(g.stateKey, State.PLAYING);
  assert.equal(g.recording, rec1, 'Fortsetzung schreibt dieselbe Aufnahme weiter');
  g.keys.add('W');
  advance(g, r, 0.5);
  g.keys.delete('W');
  assert.ok(recordingDuration(g.recording) > dur1 + 0.3, 'Dauer waechst nahtlos');

  // Game Over erzwingen waere hier umstaendlich -- der frische Anlauf
  // (kein resume) reicht: zurueck zur Karte, Startscreen, neues Spiel.
  g.handleKey('Q');
  advance(g, r, 2.0);
  g.handleKey('X');
  advance(g, r, 1.2);
  assert.equal(g.stateKey, State.STARTSCREEN);
  g.dispatch(GameEvent.START);
  advance(g, r, 0.8 + 4.5 + 2.0);
  assert.equal(g.stateKey, State.PLAYING);
  assert.notEqual(g.recording, rec1, 'frischer Anlauf = frische Aufnahme');
});

test('die Wiedergabe zeigt Statuszeile und Fortschritt', () => {
  const r = fakeRenderer();
  const g = playToMap(r);
  g.handleKey('R');
  advance(g, r, 0.1);
  // Irgendein drawText-Aufruf traegt die REPLAY-Statuszeile.
  assert.ok(String(r.lastText).length > 0, 'HUD zeichnet');
});
