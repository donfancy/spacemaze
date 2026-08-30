// Demo-Overlay des Attract-Mode (1980-Engine): waehrend die Autopilot-Demo
// laeuft, bleiben Level-Auswahl, Engine-Schalter und das blinkende
// "PRESS S TO START" ueber JEDER Szene sichtbar -- exakt das Layout des
// Startscreens (dort gezeichnet von startscreen.render, hier von
// game.render fuer alle anderen Zustaende). Die 2026-Engine zeigt dasselbe
// ueber ihre DOM-Overlays (backend.updateOverlays).

import { blinkOn, displayLevel } from '../core/hud.js';
import { ENGINE_1980, ENGINE_2026 } from '../core/engine.js';

export function drawDemoOverlay(renderer, game) {
  const w = renderer.width;
  const h = renderer.height;
  const size = Math.max(18, Math.min(42, h * 0.05));

  renderer.drawText(`LEVEL ${displayLevel(game)}`, {
    x: w / 2, y: Math.max(48, h * 0.14), size,
    align: 'center', baseline: 'middle',
  });

  const swSize = size * 0.55;
  const swY = Math.max(48, h * 0.14) + size * 1.1;
  const active = (eng) => (game.engine === eng ? 1.0 : 0.3);
  renderer.drawText('1980', {
    x: w / 2 - swSize * 2.2, y: swY, size: swSize,
    align: 'center', baseline: 'middle', intensity: active(ENGINE_1980),
  });
  renderer.drawText('/', {
    x: w / 2, y: swY, size: swSize,
    align: 'center', baseline: 'middle', intensity: 0.3,
  });
  renderer.drawText('2026', {
    x: w / 2 + swSize * 2.2, y: swY, size: swSize,
    align: 'center', baseline: 'middle', intensity: active(ENGINE_2026),
  });

  if (blinkOn(game.time)) {
    renderer.drawText('PRESS S TO START', {
      x: w / 2, y: h - Math.max(48, h * 0.14), size,
      align: 'center', baseline: 'middle',
    });
  }
}
