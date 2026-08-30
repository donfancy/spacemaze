// Startbildschirm in drei Phasen:
//   'orbiting'  - die Kamera umtanzt einen Drahtwuerfel, "PRESS S TO START" blinkt,
//                 oberhalb steht das per Pfeiltasten waehlbare Level.
//   'docking'   - nach S faehrt die Kamera harmonisch frontal vor die Wuerfelseite,
//                 die ihr beim Druck am meisten zugewandt ist (min Blick . Normale).
//                 Verdeckte Kanten faden von 30% auf 0%, sodass am Ende nur das
//                 Quadrat (diese Flaeche = das Grid) uebrig bleibt.
//   'undocking' - Rueckweg von der Karte (game.undock): das Andocken rueckwaerts.
//                 Die Kamera loest sich von der Flaeche, verdeckte Kanten faden
//                 von 0% auf 30% ein, und der Flug endet an der Stelle der
//                 Orbit-Bahn, die dieser Flaeche zugewandt ist -- dort laeuft
//                 das Umtanzen nahtlos weiter.
// Nach Abschluss des Andockens uebernimmt MazeGen nahtlos dieselbe Flaeche.
//
// Tasten (Stufe 3): links/rechts = Level, hoch/runter = Engine-Schalter
// "1980 / 2026" (hoch = 2026, runter = 1980; main.js merkt die Wahl in
// localStorage und laedt/zeigt das 2026-Backend live).

import { GameEvent } from '../core/states.js';
import { blinkOn, displayLevel } from '../core/hud.js';
import { stepLevel, levelColor, MIN_LEVEL, MAX_LEVEL } from '../core/levels.js';
import { ENGINE_1980, ENGINE_2026 } from '../core/engine.js';
import { PHOSPHOR_GREEN, mixColors } from '../render/colors.js';
import { tickPatch, dockPatch } from '../sound/patches.js';
import { createCamera } from '../math/camera.js';
import { normalize } from '../math/vec3.js';
import { cubeMesh } from '../world/shapes.js';
import { orbitCamera, dockPose, orbitTimeFacing } from '../world/cameraPaths.js';
import { classifyEdges } from '../world/visibility.js';
import { pickDockFace, faceDockPose, SIDE_FACES } from '../world/cubeFaces.js';
import { CUBE_SIZE } from './mazeView.js';

const HIDDEN_DIM = 0.3;     // Grunddimmung verdeckter Kanten
// "PRESS S TO START"-Blinken: blinkOn kommt aus core/hud.js -- EINE Formel
// fuer render(), viewState() und das Demo-Overlay des Attract-Mode.
const DOCK_DURATION = 1.6;  // Sekunden fuer das Andocken
// Attract-Mode (Demo): ohne Tastendruck startet nach IDLE Sekunden eine
// Autopilot-Demo; laeuft der Demo-Zyklus schon (Rueckkehr in den Orbit),
// geht es nach der kurzen Schleifen-Pause weiter.
const DEMO_IDLE = 30;
const DEMO_LOOP_IDLE = 7;
const UNDOCK_DURATION = DOCK_DURATION; // Rueckflug symmetrisch gleich lang
// Hoehe leicht begrenzt (max ~31 Grad), damit immer eine SEITENflaeche zugewandt
// ist -- dort dockt die Kamera ohne Gimbal-Rollen an.
const ORBIT_OPTS = {
  center: [0, 0, 0], radius: 5.85, radiusVar: 1.6, azimuthSpeed: 0.36,
  elevation: 0.38, elevationVar: 0.17,
};

export function createStartscreen(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });
  const cube = cubeMesh([0, 0, 0], CUBE_SIZE);

  let t = 0;
  let phase = 'orbiting';
  let dockT = 0;
  let dockStart = null;
  let dockTarget = null;
  let undockT = 0;
  let undockStart = null;
  let undockTarget = null;
  let idle = 0; // Sekunden ohne Tastendruck im Orbit (Attract-Mode-Uhr)

  // Andocken einleiten (S bzw. Demo-Start): zugewandte Flaeche waehlen und
  // den Flug beginnen -- aus onKey gehoben, der Attract-Mode braucht ihn auch.
  function startDock() {
    const o = orbitCamera(t, ORBIT_OPTS);
    // Blickrichtung zur Wuerfelmitte -> zugewandte Seitenflaeche waehlen.
    const viewDir = normalize([-o.position[0], -o.position[1], -o.position[2]]);
    const face = pickDockFace(viewDir);
    game.dockFace = face;
    dockTarget = faceDockPose(face, CUBE_SIZE, camera.fov, 0.85);
    dockStart = { position: o.position, yaw: o.yaw, pitch: o.pitch };
    phase = 'docking';
    dockT = 0;
    game.audio?.play(dockPatch(DOCK_DURATION)); // dezentes Herangleiten
  }

  function applyPose(pose) {
    camera.position = pose.position;
    camera.yaw = pose.yaw;
    camera.pitch = pose.pitch;
  }

  // Aktueller Blick auf den Wuerfel, fuer BEIDE Engines dieselbe Quelle:
  // Pose auf der Bahn, Dimmung der verdeckten Kanten und die Blend-Farbe
  // (null = Renderer-Grundfarbe gruen). p ist der Flug-Fortschritt (0..1).
  function look() {
    if (phase === 'undocking') {
      const p = Math.min(undockT / UNDOCK_DURATION, 1);
      return {
        phase, p, pose: dockPose(p, undockStart, undockTarget),
        hiddenDim: HIDDEN_DIM * p,
        color: mixColors(levelColor(game.level), PHOSPHOR_GREEN, p),
      };
    }
    if (phase === 'orbiting') {
      return { phase, p: 0, pose: orbitCamera(t, ORBIT_OPTS), hiddenDim: HIDDEN_DIM, color: null };
    }
    // 'docking' (und der Moment 'docked'): Blende Richtung Level-Farbe.
    const p = Math.min(dockT / DOCK_DURATION, 1);
    return {
      phase, p, pose: dockPose(p, dockStart, dockTarget),
      hiddenDim: HIDDEN_DIM * (1 - p),
      color: mixColors(PHOSPHOR_GREEN, levelColor(game.level), p),
    };
  }

  // `color` null = Renderer-Grundfarbe (Orbit); beim An-/Abdocken die
  // Blend-Farbe Richtung Level-Thema.
  function drawCube(renderer, hiddenDim, color) {
    const opts = { color: color ?? undefined };
    const { visible, hidden } = classifyEdges(cube, camera.position);
    renderer.renderScene({ segments: hidden, intensity: hiddenDim }, camera, opts);
    renderer.renderScene({ segments: visible, intensity: 1.0 }, camera, opts);
  }

  return {
    enter() {
      t = 0;
      phase = 'orbiting';
      dockT = 0;
      dockStart = null;
      dockTarget = null;
      undockT = 0;
      undockStart = null;
      undockTarget = null;
      idle = 0;

      if (game.undock) {
        // Rueckweg von der Karte: Abdock-Flug von der Andock-Pose zu der Stelle
        // der Orbit-Bahn, die dieser Flaeche zugewandt ist. t startet dort,
        // damit das Umtanzen nach dem Flug nahtlos weiterlaeuft.
        game.undock = false;
        const face = game.dockFace ?? SIDE_FACES[0];
        t = orbitTimeFacing(face.normal, ORBIT_OPTS);
        undockStart = faceDockPose(face, CUBE_SIZE, camera.fov, 0.85);
        undockTarget = orbitCamera(t, ORBIT_OPTS);
        phase = 'undocking';
        game.audio?.play(dockPatch(UNDOCK_DURATION, true)); // dezentes Weggleiten
      }
    },

    update(dt) {
      if (phase === 'undocking') {
        undockT += dt;
        if (undockT >= UNDOCK_DURATION) {
          phase = 'orbiting'; // t steht schon richtig
          idle = 0;
        }
        return; // t (Orbit-Uhr) steht waehrend des Flugs
      }
      t += dt;
      // Attract-Mode: nach IDLE Sekunden ohne Taste startet die Demo (bzw.
      // die naechste Runde des laufenden Demo-Zyklus nach kurzer Pause).
      if (phase === 'orbiting') {
        idle += dt;
        if (idle >= (game.demo ? DEMO_LOOP_IDLE : DEMO_IDLE)) {
          game.beginDemo();
          startDock();
        }
      }
      if (phase === 'docking') {
        dockT += dt;
        if (dockT >= DOCK_DURATION) {
          dockT = DOCK_DURATION;
          phase = 'docked';
          // Nahtlos (ohne Fade) ins Labyrinth: MazeGen uebernimmt dieselbe Flaeche.
          game.dispatch(GameEvent.START);
        }
      }
    },

    render(renderer) {
      const { phase: ph, pose, hiddenDim, color } = look();
      applyPose(pose);
      drawCube(renderer, hiddenDim, color);
      if (ph !== 'orbiting') return; // waehrend der Fluege keine Texte

      const w = renderer.width;
      const h = renderer.height;
      const size = Math.max(18, Math.min(42, h * 0.05));

      // Level-Auswahl oberhalb des Wuerfels (links/rechts aendert sie) --
      // waehrend der Demo die gemerkte AUSWAHL, nicht das Demo-Level.
      renderer.drawText(`LEVEL ${displayLevel(game)}`, {
        x: w / 2,
        y: Math.max(48, h * 0.14),
        size,
        align: 'center',
        baseline: 'middle',
      });

      // Engine-Schalter "1980 / 2026" darunter (hoch/runter schaltet ihn):
      // die aktive Stellung leuchtet voll, die andere ist gedimmt.
      const swSize = size * 0.55;
      const swY = Math.max(48, h * 0.14) + size * 1.1;
      const active = (eng) => (game.engine === eng ? 1.0 : 0.3);
      renderer.drawText('1980', {
        x: w / 2 - swSize * 2.2, y: swY, size: swSize,
        align: 'center', baseline: 'middle', intensity: active(ENGINE_1980),
      });
      renderer.drawText('/', {
        x: w / 2, y: swY, size: swSize,
        align: 'center', baseline: 'middle', intensity: 0.3,
      });
      renderer.drawText('2026', {
        x: w / 2 + swSize * 2.2, y: swY, size: swSize,
        align: 'center', baseline: 'middle', intensity: active(ENGINE_2026),
      });

      if (blinkOn(t)) {
        renderer.drawText('PRESS S TO START', {
          x: w / 2,
          y: h - Math.max(48, h * 0.14),
          size,
          align: 'center',
          baseline: 'middle',
        });
      }
    },

    onKey(key) {
      idle = 0; // jede Taste haelt den Attract-Mode fern
      if (phase !== 'orbiting') return;
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        // Level waehlen; nur ein ECHTER Wechsel tickt (an den Raendern still).
        // Die Tick-Tonhoehe steigt mit dem Level -- man hoert die Leiter.
        const next = stepLevel(game.level, key === 'ArrowRight' ? +1 : -1);
        if (next !== game.level) {
          game.level = next;
          game.audio?.play(tickPatch((next - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL)));
        }
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        // Engine-Schalter: hoch = 2026, runter = 1980 (wie die Level-Wahl
        // tickt nur ein echter Wechsel -- 2026 hoch, 1980 tief). main.js
        // sieht die Aenderung an game.engine und schaltet live um.
        const next = key === 'ArrowUp' ? ENGINE_2026 : ENGINE_1980;
        if (next !== game.engine) {
          game.engine = next;
          game.audio?.play(tickPatch(next === ENGINE_2026 ? 1 : 0));
        }
      } else if (key === 'S') {
        startDock();
      }
    },

    // Lese-Schnittstelle fuer die 2026-Engine (Stufe 3): Pose auf der Bahn,
    // Phase, Flug-Fortschritt, Kanten-Dimmung und Blend-Farbe -- dieselbe
    // Quelle wie die 1980-Zeichnung (look()). blink steuert "PRESS S".
    viewState() {
      return { ...look(), t, blink: blinkOn(t) };
    },
  };
}
