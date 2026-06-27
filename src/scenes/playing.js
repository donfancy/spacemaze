// Zustand "Spielablauf". Heute ein bewusst einfacher Pipeline-Beweis: ein langsam
// rotierender Drahtwuerfel ueber einem Bodengitter, projiziert durch die echte
// 6-DOF-Kamera -- damit ist die ganze 3D-Kette (Kamera -> Projektion -> Renderer)
// verdrahtet und sichtbar. Hier zieht spaeter das echte Labyrinth ein.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { cubeEdges, floorGrid, rotateSegmentsY } from '../world/shapes.js';

export function createPlaying(game) {
  let t = 0;

  // Kamera leicht erhoeht, blickt entlang -z auf den Ursprung.
  const camera = createCamera({ position: [0, 1.4, 7], fov: Math.PI / 2.2 });

  // Statische Demo-Geometrie.
  const grid = floorGrid(0, 12, 1.5);
  const cubeBase = cubeEdges([0, 1.3, 0], 2.0);

  return {
    enter() {
      t = 0;
    },

    update(dt) {
      t += dt;
    },

    render(renderer) {
      const cube = rotateSegmentsY(cubeBase, [0, 1.3, 0], t * 0.6);
      renderer.renderScene({ segments: [...grid, ...cube] }, camera);

      // Fixe 2D-Overlays.
      const w = renderer.width;
      const h = renderer.height;
      renderer.drawText('LEVEL 1', {
        x: 28,
        y: 28,
        size: Math.max(16, Math.min(30, h * 0.04)),
        align: 'left',
        baseline: 'top',
      });
      renderer.drawText('PRESS Q TO QUIT', {
        x: w - 28,
        y: h - 28,
        size: 15,
        align: 'right',
        baseline: 'bottom',
        intensity: 0.7,
      });
    },

    onKey(key) {
      if (key === 'Q') {
        game.dispatch(GameEvent.EXIT);
      }
    },
  };
}
