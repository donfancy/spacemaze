// Zustand "Replay": Wiedergabe des aufgezeichneten Laufs (R auf der Karte).
// Die Zeit ist hier nur ein ZEIGER in die Aufnahme (core/recorder.js):
// Space pausiert, links/rechts schalten das Tempo durch (1/2/4/8x, auch
// rueckwaerts), R/X/Q zurueck zur Karte. Sounds und Effekte kommen aus der
// Event-Spur; der Motor-Klang folgt den aufgezeichneten Kanaelen -- beides
// nur bei normalem Vorwaertslauf (1x), Spulen ist stumm.
//
// 1980 zeichnet die Ego-Sicht ueber den gemeinsamen Welt-Zeichner
// (scenes/egoWorld.js -- exakt derselbe Code wie die Live-Begehung); die
// Zusatz-Kameras und der Gleiter-Avatar sind 2026-Sache (backend.js liest
// viewState(), Hidden-Lines-Regel: die 1980-Kamera bleibt Ego/horizontal).

import { GameEvent } from '../core/states.js';
import { replayHint, replayStatus } from '../core/hud.js';
import {
  recordingStart, recordingDuration, sampleAt, eventsBetween, activeEvents, lastEventBefore,
} from '../core/recorder.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import { SIDE_FACES } from '../world/cubeFaces.js';
import { STARS, createStars } from '../world/stars.js';
import { swayTransform } from '../render/sway.js';
import { levelConfig, spinnerColor, enemyColor } from '../core/levels.js';
import {
  bumpPatch, sizzlePatch, fanfarePatch, engineParams,
  shotPatch, poofPatch, boomPatch, crashPatch, clinkPatch, whirrPatch, gyroPatch,
} from '../sound/patches.js';
import { NEAR_RATIO } from './mazeView.js';
import {
  buildEgoStatics, renderEgoWorld, collisionWaveSet, WAVE_TOTAL_LIFE,
} from './egoWorld.js';
import { BANK_MAX } from './playing.js';

// Tempo-Leiter: links/rechts wandern den Zeiger -- negative Werte spulen
// rueckwaerts. Start bei 1x.
const SPEEDS = [-8, -4, -2, -1, 1, 2, 4, 8];
const START_SPEED = SPEEDS.indexOf(1);
const BURST_LIFE_MAX = 1.3;  // laengste Burst-Lebensdauer (Crash 1.2) + Luft
const BUMP_WINDOW = 0.6;     // s: so lange wirkt eine Bump-/Kollisions-Flanke nach
const CRASH_FLASH = 0.18;    // s: weisser Einschlag-Blitz (wie playing)

// Kamera-Modi der 2026-Wiedergabe (C schaltet durch; 1980 bleibt Ego).
export const REPLAY_CAMS = ['ego', 'chase', 'bird', 'total', 'orbit'];

// Sound eines aufgezeichneten Events (nur bei 1x vorwaerts gespielt).
const SOUND_PATCHES = {
  shot: shotPatch, poof: poofPatch, clink: clinkPatch,
  boom: boomPatch, whirr: whirrPatch,
};
function eventPatch(e) {
  switch (e.type) {
    case 'bump': return bumpPatch(e.impact);
    case 'collision': return sizzlePatch(e.col.impact);
    case 'reached': return fanfarePatch();
    case 'crash': return crashPatch();
    case 'gyro': return gyroPatch(e.dur);
    case 'sound': return SOUND_PATCHES[e.name] ? SOUND_PATCHES[e.name]() : null;
    default: return null; // 'burst' u.a. sind rein visuell
  }
}

export function createReplay(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });

  let rec = null;
  let maze = null;
  let face = null;
  let statics = null;
  let cell = 1;
  let unit = 1;
  let stars = null;
  let rainbow = false;
  let drive = false;
  let shoot = false;
  let enemyCol = null;
  let spinnerCol = null;
  let tau = 0;       // Wiedergabe-Zeiger (Aufnahme-Zeitachse)
  let speedIdx = START_SPEED;
  let paused = false;
  let cur = null;    // interpoliertes Sample zu tau
  let puppets = null; // stabile Tanker-Liste (2026-Rebuild-Schluessel ist
                      // die Array-IDENTITAET -- pro Frame nur Felder kopieren)
  const waveCache = new Map(); // Kollisions-Event -> fertige Wellenzuege

  const speed = () => SPEEDS[speedIdx];
  const start = () => recordingStart(rec);
  const duration = () => recordingDuration(rec);

  // Tanker-Puppen nachfuehren: Positionen/alive aus dem Sample in die
  // STABILE Liste kopieren (die 2026-Engine haengt ihre Meshes daran).
  function syncPuppets() {
    const src = cur?.enemies;
    if (!src) {
      puppets = null;
      return;
    }
    if (!puppets || puppets.length !== src.length) {
      puppets = src.map((e) => ({ ...e }));
      return;
    }
    for (let i = 0; i < src.length; i++) {
      puppets[i].x = src[i].x;
      puppets[i].z = src[i].z;
      puppets[i].alive = src[i].alive;
    }
  }

  // Zustand aus der Event-Spur zur Zeit tau ableiten (rueckspul-fest).
  function derived() {
    const reachedEv = lastEventBefore(rec, tau, 'reached');
    const crashEv = lastEventBefore(rec, tau, 'crash');
    const bumpEv = lastEventBefore(rec, tau, 'bump');
    const colEv = lastEventBefore(rec, tau, 'collision');
    // Juengere der beiden Flanken als Bump (2026: Blitz/Funken/Impuls).
    let bump = null;
    const pick = (e, fields) => (e && tau - e.t < BUMP_WINDOW ? { at: e.t, ...fields } : null);
    if (colEv && (!bumpEv || colEv.t > bumpEv.t)) {
      bump = pick(colEv, {
        axis: colEv.col.axis, side: colEv.col.side, impact: colEv.col.impact,
        x: cur.px, z: cur.pz, point: colEv.col.point,
      });
    } else if (bumpEv) {
      bump = pick(bumpEv, {
        axis: bumpEv.axis, side: bumpEv.side, impact: bumpEv.impact,
        x: bumpEv.x, z: bumpEv.z,
      });
    }
    const bursts = activeEvents(rec, tau, 'burst', BURST_LIFE_MAX)
      .filter((e) => tau - e.t < e.spec.life)
      .map((e) => ({ ...e.spec, born: e.t }));
    return {
      reached: !!reachedEv,
      reachedAt: reachedEv ? reachedEv.t : 0,
      crash: crashEv ? { t: tau - crashEv.t, x: crashEv.x, z: crashEv.z } : null,
      bump, bursts,
    };
  }

  // Kollisionswellen (1980-Fahrt-Optik) aus den Events, pro Event gecacht.
  function activeWaves() {
    const out = [];
    for (const e of activeEvents(rec, tau, 'collision', WAVE_TOTAL_LIFE)) {
      let set = waveCache.get(e);
      if (!set) {
        set = collisionWaveSet(maze, e.col, e.t, { unit, cell });
        waveCache.set(e, set);
      }
      out.push(...set);
    }
    return out;
  }

  return {
    enter() {
      rec = game.recording;
      maze = game.maze ?? generateMaze(11, {});
      face = game.dockFace ?? SIDE_FACES[0];
      statics = buildEgoStatics(maze, face);
      ({ cell, unit } = statics);
      const cfg = levelConfig(game.level);
      drive = rec?.meta?.drive ?? !!cfg?.drive;
      shoot = rec?.meta?.shoot ?? !!cfg?.shoot;
      rainbow = rec?.meta?.rainbow ?? !!cfg?.rainbowStars;
      enemyCol = enemyColor(game.level);
      spinnerCol = spinnerColor(game.level);
      stars = game.level >= STARS.minLevel ? createStars(maze.seed) : null;
      tau = start();
      speedIdx = START_SPEED;
      paused = false;
      puppets = null;
      waveCache.clear();
      cur = rec ? sampleAt(rec, tau) : null;
      syncPuppets();
    },

    exit() {
      game.audio?.engine(null);
    },

    update(dt) {
      if (!rec || !cur) {
        // Ohne Aufnahme (Direkteinstieg) sofort zurueck zur Karte.
        game.dispatch(GameEvent.EXIT);
        return;
      }
      if (!paused) {
        const prev = tau;
        tau += speed() * dt;
        // An den Enden anhalten (von dort laesst sich zurueckspulen).
        if (tau >= duration()) { tau = duration(); paused = true; }
        if (tau <= start()) { tau = start(); if (speed() < 0) paused = true; }
        // Sounds nur beim normalen Vorwaertslauf -- Spulen ist stumm.
        if (speed() === 1 && game.audio) {
          for (const e of eventsBetween(rec, prev, tau)) {
            const p = eventPatch(e);
            if (p) game.audio.play(p);
          }
        }
      }
      cur = sampleAt(rec, tau);
      syncPuppets();

      // Motor-Klang aus den aufgezeichneten Kanaelen (Formeln wie playing).
      if (speed() === 1 && !paused) {
        game.audio?.engine(drive
          ? engineParams('drive', { speed: cur.speed, bank: Math.abs(cur.bank) / BANK_MAX })
          : engineParams('walk', { speed: cur.speed, steer: Math.abs(cur.steer) }));
      } else {
        game.audio?.engine(null);
      }
    },

    render(renderer) {
      if (!cur) return;
      const near = NEAR_RATIO * cell;
      const d = derived();

      // Blick-Verdrehung/Kurvenneigung wie live: Bildraum-Sway, die
      // 3D-Kamera bleibt horizontal (Hidden-Lines-Regel 4).
      const sway = Math.abs(cur.roll) > 1e-4 || Math.abs(cur.pitch) > 1e-4;
      if (sway) {
        renderer.pushSway(swayTransform(cur.roll, cur.pitch, {
          height: renderer.height, fov: camera.fov,
        }));
      }
      renderEgoWorld(renderer, camera, {
        maze, face, statics, px: cur.px, pz: cur.pz, yaw: cur.yaw,
        t: tau, near, stars, rainbow,
        reached: d.reached, reachedAt: d.reachedAt,
        waves: activeWaves(),
        enemies: puppets ?? [], spinners: cur.spinners ?? [],
        flippers: cur.flippers ?? [], pulsars: cur.pulsars ?? [],
        foeShots: cur.foeShots ?? [], shots: cur.shots ?? [],
        bursts: d.bursts, enemyCol, spinnerCol,
      });
      if (sway) renderer.popSway();

      const w = renderer.width;
      const h = renderer.height;
      renderer.drawText(replayStatus({
        t: tau - start(), duration: duration() - start(),
        speed: speed(), paused,
      }), {
        x: 24, y: 24, size: Math.min(20, h * 0.03),
        align: 'left', baseline: 'top', intensity: 0.7,
      });
      renderer.drawText(replayHint({ cams: game.engine === '2026' }), {
        x: w - 24, y: h - 20, size: 13,
        align: 'right', baseline: 'bottom', intensity: 0.5,
      });

      // Fortschritts-Linie unten: gedimmte Gesamtspur, helle bis tau.
      const span = Math.max(1e-9, duration() - start());
      const p = (tau - start()) / span;
      const y = h - 44;
      renderer.drawPolylines([[[24, y], [w - 24, y]]], { intensity: 0.2, lineWidth: 1.5 });
      if (p > 0.001) {
        renderer.drawPolylines([[[24, y], [24 + (w - 48) * p, y]]], { intensity: 0.8, lineWidth: 2.5 });
      }

      // Crash-Moment: der weisse Einschlag-Blitz auch in der Wiedergabe.
      if (d.crash && d.crash.t < CRASH_FLASH && !paused) {
        renderer.flash(0.9 * (1 - d.crash.t / CRASH_FLASH));
      }
    },

    // Lese-Schnittstelle fuer die 2026-Engine: Playing-foermiger Zustand
    // plus Wiedergabe-Extras (Kamera-Modus, Fortschritt) und die Feind-
    // Puppen (Tanker STABIL -- die Engine haengt ihre Meshes an die Liste).
    viewState() {
      if (!rec || !cur) return null;
      const d = derived();
      return {
        maze, cell, unit,
        px: cur.px, pz: cur.pz, yaw: cur.yaw,
        roll: cur.roll, pitch: cur.pitch, bank: cur.bank,
        sceneT: tau, drive, shoot, steer: cur.steer,
        reached: d.reached, reachedAt: d.reachedAt,
        bump: d.bump, bursts: d.bursts, crash: d.crash,
        shots: cur.shots ?? [], foeShots: cur.foeShots ?? [],
        foes: {
          enemies: puppets, spinners: cur.spinners,
          flippers: cur.flippers, pulsars: cur.pulsars,
        },
        replay: {
          t: tau - start(), duration: duration() - start(),
          speed: speed(), paused, cam: REPLAY_CAMS[game.replayCam % REPLAY_CAMS.length],
        },
      };
    },

    onKey(key) {
      if (key === ' ') {
        paused = !paused;
      } else if (key === 'ArrowRight') {
        if (speedIdx < SPEEDS.length - 1) speedIdx++;
        paused = false;
      } else if (key === 'ArrowLeft') {
        if (speedIdx > 0) speedIdx--;
        paused = false;
      } else if (key === 'C') {
        // Kamera-Modus (nur 2026 sichtbar -- 1980 bleibt Ego, s.o.).
        game.replayCam = (game.replayCam + 1) % REPLAY_CAMS.length;
      } else if (key === 'R' || key === 'X' || key === 'Q') {
        game.dispatch(GameEvent.EXIT); // zurueck zur Karte
      }
    },
  };
}
