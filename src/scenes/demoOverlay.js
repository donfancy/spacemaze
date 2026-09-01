// Demo-Overlay des Attract-Mode (1980-Engine): waehrend die Autopilot-Demo
// laeuft, bleiben Level-Auswahl, Engine-Schalter und das blinkende
// "PRESS S TO START" ueber JEDER Szene sichtbar -- exakt das Layout des
// Startscreens (dort gezeichnet von startscreen.render, hier von
// game.render fuer alle anderen Zustaende). Die 2026-Engine zeigt dasselbe
// ueber ihre DOM-Overlays (backend.updateOverlays).

import { blinkOn, displayLevel, selectorArrows } from '../core/hud.js';
import { ENGINE_1980, ENGINE_2026 } from '../core/engine.js';

// Level-Auswahl + Engine-Schalter samt Pfeil-Hinweisen: EIN Layout fuer
// Startscreen UND Demo-Overlay (vorher zwei driftende Kopien). Die Pfeile
// (Boris' Testuser-Befund 1.9.2026) leuchten, wenn der Druck etwas bewirkt
// -- dieselbe Aktiv/Inaktiv-Optik (1.0/0.3) wie die Jahreszahlen.
export function drawSelector(renderer, game) {
  const w = renderer.width;
  const h = renderer.height;
  const size = Math.max(18, Math.min(42, h * 0.05));
  const y = Math.max(48, h * 0.14);
  const arrows = selectorArrows(game);
  const dim = (on) => (on ? 1.0 : 0.3);

  renderer.drawText(`LEVEL ${displayLevel(game)}`, {
    x: w / 2, y, size,
    align: 'center', baseline: 'middle',
  });
  renderer.drawText('←', {
    x: w / 2 - size * 4.4, y, size: size * 0.8,
    align: 'center', baseline: 'middle', intensity: dim(arrows.left),
  });
  renderer.drawText('→', {
    x: w / 2 + size * 4.4, y, size: size * 0.8,
    align: 'center', baseline: 'middle', intensity: dim(arrows.right),
  });

  const swSize = size * 0.55;
  const swY = y + size * 1.1;
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
  // Der Pfeil steht neben der Jahreszahl, die er anwaehlt: runter = 1980
  // (links), rauf = 2026 (rechts).
  renderer.drawText('↓', {
    x: w / 2 - swSize * 5.4, y: swY, size: swSize * 0.9,
    align: 'center', baseline: 'middle', intensity: dim(arrows.down),
  });
  renderer.drawText('↑', {
    x: w / 2 + swSize * 5.4, y: swY, size: swSize * 0.9,
    align: 'center', baseline: 'middle', intensity: dim(arrows.up),
  });
}

export function drawDemoOverlay(renderer, game) {
  const w = renderer.width;
  const h = renderer.height;
  const size = Math.max(18, Math.min(42, h * 0.05));

  drawSelector(renderer, game);

  if (blinkOn(game.time)) {
    renderer.drawText('PRESS S TO START', {
      x: w / 2, y: h - Math.max(48, h * 0.14), size,
      align: 'center', baseline: 'middle',
    });
  }
}
