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
import { stepLevel } from '../core/levels.js';
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

  function drawCube(renderer, hiddenDim) {
    const { visible, hidden } = classifyEdges(cube, camera.position);
    renderer.renderScene({ segments: hidden, intensity: hiddenDim }, camera);
    renderer.renderScene({ segments: visible, intensity: 1.0 }, camera);
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
        // Symmetrisch zum Andocken: gleiche Flugkurve, verdeckte Kanten faden ein.
        const p = Math.min(undockT / UNDOCK_DURATION, 1);
        applyPose(dockPose(p, undockStart, undockTarget));
        drawCube(renderer, HIDDEN_DIM * p);
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
        const p = Math.min(dockT / DOCK_DURATION, 1);
        applyPose(dockPose(p, dockStart, dockTarget));
        drawCube(renderer, HIDDEN_DIM * (1 - p));
      }
    },

    onKey(key) {
      if (phase !== 'orbiting') return;
      if (key === 'ArrowUp' || key === 'ArrowRight') {
        game.level = stepLevel(game.level, +1);
      } else if (key === 'ArrowDown' || key === 'ArrowLeft') {
        game.level = stepLevel(game.level, -1);
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
      }
    },
  };
}
