// Zustand "Karte": nach dem Rueckschwenk steht die Kartensicht still und zeigt das
// flache Labyrinth mit S/G und dem abgelaufenen Weg. Solange das Ziel offen ist,
// faellt man mit Q zurueck ins Labyrinth und spielt weiter; X beendet zum
// Startscreen (nach 5 Minuten automatisch): Karteninhalt blendet aus, nur der
// Rahmen (= die Wuerfelflaeche) bleibt, dann uebernimmt der Startscreen nahtlos
// mit dem rueckwaertigen Andock-Flug (game.undock).

import { GameEvent } from '../core/states.js';
import { mapHint, gameOverColor } from '../core/hud.js';
import { hasRecording } from '../core/recorder.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import { SIDE_FACES } from '../world/cubeFaces.js';
import { spinnerMarkers } from '../world/spinners.js';
import { flipperMarkers } from '../world/flippers.js';
import { pulsarMarkers } from '../world/pulsars.js';
import { NEON_MAGENTA, ARCADE_YELLOW } from '../render/colors.js';
import { spinnerColor, enemyColor } from '../core/levels.js';
import {
  FAR_RATIO, NEAR_RATIO, cellSize, faceWalls, faceFootprints, renderFaceWalls, mapPose,
  drawMapOverlay, drawEnemyMarkers,
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
          game.dispatch(GameEvent.EXIT);
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
      drawEnemyMarkers(renderer, game.enemies, face, camera, cell, fade, enemyColor(game.level)); // Tanker-Kreuze (rot, ab 26 blau)
      drawEnemyMarkers(renderer, spinnerMarkers(game.spinners), face, camera, cell, fade, spinnerColor(game.level)); // Spinner-Kreuze
      drawEnemyMarkers(renderer, flipperMarkers(game.flippers), face, camera, cell, fade, NEON_MAGENTA); // magenta Kreuze
      drawEnemyMarkers(renderer, pulsarMarkers(game.pulsars), face, camera, cell, fade, ARCADE_YELLOW); // Pulsar-Kreuze

      // Nach der Feindberuehrung: GAME OVER pulsiert in der FARBE (core/hud.js)
      // zwischen Feind-Rot und Weiss, bei voller Deckkraft -- blosses
      // Helligkeits-Pulsieren wirkte ueber den Labyrinth-Linien durchgestrichen.
      if (game.gameOver && fade > 0.01) {
        renderer.drawText('GAME OVER', {
          x: renderer.width / 2, y: renderer.height * 0.16,
          size: Math.min(52, renderer.height * 0.08),
          align: 'center', baseline: 'middle',
          color: gameOverColor(t), intensity: fade,
        });
      }

      // Klein unten rechts (wie die Steuerungszeile in der Ego-Ansicht).
      if (fade > 0.01) {
        renderer.drawText(mapHint({
          reachedGoal: game.reachedGoal, gameOver: game.gameOver,
          replay: hasRecording(game.recording),
        }), {
          x: renderer.width - 24, y: renderer.height - 20, size: 13,
          align: 'right', baseline: 'bottom', intensity: 0.5 * fade,
        });
      }
    },

    // Lese-Schnittstelle fuer die 2026-Engine (Stufe 3): nur die Ausblend-
    // Stufe -- Maze, Weg, Feinde und Status liest das Backend direkt vom game.
    viewState() {
      if (!maze) return null;
      return { maze, t, fade: exiting ? Math.max(0, 1 - exitT / EXIT_FADE) : 1 };
    },

    onKey(key) {
      if (exiting) return; // waehrend des Ausblendens keine Eingaben mehr
      if (key === 'Q' && !game.reachedGoal) {
        // Weiterspielen: nahtlos zurueck ins Labyrinth fallen -- zur gemerkten
        // Spielerlage; nach Game Over dagegen frischer Versuch vom Start
        // (gleiche Maze, Weg und Feinde werden in Playing neu aufgesetzt).
        game.resume = !game.gameOver;
        if (!game.dispatch(GameEvent.RESUME)) game.resume = false;
      } else if (key === 'R' && hasRecording(game.recording)) {
        game.dispatch(GameEvent.REPLAY); // den Lauf noch einmal anschauen
      } else if (key === 'X') {
        beginExit(); // Karte abblenden, dann -> Startscreen (Abdock-Flug)
      }
    },
  };
}
