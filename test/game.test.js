// Integrationstest des Zustands-Durchlaufs OHNE Browser: ein Fake-Renderer
// ersetzt das Canvas, sodass die komplette Verdrahtung (Game + Szenen + animierte
// Uebergaenge) headless laeuft. Genau das soll auch beim spaeteren Refactoring
// stabil bleiben.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { State, GameEvent } from '../src/core/states.js';
import { PHOSPHOR_GREEN, TEMPEST_BLUE, ARCADE_RED } from '../src/render/colors.js';

// Renderer-Attrappe: bietet alle vom Spiel genutzten Methoden als No-Op an.
function fakeRenderer() {
  return {
    width: 800,
    height: 600,
    calls: 0,
    beginFrame() {},
    drawText() { this.calls++; },
    drawPolylines() { this.calls++; },
    renderScene(scene, camera, opts) { this.calls++; this.lastSceneColor = opts?.color; },
    worldToScreen() { return { x: 400, y: 300 }; },
    pushSway() {},
    popSway() {},
    pushShatter() { this.shatters = (this.shatters ?? 0) + 1; },
    popShatter() {},
    flash() {},
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

  g.handleKey('S');
  // Waehrend des Andockens (~1,6s) bleibt der Zustand Startscreen, kein Uebergang.
  advance(g, r, 0.3);
  assert.equal(g.stateKey, State.STARTSCREEN);

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

test('Level 22: gruenes Thema, lauernde Tanker + feuernde gelbe Spinner, Flipper nur als Paare', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.level = 22;

  g.handleKey('S');
  advance(g, r, 1.8);  // Andocken -> MazeGen
  assert.equal(g.stateKey, State.MAZE_GEN);
  assert.ok(Array.isArray(g.flippers) && g.flippers.length === 0,
    'Flipper werden nicht platziert -- die Paar-Liste steht leer bereit');
  // Wachstum (n=43) + Reinfallen abwarten -- grosszuegig vorspulen.
  for (let t = 0; t < 30 && g.stateKey !== State.PLAYING; t += 0.5) advance(g, r, 0.5);
  assert.equal(g.stateKey, State.PLAYING);
  assert.equal(r.color, PHOSPHOR_GREEN, 'Level 22 ist wieder gruen');
  assert.ok(Array.isArray(g.flippers), 'Paar-Liste bleibt im Spiel');
  assert.ok(g.spinners.length > 0 && g.spinners.every((s) => !s.active), 'Spinner schlafen noch an der Wand');
  assert.ok(g.enemies.length > 0 && g.enemies.every((e) => e.mode === 'lurk'),
    'Tanker lauern zu Beginn auf den Kronen');

  // Ein paar Sekunden Spiel mit Dauerfeuer: nichts wirft, es wird gezeichnet.
  g.keys.add(' ');
  const before = r.calls;
  advance(g, r, 2.0);
  g.keys.delete(' ');
  assert.ok(r.calls > before, 'Spielablauf zeichnet weiter');
});

test('Level 26: rotes Thema, alle vier Feindarten entstehen, Pulsare bleiben', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.level = 26;

  g.handleKey('S');
  advance(g, r, 1.8);  // Andocken -> MazeGen
  assert.equal(g.stateKey, State.MAZE_GEN);
  assert.ok(Array.isArray(g.pulsars) && g.pulsars.length > 0,
    'Pulsare existieren schon auf der Start-Karte');
  // Wachstum (n=47) + Reinfallen abwarten -- grosszuegig vorspulen.
  for (let t = 0; t < 40 && g.stateKey !== State.PLAYING; t += 0.5) advance(g, r, 0.5);
  assert.equal(g.stateKey, State.PLAYING);
  assert.equal(r.color, ARCADE_RED, 'Level 26 ist Arcade-rot');
  assert.ok(g.enemies.length > 0 && g.spinners.length > 0 && Array.isArray(g.flippers),
    'Tanker und Spinner treten weiter an, die Flipper-Paar-Liste steht bereit');
  assert.ok(g.pulsars.length > 0 && g.pulsars.every((p) => p.alive && p.armed),
    'Pulsare stehen scharf im Gang');

  // Ein paar Sekunden Spiel mit Dauerfeuer: nichts wirft, es wird gezeichnet,
  // und kein Pulsar stirbt (unzerstoerbar).
  g.keys.add(' ');
  const before = r.calls;
  advance(g, r, 2.0);
  g.keys.delete(' ');
  assert.ok(r.calls > before, 'Spielablauf zeichnet weiter');
  assert.ok(g.pulsars.every((p) => p.alive), 'Pulsare sind unzerstoerbar');
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

  // X -> Rueckschwenk (nahtlos) -> Karte.
  g.handleKey('X');
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

test('Pfeiltasten links/rechts waehlen das Level im Startscreen, begrenzt auf 1..30', () => {
  const g = new Game();
  assert.equal(g.level, 1);

  g.handleKey('ArrowLeft'); // unter Level 1 geht es nicht
  assert.equal(g.level, 1);

  g.handleKey('ArrowRight');
  g.handleKey('ArrowRight');
  assert.equal(g.level, 3);

  for (let i = 0; i < 40; i++) g.handleKey('ArrowRight'); // oben begrenzt
  assert.equal(g.level, 30);
  g.handleKey('ArrowLeft');
  assert.equal(g.level, 29);

  g.handleKey('ArrowUp'); // hoch/runter = Engine-Schalter, nicht Level
  assert.equal(g.level, 29);
});

test('Kampf-Level 11: Feinde stehen, Beruehrung -> Crash -> GAME OVER -> Retry', () => {
  const g = new Game();
  const r = fakeRenderer();
  for (let i = 0; i < 10; i++) g.handleKey('ArrowRight'); // Level 11
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
  const bornAt = g.enemies.map((e) => [e.gx, e.gy]); // fuer den Determinismus-Check unten

  // Space-Dauerfeuer laeuft ohne Fehler mit (Tempest-Logik ist unit-getestet).
  g.keys.add(' ');
  advance(g, r, 0.3);
  g.keys.delete(' ');

  // Feindberuehrung erzwingen: einen JAEGER auf die Spielerposition setzen
  // (Lauerer und Purzler sind harmlos).
  const victim = g.enemies[1];
  victim.mode = 'hunt';
  victim.x = g.playerState.px;
  victim.z = g.playerState.pz;
  advance(g, r, 0.1);
  assert.equal(g.gameOver, true, 'Crash setzt Game Over');
  assert.equal(victim.alive, true, 'die getroffene Raute ueberlebt -- es zerbirst nur das Schiff');
  assert.equal(g.stateKey, State.PLAYING, 'die Explosion tobt noch');
  assert.ok((r.shatters ?? 0) > 0, 'das Bild zerbirst waehrend des Crashs');

  const shattersBeforeRise = r.shatters;
  advance(g, r, 1.4); // Crash ausgetobt -> hinausgeschleudert
  assert.equal(g.stateKey, State.RISING);
  advance(g, r, 0.2);
  assert.ok(r.shatters > shattersBeforeRise, 'der Rueckschwenk sortiert die Scherben (zerbirst abklingend)');
  advance(g, r, 0.8); // schneller Crash-Schwenk (0.8s statt 1.7s)
  assert.equal(g.stateKey, State.MAP);
  assert.equal(g.gameOver, true, 'Karte zeigt GAME OVER');

  // S auf der Karte: Retry -- frischer Fall zum Start, Feinde neu aufgestellt.
  g.handleKey('S');
  assert.equal(g.stateKey, State.FALLING);
  assert.equal(g.resume, false, 'Retry ist KEINE Fortsetzung (zurueck auf S)');
  advance(g, r, 2.0);
  assert.equal(g.stateKey, State.PLAYING);
  assert.equal(g.gameOver, false);
  assert.equal(g.enemies.length, 6);
  assert.ok(g.enemies.every((e) => e.alive), 'alle Rauten leben wieder');
  // Dokumentierte Zusage von spawnFoes: deterministisch aus maze.seed --
  // der Retry landet bei DENSELBEN Geburts-Positionen.
  assert.deepEqual(g.enemies.map((e) => [e.gx, e.gy]), bornAt, 'Retry: gleiche Positionen');
});

test('gewaehltes Level bestimmt die Maze-Groesse (Level 3 -> n=13)', () => {
  const g = new Game();
  const r = fakeRenderer();

  g.handleKey('ArrowRight');
  g.handleKey('ArrowRight'); // Level 3
  g.handleKey('S');
  advance(g, r, 1.8); // Andocken -> MazeGen erzeugt das Labyrinth
  assert.equal(g.stateKey, State.MAZE_GEN);
  assert.equal(g.maze.n, 13);
});

test('Level 6 (schmale Waende, Fahrt): faehrt von selbst los, gelenkt wird mit links/rechts', () => {
  const g = new Game();
  const r = fakeRenderer();

  for (let i = 0; i < 5; i++) g.handleKey('ArrowRight'); // Level 6
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

  // X im Fahrt-Modus: erst abbremsen (Zustand bleibt Playing), dann abheben.
  g.handleKey('X');
  advance(g, r, 0.1);
  assert.equal(g.stateKey, State.PLAYING, 'direkt nach X wird noch gebremst');
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
  g.handleKey('ArrowRight');
  assert.equal(g.level, 1);

  advance(g, r, 4.5 + 2.0); // -> Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);
  g.handleKey('ArrowRight');
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

  g.keys.add('ArrowUp'); // vorwaerts in den ersten Gang
  advance(g, r, 0.5);
  g.keys.delete('ArrowUp');

  assert.ok(g.trail.length >= 2, 'Bewegung erzeugt Wegpunkte');
  const end = g.trail[g.trail.length - 1];
  assert.ok(Math.hypot(end[0] - sx, end[1] - sz) > 0, 'Weg entfernt sich vom Start');

  // X -> exit() haelt die letzte Position exakt fest (= Spielerlage fuer den Rueckschwenk).
  g.handleKey('X');
  const last = g.trail[g.trail.length - 1];
  assert.ok(Math.hypot(last[0] - g.playerState.px, last[1] - g.playerState.pz) < 1e-9);
});

test('S auf der Karte setzt das Spiel an der Spielerlage fort (Weg bleibt)', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.dispatch(GameEvent.START);
  advance(g, r, 0.8 + 4.5 + 2.0); // -> Playing
  assert.equal(g.stateKey, State.PLAYING);
  const mazeBefore = g.maze;

  g.keys.add('ArrowUp'); // ein Stueck laufen
  advance(g, r, 0.4);
  g.keys.delete('ArrowUp');
  const ps = { ...g.playerState };
  const trailLen = g.trail.length;

  g.handleKey('X'); // -> Rueckschwenk -> Karte
  advance(g, r, 2.0);
  assert.equal(g.stateKey, State.MAP);

  g.handleKey('S'); // Ziel noch offen -> nahtlos zurueckfallen
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

test('am Ziel bietet die Karte kein Weiterspielen an: S tut nichts, X beendet', () => {
  const g = new Game();
  const r = fakeRenderer();
  g.dispatch(GameEvent.START);
  advance(g, r, 0.8 + 4.5 + 2.0);
  g.dispatch(GameEvent.EXIT);
  advance(g, r, 2.8); // Fade + Rueckschwenk -> Karte
  assert.equal(g.stateKey, State.MAP);

  g.reachedGoal = true; // Ziel erreicht (Abkuerzung statt Labyrinth-Navigation)
  g.handleKey('S');
  advance(g, r, 0.1);
  assert.equal(g.stateKey, State.MAP, 'S tut am Ziel nichts');

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
  g.handleKey('S'); // wird waehrend des Ausblendens ignoriert
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
});
