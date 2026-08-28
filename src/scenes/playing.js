// Zustand "Spielablauf": Ego-Perspektive im Labyrinth.
// Zwei Steuerungs-Modi (Level-Eigenschaft `drive`):
//   - Tank (Level 1-5): vor/zurueck + drehen.
//   - Fahrt (ab Level 6): automatischer Vortrieb, nur links/rechts lenken;
//     Wandkontakt federt zurueck, loest Kollisionswellen auf der Wand und
//     mechanische Kamera-Schwingungen aus, Kurven neigen die Kamera.
// Zeichnet den abgelaufenen Weg auf (game.trail) und merkt die Spielerlage
// (game.playerState) fuer den Rueckschwenk. Q -> zurueck zur Karte; am Ziel
// loest der Rueckschwenk nach 20 s automatisch aus.
// Ab Level 11 (Level-Eigenschaften `enemies`/`shoot`): rote Rauten-Feinde
// (world/enemies.js), Schiessen mit Space (world/shots.js, Tempest-Regel,
// Fadenkreuz mit Lenk-Ausschlag); Feindberuehrung = krachende Explosion und
// Game Over -> Karte (Q dort: Level-Neustart).
// Ab Level 16 (`spinners`): gruene Spiral-Spinner an den End-Waenden langer
// Gaenge (world/spinners.js) -- ihr Spike ist eine Einbahn-Sperre: frontal
// sperrt die Spitze den Gang und will per Dauerfeuer gekuerzt werden
// (Kreuzen von vorn oder Koerper-Beruehrung = Crash), von hinten harmlos.
// Ab Level 21: Spinner GELB (auf gruenen Waenden) und feuernd
// (`spinners.shoot` -- sirrende Schuesse in flirrenden Farben, abfangbar per
// Dauerfeuer), dazu magenta X-FLIPPER (`flippers`, world/flippers.js): ihre
// Querschnitts-Ebene toetet, abschiessbar nur in Links-/Rechts-Stellung;
// ein Tanker-Abschuss aus >= 3 Feldern spawnt ein Flipper-Paar.
// Ab Level 26 (`pulsars`, rote Waende, bunte Sterne, Tanker blau): gelbe
// PULSARE (world/pulsars.js) -- unzerstoerbare Zackenlinien im Querschnitt,
// die Schuessen nach oben/unten ausweichen. Beruehrung toetet NICHT: die
// Blickachse ROTIERT um 270/360/450 Grad (world/gyro.js, als Bildraum-Roll
// im Sway -- die 3D-Kamera bleibt horizontal!) und das Spiel laeuft in der
// verdrehten Welt weiter; gelenkt wird "logisch" mit dem Pfeil, der auf dem
// Bildschirm in die gewuenschte Richtung zeigt (gyroTurn, wechselt beim
// Einrasten).

import { GameEvent } from '../core/states.js';
import { playHint } from '../core/hud.js';
import { createCamera } from '../math/camera.js';
import { createOscillator } from '../math/oscillator.js';
import { generateMaze } from '../world/maze.js';
import { cellCenter, startFacingYaw, wallFootprints } from '../world/mazeWorld.js';
import { DRIVE, createDriveState, driveStep } from '../world/drive.js';
import { WALK, createWalkState, walkStep } from '../world/walk.js';
import { ENEMY, enemiesStep, enemyHit, enemySegments } from '../world/enemies.js';
import {
  SPINNER, spinnersStep, spinnerShotHit, spinnerPlayerHit, spinnerSegments,
  spinnerFire, spinnerShotsStep, spinnerShotPlayerHit, spinnerShotIntercept, spinnerShotSegments,
} from '../world/spinners.js';
import {
  FLIPPER, flippersStep, flipperPlayerHit, flipperShotHit, flipperSegments, spawnFlipperPair,
} from '../world/flippers.js';
import { pulsarsStep, pulsarPlayerTouch, pulsarSegments } from '../world/pulsars.js';
import { createGyro, startSpin, gyroStep, gyroTurn } from '../world/gyro.js';
import { createShotsState, aimYaw, fireShot, shotsStep, shotSegments } from '../world/shots.js';
import { burstSegments } from '../world/burst.js';
import { PHOSPHOR_GREEN, NEON_MAGENTA, ARCADE_YELLOW, TANKER_RED } from '../render/colors.js';
import { SHATTER } from '../render/shatter.js';
import { mazeMetric } from '../world/metric.js';
import { createRng } from '../util/rng.js';
import {
  bumpPatch, sizzlePatch, fanfarePatch, engineParams,
  shotPatch, poofPatch, boomPatch, crashPatch, clinkPatch, whirrPatch, gyroPatch,
} from '../sound/patches.js';
import {
  goalZone, inGoalZone, goalMarkerSegments, goalBeamFeet, beamFlicker, beamOcclusionCut,
} from '../world/goal.js';
import { fireworkBeams, FIREWORK_COLORS } from '../world/fireworks.js';
import { STARS, createStars, starDirection, skylineElevation, starTwinkle } from '../world/stars.js';
import { collisionWave, waveSegments } from '../world/waves.js';
import { recordTrailPoint } from '../world/trail.js';
import { compassLayout } from '../render/compass.js';
import { swayTransform } from '../render/sway.js';
import { SIDE_FACES, faceLocalToWorld } from '../world/cubeFaces.js';
import { levelConfig, spinnerColor, enemyColor } from '../core/levels.js';
import {
  CUBE_SIZE, WALL_RATIO, EYE_RATIO, FAR_RATIO, NEAR_RATIO, cellSize, unitSize,
  faceWalls, faceFootprints, faceSegments, renderFaceWalls, renderFaceOverlay, egoPose,
} from './mazeView.js';

const RADIUS_RATIO = 0.25;
const GOAL_AUTO_EXIT = 20;  // Sekunden am Ziel bis automatischer Rueckschwenk
const TRAIL_DIST_RATIO = 0.2; // Weg-Aufzeichnung: Mindestdistanz in Zellen

// Ziel-Zone und -Leuchtfeuer: erreicht ist man erst 1/4 Feldgroesse "drinnen";
// genau diese Zone markiert ein Boden-Quadrat, auf dessen Kante flimmernde
// Leucht-Linien entlangwandern und in den Himmel strahlen. Beides MIT
// Verdeckung, aber verdeckte Stuecke scheinen doppelt so stark durch wie
// normale Kanten (0.2 statt DIM 0.1) -- und die Strahlen ragen oberhalb der
// Wand-Sichtlinie frei heraus (beamOcclusionCut), so sieht man das Ziel von
// weitem hinter den Mauern hochstrahlen. Am Ziel: alle Strahlen blitzen
// weiss auf und erloeschen.
const GOAL_INSET_RATIO = 0.25;   // Einrueckung pro Seite (Anteil der Feldgroesse)
const BEAM_HEIGHT_RATIO = 60;    // Strahlhoehe in Zellen (quasi unendlich)
const BEAM_PER_EDGE = 2;         // Zwischenstrahlen pro Quadratkante (+ 4 Ecken)
const BEAM_MAX_INT = 0.7;        // hellster Flacker-Wert der Strahlen
const BEAM_WANDER_RATE = 0.7;    // Wander-Stuetzstellen pro Sekunde
const GOAL_MARKER_INT = 0.9;     // Intensitaet des Boden-Quadrats
const GOAL_OCC_DIM = 0.2;        // verdeckt: doppelt so hell wie Wandkanten (DIM 0.1)
const GOAL_FLASH_TIME = 1.0;     // s: weisses Aufstrahlen + Erloeschen am Ziel
const FIREWORK_SPREAD = 2.2;     // Feuerwerk-Radius um die Zielmitte (Gangbreiten)
const FIREWORK_HEIGHT = 8;       // maximale Feuerwerk-Strahlhoehe (Gangbreiten --
                                 // endlich, damit die Spitzen sichtbar funkeln)

// Stroke-Batching: jeder drawPolylines/renderScene-Aufruf ist ein eigener
// Canvas-Stroke MIT Glow (shadowBlur -- der teuerste Zeichenpfad). Statt pro
// Strahl einzeln zu stroken, wird der FLACKER-Wert auf wenige Stufen gerundet
// und pro Stufe in EINEM Aufruf gezeichnet (die Faktoren fuer Grundhelligkeit
// und Verdeckungs-Dimmung bleiben exakt).
const FLICKER_STEPS = 4;
function bucketAdd(buckets, key, segments) {
  const list = buckets.get(key);
  if (list) list.push(...segments);
  else buckets.set(key, segments);
}

// Fahr-Modus: Kamera-Gefuehl und Kollisions-Effekte.
const BANK_MAX = 0.2;         // rad: maximale Kurvenneigung
const BANK_TAU = 0.22;        // s: Ein-/Ausschwenkzeit der Neigung
const SHAKE_ROLL = 1.6;       // rad/s Roll-Impuls bei vollem Aufprall
const SHAKE_PITCH = 0.8;      // rad/s Nick-Impuls bei vollem Aufprall
const WAVE_SPEED_RATIO = 1.5; // Wellen-Tempo in Gangbreiten/s (frontal steht man
                              // dicht davor -- zu schnelle Wellen verlassen den
                              // schmalen sichtbaren Wandausschnitt sofort)
const WAVE_LIFE = 0.9;        // s Lebensdauer einer Welle
const WAVE_ARM_RATIO = 0.25;  // Start-Halbarmlaenge des Kreuzes (Gangbreiten)
const WAVE_PULSES = 3;        // Wellenzuege pro Aufprall
const WAVE_PULSE_DELAY = 0.12; // s Abstand der Wellenzuege
const FLASH_TIME = 0.15;      // s: jeder Wellenzug startet als weisser Blitz
const FLASH_COLOR = '#ffffff';
const FLASH_GLOW = 16;        // Glow des Blitzes (Standard: 8)
const BRAKE_HOLD = 0.2;       // s Stillstand nach dem Bremsen (Q), bevor es abhebt

// Kampf-Levels (ab Level 11): Feinde, Schiessen, Game Over.
const FLIPPER_COLOR = NEON_MAGENTA; // X-Flipper (ab Level 21)
const PULSAR_COLOR = ARCADE_YELLOW; // Pulsare (ab Level 26)
const SHOT_COLOR = '#ffffff';    // Projektile und Verpuffen
const FOE_SHOT_FLICKER = 12;     // Farb-Schaltrate der Spinner-Schuesse (Hz)
const ENEMY_GLOW = 12;           // Rauten gluehen etwas staerker (Gefahr)
const ENEMY_OCC_DIM = 0.175;     // verdeckte Rauten schimmern durch die Wand
                                 // (dezenter als frueher 0.25; Waende: 0.1)
const CRASH_TIME = 1.3;          // s: Explosion austoben lassen, dann zur Karte
const CRASH_SHAKE_ROLL = 3.0;    // rad/s Roll-Impuls des Crashs
const CRASH_SHAKE_PITCH = 1.8;   // rad/s Nick-Impuls des Crashs
const CRASH_FLASH = 0.18;        // s: weisser Einschlag-Blitz blendet aus
const CROSSHAIR_DIST = 2.5;      // Fadenkreuz-Ankerpunkt (Gangbreiten voraus)
const CROSSHAIR_SIZE = 0.12;     // Fadenkreuz-Radius (Gangbreiten, projiziert)

export function createPlaying(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });

  let maze = null;
  let face = null;
  let walls = null;
  let footprints = null;
  let cell = 1; // Gang-Breite (Gameplay-Massstab)
  let unit = 1; // Achsen-Einheit (Grid <-> Welt)
  let px = 0;
  let pz = 0;
  let yaw = 0;
  let reached = false;
  let reachedTime = 0;
  let goalInset = 0;    // Einrueckung der Ziel-Zone in Welt-Einheiten
  let goalRect = null;  // Ziel-Zone (lokales Rechteck)
  let goalSegs = null;  // Boden-Quadrat der Ziel-Zone (Welt-Segmente)
  let localFoot = null; // Wand-Grundrisse LOKAL (fuer den Strahl-Schnitt)
  let reachedAt = 0;    // Szenenzeit des Ziel-Erreichens (weisses Erloeschen)

  // Fahr-Modus (ab Level 6).
  let drive = false;
  let driveState = null;
  let walkState = null; // Tank-Modus (Level 1-5): Rampen + Kollisions-Flanke
  let stars = null;  // Sternenhimmel ab Level 4 (world/stars.js); null = keiner
  let bank = 0;      // aktuelle Kurvenneigung (rad)
  let waves = [];    // aktive Kollisionswellen {wave, born, strength}
  let sceneT = 0;    // Szenenzeit fuer die Wellen-Alter
  let braking = false;  // Q gedrueckt: erst abbremsen, dann abheben
  let brakeHold = 0;    // s Stillstand vor dem Abheben (kurzer Beat)
  let bump = null;      // letzte Wand-Beruehrung (Flanke aus walk.js) -- fuer
                        // das 2026-Bump-Feedback (viewState), 1980 nutzt Sound
  const rollOsc = createOscillator({ freq: 5, damping: 0.22 });
  const pitchOsc = createOscillator({ freq: 8, damping: 0.3 });

  // Kampf-Levels (ab Level 11).
  let shoot = false;      // Level-Eigenschaft: Space feuert
  let enemies = [];       // Tanker/rote Rauten (liegen auf game.enemies, s. enter())
  let spinners = [];      // Spinner (liegen auf game.spinners, s. enter())
  let flippers = [];      // X-Flipper ab Level 21 (liegen auf game.flippers)
  let pulsars = [];       // Pulsare ab Level 26 (liegen auf game.pulsars)
  let foeShots = [];      // sirrende Spinner-Schuesse (ab Level 21)
  let foeRng = null;      // deterministischer Zufall fuers Spinner-Feuern
  let spinnerCol = PHOSPHOR_GREEN; // Spinner-Farbe des Levels (ab 21 gelb)
  let enemyCol = TANKER_RED;       // Tanker-Farbe des Levels (ab 26 blau)
  let rainbow = false;    // bunte Sterne (ab Level 26, rainbowStars)
  // Blickachsen-Rotation nach Pulsar-Beruehrung -- als Bildraum-Roll im Sway
  // gerendert (Hidden-Lines-Falle 4: NIE in die Kamerabasis). Reset bei
  // enter(): nach Karte/Resume startet man wieder aufrecht.
  let gyro = createGyro();
  let pairSource = false; // Level hat Flipper: Tanker-Fernabschuss spawnt ein Paar
  let fieldPitch = 0;     // Feld-Abstand (Kammer + Wand, Welt) fuer die Paar-Distanz
  let shotsState = null;  // Tempest-Schuesse (world/shots.js)
  let bursts = [];        // aktive Splitter-Explosionen (Verpuffen/Abschuss/Crash)
  let burstSeq = 0;       // laufender Splitter-Seed (unabhaengig von gerade lebenden Bursts)
  let crash = false;      // Feindberuehrung: Explosion laeuft, dann Game Over
  let crashT = 0;
  let crashPos = null;    // Einschlag {x,z} -- Zentrum des Bild-Zerberstens

  // Feindberuehrung: krachende Explosion an `at` {x,z}, dann schleudert es den
  // Spieler hinaus in die Kartenansicht (update() dispatcht nach CRASH_TIME).
  // opts: `kill` (Objekt mit alive-Flag, das in der Explosion aufgeht -- beim
  // Aufspiessen am Spike ueberlebt der Spinner!), `color` (Splitter-Farbe,
  // Standard Feind-Rot), `height` (Explosions-Hoehe, Standard Augenhoehe).
  function startCrash(at, opts = {}) {
    crash = true;
    crashT = 0;
    crashPos = { x: at.x, z: at.z };
    game.gameOver = true; // Karte zeigt GAME OVER, Q startet den Level neu
    if (opts.kill) opts.kill.alive = false;
    game.audio?.engine(null);
    game.audio?.play(crashPatch());
    const h = opts.height ?? EYE_RATIO * cell;
    const color = opts.color ?? enemyCol;
    // shardCount/shardSize: flaechige Truemmer NUR fuer die 2026-Engine
    // (burstShards -- 1980 zeichnet weiter nur die Linien-Splitter).
    bursts.push(
      { born: sceneT, center: [at.x, h, at.z], seed: 11, count: 24, speed: 3.5 * cell, life: 1.2, size: 0.16 * cell, color, shardCount: 9, shardSize: 0.38 * cell },
      { born: sceneT, center: [at.x, h, at.z], seed: 47, count: 16, speed: 2.5 * cell, life: 0.9, size: 0.12 * cell, color: SHOT_COLOR },
    );
    rollOsc.kick(CRASH_SHAKE_ROLL);
    pitchOsc.kick(CRASH_SHAKE_PITCH);
  }

  // Projektil-Ereignis (aus shotsStep): Verpuffen an der Wand, Tanker-Abschuss
  // oder die Spinner-/Flipper-Faelle -- Funken am gekuerzten Spike ('spike'),
  // Explosion in Spinner-Farbe beim Abschuss ('spinner'), Abprallen am
  // geschuetzten Koerper an der Wand ('shield'), abgefangener Spinner-Schuss
  // ('zap', weisses Zerplatzen) und Flipper-Abschuss ('flipper', magenta).
  function spawnShotEvent(ev) {
    const h = EYE_RATIO * cell;
    const hs = SPINNER.height * cell; // Spinner leben unterhalb der Augenhoehe
    if (ev.type === 'wall' || ev.type === 'shield') {
      game.audio?.play(poofPatch());
      bursts.push({ born: sceneT, center: [ev.x, ev.type === 'shield' ? hs : h, ev.z], seed: burstSeq++, count: 8, speed: 1.2 * cell, life: 0.35, size: 0.07 * cell, color: SHOT_COLOR });
    } else if (ev.type === 'spike') {
      game.audio?.play(clinkPatch());
      bursts.push({ born: sceneT, center: [ev.x, hs, ev.z], seed: burstSeq++, count: 6, speed: 1.4 * cell, life: 0.3, size: 0.06 * cell, color: spinnerCol });
    } else if (ev.type === 'spinner') {
      // Ohne Truemmer-Platten (Boris): Spinner sind reine LINIEN-Wesen --
      // flaechige Truemmer passen zu Tankern und Flippern, nicht hier.
      game.audio?.play(boomPatch());
      bursts.push({ born: sceneT, center: [ev.x, hs, ev.z], seed: burstSeq++, count: 18, speed: 2.5 * cell, life: 0.8, size: 0.13 * cell, color: spinnerCol });
    } else if (ev.type === 'zap') {
      game.audio?.play(poofPatch());
      bursts.push({ born: sceneT, center: [ev.x, hs, ev.z], seed: burstSeq++, count: 10, speed: 1.8 * cell, life: 0.4, size: 0.08 * cell, color: SHOT_COLOR });
    } else if (ev.type === 'flipper') {
      game.audio?.play(boomPatch());
      bursts.push({ born: sceneT, center: [ev.x, h, ev.z], seed: burstSeq++, count: 18, speed: 2.5 * cell, life: 0.8, size: 0.13 * cell, color: FLIPPER_COLOR, shardCount: 6, shardSize: 0.3 * cell });
    } else {
      // Tanker-Abschuss: Funken-Splitter + flaechige Truemmer (nur 2026).
      game.audio?.play(boomPatch());
      bursts.push({ born: sceneT, center: [ev.x, h, ev.z], seed: burstSeq++, count: 18, speed: 2.5 * cell, life: 0.8, size: 0.13 * cell, color: enemyCol, shardCount: 6, shardSize: 0.3 * cell });
    }
  }

  function recordState() {
    game.playerState = { px, pz, yaw };
  }

  // Fahr-Modus: ein Simulationsschritt (Vortrieb, Lenken, Abprall + Effekte).
  function updateDrive(turn, dt) {
    // Am Ziel haelt der Wagen sofort (Tempo und Feder-Impuls hart auf 0),
    // aber driveStep laeuft weiter: bei Tempo 0 bewegt er nichts und
    // kollidiert nicht, doch die Lenk-Rampe dreht den Blick -- man kann
    // sich am Ziel noch umschauen, wie in der Tank-Steuerung (Level 1-5).
    if (reached) {
      driveState.vel = 0;
      driveState.push.x = 0;
      driveState.push.z = 0;
    }
    const res = driveStep(maze, driveState, { px, pz, yaw }, turn, dt, {
      unit, cell, radius: RADIUS_RATIO * cell,
      targetSpeed: braking || reached ? 0 : undefined, // Q: erst ausrollen ...
    });
    px = res.px;
    pz = res.pz;
    yaw = res.yaw;
    if (res.collision) spawnCollision(res.collision);
    // Abheben, sobald ausgerollt (oder man waehrend des Ausrollens das Ziel
    // erreicht hat -- dann steht man ohnehin) plus ein kurzer Beat Stillstand.
    // Auch der Feder-Impuls muss abgeklungen sein, sonst rutscht man beim
    // Abheben noch seitwaerts.
    const settled = driveState.vel === 0 && driveState.push.x === 0 && driveState.push.z === 0;
    if (braking && (reached || settled)) {
      brakeHold += dt;
      if (brakeHold >= BRAKE_HOLD) game.dispatch(GameEvent.EXIT);
    }
    // Kurvenneigung: Ziel proportional zu Lenkung und Tempo, weich nachgefuehrt.
    const speed01 = reached ? 0 : Math.max(-1, Math.min(1, driveState.vel / DRIVE.cruise));
    bank += (-BANK_MAX * turn * speed01 - bank) * (1 - Math.exp(-dt / BANK_TAU));
    rollOsc.step(dt);
    pitchOsc.step(dt);
    waves = waves.filter((w) => sceneT - w.born < WAVE_LIFE);
  }

  // Aufprall: Wellenzuege auf der getroffenen Wand + mechanische Schwingung
  // + elektrisches Brutzeln (Wucht bestimmt Lautstaerke und Dauer).
  function spawnCollision(col) {
    game.audio?.play(sizzlePatch(col.impact));
    // Flanke fuer die 2026-Engine (Stufe 2): mit exaktem Wand-Auftreffpunkt
    // (`point`) -- daraus werden Licht-Blitz + Funken statt der 1980-Wellen.
    // Der Feder-Impuls selbst steckt schon in der Pose (drive.js).
    bump = { at: sceneT, axis: col.axis, side: col.side, impact: col.impact,
      x: px, z: pz, point: col.point };
    const wave = collisionWave(maze, col, { unit, eye: EYE_RATIO * cell });
    for (let i = 0; i < WAVE_PULSES; i++) {
      // Nur der ERSTE Wellenzug blitzt weiss auf -- ein Blitz pro Treffer.
      waves.push({ wave, born: sceneT + i * WAVE_PULSE_DELAY, strength: col.impact * (1 - i / WAVE_PULSES), flash: i === 0 });
    }
    // Roll-Richtung aus der Anlaufrichtung relativ zur Wandnormalen (deterministisch).
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const [nx, nz] = col.axis === 'x' ? [-col.side, 0] : [0, -col.side];
    const sign = fx * nz - fz * nx >= 0 ? 1 : -1;
    rollOsc.kick(sign * SHAKE_ROLL * col.impact);
    pitchOsc.kick(SHAKE_PITCH * col.impact);
  }

  return {
    enter() {
      maze = game.maze ?? generateMaze(11, {});
      face = game.dockFace ?? SIDE_FACES[0];
      cell = cellSize(maze);
      unit = unitSize(maze);
      walls = faceWalls(maze, face, WALL_RATIO * cell);
      footprints = faceFootprints(maze, face);
      goalInset = GOAL_INSET_RATIO * cell;
      goalRect = goalZone(maze, unit, goalInset);
      goalSegs = faceSegments(goalMarkerSegments(goalRect), face);
      localFoot = wallFootprints(maze, { unit });
      const cfg = levelConfig(game.level);
      drive = !!cfg?.drive;
      shoot = !!cfg?.shoot;
      driveState = createDriveState(); // vel 0: nach dem Reinfallen faehrt man mit der Rampe los
      walkState = createWalkState();   // ebenso zu Fuss: Anfahren ueber die Rampe
      bank = 0;
      waves = [];
      sceneT = 0;
      braking = false;
      brakeHold = 0;
      bump = null;
      rollOsc.reset();
      pitchOsc.reset();

      // Feinde gehoeren zum Labyrinth-Durchlauf: MazeGen wuerfelt sie bei der
      // Geburt der Karte (die Start-Karte zeigt die Kreuze), Falling bei
      // jedem frischen Anlauf neu (Retry nach Game Over) -- deterministisch
      // aus dem Maze-Seed. Bei Fortsetzung von der Karte bleiben sie samt
      // Abschuessen erhalten. Hier nur der Fallback fuer den Direkteinstieg
      // (Tests ohne MazeGen/Falling) und das Aufraeumen fremder Level-Reste.
      if ((cfg?.enemies || cfg?.spinners || cfg?.flippers || cfg?.pulsars)
        && !game.enemies && !game.spinners && !game.flippers && !game.pulsars) {
        game.spawnFoes(maze);
      }
      if (!cfg?.enemies) game.enemies = null;
      if (!cfg?.spinners) game.spinners = null;
      if (!cfg?.flippers) game.flippers = null;
      else if (!game.flippers) game.flippers = []; // Paar-Spawns landen auf game.flippers
      if (!cfg?.pulsars) game.pulsars = null;
      enemies = game.enemies ?? [];
      spinners = game.spinners ?? [];
      flippers = game.flippers ?? [];
      pulsars = game.pulsars ?? [];
      foeShots = [];
      foeRng = createRng((maze.seed ^ 0x27d4eb2f) >>> 0);
      spinnerCol = spinnerColor(game.level);
      enemyCol = enemyColor(game.level);
      rainbow = !!cfg?.rainbowStars;
      gyro = createGyro(); // aufrecht starten (auch nach Karte/Resume)
      pairSource = !!cfg?.flippers;
      const metric = mazeMetric(maze);
      fieldPitch = (metric.wall + metric.corridor) * unit; // 1 Feld = Kammer + Wand
      // Sternenhimmel ab Level 4 (1-3 "legacy 1974"), deterministisch aus
      // dem Maze-Seed -- gleiche Karte, gleicher Himmel.
      stars = game.level >= STARS.minLevel ? createStars(maze.seed) : null;
      shotsState = createShotsState();
      bursts = [];
      burstSeq = 0;
      crash = false;
      crashT = 0;
      game.gameOver = false;
      if (game.resume && game.playerState) {
        // Fortsetzung von der Karte: Lage und abgelaufener Weg bleiben erhalten.
        ({ px, pz, yaw } = game.playerState);
      } else {
        const [cx, cz] = cellCenter(maze, maze.start[0], maze.start[1], unit);
        px = cx;
        pz = cz;
        yaw = startFacingYaw(maze);
        game.trail = [[px, pz]]; // abgelaufener Weg (praezise Flaechenpunkte)
      }
      game.resume = false;
      reached = false;
      reachedTime = 0;
      reachedAt = 0;
      game.reachedGoal = false;
      recordState();
    },

    exit() {
      // Letzte Position exakt festhalten (auch unterhalb der Mindestdistanz),
      // damit die Weglinie genau dort endet, wo der Rueckschwenk beginnt.
      recordTrailPoint(game.trail, px, pz, { force: true });
      // Rest-Verdrehung der Blickachse (Pulsar-Rotation) auf dem kuerzesten
      // Weg normalisiert an den Rueckschwenk uebergeben: der dreht sie sanft
      // aus, statt hart auf "aufrecht" zu springen.
      game.viewRoll = ((gyro.roll + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      game.audio?.engine(null); // Motor-Klang ausblenden (die Karte ist still)
    },

    update(dt) {
      sceneT += dt;

      // Nach der Feindberuehrung: Steuerung eingefroren, nur die Explosion
      // und das Nachschwingen laufen noch -- dann hinaus zur Karte. Eine
      // laufende Blick-Rotation dreht dabei zu Ende (eingefroren saehe sie
      // kaputt aus).
      if (crash) {
        crashT += dt;
        gyroStep(gyro, dt);
        rollOsc.step(dt);
        pitchOsc.step(dt);
        waves = waves.filter((w) => sceneT - w.born < WAVE_LIFE);
        bursts = bursts.filter((b) => sceneT - b.born < b.life);
        if (crashT >= CRASH_TIME) game.dispatch(GameEvent.EXIT);
        return;
      }

      const keys = game.keys;
      const dirs = {
        left: keys.has('ArrowLeft') || keys.has('A'),
        right: keys.has('ArrowRight') || keys.has('D'),
        up: keys.has('ArrowUp') || keys.has('W'),
        down: keys.has('ArrowDown') || keys.has('S'),
      };
      // Lenk-Eingabe: im Fahrt-Modus "logisch" unter der aktuellen Blick-
      // Verdrehung (gyroTurn -- ohne Pulsar-Beruehrung ist orient 0 und es
      // bleibt beim gewohnten links/rechts); die Rotation selbst laeuft als
      // reine Zeitfunktion weiter und rastet im 90-Grad-Raster ein.
      gyroStep(gyro, dt);
      const turn = drive
        ? gyroTurn(gyro.orient, dirs)
        : (dirs.left ? 1 : 0) - (dirs.right ? 1 : 0);
      const prevX = px, prevZ = pz; // Lage VOR dem Schritt (Spike-Kreuzungs-Check)

      if (drive) {
        updateDrive(turn, dt);
        // Motor-Klang: Tonhoehe/Pegel folgen dem Tempo, das Sirren der
        // Kurvenneigung (bank ist schon weich nachgefuehrt).
        game.audio?.engine(engineParams('drive', {
          speed: reached ? 0 : driveState.vel / DRIVE.cruise,
          bank: Math.abs(bank) / BANK_MAX,
        }));
      } else {
        const move = reached ? 0 : (dirs.up ? 1 : 0) - (dirs.down ? 1 : 0);
        const res = walkStep(maze, walkState, { px, pz, yaw }, { move, turn }, dt, {
          unit, cell, radius: RADIUS_RATIO * cell,
        });
        ({ px, pz, yaw } = res);
        if (res.collision) {
          game.audio?.play(bumpPatch(res.collision.impact));
          // Flanke festhalten (Ort = Spielerlage im Moment des Auftreffens):
          // die 2026-Engine liest sie via viewState() und macht daraus
          // Kamera-Impuls + Licht-Blitz an der Wand.
          const { axis, side, impact } = res.collision;
          bump = { at: sceneT, axis, side, impact, x: px, z: pz };
        }
        // Kaum merkliches Gleiten: nur das ERREICHTE Tempo klingt -- an der
        // Wand angedrueckt ist es still, obwohl die Taste gehalten wird.
        game.audio?.engine(engineParams('walk', {
          speed: res.speed / WALK.speed,
          steer: Math.abs(walkState.steer),
        }));
      }

      // Weg praezise aufzeichnen: echte Position, gerade Strecken zusammengefasst.
      recordTrailPoint(game.trail, px, pz, { minDist: TRAIL_DIST_RATIO * cell });
      recordState();

      // Feinde: pulsieren/patrouillieren; Beruehrung einer Raute = Game Over.
      if (enemies.length) {
        enemiesStep(enemies, dt);
        const hit = enemyHit(enemies, px, pz, (RADIUS_RATIO + ENEMY.hitRadius) * cell);
        if (hit && !reached) {
          startCrash(hit, { kill: hit });
          return;
        }
      }

      // Spinner: Spike waechst, Vorlauf/Rueckzug pendelt; Koerper-Beruehrung
      // ODER frontales Kreuzen der Spitze = Game Over (beim Aufspiessen
      // ueberlebt der Spinner -- nur die Koerper-Kollision reisst ihn mit).
      if (spinners.length) {
        spinnersStep(spinners, dt, cell);
        const hit = spinnerPlayerHit(spinners, px, pz, RADIUS_RATIO * cell, cell,
          { px: prevX, pz: prevZ });
        if (hit && !reached) {
          startCrash(hit, {
            kill: hit.impale ? null : hit.spinner,
            color: spinnerCol, height: SPINNER.height * cell,
          });
          return;
        }
        // Ab Level 21 (spinners.shoot): steht man im Gang eines Spinners
        // und hat ihn vor sich, loest sich gelegentlich ein sirrender
        // Schuss von der Spike-Spitze -- das Duell, nicht die Ferne.
        if (spinnerFire(spinners, foeShots, dt, foeRng, { px, pz, yaw }, cell).length) {
          game.audio?.play(whirrPatch());
        }
      }

      // Spinner-Schuesse fliegen die Gangmitte entlang: Beruehren/Kreuzen =
      // Game Over (ausweichen geht nicht -- abfangen schon, s. hitTest unten);
      // am fernen Gang-Ende verpuffen sie an der Wand.
      if (foeShots.length) {
        for (const ev of spinnerShotsStep(foeShots, dt, cell)) spawnShotEvent(ev);
        const hit = spinnerShotPlayerHit(foeShots, px, pz, RADIUS_RATIO * cell, cell,
          { px: prevX, pz: prevZ });
        if (hit && !reached) {
          startCrash(hit, { color: spinnerCol, height: SPINNER.height * cell });
          return;
        }
      }

      // Flipper: wandern und flippen; ihre Querschnitts-Ebene ist toedlich --
      // Beruehren oder Kreuzen zerstoert den Spieler (der Flipper geht mit).
      if (flippers.length) {
        flippersStep(flippers, dt, cell);
        const hit = flipperPlayerHit(flippers, px, pz, RADIUS_RATIO * cell, cell,
          { px: prevX, pz: prevZ });
        if (hit && !reached) {
          startCrash(hit, { kill: hit.flipper, color: FLIPPER_COLOR });
          return;
        }
      }

      // Pulsare: pulsieren und klappen an fester Position; eigene Schuesse
      // in ihrem Gang lassen sie rechtzeitig nach unten/oben ausweichen
      // (unzerstoerbar). Beruehrung toetet NICHT -- sie ROTIERT die Blick-
      // achse (world/gyro.js), waehrend der Rotation loest kein weiterer
      // Pulsar aus (eine Drehung nach der anderen).
      if (pulsars.length) {
        pulsarsStep(pulsars, dt, cell, shotsState?.shots);
        if (!gyro.spinning && !reached) {
          const touch = pulsarPlayerTouch(pulsars, px, pz, RADIUS_RATIO * cell, cell,
            { px: prevX, pz: prevZ });
          if (touch) {
            const dur = startSpin(gyro, foeRng);
            game.audio?.play(gyroPatch(dur));
          }
        }
      }

      // Schiessen: Space als Dauerfeuer, Tempest-Regel (max 8 unterwegs).
      // Zielrichtung = Blick + Lenk-Ausschlag zum Abschusszeitpunkt.
      if (shoot) {
        const steer = drive ? driveState.steer : walkState.steer;
        if (keys.has(' ') && !reached && fireShot(shotsState, { px, pz, yaw }, steer)) {
          game.audio?.play(shotPatch());
        }
        // Treffer-Kette eigener Projektile: erst die heranfliegenden Spinner-
        // Schuesse abfangen, dann Flipper (nur in Seiten-Stellung), dann
        // Spike/Spinner-Koerper.
        const events = shotsStep(maze, shotsState, dt, {
          unit, cell, enemies, enemyRadius: ENEMY.shotRadius * cell,
          hitTest: (x, z) => (foeShots.length ? spinnerShotIntercept(foeShots, x, z, cell) : null)
            ?? (flippers.length ? flipperShotHit(flippers, x, z, cell) : null)
            ?? (spinners.length ? spinnerShotHit(spinners, x, z, cell) : null),
        });
        for (const ev of events) {
          spawnShotEvent(ev);
          // Tanker aus >= 3 Feldern Entfernung abgeschossen (Level mit
          // Flippern): an seiner Stelle entsteht ein Flipper-PAAR (links +
          // rechts), das den Gang entlang auf den Spieler zurueckt.
          if (ev.type === 'enemy' && pairSource
            && Math.hypot(ev.x - px, ev.z - pz) >= FLIPPER.pairFields * fieldPitch) {
            flippers.push(...spawnFlipperPair(maze, ev.enemy, { px, pz }, { unit, cell }));
          }
        }
      }
      bursts = bursts.filter((b) => sceneT - b.born < b.life);

      // Streng: die Kante des Zielfelds reicht nicht, man muss mindestens
      // GOAL_INSET_RATIO der Feldgroesse "drinnen" stehen (= das Boden-Quadrat).
      if (!reached && inGoalZone(maze, px, pz, unit, goalInset)) {
        reached = true;
        reachedAt = sceneT; // ab hier: weisses Aufstrahlen + Erloeschen
        game.reachedGoal = true; // die Karte bietet dann kein Weiterspielen mehr an
        game.audio?.play(fanfarePatch()); // drei aufsteigende Toene zum weissen Aufblitzen
      }
      if (reached) {
        reachedTime += dt;
        if (reachedTime >= GOAL_AUTO_EXIT) game.dispatch(GameEvent.EXIT);
      }
    },

    render(renderer) {
      // Spieler-Crash: das GANZE Bild zerbirst -- alle Linien fliegen als
      // Scherben vom Einschlag weg (render/shatter.js), waehrend Explosion
      // und Kamera-Schuetteln laufen; der schnelle Rueckschwenk setzt die
      // Scherben wieder zusammen (rising.js). Push ganz oben: auch HUD,
      // Kompass und Texte bersten mit. Bildraum-Effekt wie der Sway -- die
      // 3D-Kamera bleibt horizontal.
      if (crash) {
        const p = Math.min(1, crashT / CRASH_TIME);
        const world = faceLocalToWorld(crashPos.x, EYE_RATIO * cell, crashPos.z, face, CUBE_SIZE);
        // Kamera-Basis steht vom Vorframe; near mit cell skalieren (der
        // Einschlag ist direkt vor der Kamera -- Near-Plane-Regel).
        const c = renderer.worldToScreen(world, camera, NEAR_RATIO * cell);
        renderer.pushShatter({
          amount: 1 - (1 - p) * (1 - p), // harter Stoss, dann treibendes Auseinanderfliegen
          cx: c ? c.x : renderer.width / 2,
          cy: c ? c.y : renderer.height / 2,
          scale: SHATTER.scale * Math.min(renderer.width, renderer.height),
        });
      }

      // Kurvenneigung + mechanische Schwingungen NICHT in die 3D-Kamera (das
      // braeche die azimutale Hidden-Line-Annahme), sondern als Bildraum-
      // Schwenk ueber die komplette 3D-Sicht (Waende + Wellen, ohne HUD).
      // Der Gyro-Roll (Pulsar-Rotation) kommt zur Kurvenneigung dazu -- ein
      // Roll um die Blickachse ist exakt eine 2D-Rotation um die Bildmitte,
      // auch bei 90/180/270 Grad Dauerzustand.
      if (drive) {
        renderer.pushSway(swayTransform(bank + rollOsc.x + gyro.roll, pitchOsc.x, { height: renderer.height, fov: camera.fov }));
      }
      const pose = egoPose(face, px, pz, yaw, cell);
      const view = renderFaceWalls(renderer, walls, footprints, camera, pose, { far: FAR_RATIO * cell, near: NEAR_RATIO * cell });

      // Sternenhimmel (ab Level 4): weltfeste Sterne in der Level-Farbe --
      // beim Drehen zieht der Himmel vorbei, das macht jede Drehung
      // spuerbar. Sichtbar nur OBERHALB der Wand-Silhouette in der
      // jeweiligen Richtung (skylineElevation-Raycast); als Bildschirm-
      // Kreuzchen gezeichnet, nach Funkel-Stufe gebatcht (ein Stroke pro
      // Stufe). Innerhalb des Sway: die Kurvenneigung kippt den Himmel mit.
      if (stars) {
        const starBuckets = new Map();
        const skyOpts = { unit, cell, eye: EYE_RATIO * cell, wallHeight: WALL_RATIO * cell };
        const R = STARS.dist * cell;
        for (const st of stars) {
          if (st.el <= skylineElevation(maze, px, pz, st.az, skyOpts) + STARS.margin) continue;
          const dir = starDirection(st.az, st.el);
          const p = renderer.worldToScreen(faceLocalToWorld(
            px + dir[0] * R, EYE_RATIO * cell + dir[1] * R, pz + dir[2] * R, face, CUBE_SIZE), camera);
          if (!p) continue;
          const r = st.size;
          const q = Math.ceil(starTwinkle(st, sceneT) * FLICKER_STEPS) / FLICKER_STEPS;
          // BUNTE Sterne (ab Level 26, rainbowStars): jeder Stern behaelt
          // seine deterministische Arcade-Farbe (tint) -- gebatcht wird
          // dann pro Farbe UND Funkel-Stufe (ein Stroke pro Kombination).
          const color = rainbow ? FIREWORK_COLORS[st.tint % FIREWORK_COLORS.length] : null;
          bucketAdd(starBuckets, color ? color + '|' + q : q, [
            [[p.x - r, p.y], [p.x + r, p.y]],
            [[p.x, p.y - r], [p.x, p.y + r]],
          ]);
        }
        for (const [key, segs] of starBuckets) {
          const [color, q] = typeof key === 'string' ? key.split('|') : [undefined, key];
          renderer.drawPolylines(segs, { intensity: Number(q), lineWidth: 1, color });
        }
      }

      // Ziel-Leuchtfeuer. Boden-Quadrat: normale Kanten-Verdeckung, aber
      // verdeckt doppelt so hell wie Wandkanten. Near-Plane wie bei den
      // Waenden skalieren (man faehrt direkt darueber).
      const goalNear = NEAR_RATIO * cell;
      renderFaceOverlay(renderer, goalSegs, camera, view, { intensity: GOAL_MARKER_INT, dim: GOAL_OCC_DIM });

      // Strahlen: wandern auf der Quadratkante (am Ziel eingefroren) und
      // flimmern. Verdeckung analytisch pro Strahl (beamOcclusionCut): unter
      // der Wand-Sichtlinie gedimmt durchscheinend, darueber frei strahlend.
      // Am Ziel blitzen alle weiss auf und erloeschen in GOAL_FLASH_TIME.
      const flashAge = sceneT - reachedAt;
      if (!reached || flashAge < GOAL_FLASH_TIME) {
        const beamH = BEAM_HEIGHT_RATIO * cell;
        const feet = goalBeamFeet(goalRect, {
          perEdge: BEAM_PER_EDGE, rate: BEAM_WANDER_RATE,
          time: reached ? reachedAt : sceneT, // eingefroren beim Erloeschen
        });
        if (reached) {
          // Weisses Aufstrahlen: alle Strahlen gleich hell -> EIN Stroke.
          const segs = faceSegments(feet.map(([bx, bz]) => [[bx, 0, bz], [bx, beamH, bz]]), face);
          renderer.renderScene({ segments: segs, intensity: 1 - flashAge / GOAL_FLASH_TIME },
            camera, { near: goalNear, color: FLASH_COLOR, glow: FLASH_GLOW });
        } else {
          // Flacker-Wert auf FLICKER_STEPS Stufen gerundet, pro Stufe EIN
          // Stroke (statt bis zu 2 pro Strahl) -- sichtbar und verdeckt
          // getrennt gebuendelt, deren Helligkeits-Faktoren bleiben exakt.
          const visBuckets = new Map();
          const dimBuckets = new Map();
          for (let i = 0; i < feet.length; i++) {
            const [bx, bz] = feet[i];
            const cut = Math.min(beamH, beamOcclusionCut(localFoot, [px, pz], feet[i], {
              eye: EYE_RATIO * cell, wallHeight: WALL_RATIO * cell,
            }));
            const qf = Math.ceil(beamFlicker(i, sceneT) * FLICKER_STEPS) / FLICKER_STEPS;
            if (cut > 0) bucketAdd(dimBuckets, qf, faceSegments([[[bx, 0, bz], [bx, cut, bz]]], face));
            if (cut < beamH) bucketAdd(visBuckets, qf, faceSegments([[[bx, cut, bz], [bx, beamH, bz]]], face));
          }
          for (const [qf, segments] of visBuckets) {
            renderer.renderScene({ segments, intensity: BEAM_MAX_INT * qf }, camera, { near: goalNear });
          }
          for (const [qf, segments] of dimBuckets) {
            renderer.renderScene({ segments, intensity: GOAL_OCC_DIM * BEAM_MAX_INT * qf }, camera, { near: goalNear });
          }
        }
      }

      // Ziel-FEUERWERK (world/fireworks.js): waehrend die Ziel-Strahlen weiss
      // verloeschen, spriessen rund ums Ziel viele senkrechte Strahlen aus
      // dem Boden -- jeder schaltet von unsichtbar durch die klassischen
      // Arcade-Farben nach Weiss und verschwindet. Keine Verdeckung (es
      // strahlt UEBER die Waende) und pro Farbe + Helligkeits-Stufe EIN
      // Stroke (shadowBlur-Batching wie bei den Ziel-Strahlen).
      if (reached) {
        const beams = fireworkBeams(sceneT - reachedAt, {
          seed: maze.seed,
          center: [(goalRect.x0 + goalRect.x1) / 2, (goalRect.z0 + goalRect.z1) / 2],
          spread: FIREWORK_SPREAD * cell,
          height: FIREWORK_HEIGHT * cell,
        });
        if (beams.length) {
          const buckets = new Map();
          for (const b of beams) {
            const q = Math.ceil(b.intensity * FLICKER_STEPS) / FLICKER_STEPS;
            bucketAdd(buckets, b.color + '|' + q,
              faceSegments([[[b.x, 0, b.z], [b.x, b.top, b.z]]], face));
          }
          for (const [key, segments] of buckets) {
            const [color, q] = key.split('|');
            renderer.renderScene({ segments, intensity: Number(q) }, camera,
              { near: goalNear, color, glow: FLASH_GLOW });
          }
        }
      }

      // Kollisionswellen auf der Wand (camera.basis steht nach renderFaceWalls).
      // Jeder Wellenzug beginnt als weisses Blitz-Kreuz am Auftreffpunkt und
      // laeuft dann gruen auseinander: das Weiss wird als Overlay darueber-
      // gezeichnet und blendet in FLASH_TIME aus.
      for (const wv of waves) {
        const age = sceneT - wv.born;
        const geo = waveSegments(wv.wave, age, {
          height: WALL_RATIO * cell, speed: WAVE_SPEED_RATIO * cell,
          life: WAVE_LIFE, arm: WAVE_ARM_RATIO * cell,
        });
        if (!geo) continue;
        // Near-Plane wie bei den Waenden mit der Zellgroesse skalieren: beim
        // Aufprall ist die Wand naeher als die Standard-Near des Renderers --
        // ohne Override wuerde das Kreuz frontal komplett weggeclippt.
        const near = NEAR_RATIO * cell;
        const segments = faceSegments(geo.segments, face);
        renderer.renderScene({ segments, intensity: geo.fade * wv.strength }, camera, { near });
        const whiteness = wv.flash ? (1 - age / FLASH_TIME) * wv.strength : 0;
        if (whiteness > 0.01) {
          renderer.renderScene({ segments, intensity: whiteness }, camera, { near, color: FLASH_COLOR, glow: FLASH_GLOW });
        }
      }

      // Feinde: rote pulsierende Rauten, mit derselben Hidden-Line-Dimmung
      // wie die Waende -- verdeckt schimmern sie staerker durch als normale
      // Kanten (man ahnt die Gefahr hinterm Eck).
      const aliveEnemies = enemies.filter((e) => e.alive);
      if (aliveEnemies.length) {
        const segs = [];
        for (const e of aliveEnemies) {
          segs.push(...enemySegments(e, sceneT, { cell, px, pz, height: EYE_RATIO * cell }));
        }
        renderFaceOverlay(renderer, faceSegments(segs, face), camera, view, {
          intensity: 0.95, dim: ENEMY_OCC_DIM, color: enemyCol, glow: ENEMY_GLOW,
        });
      }

      // Spinner: rotierende Spiralen samt Spike in der Level-Spinner-Farbe
      // (16-20 gruen auf Blau, ab 21 gelb auf Gruen), gleiche Hidden-Line-
      // Behandlung wie die Rauten (verdeckt schimmern sie durch die Wand --
      // man ahnt den Spike hinter der Ecke).
      const aliveSpinners = spinners.filter((s) => s.alive);
      if (aliveSpinners.length) {
        const segs = [];
        for (const s of aliveSpinners) {
          segs.push(...spinnerSegments(s, sceneT, { cell }));
        }
        renderFaceOverlay(renderer, faceSegments(segs, face), camera, view, {
          intensity: 0.95, dim: ENEMY_OCC_DIM, color: spinnerCol, glow: ENEMY_GLOW,
        });
      }

      // Flipper: magenta X-Konturen im Gang-Querschnitt, Hidden-Line wie die
      // anderen Feinde (verdeckt schimmern sie durch die Wand).
      const aliveFlippers = flippers.filter((f) => f.alive);
      if (aliveFlippers.length) {
        const segs = [];
        for (const f of aliveFlippers) {
          segs.push(...flipperSegments(f, { cell }));
        }
        renderFaceOverlay(renderer, faceSegments(segs, face), camera, view, {
          intensity: 0.95, dim: ENEMY_OCC_DIM, color: FLIPPER_COLOR, glow: ENEMY_GLOW,
        });
      }

      // Pulsare: gelbe pulsierende Zackenlinien im Gang-Querschnitt, gleiche
      // Hidden-Line-Behandlung wie die anderen Feinde.
      if (pulsars.length) {
        const segs = [];
        for (const p of pulsars) {
          segs.push(...pulsarSegments(p, sceneT, { cell }));
        }
        renderFaceOverlay(renderer, faceSegments(segs, face), camera, view, {
          intensity: 0.95, dim: ENEMY_OCC_DIM, color: PULSAR_COLOR, glow: ENEMY_GLOW,
        });
      }

      // Spinner-Schuesse: sirrende Funken-Sterne in FLIRRENDEN Farben -- die
      // Arcade-Palette schaltet hart (1981 gab es kein Blenden). Wenige
      // Schuesse unterwegs -> ein Stroke pro Schuss ist ok.
      for (const s of foeShots) {
        const color = FIREWORK_COLORS[
          Math.floor(sceneT * FOE_SHOT_FLICKER + (s.phase ?? 0)) % FIREWORK_COLORS.length];
        renderer.renderScene(
          { segments: faceSegments(spinnerShotSegments(s, sceneT, { cell }), face) },
          camera, { near: NEAR_RATIO * cell, color, glow: 10 });
      }

      // Projektile: weisse rotierende Sterne. Keine Verdeckung noetig -- sie
      // fliegen im eigenen Sichtgang und verpuffen an der ersten Wand.
      if (shotsState && shotsState.shots.length) {
        const segs = [];
        for (const s of shotsState.shots) {
          segs.push(...shotSegments(s, sceneT, { cell, yaw, height: EYE_RATIO * cell }));
        }
        renderer.renderScene({ segments: faceSegments(segs, face) }, camera,
          { near: NEAR_RATIO * cell, color: SHOT_COLOR, glow: 10 });
      }

      // Splitter-Explosionen (Verpuffen, Feind-Abschuss, Crash).
      for (const b of bursts) {
        const geo = burstSegments(sceneT - b.born, b);
        if (!geo) continue;
        renderer.renderScene({ segments: faceSegments(geo.segments, face), intensity: geo.fade },
          camera, { near: NEAR_RATIO * cell, color: b.color, glow: 10 });
      }

      // Fadenkreuz: zeigt die aktuelle ZIELRICHTUNG der Projektile -- bei
      // Geradeausflug exakt die Blickrichtung, beim Lenken schlaegt es weiter
      // aus als die Flugbahn (aimYaw). Innerhalb des Sway gezeichnet, es
      // haengt am Schiff, nicht am Bildschirm.
      if (shoot && !crash && !reached) {
        const aim = aimYaw(yaw, drive ? driveState.steer : walkState.steer);
        const d = CROSSHAIR_DIST * cell;
        // near mit cell skalieren (Near-Plane-Regel): der Anker liegt bei
        // 2.5 Gangbreiten -- mit dem festen 0.1 verschwaende das Fadenkreuz
        // bei noch groesseren Labyrinthen kommentarlos.
        const near = NEAR_RATIO * cell;
        const anchor = renderer.worldToScreen(
          faceLocalToWorld(px - Math.sin(aim) * d, EYE_RATIO * cell, pz - Math.cos(aim) * d, face, CUBE_SIZE), camera, near);
        const above = renderer.worldToScreen(
          faceLocalToWorld(px - Math.sin(aim) * d, (EYE_RATIO + CROSSHAIR_SIZE) * cell, pz - Math.cos(aim) * d, face, CUBE_SIZE), camera, near);
        if (anchor && above) {
          // Groesse aus der Projektion -- das Fadenkreuz atmet mit der Perspektive.
          const r = Math.max(6, Math.hypot(above.x - anchor.x, above.y - anchor.y));
          const g = r * 0.4; // Luecke in der Mitte
          renderer.drawPolylines([
            [[anchor.x, anchor.y - r], [anchor.x, anchor.y - g]],
            [[anchor.x, anchor.y + g], [anchor.x, anchor.y + r]],
            [[anchor.x - r, anchor.y], [anchor.x - g, anchor.y]],
            [[anchor.x + g, anchor.y], [anchor.x + r, anchor.y]],
          ], { intensity: 0.85, lineWidth: 1.5 });
        }
      }
      if (drive) renderer.popSway();

      const w = renderer.width;
      const h = renderer.height;
      renderer.drawText('FIND THE EXIT', {
        x: 24, y: 24, size: Math.min(20, h * 0.03),
        align: 'left', baseline: 'top', intensity: 0.7,
      });
      // Die Steuer-Zeile (core/hud.js, geteilt mit 2026) folgt der Blick-
      // Verdrehung: bei 90/270 Grad lenkt man mit runter/rauf.
      renderer.drawText(playHint({ drive, shoot, orient: gyro.orient }), {
        x: w - 24, y: h - 20, size: 13,
        align: 'right', baseline: 'bottom', intensity: 0.5,
      });

      // Kompass-Rose rechts unten (oberhalb der Steuerungszeile schwebend).
      const cr = Math.max(26, Math.min(w, h) * 0.05);
      const rose = compassLayout(yaw, { cx: w - cr - 30, cy: h - cr - 52, radius: cr });
      renderer.drawPolylines(rose.polylines, { intensity: 0.45, lineWidth: 1.5 });
      for (const l of rose.labels) {
        renderer.drawText(l.label, {
          x: l.x, y: l.y, size: Math.max(10, cr * 0.5), angle: l.angle,
          align: 'center', baseline: 'middle', intensity: l.major ? 0.9 : 0.45,
        });
      }
      if (reached) {
        renderer.drawText('YOU MADE IT', {
          x: w / 2, y: h / 2, size: Math.min(52, h * 0.08),
          align: 'center', baseline: 'middle',
        });
      }

      if (crash) {
        renderer.popShatter();
        // Einschlag-Blitz OBENDRAUF (selbst ungescherbt): blitzt weiss auf
        // und gibt den Blick auf das zerberstende Bild frei.
        renderer.flash(0.9 * (1 - Math.min(1, crashT / CRASH_FLASH)));
      }
    },

    // Lese-Schnittstelle fuer die 2026-Engine (PLAN2026.md, Stufe 1+2): gibt
    // den privaten Zeichen-Zustand der Szene frei, ohne dass der Core die
    // Engine kennt -- der 2026-Zeichner liest hieraus Kamera-Pose, Ziel-Status
    // und die letzte Wand-Beruehrung. Bewusst klein (pro Stufe erweitert,
    // nicht auf Vorrat); reine Daten, headless testbar.
    // roll/pitch in SWAY-Konvention (render/sway.js: roll > 0 = Kamera legt
    // sich nach rechts, pitch > 0 = Blick hebt sich) -- 1980 rendert sie als
    // Bildraum-Schwenk, 2026 als ECHTEN Kamera-Roll (dort erlaubt; der
    // Gyro-Roll ab Level 26 kommt in Stufe 5 dazu).
    // Stufe 4 (Kampf): dazu Schuesse samt gerampter Lenkgroesse (Fadenkreuz),
    // die Splitter-Explosionen (Verpuffen/Abschuss/Crash -- reine burst.js-
    // Spezifikationen) und der Crash-Zustand (Shake steckt schon in roll/
    // pitch, der weisse Blitz haengt an crash.t). Die Tanker selbst liest
    // die Engine von game.enemies (dort leben sie, Resume/Retry inklusive).
    // Stufe 5: roll traegt jetzt auch den GYRO-Roll (Pulsar-Rotation) --
    // in 2026 ein ECHTER Kamera-Roll um die Blickachse, auch als
    // Dauerzustand (1980 rendert ihn weiter als Bildraum-Sway); `orient`
    // fuer die Steuer-Hinweis-Zeile, `foeShots` fuer die sirrenden
    // Spinner-Schuesse. Spinner/Flipper/Pulsare liest die Engine wie die
    // Tanker von game.* (dort leben sie samt Resume/Retry-Regeln).
    viewState() {
      if (!maze) return null; // vor enter() -- gleicher Vertrag wie alle Szenen
      return { maze, cell, unit, px, pz, yaw, sceneT, reached, reachedAt, bump,
        drive, roll: bank + rollOsc.x + gyro.roll, pitch: pitchOsc.x,
        orient: gyro.orient, foeShots,
        shoot, steer: drive ? driveState.steer : walkState.steer,
        shots: shotsState ? shotsState.shots : [], bursts,
        crash: crash ? { t: crashT, x: crashPos.x, z: crashPos.z } : null };
    },

    onKey(key) {
      if (key !== 'Q' || crash) return; // waehrend der Explosion kein Abheben mehr
      if (drive && !reached) {
        braking = true; // Fahrt-Modus: erst abbremsen, updateDrive hebt dann ab
      } else {
        game.dispatch(GameEvent.EXIT); // nahtlos in den Rueckschwenk
      }
    },
  };
}
