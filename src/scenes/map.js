// Zustand "Karte": nach dem Rueckschwenk steht die Kartensicht still und zeigt das
// flache Labyrinth mit S/G und dem abgelaufenen Weg. Solange das Ziel offen ist,
// faellt man mit Q zurueck ins Labyrinth und spielt weiter; X beendet zum
// Startscreen (nach 5 Minuten automatisch): Karteninhalt blendet aus, nur der
// Rahmen (= die Wuerfelflaeche) bleibt, dann uebernimmt der Startscreen nahtlos
// mit dem rueckwaertigen Andock-Flug (game.undock).

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import { SIDE_FACES } from '../world/cubeFaces.js';
import {
  FAR_RATIO, NEAR_RATIO, cellSize, faceWalls, faceFootprints, renderFaceWalls, mapPose, drawMapOverlay,
} from './mazeView.js';

const AUTO_EXIT = 300; // 5 Minuten
const EXIT_FADE = 0.9; // Sekunden: Karteninhalt blendet aus, der Rahmen bleibt

export function createMap(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });

  let maze = null;
  let face = null;
  let walls = null;
  let footprints = null;
  let cell = 1;
  let pose = null;
  let t = 0;
  let exiting = false;
  let exitT = 0;

  function beginExit() {
    exiting = true;
    exitT = 0;
  }

  return {
    enter() {
      t = 0;
      exiting = false;
      exitT = 0;
      maze = game.maze ?? generateMaze(11, {});
      face = game.dockFace ?? SIDE_FACES[0];
      cell = cellSize(maze);
      walls = faceWalls(maze, face, 0); // flaches Labyrinth (Korridor-Konturen)
      footprints = faceFootprints(maze, face);
      pose = mapPose(face, camera.fov);
    },

    update(dt) {
      t += dt;
      if (exiting) {
        exitT += dt;
        if (exitT >= EXIT_FADE) {
          game.undock = true; // Startscreen: Andock-Flug rueckwaerts von dieser Flaeche
          game.dispatch(GameEvent.EXIT, { fade: false });
        }
        return;
      }
      if (t >= AUTO_EXIT) beginExit();
    },

    render(renderer) {
      const fade = exiting ? Math.max(0, 1 - exitT / EXIT_FADE) : 1;
      renderFaceWalls(renderer, walls, footprints, camera, pose, {
        far: FAR_RATIO * cell, near: NEAR_RATIO * cell, occWeight: 0, alpha: fade,
      });
      drawMapOverlay(renderer, maze, face, camera, game.trail, fade, 1); // Rahmen bleibt

      // Nach der Feindberuehrung: GAME OVER pulsiert rot ueber der Karte.
      if (game.gameOver && fade > 0.01) {
        renderer.drawText('GAME OVER', {
          x: renderer.width / 2, y: renderer.height * 0.16,
          size: Math.min(52, renderer.height * 0.08),
          align: 'center', baseline: 'middle', color: '#ff3b30',
          intensity: fade * (0.7 + 0.3 * Math.sin(2 * Math.PI * 1.2 * t)),
        });
      }

      // Klein unten rechts (wie die Steuerungszeile in der Ego-Ansicht).
      if (fade > 0.01) {
        const hint = game.reachedGoal ? 'X EXIT' : game.gameOver ? 'Q RETRY  X EXIT' : 'Q RETURN  X EXIT';
        renderer.drawText(hint, {
          x: renderer.width - 24, y: renderer.height - 20, size: 13,
          align: 'right', baseline: 'bottom', intensity: 0.5 * fade,
        });
      }
    },

    onKey(key) {
      if (exiting) return; // waehrend des Ausblendens keine Eingaben mehr
      if (key === 'Q' && !game.reachedGoal) {
        // Weiterspielen: nahtlos zurueck ins Labyrinth fallen -- zur gemerkten
        // Spielerlage; nach Game Over dagegen frischer Versuch vom Start
        // (gleiche Maze, Weg und Feinde werden in Playing neu aufgesetzt).
        game.resume = !game.gameOver;
        if (!game.dispatch(GameEvent.RESUME, { fade: false })) game.resume = false;
      } else if (key === 'X') {
        beginExit(); // Karte abblenden, dann -> Startscreen (Abdock-Flug)
      }
    },
  };
}
