// Zustand "Spielablauf": Ego-Perspektive im Labyrinth, Tank-Steuerung.
// Zeichnet den abgelaufenen Weg auf (game.trail) und merkt die Spielerlage
// (game.playerState) fuer den Rueckschwenk. Q -> zurueck zur Karte; am Ziel
// loest der Rueckschwenk nach 20 s automatisch aus.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import { cellCenter, cellAt, tryMove, startFacingYaw } from '../world/mazeWorld.js';
import { recordTrailPoint } from '../world/trail.js';
import { compassLayout } from '../render/compass.js';
import { SIDE_FACES } from '../world/cubeFaces.js';
import {
  WALL_RATIO, FAR_RATIO, NEAR_RATIO, cellSize, faceWalls, faceFootprints, renderFaceWalls, egoPose,
} from './mazeView.js';

const MOVE_RATIO = 2.2;     // Zellen pro Sekunde
const TURN_SPEED = 2.2;     // Radiant pro Sekunde
const RADIUS_RATIO = 0.25;
const GOAL_AUTO_EXIT = 20;  // Sekunden am Ziel bis automatischer Rueckschwenk
const TRAIL_DIST_RATIO = 0.2; // Weg-Aufzeichnung: Mindestdistanz in Zellen

export function createPlaying(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });

  let maze = null;
  let face = null;
  let walls = null;
  let footprints = null;
  let cell = 1;
  let px = 0;
  let pz = 0;
  let yaw = 0;
  let reached = false;
  let reachedTime = 0;

  function recordState() {
    game.playerState = { px, pz, yaw };
  }

  return {
    enter() {
      maze = game.maze ?? generateMaze(11, {});
      face = game.dockFace ?? SIDE_FACES[0];
      cell = cellSize(maze);
      walls = faceWalls(maze, face, WALL_RATIO * cell);
      footprints = faceFootprints(maze, face);
      if (game.resume && game.playerState) {
        // Fortsetzung von der Karte: Lage und abgelaufener Weg bleiben erhalten.
        ({ px, pz, yaw } = game.playerState);
      } else {
        const [cx, cz] = cellCenter(maze.start[0], maze.start[1], cell);
        px = cx;
        pz = cz;
        yaw = startFacingYaw(maze);
        game.trail = [[px, pz]]; // abgelaufener Weg (praezise Flaechenpunkte)
      }
      game.resume = false;
      reached = false;
      reachedTime = 0;
      game.reachedGoal = false;
      recordState();
    },

    exit() {
      // Letzte Position exakt festhalten (auch unterhalb der Mindestdistanz),
      // damit die Weglinie genau dort endet, wo der Rueckschwenk beginnt.
      recordTrailPoint(game.trail, px, pz, { force: true });
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

      // Weg praezise aufzeichnen: echte Position, gerade Strecken zusammengefasst.
      recordTrailPoint(game.trail, px, pz, { minDist: TRAIL_DIST_RATIO * cell });
      recordState();

      const [gx, gy] = cellAt(px, pz, cell);

      if (gx === maze.goal[0] && gy === maze.goal[1]) {
        reached = true;
        game.reachedGoal = true; // die Karte bietet dann kein Weiterspielen mehr an
      }
      if (reached) {
        reachedTime += dt;
        if (reachedTime >= GOAL_AUTO_EXIT) game.dispatch(GameEvent.EXIT, { fade: false });
      }
    },

    render(renderer) {
      const pose = egoPose(face, px, pz, yaw, cell);
      renderFaceWalls(renderer, walls, footprints, camera, pose, { far: FAR_RATIO * cell, near: NEAR_RATIO * cell });

      const w = renderer.width;
      const h = renderer.height;
      renderer.drawText('FIND THE EXIT', {
        x: 24, y: 24, size: Math.min(20, h * 0.03),
        align: 'left', baseline: 'top', intensity: 0.7,
      });
      renderer.drawText('ARROWS MOVE - Q MAP', {
        x: w - 24, y: h - 20, size: 13,
        align: 'right', baseline: 'bottom', intensity: 0.5,
      });

      // Kompass-Rose rechts unten (oberhalb der Steuerungszeile schwebend).
      const cr = Math.max(26, Math.min(w, h) * 0.05);
      const rose = compassLayout(yaw, { cx: w - cr - 30, cy: h - cr - 52, radius: cr });
      renderer.drawPolylines(rose.polylines, { intensity: 0.45, lineWidth: 1.5 });
      for (const l of rose.labels) {
        renderer.drawText(l.label, {
          x: l.x, y: l.y, size: Math.max(10, cr * 0.5), angle: l.angle,
          align: 'center', baseline: 'middle', intensity: l.major ? 0.9 : 0.45,
        });
      }
      if (reached) {
        renderer.drawText('YOU MADE IT', {
          x: w / 2, y: h / 2, size: Math.min(52, h * 0.08),
          align: 'center', baseline: 'middle',
        });
      }
    },

    onKey(key) {
      if (key === 'Q') game.dispatch(GameEvent.EXIT, { fade: false }); // nahtlos in den Rueckschwenk
    },
  };
}
