// Zustand "Spielablauf": Ego-Perspektive im Labyrinth.
// Zwei Steuerungs-Modi (Level-Eigenschaft `drive`):
//   - Tank (Level 1-5): vor/zurueck + drehen.
//   - Fahrt (ab Level 6): automatischer Vortrieb, nur links/rechts lenken;
//     Wandkontakt federt zurueck, loest Kollisionswellen auf der Wand und
//     mechanische Kamera-Schwingungen aus, Kurven neigen die Kamera.
// Zeichnet den abgelaufenen Weg auf (game.trail) und merkt die Spielerlage
// (game.playerState) fuer den Rueckschwenk. Q -> zurueck zur Karte; am Ziel
// loest der Rueckschwenk nach 20 s automatisch aus.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { createOscillator } from '../math/oscillator.js';
import { generateMaze } from '../world/maze.js';
import { cellCenter, tryMove, startFacingYaw, wallFootprints } from '../world/mazeWorld.js';
import { DRIVE, createDriveState, driveStep } from '../world/drive.js';
import {
  goalZone, inGoalZone, goalMarkerSegments, goalBeamFeet, beamFlicker, beamOcclusionCut,
} from '../world/goal.js';
import { collisionWave, waveSegments } from '../world/waves.js';
import { recordTrailPoint } from '../world/trail.js';
import { compassLayout } from '../render/compass.js';
import { swayTransform } from '../render/sway.js';
import { SIDE_FACES } from '../world/cubeFaces.js';
import { levelConfig } from '../core/levels.js';
import {
  WALL_RATIO, EYE_RATIO, FAR_RATIO, NEAR_RATIO, cellSize, unitSize,
  faceWalls, faceFootprints, faceSegments, renderFaceWalls, renderFaceOverlay, egoPose,
} from './mazeView.js';

const MOVE_RATIO = 2.2;     // Zellen pro Sekunde
const TURN_SPEED = 2.2;     // Radiant pro Sekunde
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
  let bank = 0;      // aktuelle Kurvenneigung (rad)
  let waves = [];    // aktive Kollisionswellen {wave, born, strength}
  let sceneT = 0;    // Szenenzeit fuer die Wellen-Alter
  let braking = false;  // Q gedrueckt: erst abbremsen, dann abheben
  let brakeHold = 0;    // s Stillstand vor dem Abheben (kurzer Beat)
  const rollOsc = createOscillator({ freq: 5, damping: 0.22 });
  const pitchOsc = createOscillator({ freq: 8, damping: 0.3 });

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

  // Aufprall: Wellenzuege auf der getroffenen Wand + mechanische Schwingung.
  function spawnCollision(col) {
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
      drive = !!levelConfig(game.level)?.drive;
      driveState = createDriveState(); // vel 0: nach dem Reinfallen faehrt man mit der Rampe los
      bank = 0;
      waves = [];
      sceneT = 0;
      braking = false;
      brakeHold = 0;
      rollOsc.reset();
      pitchOsc.reset();
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
    },

    update(dt) {
      sceneT += dt;
      const keys = game.keys;
      const left = keys.has('ArrowLeft') || keys.has('A');
      const right = keys.has('ArrowRight') || keys.has('D');
      const turn = (left ? 1 : 0) - (right ? 1 : 0);

      if (drive) {
        updateDrive(turn, dt);
      } else {
        const fwd = keys.has('ArrowUp') || keys.has('W');
        const back = keys.has('ArrowDown') || keys.has('S');
        yaw += turn * TURN_SPEED * dt;

        const move = (fwd ? 1 : 0) - (back ? 1 : 0);
        if (move !== 0 && !reached) {
          const step = MOVE_RATIO * cell * dt * move;
          const dx = -Math.sin(yaw) * step;
          const dz = -Math.cos(yaw) * step;
          [px, pz] = tryMove(maze, px, pz, dx, dz, { unit, radius: RADIUS_RATIO * cell });
        }
      }

      // Weg praezise aufzeichnen: echte Position, gerade Strecken zusammengefasst.
      recordTrailPoint(game.trail, px, pz, { minDist: TRAIL_DIST_RATIO * cell });
      recordState();

      // Streng: die Kante des Zielfelds reicht nicht, man muss mindestens
      // GOAL_INSET_RATIO der Feldgroesse "drinnen" stehen (= das Boden-Quadrat).
      if (!reached && inGoalZone(maze, px, pz, unit, goalInset)) {
        reached = true;
        reachedAt = sceneT; // ab hier: weisses Aufstrahlen + Erloeschen
        game.reachedGoal = true; // die Karte bietet dann kein Weiterspielen mehr an
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
      if (drive) renderer.popSway();

      const w = renderer.width;
      const h = renderer.height;
      renderer.drawText('FIND THE EXIT', {
        x: 24, y: 24, size: Math.min(20, h * 0.03),
        align: 'left', baseline: 'top', intensity: 0.7,
      });
      renderer.drawText(drive ? 'LEFT/RIGHT STEER - Q MAP' : 'ARROWS MOVE - Q MAP', {
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
      if (key !== 'Q') return;
      if (drive && !reached) {
        braking = true; // Fahrt-Modus: erst abbremsen, updateDrive hebt dann ab
      } else {
        game.dispatch(GameEvent.EXIT, { fade: false }); // nahtlos in den Rueckschwenk
      }
    },
  };
}
