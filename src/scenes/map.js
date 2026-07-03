// Zustand "Karte": nach dem Rueckschwenk steht die Kartensicht still und zeigt das
// flache Labyrinth mit S/G und dem abgelaufenen Weg. Solange das Ziel offen ist,
// faellt man mit Q zurueck ins Labyrinth und spielt weiter; X beendet zum
// Startscreen (nach 5 Minuten automatisch). Am Ziel gibt es nur noch X.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import { SIDE_FACES } from '../world/cubeFaces.js';
import {
  FAR_RATIO, NEAR_RATIO, cellSize, faceWalls, faceFootprints, renderFaceWalls, mapPose, drawMapOverlay,
} from './mazeView.js';

const AUTO_EXIT = 300; // 5 Minuten

export function createMap(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });

  let maze = null;
  let face = null;
  let walls = null;
  let footprints = null;
  let cell = 1;
  let pose = null;
  let t = 0;

  return {
    enter() {
      t = 0;
      maze = game.maze ?? generateMaze(11, {});
      face = game.dockFace ?? SIDE_FACES[0];
      cell = cellSize(maze);
      walls = faceWalls(maze, face, 0); // flaches Labyrinth (Korridor-Konturen)
      footprints = faceFootprints(maze, face);
      pose = mapPose(face, camera.fov);
    },

    update(dt) {
      t += dt;
      if (t >= AUTO_EXIT) game.dispatch(GameEvent.EXIT);
    },

    render(renderer) {
      renderFaceWalls(renderer, walls, footprints, camera, pose, { far: FAR_RATIO * cell, near: NEAR_RATIO * cell, occWeight: 0 });
      drawMapOverlay(renderer, maze, face, camera, game.trail, 1);

      // Klein unten rechts (wie die Steuerungszeile in der Ego-Ansicht).
      renderer.drawText(game.reachedGoal ? 'X EXIT' : 'Q RETURN  X EXIT', {
        x: renderer.width - 24, y: renderer.height - 20, size: 13,
        align: 'right', baseline: 'bottom', intensity: 0.5,
      });
    },

    onKey(key) {
      if (key === 'Q' && !game.reachedGoal) {
        // Weiterspielen: nahtlos zurueck ins Labyrinth fallen (gleiche Kamera-Pose).
        game.resume = true;
        if (!game.dispatch(GameEvent.RESUME, { fade: false })) game.resume = false;
      } else if (key === 'X') {
        game.dispatch(GameEvent.EXIT); // -> Startscreen
      }
    },
  };
}
