// Zustand "Spielablauf": Ego-Perspektive im Labyrinth, Tank-Steuerung.
// Die Korridore sind begehbarer Boden, die Waende ragen als Wireframe auf.
// Hidden Lines: verdeckte Kantenstuecke werden gedimmt (nah) bzw. weggelassen (fern).
// Ziel: von S nach G.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import {
  mazeWalls, wallFootprints, cellCenter, cellAt, tryMove, startFacingYaw,
} from '../world/mazeWorld.js';
import { projectOccluders, occludeEdge } from '../render/occlusion.js';

const CELL = 1;
const WALL_HEIGHT = 1.2;
const EYE = 0.5;          // Augenhoehe ueber dem Boden
const MOVE_SPEED = 2.2;   // Zellen pro Sekunde
const TURN_SPEED = 2.2;   // Radiant pro Sekunde
const RADIUS = 0.25;      // Kollisionsabstand zur Wand
const NEAR = 0.1;
const FAR_OCCLUDED = 6;   // verdeckte Kanten weiter weg als das werden weggelassen
const DIM = 0.1;          // Helligkeit verdeckter (naher) Kanten

export function createPlaying(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });

  let maze = null;
  let walls = null;
  let footprints = null;
  let px = 0;
  let pz = 0;
  let yaw = 0;
  let reached = false;

  return {
    enter() {
      maze = game.maze ?? generateMaze(11, {});
      walls = mazeWalls(maze, { cell: CELL, height: WALL_HEIGHT });
      footprints = wallFootprints(maze, { cell: CELL });
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

      if (left) yaw += TURN_SPEED * dt;  // nach links drehen
      if (right) yaw -= TURN_SPEED * dt; // nach rechts drehen

      const move = (fwd ? 1 : 0) - (back ? 1 : 0);
      if (move !== 0 && !reached) {
        // forward(yaw, pitch=0) = (-sin yaw, 0, -cos yaw)
        const step = MOVE_SPEED * dt * move;
        const dx = -Math.sin(yaw) * step;
        const dz = -Math.cos(yaw) * step;
        [px, pz] = tryMove(maze, px, pz, dx, dz, { cell: CELL, radius: RADIUS });
      }

      const [gx, gy] = cellAt(px, pz, CELL);
      if (gx === maze.goal[0] && gy === maze.goal[1]) reached = true;
    },

    render(renderer) {
      camera.position = [px, EYE, pz];
      camera.yaw = yaw;
      camera.pitch = 0;

      const vp = { width: renderer.width, height: renderer.height, fov: camera.fov, near: NEAR };
      const occluders = projectOccluders(footprints, camera, vp);

      // Jede Wandkante exakt an den Verdeckungsgrenzen aufteilen und einsortieren.
      const visible = [];
      const dimmed = [];
      for (const edge of walls) {
        for (const s of occludeEdge(edge, camera, vp, occluders)) {
          if (!s.occluded) visible.push([s.a, s.b]);
          else if (s.depth < FAR_OCCLUDED) dimmed.push([s.a, s.b]);
          // sonst: weit verdeckt -> gar nicht zeichnen
        }
      }
      renderer.drawPolylines(dimmed, { intensity: DIM });
      renderer.drawPolylines(visible, { intensity: 1.0 });

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
