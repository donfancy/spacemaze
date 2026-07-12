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

import { GameEvent } from '../core/states.js';
import { stepLevel, levelColor, MIN_LEVEL, MAX_LEVEL } from '../core/levels.js';
import { PHOSPHOR_GREEN, mixColors } from '../render/colors.js';
import { tickPatch, dockPatch } from '../sound/patches.js';
import { createCamera } from '../math/camera.js';
import { normalize } from '../math/vec3.js';
import { cubeMesh } from '../world/shapes.js';
import { orbitCamera, dockPose, orbitTimeFacing } from '../world/cameraPaths.js';
import { classifyEdges } from '../world/visibility.js';
import { pickDockFace, faceDockPose, SIDE_FACES } from '../world/cubeFaces.js';

const CUBE_SIZE = 2.4;
const HIDDEN_DIM = 0.3;     // Grunddimmung verdeckter Kanten
const DOCK_DURATION = 1.6;  // Sekunden fuer das Andocken
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

  function applyPose(pose) {
    camera.position = pose.position;
    camera.yaw = pose.yaw;
    camera.pitch = pose.pitch;
  }

  // `color` optional: beim An-/Abdocken die Blend-Farbe Richtung Level-Thema,
  // sonst die Renderer-Grundfarbe (gruen).
  function drawCube(renderer, hiddenDim, color) {
    const { visible, hidden } = classifyEdges(cube, camera.position);
    renderer.renderScene({ segments: hidden, intensity: hiddenDim }, camera, { color });
    renderer.renderScene({ segments: visible, intensity: 1.0 }, camera, { color });
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
        if (undockT >= UNDOCK_DURATION) phase = 'orbiting'; // t steht schon richtig
        return; // t (Orbit-Uhr) steht waehrend des Flugs
      }
      t += dt;
      if (phase === 'docking') {
        dockT += dt;
        if (dockT >= DOCK_DURATION) {
          dockT = DOCK_DURATION;
          phase = 'docked';
          // Nahtlos (ohne Fade) ins Labyrinth: MazeGen uebernimmt dieselbe Flaeche.
          game.dispatch(GameEvent.START, { fade: false });
        }
      }
    },

    render(renderer) {
      if (phase === 'undocking') {
        // Symmetrisch zum Andocken: gleiche Flugkurve, verdeckte Kanten faden
        // ein, und die Level-Farbe blendet zurueck nach Gruen.
        const p = Math.min(undockT / UNDOCK_DURATION, 1);
        applyPose(dockPose(p, undockStart, undockTarget));
        drawCube(renderer, HIDDEN_DIM * p, mixColors(levelColor(game.level), PHOSPHOR_GREEN, p));
      } else if (phase === 'orbiting') {
        applyPose(orbitCamera(t, ORBIT_OPTS));
        drawCube(renderer, HIDDEN_DIM);

        const w = renderer.width;
        const h = renderer.height;

        // Level-Auswahl oberhalb des Wuerfels (Pfeiltasten aendern sie).
        renderer.drawText(`LEVEL ${game.level}`, {
          x: w / 2,
          y: Math.max(48, h * 0.14),
          size: Math.max(18, Math.min(42, h * 0.05)),
          align: 'center',
          baseline: 'middle',
        });

        if ((t % 1.1) < 0.72) {
          renderer.drawText('PRESS S TO START', {
            x: w / 2,
            y: h - Math.max(48, h * 0.14),
            size: Math.max(18, Math.min(42, h * 0.05)),
            align: 'center',
            baseline: 'middle',
          });
        }
      } else {
        // Andocken: waehrend des Reinschwebens blendet der Wuerfel von Gruen
        // zur Level-Farbe -- am Ende uebernimmt MazeGen nahtlos in ihr.
        const p = Math.min(dockT / DOCK_DURATION, 1);
        applyPose(dockPose(p, dockStart, dockTarget));
        drawCube(renderer, HIDDEN_DIM * (1 - p), mixColors(PHOSPHOR_GREEN, levelColor(game.level), p));
      }
    },

    onKey(key) {
      if (phase !== 'orbiting') return;
      if (key === 'ArrowUp' || key === 'ArrowRight' || key === 'ArrowDown' || key === 'ArrowLeft') {
        // Level waehlen; nur ein ECHTER Wechsel tickt (an den Raendern still).
        // Die Tick-Tonhoehe steigt mit dem Level -- man hoert die Leiter.
        const next = stepLevel(game.level, (key === 'ArrowUp' || key === 'ArrowRight') ? +1 : -1);
        if (next !== game.level) {
          game.level = next;
          game.audio?.play(tickPatch((next - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL)));
        }
      } else if (key === 'S') {
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
    },
  };
}
