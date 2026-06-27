// Zustand "Spielablauf": Ego-Perspektive im Labyrinth, Tank-Steuerung.
// Die Korridore sind begehbarer Boden, die Waende ragen als Wireframe auf.
// Ziel: von S nach G.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import { mazeWalls, cellCenter, cellAt, tryMove, startFacingYaw } from '../world/mazeWorld.js';

const CELL = 1;
const WALL_HEIGHT = 1.2;
const EYE = 0.5;          // Augenhoehe ueber dem Boden
const MOVE_SPEED = 2.2;   // Zellen pro Sekunde
const TURN_SPEED = 2.2;   // Radiant pro Sekunde
const RADIUS = 0.25;      // Kollisionsabstand zur Wand

export function createPlaying(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });

  let maze = null;
  let walls = null;
  let px = 0;
  let pz = 0;
  let yaw = 0;
  let reached = false;

  return {
    enter() {
      maze = game.maze ?? generateMaze(11, {});
      walls = mazeWalls(maze, { cell: CELL, height: WALL_HEIGHT });
      const [cx, cz] = cellCenter(maze.start[0], maze.start[1], CELL);
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

      if (left) yaw -= TURN_SPEED * dt;
      if (right) yaw += TURN_SPEED * dt;

      const move = (fwd ? 1 : 0) - (back ? 1 : 0);
      if (move !== 0 && !reached) {
        // forward(yaw, pitch=0) = (-sin yaw, 0, -cos yaw)
        const step = MOVE_SPEED * dt * move;
        const dx = -Math.sin(yaw) * step;
        const dz = -Math.cos(yaw) * step;
        [px, pz] = tryMove(maze, px, pz, dx, dz, { cell: CELL, radius: RADIUS });
      }

      // Ziel erreicht?
      const [gx, gy] = cellAt(px, pz, CELL);
      if (gx === maze.goal[0] && gy === maze.goal[1]) reached = true;
    },

    render(renderer) {
      camera.position = [px, EYE, pz];
      camera.yaw = yaw;
      camera.pitch = 0;
      renderer.renderScene({ segments: walls }, camera);

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
