// Zustand "Spielablauf": Ego-Perspektive im Labyrinth, Tank-Steuerung.
// Das Labyrinth liegt auf der Andock-Wuerfelflaeche (nahtlos vom Reinfallen).
// Die Spiellogik (Bewegung, Kollision) rechnet in der lokalen Welt; gerendert
// wird ueber die Flaeche mit freier Kamera-Orientierung (up = Flaechennormale).

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import { cellCenter, cellAt, tryMove, startFacingYaw } from '../world/mazeWorld.js';
import { faceLocalToWorld, faceDir, SIDE_FACES } from '../world/cubeFaces.js';
import {
  CUBE_SIZE, WALL_RATIO, EYE_RATIO, FAR_RATIO, NEAR_RATIO, cellSize, faceWalls, faceFootprints, renderFaceWalls,
} from './mazeView.js';

const MOVE_RATIO = 2.2;   // Zellen pro Sekunde
const TURN_SPEED = 2.2;   // Radiant pro Sekunde
const RADIUS_RATIO = 0.25;

export function createPlaying(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });

  let maze = null;
  let face = null;
  let walls = null;
  let footprints = null;
  let cell = 1;
  let px = 0; // lokale Position (Flaecheneinheiten)
  let pz = 0;
  let yaw = 0; // lokaler Blickwinkel
  let reached = false;

  return {
    enter() {
      maze = game.maze ?? generateMaze(11, {});
      face = game.dockFace ?? SIDE_FACES[0];
      cell = cellSize(maze);
      walls = faceWalls(maze, face, WALL_RATIO * cell);
      footprints = faceFootprints(maze, face);
      const [cx, cz] = cellCenter(maze.start[0], maze.start[1], cell);
      px = cx;
      pz = cz;
      yaw = startFacingYaw(maze);
      reached = false;
    },

    update(dt) {
      const keys = game.keys;
      const fwd = keys.has('ArrowUp') || keys.has('W');
      const back = keys.has('ArrowDown') || keys.has('S');
      const left = keys.has('ArrowLeft') || keys.has('A');
      const right = keys.has('ArrowRight') || keys.has('D');

      if (left) yaw += TURN_SPEED * dt;
      if (right) yaw -= TURN_SPEED * dt;

      const move = (fwd ? 1 : 0) - (back ? 1 : 0);
      if (move !== 0 && !reached) {
        const step = MOVE_RATIO * cell * dt * move;
        const dx = -Math.sin(yaw) * step;
        const dz = -Math.cos(yaw) * step;
        [px, pz] = tryMove(maze, px, pz, dx, dz, { cell, radius: RADIUS_RATIO * cell });
      }

      const [gx, gy] = cellAt(px, pz, cell);
      if (gx === maze.goal[0] && gy === maze.goal[1]) reached = true;
    },

    render(renderer) {
      const eye = EYE_RATIO * cell;
      const pose = {
        position: faceLocalToWorld(px, eye, pz, face, CUBE_SIZE),
        forward: faceDir(-Math.sin(yaw), 0, -Math.cos(yaw), face),
        up: face.normal,
      };
      renderFaceWalls(renderer, walls, footprints, camera, pose, { far: FAR_RATIO * cell, near: NEAR_RATIO * cell });

      const w = renderer.width;
      const h = renderer.height;
      renderer.drawText('FIND THE EXIT', {
        x: 24, y: 24, size: Math.min(20, h * 0.03),
        align: 'left', baseline: 'top', intensity: 0.7,
      });
      renderer.drawText('ARROWS MOVE - Q QUIT', {
        x: w - 24, y: h - 20, size: 13,
        align: 'right', baseline: 'bottom', intensity: 0.5,
      });
      if (reached) {
        renderer.drawText('YOU MADE IT', {
          x: w / 2, y: h / 2, size: Math.min(52, h * 0.08),
          align: 'center', baseline: 'middle',
        });
      }
    },

    onKey(key) {
      if (key === 'Q') game.dispatch(GameEvent.EXIT);
    },
  };
}
