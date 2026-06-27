// Zustand "Reinfallen": sanfter Schwenk aus der Kartensicht (frontal aufs flache
// Labyrinth) in die Ego-Begehung. Position, Blick und Oben-Richtung werden
// harmonisch (Cosinus-Ease) interpoliert; die Waende wachsen dabei von flach auf
// volle Hoehe. Endlage = Stillstand auf S mit Blick in den ersten Gang.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import { normalize, lerp } from '../math/vec3.js';
import { cellCenter, startFacingYaw } from '../world/mazeWorld.js';
import {
  faceDockPose, faceLocalToWorld, faceDir, mapGridToFace, gridBorderOnFace, SIDE_FACES,
} from '../world/cubeFaces.js';
import {
  CUBE_SIZE, WALL_RATIO, EYE_RATIO, FAR_RATIO, NEAR_RATIO, cellSize, faceWalls, faceFootprints, renderFaceWalls,
} from './mazeView.js';

const DURATION = 1.7; // Sekunden

function easeInOut(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return 0.5 - 0.5 * Math.cos(Math.PI * c);
}

export function createFalling(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });

  let maze = null;
  let face = null;
  let footprints = null;
  let cell = 1;
  let t = 0;
  let startPose = null;
  let endPose = null;

  return {
    enter() {
      t = 0;
      maze = game.maze ?? generateMaze(11, {});
      face = game.dockFace ?? SIDE_FACES[0];
      cell = cellSize(maze);
      footprints = faceFootprints(maze, face);

      // Start = Kartensicht (= Andock-Pose): frontal auf die Flaeche, Welt-oben.
      const dock = faceDockPose(face, CUBE_SIZE, camera.fov, 0.85);
      startPose = {
        position: dock.position,
        forward: [-face.normal[0], -face.normal[1], -face.normal[2]],
        up: [0, 1, 0],
      };

      // Ende = Ego auf S, Blick in den freien Gang, Oben = Flaechennormale.
      const [cx, cz] = cellCenter(maze.start[0], maze.start[1], cell);
      const yaw = startFacingYaw(maze);
      endPose = {
        position: faceLocalToWorld(cx, EYE_RATIO * cell, cz, face, CUBE_SIZE),
        forward: faceDir(-Math.sin(yaw), 0, -Math.cos(yaw), face),
        up: face.normal,
      };
    },

    update(dt) {
      t += dt;
      if (t >= DURATION) {
        game.dispatch(GameEvent.FALL_DONE, { fade: false }); // nahtlos in die Begehung
      }
    },

    render(renderer) {
      const e = easeInOut(t / DURATION);
      const pose = {
        position: lerp(startPose.position, endPose.position, e),
        forward: normalize(lerp(startPose.forward, endPose.forward, e)),
        up: normalize(lerp(startPose.up, endPose.up, e)),
      };
      // Occlusion einblenden, sobald die Kamera quer zur Wandrichtung blickt:
      // |forward . normal| = 1 (schaut auf die Flaeche) -> 0, = 0 (Ego) -> 1.
      const fn = pose.forward[0] * face.normal[0] + pose.forward[1] * face.normal[1] + pose.forward[2] * face.normal[2];
      const occWeight = 1 - Math.abs(fn);

      const walls = faceWalls(maze, face, WALL_RATIO * cell * e); // Waende wachsen auf
      renderFaceWalls(renderer, walls, footprints, camera, pose, { far: FAR_RATIO * cell, near: NEAR_RATIO * cell, occWeight });

      // Naht zur Kartensicht: Grid-Rahmen + S/G blenden waehrend des Schwenks aus.
      const fade = 1 - e;
      if (fade > 0.01) {
        renderer.renderScene({ segments: gridBorderOnFace(maze.n, CUBE_SIZE, face), intensity: fade }, camera);
        drawMarker(renderer, maze.start, 'S', fade);
        drawMarker(renderer, maze.goal, 'G', fade);
      }
    },
  };

  function drawMarker(renderer, gridCell, label, intensity) {
    const world = mapGridToFace(gridCell[0] + 0.5, gridCell[1] + 0.5, maze.n, CUBE_SIZE, face);
    const screen = renderer.worldToScreen(world, camera);
    if (!screen) return;
    renderer.drawText(label, {
      x: screen.x, y: screen.y, size: Math.max(12, renderer.height * 0.04),
      align: 'center', baseline: 'middle', intensity,
    });
  }
}
