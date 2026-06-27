// Zustand "Labyrinth-Erzeugung". Heute nur ein animierter Platzhalter:
// "GENERATING MAZE..." mit laufenden Punkten, danach automatisch weiter zu PLAYING.
// Hier wird spaeter die echte Labyrinth-Generierung (mit Aufbau-Animation) einziehen.

import { GameEvent } from '../core/states.js';

const DURATION = 2.0; // Sekunden, bis das "Labyrinth fertig" ist

export function createMazeGen(game) {
  let t = 0;

  return {
    enter() {
      t = 0;
    },

    update(dt) {
      t += dt;
      if (t >= DURATION) {
        game.dispatch(GameEvent.MAZE_READY);
      }
    },

    render(renderer) {
      const w = renderer.width;
      const h = renderer.height;
      const dots = '.'.repeat(Math.floor(t * 3) % 4);
      const size = Math.max(18, Math.min(38, h * 0.05));
      renderer.drawText('GENERATING MAZE' + dots, {
        x: w / 2,
        y: h / 2,
        size,
        align: 'center',
        baseline: 'middle',
      });
    },
  };
}
