// Gemeinsame 1980-Zeichnung der Ego-WELT (Waende, Sterne, Ziel-Leuchtfeuer,
// Feuerwerk, Kollisionswellen, Feinde, Schuesse, Splitter) -- aus playing.js
// gehoben (Beginn der "playing-Zerlegung", PLAN2026 Stufe 6), damit die
// REPLAY-Szene exakt dieselbe Welt zeichnet, nur aus aufgezeichnetem statt
// gelebtem Zustand. Bewusst OHNE Steuer-Gefuehl (Sway/Shatter/HUD/Fadenkreuz):
// das bleibt Sache der Szenen.
//
// Alles rein aus uebergebenem Zustand -- kein eigener Szenen-Zustand.

import { enemySegments } from '../world/enemies.js';
import { SPINNER, spinnerSegments, spinnerShotSegments, spinnerShown } from '../world/spinners.js';
import { flipperSegments } from '../world/flippers.js';
import { pulsarSegments } from '../world/pulsars.js';
import { shotSegments } from '../world/shots.js';
import { burstSegments } from '../world/burst.js';
import { NEON_MAGENTA, ARCADE_YELLOW } from '../render/colors.js';
import {
  goalZone, goalMarkerSegments, goalBeamFeet, beamFlicker, beamOcclusionCut,
} from '../world/goal.js';
import { fireworkBeams, FIREWORK_COLORS } from '../world/fireworks.js';
import { STARS, starDirection, skylineElevation, starTwinkle } from '../world/stars.js';
import { collisionWave, waveSegments } from '../world/waves.js';
import { wallFootprints } from '../world/mazeWorld.js';
import { faceLocalToWorld } from '../world/cubeFaces.js';
import {
  CUBE_SIZE, WALL_RATIO, EYE_RATIO, FAR_RATIO, cellSize, unitSize,
  faceWalls, faceFootprints, faceSegments, renderFaceWalls, renderFaceOverlay,
  egoPose,
} from './mazeView.js';

// Ziel-Zone und -Leuchtfeuer (Masse und Verdeckungs-Regeln s. playing.js).
export const GOAL_INSET_RATIO = 0.25; // Einrueckung pro Seite (Anteil der Feldgroesse)
const BEAM_HEIGHT_RATIO = 60;    // Strahlhoehe in Zellen (quasi unendlich)
const BEAM_PER_EDGE = 3;         // Strahlen pro Quadratkante (12 gesamt)
const BEAM_MAX_INT = 0.7;        // hellster Flacker-Wert der Strahlen
const BEAM_WANDER_RATE = 0.7;    // Wander-Stuetzstellen pro Sekunde
const GOAL_MARKER_INT = 0.9;     // Intensitaet des Boden-Quadrats
const GOAL_OCC_DIM = 0.2;        // verdeckt: doppelt so hell wie Wandkanten (DIM 0.1)
export const GOAL_FLASH_TIME = 1.0; // s: weisses Aufstrahlen + Erloeschen am Ziel
const FIREWORK_SPREAD = 2.2;     // Feuerwerk-Radius um die Zielmitte (Gangbreiten)
const FIREWORK_HEIGHT = 8;       // maximale Feuerwerk-Strahlhoehe (Gangbreiten)

// Kollisionswellen (Fahr-Modus): Wellenzuege + weisses Blitz-Kreuz.
export const WAVE_FX = {
  speedRatio: 1.5, // Wellen-Tempo in Gangbreiten/s
  life: 0.9,       // s Lebensdauer einer Welle
  armRatio: 0.25,  // Start-Halbarmlaenge des Kreuzes (Gangbreiten)
  pulses: 3,       // Wellenzuege pro Aufprall
  pulseDelay: 0.12, // s Abstand der Wellenzuege
};
// Gesamtdauer eines Aufpralls (letzter Wellenzug fertig) -- Replay-Fenster.
export const WAVE_TOTAL_LIFE = WAVE_FX.life + (WAVE_FX.pulses - 1) * WAVE_FX.pulseDelay;
const FLASH_TIME = 0.15;      // s: jeder Wellenzug startet als weisser Blitz
const FLASH_COLOR = '#ffffff';
const FLASH_GLOW = 16;        // Glow des Blitzes (Standard: 8)

// Kampf-Optik.
const SHOT_COLOR = '#ffffff';    // Projektile und Verpuffen
const FOE_SHOT_FLICKER = 12;     // Farb-Schaltrate der Spinner-Schuesse (Hz)
const ENEMY_GLOW = 12;           // Feinde gluehen etwas staerker (Gefahr)
const ENEMY_OCC_DIM = 0.175;     // verdeckte Feinde schimmern durch die Wand

// Stroke-Batching (shadowBlur-Regel): Flacker-Werte auf Stufen runden und
// pro Stufe in EINEM Aufruf zeichnen.
const FLICKER_STEPS = 4;
function bucketAdd(buckets, key, segments) {
  const list = buckets.get(key);
  if (list) list.push(...segments);
  else buckets.set(key, segments);
}

// Unveraenderliche Welt-Bausteine einer Begehung (einmal pro Maze/Flaeche):
// Wand-Geometrie, Verdecker, Ziel-Zone. Von playing.enter() und der
// Replay-Szene gemeinsam genutzt.
export function buildEgoStatics(maze, face) {
  const cell = cellSize(maze);
  const unit = unitSize(maze);
  const goalInset = GOAL_INSET_RATIO * cell;
  const goalRect = goalZone(maze, unit, goalInset);
  return {
    cell, unit, goalInset, goalRect,
    walls: faceWalls(maze, face, WALL_RATIO * cell),
    footprints: faceFootprints(maze, face),
    goalSegs: faceSegments(goalMarkerSegments(goalRect), face),
    localFoot: wallFootprints(maze, { unit }),
  };
}

// Die Wellenzuege eines Aufpralls (aus playing.spawnCollision gehoben):
// `col` ist die Kollisions-Meldung aus drive.js, `born` die Szenen-/Replay-
// Zeit des Treffers. Nur der erste Wellenzug blitzt weiss.
export function collisionWaveSet(maze, col, born, { unit, cell }) {
  const wave = collisionWave(maze, col, { unit, eye: EYE_RATIO * cell });
  const out = [];
  for (let i = 0; i < WAVE_FX.pulses; i++) {
    out.push({
      wave, born: born + i * WAVE_FX.pulseDelay,
      strength: col.impact * (1 - i / WAVE_FX.pulses), flash: i === 0,
    });
  }
  return out;
}

// Zeichnet die komplette Ego-Welt fuer einen Frame und liefert das
// Verdeckungs-Ergebnis (view) fuer weitere Overlays der Szene.
// ctx: { maze, face, statics, px, pz, yaw, t, near,
//   stars, rainbow, reached, reachedAt, waves, enemies, spinners, flippers,
//   pulsars, foeShots, shots, bursts, enemyCol, spinnerCol }
// (Listen duerfen leer sein; stars null = kein Himmel.)
export function renderEgoWorld(renderer, camera, ctx) {
  const {
    maze, face, statics, px, pz, yaw, t, near,
    stars, rainbow, reached, reachedAt,
  } = ctx;
  const { cell, unit, walls, footprints, goalRect, goalSegs, localFoot } = statics;

  const view = renderFaceWalls(renderer, walls, footprints, camera,
    egoPose(face, px, pz, yaw, cell), { far: FAR_RATIO * cell, near });

  // Sternenhimmel (ab Level 4): weltfeste Sterne, sichtbar nur oberhalb der
  // Wand-Silhouette (DDA-Raycast); als Bildschirm-Kreuzchen, nach Funkel-
  // Stufe (und ab 26 Farbe) gebatcht.
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
      const q = Math.ceil(starTwinkle(st, t) * FLICKER_STEPS) / FLICKER_STEPS;
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

  // Ziel-Leuchtfeuer: Boden-Quadrat mit staerker durchscheinender Verdeckung.
  renderFaceOverlay(renderer, goalSegs, camera, view, { intensity: GOAL_MARKER_INT, dim: GOAL_OCC_DIM });

  // Strahlen: wandern auf der Quadratkante (am Ziel eingefroren) und
  // flimmern; am Ziel blitzen alle weiss auf und erloeschen.
  const flashAge = t - reachedAt;
  if (!reached || flashAge < GOAL_FLASH_TIME) {
    const beamH = BEAM_HEIGHT_RATIO * cell;
    const feet = goalBeamFeet(goalRect, {
      perEdge: BEAM_PER_EDGE, rate: BEAM_WANDER_RATE,
      time: reached ? reachedAt : t, // eingefroren beim Erloeschen
    });
    if (reached) {
      const segs = faceSegments(feet.map(([bx, bz]) => [[bx, 0, bz], [bx, beamH, bz]]), face);
      renderer.renderScene({ segments: segs, intensity: 1 - flashAge / GOAL_FLASH_TIME },
        camera, { near, color: FLASH_COLOR, glow: FLASH_GLOW });
    } else {
      const visBuckets = new Map();
      const dimBuckets = new Map();
      for (let i = 0; i < feet.length; i++) {
        const [bx, bz] = feet[i];
        const cut = Math.min(beamH, beamOcclusionCut(localFoot, [px, pz], feet[i], {
          eye: EYE_RATIO * cell, wallHeight: WALL_RATIO * cell,
        }));
        const qf = Math.ceil(beamFlicker(i, t) * FLICKER_STEPS) / FLICKER_STEPS;
        if (cut > 0) bucketAdd(dimBuckets, qf, faceSegments([[[bx, 0, bz], [bx, cut, bz]]], face));
        if (cut < beamH) bucketAdd(visBuckets, qf, faceSegments([[[bx, cut, bz], [bx, beamH, bz]]], face));
      }
      for (const [qf, segments] of visBuckets) {
        renderer.renderScene({ segments, intensity: BEAM_MAX_INT * qf }, camera, { near });
      }
      for (const [qf, segments] of dimBuckets) {
        renderer.renderScene({ segments, intensity: GOAL_OCC_DIM * BEAM_MAX_INT * qf }, camera, { near });
      }
    }
  }

  // Ziel-FEUERWERK: harte Arcade-Farbwechsel, ohne Verdeckung, gebatcht.
  if (reached) {
    const beams = fireworkBeams(t - reachedAt, {
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
          { near, color, glow: FLASH_GLOW });
      }
    }
  }

  // Kollisionswellen: weisses Blitz-Kreuz, dann auseinanderlaufend.
  for (const wv of ctx.waves ?? []) {
    const age = t - wv.born;
    const geo = waveSegments(wv.wave, age, {
      height: WALL_RATIO * cell, speed: WAVE_FX.speedRatio * cell,
      life: WAVE_FX.life, arm: WAVE_FX.armRatio * cell,
    });
    if (!geo) continue;
    const segments = faceSegments(geo.segments, face);
    renderer.renderScene({ segments, intensity: geo.fade * wv.strength }, camera, { near });
    const whiteness = wv.flash ? (1 - age / FLASH_TIME) * wv.strength : 0;
    if (whiteness > 0.01) {
      renderer.renderScene({ segments, intensity: whiteness }, camera, { near, color: FLASH_COLOR, glow: FLASH_GLOW });
    }
  }

  // Feinde: verdeckt schimmern sie staerker durch als normale Kanten.
  const foeOverlay = (segs, color) => renderFaceOverlay(
    renderer, faceSegments(segs, face), camera, view,
    { intensity: 0.95, dim: ENEMY_OCC_DIM, color, glow: ENEMY_GLOW });

  const aliveEnemies = (ctx.enemies ?? []).filter((e) => e.alive);
  if (aliveEnemies.length) {
    const segs = [];
    for (const e of aliveEnemies) {
      segs.push(...enemySegments(e, t, {
        cell, px, pz, height: EYE_RATIO * cell, crown: WALL_RATIO * cell,
      }));
    }
    foeOverlay(segs, ctx.enemyCol);
  }

  const aliveSpinners = (ctx.spinners ?? []).filter(spinnerShown); // auch stehen gebliebene Spikes
  if (aliveSpinners.length) {
    const segs = [];
    for (const s of aliveSpinners) segs.push(...spinnerSegments(s, t, { cell }));
    foeOverlay(segs, ctx.spinnerCol);
  }

  const aliveFlippers = (ctx.flippers ?? []).filter((f) => f.alive);
  if (aliveFlippers.length) {
    const segs = [];
    for (const f of aliveFlippers) segs.push(...flipperSegments(f, { cell }));
    foeOverlay(segs, NEON_MAGENTA);
  }

  if ((ctx.pulsars ?? []).length) {
    const segs = [];
    for (const p of ctx.pulsars) segs.push(...pulsarSegments(p, t, { cell }));
    foeOverlay(segs, ARCADE_YELLOW);
  }

  // Spinner-Schuesse: sirrende Funken-Sterne in FLIRRENDEN Farben.
  for (const s of ctx.foeShots ?? []) {
    const color = FIREWORK_COLORS[
      Math.floor(t * FOE_SHOT_FLICKER + (s.phase ?? 0)) % FIREWORK_COLORS.length];
    renderer.renderScene(
      { segments: faceSegments(spinnerShotSegments(s, t, { cell }), face) },
      camera, { near, color, glow: 10 });
  }

  // Eigene Projektile: weisse rotierende Sterne (Billboard zur Blickrichtung).
  if ((ctx.shots ?? []).length) {
    const segs = [];
    for (const s of ctx.shots) {
      segs.push(...shotSegments(s, t, { cell, yaw, height: EYE_RATIO * cell }));
    }
    renderer.renderScene({ segments: faceSegments(segs, face) }, camera,
      { near, color: SHOT_COLOR, glow: 10 });
  }

  // Splitter-Explosionen (Verpuffen, Feind-Abschuss, Crash). Der Schiffs-
  // Burst des Spieler-Crashs ist NUR fuer die 2026-Engine (only2026, dort
  // schneidet die Kamera nach aussen) -- 1980 sitzt die Kamera IM Schiff,
  // sein Crash bleibt das klassische Zerbersten des Bildes.
  for (const b of ctx.bursts ?? []) {
    if (b.only2026) continue;
    const geo = burstSegments(t - b.born, b);
    if (!geo) continue;
    renderer.renderScene({ segments: faceSegments(geo.segments, face), intensity: geo.fade },
      camera, { near, color: b.color, glow: 10 });
  }

  return view;
}
