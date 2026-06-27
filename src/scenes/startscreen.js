// Startbildschirm in zwei Phasen:
//   'orbiting' - die Kamera umtanzt einen Drahtwuerfel, "PRESS S TO START" blinkt.
//   'docking'  - nach S faehrt die Kamera harmonisch frontal vor die Wuerfelseite,
//                die ihr beim Druck am meisten zugewandt ist (min Blick . Normale).
//                Verdeckte Kanten faden von 30% auf 0%, sodass am Ende nur das
//                Quadrat (diese Flaeche = das Grid) uebrig bleibt.
// Nach Abschluss des Andockens uebernimmt MazeGen nahtlos dieselbe Flaeche.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { normalize } from '../math/vec3.js';
import { cubeMesh } from '../world/shapes.js';
import { orbitCamera, dockPose } from '../world/cameraPaths.js';
import { classifyEdges } from '../world/visibility.js';
import { pickDockFace, faceDockPose } from '../world/cubeFaces.js';

const CUBE_SIZE = 2.4;
const HIDDEN_DIM = 0.3;     // Grunddimmung verdeckter Kanten
const DOCK_DURATION = 1.6;  // Sekunden fuer das Andocken
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
    },

    update(dt) {
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
      if (phase === 'orbiting') {
        applyPose(orbitCamera(t, ORBIT_OPTS));
        drawCube(renderer, HIDDEN_DIM);

        const w = renderer.width;
        const h = renderer.height;
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
      if (key === 'S' && phase === 'orbiting') {
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
