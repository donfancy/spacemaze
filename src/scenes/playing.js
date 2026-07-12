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
// Gaenge (world/spinners.js) -- ihr Spike sperrt den Gang und will per
// Dauerfeuer gekuerzt werden; Aufspiessen oder Koerper-Beruehrung = Crash.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { createOscillator } from '../math/oscillator.js';
import { generateMaze } from '../world/maze.js';
import { cellCenter, startFacingYaw, wallFootprints } from '../world/mazeWorld.js';
import { DRIVE, createDriveState, driveStep } from '../world/drive.js';
import { WALK, createWalkState, walkStep } from '../world/walk.js';
import { ENEMY, createEnemies, enemiesStep, enemyHit, enemySegments } from '../world/enemies.js';
import {
  SPINNER, createSpinners, spinnersStep, spinnerShotHit, spinnerPlayerHit, spinnerSegments,
} from '../world/spinners.js';
import { createShotsState, aimYaw, fireShot, shotsStep, shotSegments } from '../world/shots.js';
import { burstSegments } from '../world/burst.js';
import { createRng } from '../util/rng.js';
import { PHOSPHOR_GREEN } from '../render/colors.js';
import {
  bumpPatch, sizzlePatch, fanfarePatch, engineParams,
  shotPatch, poofPatch, boomPatch, crashPatch, clinkPatch,
} from '../sound/patches.js';
import {
  goalZone, inGoalZone, goalMarkerSegments, goalBeamFeet, beamFlicker, beamOcclusionCut,
} from '../world/goal.js';
import { collisionWave, waveSegments } from '../world/waves.js';
import { recordTrailPoint } from '../world/trail.js';
import { compassLayout } from '../render/compass.js';
import { swayTransform } from '../render/sway.js';
import { SIDE_FACES, faceLocalToWorld } from '../world/cubeFaces.js';
import { levelConfig } from '../core/levels.js';
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
const ENEMY_COLOR = '#ff3b30';   // Feind-Rot (Rauten, Abschuss-Splitter)
const SPINNER_COLOR = PHOSPHOR_GREEN; // Spinner-Gruen (Spiralen, ab Level 16 auf Blau)
const SHOT_COLOR = '#ffffff';    // Projektile und Verpuffen
const ENEMY_GLOW = 12;           // Rauten gluehen etwas staerker (Gefahr)
const ENEMY_OCC_DIM = 0.25;      // verdeckte Rauten schimmern durch die Wand
const CRASH_TIME = 1.3;          // s: Explosion austoben lassen, dann zur Karte
const CRASH_SHAKE_ROLL = 3.0;    // rad/s Roll-Impuls des Crashs
const CRASH_SHAKE_PITCH = 1.8;   // rad/s Nick-Impuls des Crashs
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
  let bank = 0;      // aktuelle Kurvenneigung (rad)
  let waves = [];    // aktive Kollisionswellen {wave, born, strength}
  let sceneT = 0;    // Szenenzeit fuer die Wellen-Alter
  let braking = false;  // Q gedrueckt: erst abbremsen, dann abheben
  let brakeHold = 0;    // s Stillstand vor dem Abheben (kurzer Beat)
  const rollOsc = createOscillator({ freq: 5, damping: 0.22 });
  const pitchOsc = createOscillator({ freq: 8, damping: 0.3 });

  // Kampf-Levels (ab Level 11).
  let shoot = false;      // Level-Eigenschaft: Space feuert
  let enemies = [];       // rote Rauten (liegen auf game.enemies, s. enter())
  let spinners = [];      // gruene Spinner (liegen auf game.spinners, s. enter())
  let shotsState = null;  // Tempest-Schuesse (world/shots.js)
  let bursts = [];        // aktive Splitter-Explosionen (Verpuffen/Abschuss/Crash)
  let crash = false;      // Feindberuehrung: Explosion laeuft, dann Game Over
  let crashT = 0;

  // Feindberuehrung: krachende Explosion an `at` {x,z}, dann schleudert es den
  // Spieler hinaus in die Kartenansicht (update() dispatcht nach CRASH_TIME).
  // opts: `kill` (Objekt mit alive-Flag, das in der Explosion aufgeht -- beim
  // Aufspiessen am Spike ueberlebt der Spinner!), `color` (Splitter-Farbe,
  // Standard Feind-Rot), `height` (Explosions-Hoehe, Standard Augenhoehe).
  function startCrash(at, opts = {}) {
    crash = true;
    crashT = 0;
    game.gameOver = true; // Karte zeigt GAME OVER, Q startet den Level neu
    if (opts.kill) opts.kill.alive = false;
    game.audio?.engine(null);
    game.audio?.play(crashPatch());
    const h = opts.height ?? EYE_RATIO * cell;
    const color = opts.color ?? ENEMY_COLOR;
    bursts.push(
      { born: sceneT, center: [at.x, h, at.z], seed: 11, count: 24, speed: 3.5 * cell, life: 1.2, size: 0.16 * cell, color },
      { born: sceneT, center: [at.x, h, at.z], seed: 47, count: 16, speed: 2.5 * cell, life: 0.9, size: 0.12 * cell, color: SHOT_COLOR },
    );
    rollOsc.kick(CRASH_SHAKE_ROLL);
    pitchOsc.kick(CRASH_SHAKE_PITCH);
  }

  // Projektil-Ereignis (aus shotsStep): Verpuffen an der Wand, Feind-Abschuss
  // oder die Spinner-Faelle -- Funken am gekuerzten Spike ('spike'), gruene
  // Explosion beim Abschuss ('spinner'), Abprallen am geschuetzten Koerper
  // an der Wand ('shield').
  function spawnShotEvent(ev) {
    const h = EYE_RATIO * cell;
    const hs = SPINNER.height * cell; // Spinner leben unterhalb der Augenhoehe
    if (ev.type === 'wall' || ev.type === 'shield') {
      game.audio?.play(poofPatch());
      bursts.push({ born: sceneT, center: [ev.x, ev.type === 'shield' ? hs : h, ev.z], seed: bursts.length + 1, count: 8, speed: 1.2 * cell, life: 0.35, size: 0.07 * cell, color: SHOT_COLOR });
    } else if (ev.type === 'spike') {
      game.audio?.play(clinkPatch());
      bursts.push({ born: sceneT, center: [ev.x, hs, ev.z], seed: bursts.length + 3, count: 6, speed: 1.4 * cell, life: 0.3, size: 0.06 * cell, color: SPINNER_COLOR });
    } else if (ev.type === 'spinner') {
      game.audio?.play(boomPatch());
      bursts.push({ born: sceneT, center: [ev.x, hs, ev.z], seed: bursts.length + 5, count: 18, speed: 2.5 * cell, life: 0.8, size: 0.13 * cell, color: SPINNER_COLOR });
    } else {
      game.audio?.play(boomPatch());
      bursts.push({ born: sceneT, center: [ev.x, h, ev.z], seed: bursts.length + 5, count: 18, speed: 2.5 * cell, life: 0.8, size: 0.13 * cell, color: ENEMY_COLOR });
    }
  }

  function recordState() {
    game.playerState = { px, pz, yaw };
  }

  // Fahr-Modus: ein Simulationsschritt (Vortrieb, Lenken, Abprall + Effekte).
  function updateDrive(turn, dt) {
    if (!reached) {
      const res = driveStep(maze, driveState, { px, pz, yaw }, turn, dt, {
        unit, cell, radius: RADIUS_RATIO * cell,
        targetSpeed: braking ? 0 : undefined, // Q: erst ausrollen ...
      });
      px = res.px;
      pz = res.pz;
      yaw = res.yaw;
      if (res.collision) spawnCollision(res.collision);
    }
    // Abheben, sobald ausgerollt (oder man waehrend des Ausrollens das Ziel
    // erreicht hat -- dann steht man ohnehin) plus ein kurzer Beat Stillstand.
    // Auch der Feder-Impuls muss abgeklungen sein, sonst rutscht man beim
    // Abheben noch seitwaerts.
    const settled = driveState.vel === 0 && driveState.push.x === 0 && driveState.push.z === 0;
    if (braking && (reached || settled)) {
      brakeHold += dt;
      if (brakeHold >= BRAKE_HOLD) game.dispatch(GameEvent.EXIT, { fade: false });
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
      rollOsc.reset();
      pitchOsc.reset();

      // Feinde: gehoeren zum Labyrinth-Durchlauf (game.enemies) -- bei
      // Fortsetzung von der Karte bleiben sie (samt Abschuessen) erhalten,
      // ein frischer Anlauf (auch Retry nach Game Over) wuerfelt sie neu.
      // Deterministisch aus dem Maze-Seed -> headless reproduzierbar.
      if (cfg?.enemies) {
        if (!game.resume || !game.enemies) {
          game.enemies = createEnemies(maze, cfg.enemies, {
            unit, cell, rng: createRng((maze.seed ^ 0x5bd1e995) >>> 0),
          });
        }
      } else {
        game.enemies = null;
      }
      enemies = game.enemies ?? [];
      // Spinner: gleiche Lebensdauer-Regeln wie die Rauten (Resume behaelt
      // den Zustand samt Abschuessen, frischer Anlauf wuerfelt neu).
      if (cfg?.spinners) {
        if (!game.resume || !game.spinners) {
          game.spinners = createSpinners(maze, cfg.spinners, {
            unit, cell, rng: createRng((maze.seed ^ 0x9e3779b9) >>> 0),
          });
        }
      } else {
        game.spinners = null;
      }
      spinners = game.spinners ?? [];
      shotsState = createShotsState();
      bursts = [];
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
      game.audio?.engine(null); // Motor-Klang ausblenden (die Karte ist still)
    },

    update(dt) {
      sceneT += dt;

      // Nach der Feindberuehrung: Steuerung eingefroren, nur die Explosion
      // und das Nachschwingen laufen noch -- dann hinaus zur Karte.
      if (crash) {
        crashT += dt;
        rollOsc.step(dt);
        pitchOsc.step(dt);
        waves = waves.filter((w) => sceneT - w.born < WAVE_LIFE);
        bursts = bursts.filter((b) => sceneT - b.born < b.life);
        if (crashT >= CRASH_TIME) game.dispatch(GameEvent.EXIT, { fade: false });
        return;
      }

      const keys = game.keys;
      const left = keys.has('ArrowLeft') || keys.has('A');
      const right = keys.has('ArrowRight') || keys.has('D');
      const turn = (left ? 1 : 0) - (right ? 1 : 0);

      if (drive) {
        updateDrive(turn, dt);
        // Motor-Klang: Tonhoehe/Pegel folgen dem Tempo, das Sirren der
        // Kurvenneigung (bank ist schon weich nachgefuehrt).
        game.audio?.engine(engineParams('drive', {
          speed: reached ? 0 : driveState.vel / DRIVE.cruise,
          bank: Math.abs(bank) / BANK_MAX,
        }));
      } else {
        const fwd = keys.has('ArrowUp') || keys.has('W');
        const back = keys.has('ArrowDown') || keys.has('S');
        const move = reached ? 0 : (fwd ? 1 : 0) - (back ? 1 : 0);
        const res = walkStep(maze, walkState, { px, pz, yaw }, { move, turn }, dt, {
          unit, cell, radius: RADIUS_RATIO * cell,
        });
        ({ px, pz, yaw } = res);
        if (res.collision) game.audio?.play(bumpPatch(res.collision.impact));
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
      // ODER Aufspiessen am Spike = Game Over (beim Aufspiessen ueberlebt der
      // Spinner -- nur die Koerper-Kollision reisst ihn mit).
      if (spinners.length) {
        spinnersStep(spinners, dt, cell);
        const hit = spinnerPlayerHit(spinners, px, pz, RADIUS_RATIO * cell, cell);
        if (hit && !reached) {
          startCrash(hit, {
            kill: hit.impale ? null : hit.spinner,
            color: SPINNER_COLOR, height: SPINNER.height * cell,
          });
          return;
        }
      }

      // Schiessen: Space als Dauerfeuer, Tempest-Regel (max 8 unterwegs).
      // Zielrichtung = Blick + Lenk-Ausschlag zum Abschusszeitpunkt.
      if (shoot) {
        const steer = drive ? driveState.steer : walkState.steer;
        if (keys.has(' ') && !reached && fireShot(shotsState, { px, pz, yaw }, steer)) {
          game.audio?.play(shotPatch());
        }
        const events = shotsStep(maze, shotsState, dt, {
          unit, cell, enemies, enemyRadius: ENEMY.shotRadius * cell,
          hitTest: spinners.length ? (x, z) => spinnerShotHit(spinners, x, z, cell) : null,
        });
        for (const ev of events) spawnShotEvent(ev);
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
        if (reachedTime >= GOAL_AUTO_EXIT) game.dispatch(GameEvent.EXIT, { fade: false });
      }
    },

    render(renderer) {
      // Kurvenneigung + mechanische Schwingungen NICHT in die 3D-Kamera (das
      // braeche die azimutale Hidden-Line-Annahme), sondern als Bildraum-
      // Schwenk ueber die komplette 3D-Sicht (Waende + Wellen, ohne HUD).
      if (drive) {
        renderer.pushSway(swayTransform(bank + rollOsc.x, pitchOsc.x, { height: renderer.height, fov: camera.fov }));
      }
      const pose = egoPose(face, px, pz, yaw, cell);
      const view = renderFaceWalls(renderer, walls, footprints, camera, pose, { far: FAR_RATIO * cell, near: NEAR_RATIO * cell });

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
          intensity: 0.95, dim: ENEMY_OCC_DIM, color: ENEMY_COLOR, glow: ENEMY_GLOW,
        });
      }

      // Spinner: gruene rotierende Spiralen samt Spike, gleiche Hidden-Line-
      // Behandlung wie die Rauten (verdeckt schimmern sie durch die Wand --
      // man ahnt den Spike hinter der Ecke).
      const aliveSpinners = spinners.filter((s) => s.alive);
      if (aliveSpinners.length) {
        const segs = [];
        for (const s of aliveSpinners) {
          segs.push(...spinnerSegments(s, sceneT, { cell }));
        }
        renderFaceOverlay(renderer, faceSegments(segs, face), camera, view, {
          intensity: 0.95, dim: ENEMY_OCC_DIM, color: SPINNER_COLOR, glow: ENEMY_GLOW,
        });
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
        const anchor = renderer.worldToScreen(
          faceLocalToWorld(px - Math.sin(aim) * d, EYE_RATIO * cell, pz - Math.cos(aim) * d, face, CUBE_SIZE), camera);
        const above = renderer.worldToScreen(
          faceLocalToWorld(px - Math.sin(aim) * d, (EYE_RATIO + CROSSHAIR_SIZE) * cell, pz - Math.cos(aim) * d, face, CUBE_SIZE), camera);
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
      const hint = shoot ? 'LEFT/RIGHT STEER - SPACE FIRE - Q MAP'
        : drive ? 'LEFT/RIGHT STEER - Q MAP' : 'ARROWS MOVE - Q MAP';
      renderer.drawText(hint, {
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
    },

    onKey(key) {
      if (key !== 'Q' || crash) return; // waehrend der Explosion kein Abheben mehr
      if (drive && !reached) {
        braking = true; // Fahrt-Modus: erst abbremsen, updateDrive hebt dann ab
      } else {
        game.dispatch(GameEvent.EXIT, { fade: false }); // nahtlos in den Rueckschwenk
      }
    },
  };
}
