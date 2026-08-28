// Tests der Engine-Naht (PLAN2026.md, Stufe 0): die Wahl aus dem URL-Query
// (core/engine.js, pur) und der Render-Dispatch in game.render() -- die
// 2026-Engine haengt als injiziertes Backend dran, exakt wie audio; der
// Core beruehrt Three.js nie.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEngine, resolveEngine, otherEngine, ENGINES, ENGINE_1980, ENGINE_2026,
} from '../src/core/engine.js';
import { Game, GameEvent } from '../src/core/game.js';
import { State } from '../src/core/states.js';

test('parseEngine: Standard ist 1980, ?engine=2026 schaltet um', () => {
  assert.equal(parseEngine(''), ENGINE_1980);
  assert.equal(parseEngine('?debug'), ENGINE_1980);
  assert.equal(parseEngine('?engine=1980'), ENGINE_1980);
  assert.equal(parseEngine('?engine=2026'), ENGINE_2026);
  assert.equal(parseEngine('?debug&engine=2026'), ENGINE_2026);
});

test('parseEngine: unbekannte Werte fallen sicher auf 1980 zurueck', () => {
  assert.equal(parseEngine('?engine=2027'), ENGINE_1980);
  assert.equal(parseEngine('?engine='), ENGINE_1980);
  assert.equal(parseEngine('?engine=Quatsch'), ENGINE_1980);
  assert.equal(ENGINES.length, 2);
});

// Renderer-Attrappe: zaehlt, ob die 1980-Zeichnung angefasst wurde.
function fakeRenderer() {
  return {
    width: 800, height: 600, calls: 0,
    beginFrame() {},
    drawText() { this.calls++; }, drawPolylines() { this.calls++; },
    renderScene() { this.calls++; },
    worldToScreen() { return { x: 400, y: 300 }; },
    pushSway() {}, popSway() {}, pushShatter() {}, popShatter() {}, flash() {},
  };
}

test('Game: Engine-Standard ist 1980, klassische Zeichnung laeuft', () => {
  const game = new Game({});
  assert.equal(game.engine, ENGINE_1980);
  const r = fakeRenderer();
  game.render(r);
  assert.ok(r.calls > 0, 'Startscreen muss auf dem 1980-Renderer zeichnen');
});

test('Game: engine 2026 mit Backend -> NUR das Backend zeichnet', () => {
  const backend = { frames: [], render(g) { this.frames.push(g.stateKey); } };
  const game = new Game({ engine: ENGINE_2026, renderBackend: backend });
  const r = fakeRenderer();
  game.render(r);
  game.render(r);
  assert.deepEqual(backend.frames, ['STARTSCREEN', 'STARTSCREEN']);
  assert.equal(r.calls, 0, '1980-Renderer darf nicht angefasst werden');
  assert.equal(r.color, undefined, 'auch die Farb-Zuweisung bleibt aus');
});

test('Game: engine 2026 OHNE Backend faellt sicher auf 1980 zurueck', () => {
  const game = new Game({ engine: ENGINE_2026 });
  const r = fakeRenderer();
  game.render(r);
  assert.ok(r.calls > 0, 'ohne Backend muss die klassische Zeichnung laufen');
});

// Simuliert Spielzeit in ~16ms-Schritten (wie game.test.js, ohne Rendern --
// die Lese-Schnittstelle haengt nur an update()).
function advance(game, seconds, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) game.update(dt);
}

// Stufe 1: die Playing-Szene gibt ihren privaten Zeichen-Zustand ueber eine
// kleine Lese-Schnittstelle frei -- daraus zeichnet die 2026-Engine.
test('Playing: viewState() gibt die Ego-Lage fuer die 2026-Engine frei', () => {
  const g = new Game();
  g.dispatch(GameEvent.START);
  advance(g, 0.8 + 4.5 + 2.0); // -> MazeGen -> Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);

  const view = g.current.viewState();
  assert.equal(view.maze, g.maze, 'dasselbe Maze-Objekt wie der Core');
  assert.ok(view.cell > 0 && view.unit > 0, 'Massstaebe vorhanden');
  assert.equal(view.px, g.playerState.px);
  assert.equal(view.pz, g.playerState.pz);
  assert.equal(view.yaw, g.playerState.yaw);
  assert.equal(view.reached, false);
  assert.equal(view.bump, null, 'noch keine Wand beruehrt');
});

test('Playing: Wand-Auftreffen landet als Flanke in viewState().bump', () => {
  const g = new Game();
  g.dispatch(GameEvent.START);
  advance(g, 0.8 + 4.5 + 2.0);
  assert.equal(g.stateKey, State.PLAYING);

  // Stur geradeaus laufen: spaetestens an der Labyrinth-Grenze steht eine
  // Wand frontal im Weg (Blick ist beim Start achsparallel).
  g.keys.add('W');
  let view = null;
  for (let t = 0; t < 15 && !view?.bump; t += 1 / 60) {
    g.update(1 / 60);
    view = g.current.viewState();
  }
  g.keys.delete('W');

  const b = view.bump;
  assert.ok(b, 'Wand-Beruehrung wurde aufgezeichnet');
  assert.ok(b.axis === 'x' || b.axis === 'z');
  assert.ok(Math.abs(b.side) === 1, 'side ist die Anlauf-Richtung');
  assert.ok(b.impact > 0 && b.impact <= 1, 'Wucht als Anteil des Gehtempos');
  assert.ok(b.at <= view.sceneT, 'Zeitstempel liegt in der Szenenzeit');
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z), 'Ort des Auftreffens');
});

// Stufe 2: im Fahrt-Modus kommen drive/roll/pitch dazu, und die Kollisions-
// Flanke traegt den exakten Wand-Auftreffpunkt (fuer Blitz + Funken).
test('Playing (Fahrt, Level 6): viewState mit drive/roll/pitch und Auftreffpunkt', () => {
  const g = new Game();
  g.level = 6;
  g.dispatch(GameEvent.START);
  advance(g, 0.8 + 4.5 + 2.0); // -> MazeGen -> Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);

  let view = g.current.viewState();
  assert.equal(view.drive, true);
  assert.ok(Number.isFinite(view.roll) && Number.isFinite(view.pitch));

  // Das Auto faehrt von selbst -- ohne Lenkung prallt es spaetestens an der
  // ersten Kurve ab (Feder-Impuls); auf die Flanke warten.
  for (let t = 0; t < 20 && !view.bump; t += 1 / 60) {
    g.update(1 / 60);
    view = g.current.viewState();
  }
  const b = view.bump;
  assert.ok(b, 'Fahrt-Aufprall wurde aufgezeichnet');
  assert.ok(Array.isArray(b.point) && b.point.every(Number.isFinite),
    'Fahrt-Flanke traegt den Wand-Auftreffpunkt');
  assert.ok(b.impact >= 0.3, 'unter minImpact gibt es keine Flanke');

  // Der Aufprall stoesst die Oszillatoren an: der Roll schwingt danach echt.
  let maxRoll = 0;
  for (let t = 0; t < 0.4; t += 1 / 60) {
    g.update(1 / 60);
    maxRoll = Math.max(maxRoll, Math.abs(g.current.viewState().roll));
  }
  assert.ok(maxRoll > 1e-4, 'rollOsc/bank erreichen die 2026-Kamera');
});

// Stufe 4: Kampf-Naht -- Schuesse, Fadenkreuz-Lenkgroesse und die Splitter-
// Explosionen liegen im viewState (die Tanker liest die Engine von
// game.enemies, dort leben sie samt Resume/Retry-Regeln).
test('Playing (Kampf, Level 11): viewState mit Schuessen und Bursts', () => {
  const g = new Game();
  g.level = 11;
  g.dispatch(GameEvent.START);
  advance(g, 0.8 + 4.5 + 2.0); // -> MazeGen -> Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);
  assert.ok(g.enemies?.length > 0, 'MazeGen hat die Tanker gewuerfelt');

  let view = g.current.viewState();
  assert.equal(view.shoot, true);
  assert.ok(Number.isFinite(view.steer), 'gerampte Lenkgroesse fuers Fadenkreuz');
  assert.deepEqual(view.shots, []);
  assert.equal(view.crash, null);

  // Space-Dauerfeuer: Projektile erscheinen im viewState; spaetestens an der
  // ersten Wand verpufft eines als Splitter-Explosion (view.bursts).
  g.keys.add(' ');
  let sawShot = false;
  let burst = null;
  for (let t = 0; t < 6 && !(sawShot && burst); t += 1 / 60) {
    g.update(1 / 60);
    view = g.current.viewState();
    if (view.shots.length > 0) sawShot = true;
    if (!burst && view.bursts.length > 0) [burst] = view.bursts;
  }
  g.keys.delete(' ');
  assert.ok(sawShot, 'Projektile liegen im viewState');
  assert.ok(burst, 'Verpuffen/Abschuss erzeugt eine Splitter-Explosion');
  assert.ok(burst.center.length === 3 && burst.center.every(Number.isFinite));
  assert.ok(burst.life > 0 && typeof burst.color === 'string',
    'die Explosion ist eine vollstaendige burst.js-Spezifikation');
});

test('Playing (Kampf): Feindberuehrung setzt crash im viewState und Game Over', () => {
  const g = new Game();
  g.level = 11;
  g.dispatch(GameEvent.START);
  advance(g, 0.8 + 4.5 + 2.0);
  assert.equal(g.stateKey, State.PLAYING);

  // Einen Tanker direkt auf die Spielerlage setzen: der naechste Schritt
  // ist die Beruehrung -- deterministisch, ohne dorthin steuern zu muessen.
  const foe = g.enemies[0];
  foe.patrol = null;
  foe.x = g.playerState.px;
  foe.z = g.playerState.pz;
  g.update(1 / 60);

  const view = g.current.viewState();
  assert.ok(view.crash, 'Crash-Zustand liegt im viewState');
  assert.ok(view.crash.t >= 0, 'Crash-Alter fuer den weissen Blitz');
  assert.ok([view.crash.x, view.crash.z].every(Number.isFinite), 'Einschlagsort');
  assert.equal(g.gameOver, true);
  assert.equal(foe.alive, false, 'die Beruehrung reisst den Tanker mit');
  assert.ok(view.bursts.length >= 2, 'Crash-Explosion (zwei Splitter-Wuerfe)');
  assert.ok(view.bursts[0].shardCount > 0,
    'der Crash-Burst traegt die Truemmer-Spezifikation (burstShards, 2026)');

  // Der Shake erreicht die 2026-Kamera echt ueber roll/pitch (Oszillatoren).
  let maxRoll = 0;
  for (let t = 0; t < 0.3; t += 1 / 60) {
    g.update(1 / 60);
    const v = g.current.viewState();
    maxRoll = Math.max(maxRoll, Math.abs(v.roll), Math.abs(v.pitch));
  }
  assert.ok(maxRoll > 1e-4, 'Crash-Kick der Oszillatoren kommt an');

  // Nach CRASH_TIME schleudert es hinaus in den (schnellen) Rueckschwenk.
  advance(g, 1.2);
  assert.equal(g.stateKey, State.RISING);
});

// Stufe 5: der Gyro-Roll (Pulsar-Beruehrung) erreicht die 2026-Kamera als
// ECHTER Roll ueber viewState().roll und rastet im 90-Grad-Raster ein;
// foeShots und orient (Steuer-Hinweiszeile) liegen ebenfalls in der Naht.
test('Playing (Level 26): Pulsar-Beruehrung rotiert view.roll und rastet ein', () => {
  const g = new Game();
  g.level = 26;
  g.dispatch(GameEvent.START);
  advance(g, 0.8 + 4.5 + 2.0);
  assert.equal(g.stateKey, State.PLAYING);
  assert.ok(g.pulsars?.length > 0, 'Level 26 hat Pulsare');
  let view = g.current.viewState();
  assert.ok(Array.isArray(view.foeShots), 'foeShots liegen im viewState');
  assert.equal(view.orient, 0, 'aufrecht gestartet');

  // Andere Feinde stilllegen (die Auto-Fahrt soll nicht crashen) und den
  // ersten Pulsar quer in den Fahrweg legen: der naechste Schritt kreuzt
  // seine Querschnitts-Ebene -- deterministisch, ohne dorthin zu steuern.
  for (const e of g.enemies ?? []) e.alive = false;
  for (const s of g.spinners ?? []) s.alive = false;
  for (const f of g.flippers ?? []) f.alive = false;
  const s0 = g.playerState;
  const axis = Math.abs(Math.sin(s0.yaw)) > 0.5 ? 'x' : 'z';
  const fwd = axis === 'x' ? -Math.sin(s0.yaw) : -Math.cos(s0.yaw);
  const p = g.pulsars[0];
  p.axis = axis;
  p.cross = axis === 'x' ? s0.pz : s0.px;
  p.along = (axis === 'x' ? s0.px : s0.pz) + fwd * 0.3 * view.cell;
  p.armed = true;

  let maxRoll = 0;
  for (let t = 0; t < 3.0; t += 1 / 60) {
    g.update(1 / 60);
    view = g.current.viewState();
    maxRoll = Math.max(maxRoll, Math.abs(view.roll));
  }
  // bank/rollOsc allein bleiben weit unter 1 rad -- ueber 1 ist nur der Gyro.
  assert.ok(maxRoll > 1.0, 'die Rotation erreicht die Kamera: ' + maxRoll);
  const rest = Math.abs(view.roll % (Math.PI / 2));
  assert.ok(Math.min(rest, Math.PI / 2 - rest) < 0.15,
    'roll rastet im 90-Grad-Raster ein: ' + view.roll);
});

// Stufe 3: Vorrang-Regel des Schalters -- URL vor gemerkter Wahl vor Default.
test('resolveEngine: URL-Parameter vor localStorage vor Default', () => {
  assert.equal(resolveEngine('', null), ENGINE_1980);
  assert.equal(resolveEngine('', ENGINE_2026), ENGINE_2026);
  assert.equal(resolveEngine('?engine=1980', ENGINE_2026), ENGINE_1980);
  assert.equal(resolveEngine('?engine=2026', ENGINE_1980), ENGINE_2026);
  assert.equal(resolveEngine('?engine=Quatsch', 'Unsinn'), ENGINE_1980);
  assert.equal(otherEngine(ENGINE_1980), ENGINE_2026);
  assert.equal(otherEngine(ENGINE_2026), ENGINE_1980);
});

// Stufe 3: Startscreen-Tasten -- links/rechts Level, hoch/runter Engine.
test('Startscreen: ArrowLeft/Right waehlen das Level, ArrowUp/Down die Engine', () => {
  const g = new Game();
  assert.equal(g.stateKey, State.STARTSCREEN);
  const level = g.level;
  g.handleKey('ArrowRight');
  assert.equal(g.level, level + 1);
  g.handleKey('ArrowLeft');
  assert.equal(g.level, level);
  assert.equal(g.engine, ENGINE_1980);
  g.handleKey('ArrowUp');
  assert.equal(g.engine, ENGINE_2026, 'hoch schaltet auf 2026');
  g.handleKey('ArrowUp');
  assert.equal(g.engine, ENGINE_2026, 'nochmal hoch bleibt 2026');
  g.handleKey('ArrowDown');
  assert.equal(g.engine, ENGINE_1980, 'runter schaltet auf 1980');
  assert.equal(g.level, level, 'der Schalter laesst das Level in Ruhe');
});

// Stufe 3: Lese-Schnittstellen der Zyklus-Szenen fuer die 2026-Engine.
test('Startscreen: viewState liefert Orbit-Pose und Dock-Fortschritt', () => {
  const g = new Game();
  g.update(0.5);
  let v = g.current.viewState();
  assert.equal(v.phase, 'orbiting');
  assert.ok(v.pose.position.every(Number.isFinite));
  assert.ok(Number.isFinite(v.pose.yaw) && Number.isFinite(v.pose.pitch));
  assert.equal(v.color, null, 'im Orbit gilt die Grundfarbe');

  g.handleKey('S');
  g.update(0.4);
  v = g.current.viewState();
  assert.equal(v.phase, 'docking');
  assert.ok(v.p > 0 && v.p < 1, 'Andock-Flug laeuft');
  assert.ok(typeof v.color === 'string', 'Blend-Farbe Richtung Level-Thema');
});

test('MazeGen: viewState liefert die Wachstums-Kurven', () => {
  const g = new Game();
  g.dispatch(GameEvent.START);
  advance(g, 0.8); // Fade -> MAZE_GEN
  assert.equal(g.stateKey, State.MAZE_GEN);
  g.update(0.5);
  const v = g.current.viewState();
  assert.equal(v.maze, g.maze);
  assert.ok(v.markerFade > 0, 'S/G blenden ein');
  assert.ok(v.growCount >= 0 && v.growCount <= g.maze.order.length);
  advance(g, 1.5); // mitten im Wachstum
  const v2 = g.current.viewState();
  assert.ok(v2.growCount > v.growCount, 'die Kontur frisst sich hinein');
  assert.ok(v2.growT > 0 && v2.growT < 1);
});

test('Falling/Rising/Map: viewState traegt Schwenk-Fortschritt und Ziellage', () => {
  const g = new Game();
  g.dispatch(GameEvent.START);
  advance(g, 0.8 + 4.4); // -> FALLING (MazeGen 4.3s + Reserve)
  assert.equal(g.stateKey, State.FALLING);
  g.update(0.5);
  const vf = g.current.viewState();
  assert.equal(vf.maze, g.maze);
  assert.ok(vf.e > 0 && vf.e < 1, 'Schwenk laeuft (geeaste Kurve)');
  assert.ok([vf.target.px, vf.target.pz, vf.target.yaw].every(Number.isFinite));
  assert.equal(vf.resume, false);

  advance(g, 2.0); // -> PLAYING
  assert.equal(g.stateKey, State.PLAYING);
  g.handleKey('Q'); // Abheben (Level 1: sofort)
  assert.equal(g.stateKey, State.RISING);
  g.update(0.5);
  const vr = g.current.viewState();
  assert.equal(vr.origin.px, g.playerState.px, 'Rueckschwenk startet an der Spielerlage');
  assert.ok(vr.e > 0 && vr.e < 1);

  advance(g, 1.5); // -> MAP
  assert.equal(g.stateKey, State.MAP);
  let vm = g.current.viewState();
  assert.equal(vm.fade, 1, 'Karte steht voll da');
  g.handleKey('X');
  g.update(0.45);
  vm = g.current.viewState();
  assert.ok(vm.fade < 1 && vm.fade > 0, 'Karten-Exit blendet aus');
});

test('Game: Backend sieht Szenenwechsel sofort (dispatch ist nahtlos)', () => {
  const seen = [];
  const backend = { render(g) { seen.push(g.stateKey); } };
  const game = new Game({ engine: ENGINE_2026, renderBackend: backend });
  game.render(fakeRenderer());
  game.dispatch(GameEvent.START);           // sofortiger Wechsel zum MazeGen
  game.render(fakeRenderer());
  assert.deepEqual(seen, ['STARTSCREEN', 'MAZE_GEN']);
});

test('Engine 1980 ignoriert ein injiziertes Backend (Naht-Gegentest)', () => {
  // Regressions-Schutz: der Dispatch in game.render prueft Engine UND
  // Backend -- verkuerzte ihn jemand auf "Backend vorhanden", bliebe
  // dieser Test nicht gruen.
  let backendCalls = 0;
  const backend = { render() { backendCalls++; } };
  const game = new Game({ engine: ENGINE_1980, renderBackend: backend });
  const r = fakeRenderer();
  game.render(r);
  assert.equal(backendCalls, 0, 'das Backend wird NICHT gerufen');
  assert.ok(r.calls > 0, 'die 1980-Zeichnung laeuft');
});
