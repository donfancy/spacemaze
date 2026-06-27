// Startbildschirm: die Kamera umtanzt einen Drahtwuerfel, darueber blinkt fix
// "PRESS S TO START". Der Wuerfel steht im Ursprung; spaeter dockt die Kamera bei
// S an eine seiner Seiten an und blendet auf die Labyrinth-Draufsicht ueber.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { cubeEdges } from '../world/shapes.js';
import { orbitCamera } from '../world/cameraPaths.js';

export function createStartscreen(game) {
  let t = 0;
  const camera = createCamera({ fov: Math.PI / 2.4 });
  const cube = cubeEdges([0, 0, 0], 2.4); // Wuerfel im Ursprung

  return {
    enter() {
      t = 0;
    },

    update(dt) {
      t += dt;
    },

    render(renderer) {
      // Kamera umtanzt den Wuerfel: Blick stets auf den Mittelpunkt, kreisend,
      // Abstand und Hoehe pulsieren sanft.
      const orbit = orbitCamera(t, { center: [0, 0, 0], radius: 6.5, radiusVar: 1.6 });
      camera.position = orbit.position;
      camera.yaw = orbit.yaw;
      camera.pitch = orbit.pitch;
      renderer.renderScene({ segments: cube }, camera);

      // Arcade-typisches Blinken: ~1,1s Periode, etwa zwei Drittel der Zeit sichtbar.
      const w = renderer.width;
      const h = renderer.height;
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
