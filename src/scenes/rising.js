// Zustand "Rueckschwenk": das Reinfallen rueckwaerts. Aus der Ego-Lage (wo der
// Spieler Q drueckte bzw. das Ziel erreichte) schwenkt die Kamera harmonisch
// zurueck in die Kartensicht; die Waende schrumpfen dabei wieder flach, Rahmen,
// S/G und der abgelaufene Weg blenden ein. Danach -> Kartenzustand.
// Nach einem Game Over (Feindberuehrung) geht derselbe Schwenk deutlich
// schneller -- die Explosion SCHLEUDERT den Spieler hinaus zur Karte.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import { SIDE_FACES } from '../world/cubeFaces.js';
import { spinnerMarkers } from '../world/spinners.js';
import { flipperMarkers } from '../world/flippers.js';
import { pulsarMarkers } from '../world/pulsars.js';
import { NEON_MAGENTA, ARCADE_YELLOW } from '../render/colors.js';
import { spinnerColor, enemyColor } from '../core/levels.js';
import { SHATTER } from '../render/shatter.js';
import { swayTransform } from '../render/sway.js';
import { risePatch } from '../sound/patches.js';
import {
  WALL_RATIO, FAR_RATIO, NEAR_RATIO, cellSize, faceWalls, faceFootprints, renderFaceWalls,
  egoPose, mapPose, blendPose, drawMapOverlay, drawEnemyMarkers,
} from './mazeView.js';

const DURATION = 1.7;
const CRASH_DURATION = 0.8; // nach Game Over: hinausgeschleudert statt geschwebt

function easeInOut(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return 0.5 - 0.5 * Math.cos(Math.PI * c);
}

export function createRising(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });

  let maze = null;
  let face = null;
  let footprints = null;
  let cell = 1;
  let t = 0;
  let duration = DURATION;
  let startPose = null;
  let endPose = null;
  let origin = null; // Ego-Startlage in lokalen Flaechen-Koordinaten (fuer 2026)

  return {
    enter() {
      t = 0;
      duration = game.gameOver ? CRASH_DURATION : DURATION;
      maze = game.maze ?? generateMaze(11, {});
      face = game.dockFace ?? SIDE_FACES[0];
      cell = cellSize(maze);
      footprints = faceFootprints(maze, face);
      const ps = game.playerState ?? { px: 0, pz: 0, yaw: 0 };
      origin = { px: ps.px, pz: ps.pz, yaw: ps.yaw };
      startPose = egoPose(face, ps.px, ps.pz, ps.yaw, cell); // Ego (Spielerlage)
      endPose = mapPose(face, camera.fov);                   // Kartensicht
      game.audio?.play(risePatch(duration)); // steigender Schweb-Klang bis zur Karte
    },

    update(dt) {
      t += dt;
      if (t >= duration) game.dispatch(GameEvent.RISE_DONE);
    },

    render(renderer) {
      const e = easeInOut(t / duration);
      const pose = blendPose(startPose, endPose, e);
      const fn = pose.forward[0] * face.normal[0] + pose.forward[1] * face.normal[1] + pose.forward[2] * face.normal[2];
      const occWeight = 1 - Math.abs(fn);

      // Wer VERDREHT abhebt (Pulsar-Rotation, ab 26), wird waehrend des
      // Schwenks sanft ausgedreht: der Bildraum-Roll (Sway, Kamera bleibt
      // horizontal) klingt mit dem Ease auf 0 ab -- die Karte kommt aufrecht an.
      const roll = (game.viewRoll ?? 0) * (1 - e);
      if (Math.abs(roll) > 1e-4) {
        renderer.pushSway(swayTransform(roll, 0, { height: renderer.height, fov: camera.fov }));
      }

      // Nach dem Crash beginnt der Schwenk voll ZERSCHERBT (nahtlos zum
      // Zerbersten in playing) -- waehrend es hinausschleudert, klingt das
      // Chaos quadratisch ab und die Linien sortieren sich wieder ein:
      // die Karte kommt sauber an. Das Zentrum ist der Einschlagpunkt aus
      // playing (game.crashScreen) -- mit derselben Mitte behalten die
      // Scherben am Uebergabe-Frame ihre Flugbahnen.
      const shatter = game.gameOver ? (1 - e) * (1 - e) : 0;
      if (shatter > 0.001) {
        renderer.pushShatter({
          amount: shatter,
          cx: game.crashScreen?.cx ?? renderer.width / 2,
          cy: game.crashScreen?.cy ?? renderer.height / 2,
          scale: SHATTER.scale * Math.min(renderer.width, renderer.height),
        });
      }

      const walls = faceWalls(maze, face, WALL_RATIO * cell * (1 - e)); // Waende schrumpfen
      renderFaceWalls(renderer, walls, footprints, camera, pose, { far: FAR_RATIO * cell, near: NEAR_RATIO * cell, occWeight });
      drawMapOverlay(renderer, maze, face, camera, game.trail, e); // Rahmen + S/G + Weg blenden ein
      drawEnemyMarkers(renderer, game.enemies, face, camera, cell, e, enemyColor(game.level)); // Tanker-Kreuze blenden mit ein
      drawEnemyMarkers(renderer, spinnerMarkers(game.spinners), face, camera, cell, e, spinnerColor(game.level)); // Spinner dito
      drawEnemyMarkers(renderer, flipperMarkers(game.flippers), face, camera, cell, e, NEON_MAGENTA); // Flipper dito
      drawEnemyMarkers(renderer, pulsarMarkers(game.pulsars), face, camera, cell, e, ARCADE_YELLOW); // Pulsare dito

      if (Math.abs(roll) > 1e-4) renderer.popSway();
      if (shatter > 0.001) renderer.popShatter();
    },

    exit() {
      game.viewRoll = 0;       // die Rest-Verdrehung ist ausgedreht
      game.crashScreen = null; // der Scherben-Handoff ist verbraucht
    },

    // Lese-Schnittstelle fuer die 2026-Engine (Stufe 3): Rueckschwenk mit
    // derselben Zeitkurve von der Ego-Startlage `origin` zur Draufsicht.
    viewState() {
      if (!maze) return null;
      return { maze, cell, e: easeInOut(t / duration), origin, gameOver: game.gameOver };
    },
  };
}
