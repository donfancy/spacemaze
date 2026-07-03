// Zustand "Reinfallen": sanfter Schwenk aus der Kartensicht (frontal aufs flache
// Labyrinth) in die Ego-Begehung. Position, Blick und Oben-Richtung werden
// harmonisch (Cosinus-Ease) interpoliert; die Waende wachsen dabei von flach auf
// volle Hoehe. Endlage = Stillstand auf S mit Blick in den ersten Gang.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import { cellCenter, startFacingYaw } from '../world/mazeWorld.js';
import { SIDE_FACES } from '../world/cubeFaces.js';
import {
  WALL_RATIO, FAR_RATIO, NEAR_RATIO, cellSize, faceWalls, faceFootprints, renderFaceWalls,
  egoPose, mapPose, blendPose, drawMapOverlay,
} from './mazeView.js';

const DURATION = 1.7;

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
      startPose = mapPose(face, camera.fov); // Kartensicht
      const [cx, cz] = cellCenter(maze.start[0], maze.start[1], cell);
      endPose = egoPose(face, cx, cz, startFacingYaw(maze), cell); // Ego auf S
    },

    update(dt) {
      t += dt;
      if (t >= DURATION) game.dispatch(GameEvent.FALL_DONE, { fade: false });
    },

    render(renderer) {
      const e = easeInOut(t / DURATION);
      const pose = blendPose(startPose, endPose, e);
      const fn = pose.forward[0] * face.normal[0] + pose.forward[1] * face.normal[1] + pose.forward[2] * face.normal[2];
      const occWeight = 1 - Math.abs(fn);

      const walls = faceWalls(maze, face, WALL_RATIO * cell * e); // Waende wachsen auf
      renderFaceWalls(renderer, walls, footprints, camera, pose, { far: FAR_RATIO * cell, near: NEAR_RATIO * cell, occWeight });
      drawMapOverlay(renderer, maze, face, camera, null, 1 - e); // Rahmen + S/G verblassen
    },
  };
}
