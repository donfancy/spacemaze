// Startbildschirm: schwarz, mit blinkendem "PRESS S TO START" unten zentriert.
// Konzeptuell eine (leere) 3D-Szene mit fixem 2D-Text-Overlay darueber.

import { GameEvent } from '../core/states.js';

export function createStartscreen(game) {
  let t = 0;

  return {
    enter() {
      t = 0;
    },

    update(dt) {
      t += dt;
    },

    render(renderer) {
      const w = renderer.width;
      const h = renderer.height;

      // Arcade-typisches Blinken: ~1,1s Periode, etwa zwei Drittel der Zeit sichtbar.
      const visible = (t % 1.1) < 0.72;
      if (visible) {
        const size = Math.max(18, Math.min(42, h * 0.05));
        renderer.drawText('PRESS S TO START', {
          x: w / 2,
          y: h - Math.max(48, h * 0.14),
          size,
          align: 'center',
          baseline: 'middle',
        });
      }
    },

    onKey(key) {
      if (key === 'S') {
        game.dispatch(GameEvent.START);
      }
    },
  };
}
