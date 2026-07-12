// Integrationstest des Zustands-Durchlaufs OHNE Browser: ein Fake-Renderer
// ersetzt das Canvas, sodass die komplette Verdrahtung (Game + Szenen + animierte
// Uebergaenge) headless laeuft. Genau das soll auch beim spaeteren Refactoring
// stabil bleiben.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { State, GameEvent } from '../src/core/states.js';
import { PHOSPHOR_GREEN, TEMPEST_BLUE } from '../src/render/colors.js';

// Renderer-Attrappe: bietet alle vom Spiel genutzten Methoden als No-Op an.
function fakeRenderer() {
  return {
    width: 800,
    height: 600,
    calls: 0,
    beginFrame() {},
    fillBlack() {},
    drawText() { this.calls++; },
    drawPolylines() { this.calls++; },
    renderScene(scene, camera, opts) { this.calls++; this.lastSceneColor = opts?.color; },
    worldToScreen() { return { x: 400, y: 300 }; },
    pushSway() {},
    popSway() {},
  };
}

// Simuliert `seconds` Spielzeit in realistischen ~16ms-Schritten inkl. Rendern.
function advance(game, renderer, seconds, dt = 1 / 60) {
  let elapsed = 0;
  while (elapsed < seconds) {
    game.update(dt);
    renderer.beginFrame();
    game.render(renderer);
    elapsed += dt;
  }
}

test('Spiel startet im Startscreen und rendert', () => {
  const g = new Game();
  const r = fakeRenderer();
  assert.equal(g.stateKey, State.STARTSCREEN);
  advance(g, r, 0.1);
  assert.ok(r.calls > 0, 'Startscreen sollte zeichnen');
});

test('S leitet die Andock-Sequenz ein; erst danach Uebergang zur Labyrinth-Erzeugung', () => {
  const g = new Game();
  const r = fakeRenderer();

  g.handleKey('X'); // irrelevante Taste -> nichts passiert
  advance(g, r, 0.1);
  assert.equal(g.stateKey, State.STARTSCREEN);
  assert.ok(!g.transition.active);

  g.handleKey('S');
  // Waehrend des Andockens (~1,6s) bleibt der Zustand Startscreen, kein Uebergang.
  advance(g, r, 0.3);
  assert.equal(g.stateKey, State.STARTSCREEN);
  assert.ok(!g.transition.active);

  // Nach dem Andocken folgt der Uebergang zur Labyrinth-Erzeugung.
  advance(g, r, 2.6);
  assert.equal(g.stateKey, State.MAZE_GEN);
});

test('Farb-Thema Level 6: Orbit gruen, Andocken blendet, ab MazeGen blau', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.level = 6;

  // Im Orbit bleibt alles gruen (Wuerfel ohne explizite Farbe -> Grundfarbe).
  advance(g, r, 0.1);
  assert.equal(r.color, PHOSPHOR_GREEN);
  assert.equal(r.lastSceneColor, undefined);

  // Mitten im Andocken (~1,6s): der Wuerfel blendet Richtung Blau --
  // weder noch gruen noch schon blau.
  g.handleKey('S');
  advance(g, r, 0.8);
  assert.ok(r.lastSceneColor, 'Andocken zeichnet mit expliziter Blend-Farbe');
  assert.notEqual(r.lastSceneColor, PHOSPHOR_GREEN);
  assert.notEqual(r.lastSceneColor, TEMPEST_BLUE);

  // Nach dem Andocken uebernimmt MazeGen -- Grundfarbe jetzt Tempest-blau.
  advance(g, r, 1.2);
  assert.equal(g.stateKey, State.MAZE_GEN);
  assert.equal(r.color, TEMPEST_BLUE);
});

test('Level 16: Spinner entstehen beim Spielstart und werden gerendert', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.level = 16;

  g.handleKey('S');
  advance(g, r, 1.8);  // Andocken -> MazeGen
  assert.equal(g.stateKey, State.MAZE_GEN);
  assert.ok(Array.isArray(g.spinners) && g.spinners.length > 0,
    'Spinner existieren schon auf der Start-Karte (MazeGen wuerfelt bei der Geburt)');
  advance(g, r, 6.0);  // Wachstum (n=35 dauert laenger) -> Reinfallen
  advance(g, r, 2.0);  // Schwenk -> Spielablauf
  assert.equal(g.stateKey, State.PLAYING);
  assert.ok(Array.isArray(g.spinners) && g.spinners.length > 0, 'Spinner erzeugt');
  assert.ok(g.spinners.every((s) => s.alive), 'alle Spinner leben am Start');
  assert.equal(g.enemies, null, 'Level 16 hat keine Rauten');

  // Ein paar Sekunden Spiel mit Dauerfeuer: nichts wirft, es wird gezeichnet.
  g.keys.add(' ');
  const before = r.calls;
  advance(g, r, 2.0);
  g.keys.delete(' ');
  assert.ok(r.calls > before, 'Spielablauf zeichnet weiter');
});

test('voller Zyklus Start -> (Andocken) -> MazeGen -> Playing -> Start', () => {
  const g = new Game();
  const r = fakeRenderer();

  g.handleKey('S');
  advance(g, r, 1.8); // Andocken (~1,6s) -> nahtlos (ohne Fade) MazeGen
  assert.equal(g.stateKey, State.MAZE_GEN);

  // MazeGen inszeniert Marker + Wachstum (~4,3s) -> Reinfallen.
  advance(g, r, 4.5);
  assert.equal(g.stateKey, State.FALLING);

  // Reinfall-Schwenk (~1,7s) -> Spielablauf.
  advance(g, r, 2.0);
  assert.equal(g.stateKey, State.PLAYING);

  // Playing rendert die 3D-Szene.
  r.calls = 0;
  advance(g, r, 0.1);
  assert.ok(r.calls > 0);

  // Q -> Rueckschwenk (nahtlos) -> Karte.
  g.handleKey('Q');
  advance(g, r, 0.1);
  assert.equal(g.stateKey, State.RISING);
  advance(g, r, 2.0);
  assert.equal(g.stateKey, State.MAP);

  // X auf der Karte -> Karte blendet aus (~0,9s), dann nahtlos Startscreen.
  g.handleKey('X');
  advance(g, r, 0.5);
  assert.equal(g.stateKey, State.MAP, 'waehrend des Ausblendens noch Karte');
  advance(g, r, 0.7);
  assert.equal(g.stateKey, State.STARTSCREEN);
});

test('Zustands-Zyklus direkt via dispatch (ohne Andocken)', () => {
  const g = new Game();
  const r = fakeRenderer();
  assert.equal(g.stateKey, State.STARTSCREEN);

  g.dispatch(GameEvent.START);
  advance(g, r, 0.8);
  assert.equal(g.stateKey, State.MAZE_GEN);

  advance(g, r, 4.5); // MazeGen -> Falling
  assert.equal(g.stateKey, State.FALLING);
  advance(g, r, 2.0); // Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);

  g.dispatch(GameEvent.EXIT);
  advance(g, r, 0.8);
  assert.equal(g.stateKey, State.RISING);
  advance(g, r, 2.0); // Rising -> Map
  assert.equal(g.stateKey, State.MAP);

  g.dispatch(GameEvent.EXIT);
  advance(g, r, 0.8);
  assert.equal(g.stateKey, State.STARTSCREEN);
});

test('Pfeiltasten waehlen das Level im Startscreen, begrenzt auf 1..20', () => {
  const g = new Game();
  assert.equal(g.level, 1);

  g.handleKey('ArrowDown'); // unter Level 1 geht es nicht
  assert.equal(g.level, 1);

  g.handleKey('ArrowRight');
  g.handleKey('ArrowUp');
  assert.equal(g.level, 3);

  for (let i = 0; i < 25; i++) g.handleKey('ArrowUp'); // oben begrenzt
  assert.equal(g.level, 20);
  g.handleKey('ArrowLeft');
  assert.equal(g.level, 19);
});

test('Kampf-Level 11: Feinde stehen, Beruehrung -> Crash -> GAME OVER -> Retry', () => {
  const g = new Game();
  const r = fakeRenderer();
  for (let i = 0; i < 10; i++) g.handleKey('ArrowUp'); // Level 11
  assert.equal(g.level, 11);

  g.dispatch(GameEvent.START);
  advance(g, r, 0.8);
  assert.equal(g.stateKey, State.MAZE_GEN);
  advance(g, r, 4.5); // MazeGen -> Falling
  advance(g, r, 2.0); // Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);

  // Feinde stehen: Level 11 hat 6 Rauten, alle lebendig.
  assert.equal(g.enemies.length, 6);
  assert.ok(g.enemies.every((e) => e.alive));

  // Space-Dauerfeuer laeuft ohne Fehler mit (Tempest-Logik ist unit-getestet).
  g.keys.add(' ');
  advance(g, r, 0.3);
  g.keys.delete(' ');

  // Feindberuehrung erzwingen: eine Raute auf die Spielerposition setzen.
  const victim = g.enemies[1];
  victim.x = g.playerState.px;
  victim.z = g.playerState.pz;
  advance(g, r, 0.1);
  assert.equal(g.gameOver, true, 'Crash setzt Game Over');
  assert.equal(victim.alive, false, 'die getroffene Raute zerplatzt');
  assert.equal(g.stateKey, State.PLAYING, 'die Explosion tobt noch');

  advance(g, r, 1.4); // Crash ausgetobt -> hinausgeschleudert
  assert.equal(g.stateKey, State.RISING);
  advance(g, r, 1.0); // schneller Crash-Schwenk (0.8s statt 1.7s)
  assert.equal(g.stateKey, State.MAP);
  assert.equal(g.gameOver, true, 'Karte zeigt GAME OVER');

  // Q auf der Karte: Retry -- frischer Fall zum Start, Feinde neu aufgestellt.
  g.handleKey('Q');
  assert.equal(g.stateKey, State.FALLING);
  assert.equal(g.resume, false, 'Retry ist KEINE Fortsetzung (zurueck auf S)');
  advance(g, r, 2.0);
  assert.equal(g.stateKey, State.PLAYING);
  assert.equal(g.gameOver, false);
  assert.equal(g.enemies.length, 6);
  assert.ok(g.enemies.every((e) => e.alive), 'alle Rauten leben wieder');
});

test('gewaehltes Level bestimmt die Maze-Groesse (Level 3 -> n=13)', () => {
  const g = new Game();
  const r = fakeRenderer();

  g.handleKey('ArrowUp');
  g.handleKey('ArrowUp'); // Level 3
  g.handleKey('S');
  advance(g, r, 1.8); // Andocken -> MazeGen erzeugt das Labyrinth
  assert.equal(g.stateKey, State.MAZE_GEN);
  assert.equal(g.maze.n, 13);
});

test('Level 6 (schmale Waende, Fahrt): faehrt von selbst los, gelenkt wird mit links/rechts', () => {
  const g = new Game();
  const r = fakeRenderer();

  for (let i = 0; i < 5; i++) g.handleKey('ArrowUp'); // Level 6
  g.handleKey('S');
  advance(g, r, 1.8); // Andocken -> MazeGen
  assert.equal(g.stateKey, State.MAZE_GEN);
  assert.equal(g.maze.n, 17);
  assert.equal(g.maze.metric.wall, 1);
  assert.equal(g.maze.metric.corridor, 5);

  advance(g, r, 4.5 + 2.0); // -> Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);

  // Automatischer Vortrieb: OHNE Tasten bewegt sich der Spieler.
  const [sx, sz] = g.trail[0];
  advance(g, r, 1.0);
  const end = g.trail[g.trail.length - 1];
  assert.ok(Math.hypot(end[0] - sx, end[1] - sz) > 0, 'faehrt ohne Eingabe los');

  // Lenken: links aendert den Kurs.
  const yawBefore = g.playerState.yaw;
  g.keys.add('ArrowLeft');
  advance(g, r, 0.3);
  g.keys.delete('ArrowLeft');
  assert.ok(g.playerState.yaw > yawBefore, 'links lenken erhoeht yaw');

  // Q im Fahrt-Modus: erst abbremsen (Zustand bleibt Playing), dann abheben.
  g.handleKey('Q');
  advance(g, r, 0.1);
  assert.equal(g.stateKey, State.PLAYING, 'direkt nach Q wird noch gebremst');
  advance(g, r, 1.0); // ausrollen (~0.4 s) + kurzer Halt (0.2 s) -> Abheben
  assert.equal(g.stateKey, State.RISING, 'nach dem Ausrollen hebt es ab');
});

test('Tank-Levels fahren NICHT von selbst (Level 1 bleibt stehen ohne Tasten)', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.dispatch(GameEvent.START);
  advance(g, r, 0.8 + 4.5 + 2.0); // -> MazeGen -> Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);
  const { px, pz } = g.playerState;
  advance(g, r, 1.0);
  assert.equal(g.playerState.px, px);
  assert.equal(g.playerState.pz, pz);
});

test('Pfeiltasten aendern das Level nur im Startscreen (nicht waehrend des Spiels)', () => {
  const g = new Game();
  const r = fakeRenderer();

  g.handleKey('S');
  advance(g, r, 1.8);
  assert.equal(g.stateKey, State.MAZE_GEN);
  g.handleKey('ArrowUp');
  assert.equal(g.level, 1);

  advance(g, r, 4.5 + 2.0); // -> Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);
  g.handleKey('ArrowUp');
  assert.equal(g.level, 1);
});

test('Playing zeichnet den Weg praezise auf (echte Positionen, Endpunkt beim Verlassen)', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.dispatch(GameEvent.START);
  advance(g, r, 0.8 + 4.5 + 2.0); // -> MazeGen -> Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);

  assert.equal(g.trail.length, 1); // exakt die Startposition
  const [sx, sz] = g.trail[0];

  g.keys.add('W'); // vorwaerts in den ersten Gang
  advance(g, r, 0.5);
  g.keys.delete('W');

  assert.ok(g.trail.length >= 2, 'Bewegung erzeugt Wegpunkte');
  const end = g.trail[g.trail.length - 1];
  assert.ok(Math.hypot(end[0] - sx, end[1] - sz) > 0, 'Weg entfernt sich vom Start');

  // Q -> exit() haelt die letzte Position exakt fest (= Spielerlage fuer den Rueckschwenk).
  g.handleKey('Q');
  const last = g.trail[g.trail.length - 1];
  assert.ok(Math.hypot(last[0] - g.playerState.px, last[1] - g.playerState.pz) < 1e-9);
});

test('Q auf der Karte setzt das Spiel an der Spielerlage fort (Weg bleibt)', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.dispatch(GameEvent.START);
  advance(g, r, 0.8 + 4.5 + 2.0); // -> Playing
  assert.equal(g.stateKey, State.PLAYING);
  const mazeBefore = g.maze;

  g.keys.add('W'); // ein Stueck laufen
  advance(g, r, 0.4);
  g.keys.delete('W');
  const ps = { ...g.playerState };
  const trailLen = g.trail.length;

  g.handleKey('Q'); // -> Rueckschwenk -> Karte
  advance(g, r, 2.0);
  assert.equal(g.stateKey, State.MAP);

  g.handleKey('Q'); // Ziel noch offen -> nahtlos zurueckfallen
  advance(g, r, 0.05);
  assert.equal(g.stateKey, State.FALLING);
  advance(g, r, 2.0);
  assert.equal(g.stateKey, State.PLAYING);

  assert.equal(g.maze, mazeBefore, 'gleiches Labyrinth, kein neues');
  assert.ok(Math.abs(g.playerState.px - ps.px) < 1e-9, 'gleiche Position (px)');
  assert.ok(Math.abs(g.playerState.pz - ps.pz) < 1e-9, 'gleiche Position (pz)');
  assert.ok(Math.abs(g.playerState.yaw - ps.yaw) < 1e-9, 'gleiche Blickrichtung');
  assert.ok(g.trail.length >= trailLen, 'abgelaufener Weg bleibt erhalten');
  assert.ok(!g.resume, 'resume-Flag wurde verbraucht');
});

test('am Ziel bietet die Karte kein Weiterspielen an: Q bleibt, X beendet', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.dispatch(GameEvent.START);
  advance(g, r, 0.8 + 4.5 + 2.0);
  g.dispatch(GameEvent.EXIT);
  advance(g, r, 2.8); // Fade + Rueckschwenk -> Karte
  assert.equal(g.stateKey, State.MAP);

  g.reachedGoal = true; // Ziel erreicht (Abkuerzung statt Labyrinth-Navigation)
  g.handleKey('Q');
  advance(g, r, 0.1);
  assert.equal(g.stateKey, State.MAP, 'Q tut am Ziel nichts');

  g.handleKey('X');
  advance(g, r, 1.2); // Ausblenden (~0,9s) + nahtloser Wechsel
  assert.equal(g.stateKey, State.STARTSCREEN);
});

test('X auf der Karte: Ausblenden, Abdock-Flug, dann reagiert der Startscreen wieder', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.dispatch(GameEvent.START);
  advance(g, r, 0.8 + 4.5 + 2.0); // -> MazeGen -> Falling -> Playing
  g.dispatch(GameEvent.EXIT);
  advance(g, r, 0.8 + 2.0); // Fade + Rueckschwenk -> Karte
  assert.equal(g.stateKey, State.MAP);

  g.handleKey('X'); // Karte blendet aus (~0,9s), Eingaben sind dabei gesperrt
  advance(g, r, 0.5);
  assert.equal(g.stateKey, State.MAP);
  g.handleKey('Q'); // wird waehrend des Ausblendens ignoriert
  advance(g, r, 0.05);
  assert.equal(g.stateKey, State.MAP);

  advance(g, r, 0.5); // Ausblenden fertig -> nahtlos (ohne Schwarzblende) Startscreen
  assert.equal(g.stateKey, State.STARTSCREEN);
  assert.ok(!g.undock, 'undock-Flag wurde verbraucht');

  g.handleKey('S'); // waehrend des Abdock-Flugs (~1,6s) ignoriert
  advance(g, r, 1.0);
  assert.equal(g.stateKey, State.STARTSCREEN);

  advance(g, r, 0.8); // Flug beendet -> Orbit laeuft, S startet wieder normal
  g.handleKey('S');
  advance(g, r, 1.8);
  assert.equal(g.stateKey, State.MAZE_GEN);
});

test('dispatch ignoriert undefinierte Uebergaenge', () => {
  const g = new Game();
  assert.equal(g.dispatch(GameEvent.EXIT), false); // im Startscreen nicht erlaubt
  assert.ok(!g.transition.active);
});
