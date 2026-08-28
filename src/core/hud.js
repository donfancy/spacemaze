// HUD-Texte und -Farben, die BEIDE Engines anzeigen (1980: die Szenen
// zeichnen selbst, 2026: DOM-Overlays im Backend) -- EINE Quelle statt
// zweier driftender Kopien; das Wording ist das der 1980-Version
// (Boris' Entscheidung, 28.8.2026). Reine Strings/Farben, kein
// Canvas/DOM -> headless testbar.

import { steerHintKeys } from '../world/gyro.js';
import { TANKER_RED, mixColors } from '../render/colors.js';

// Steuer-Zeile der Ego-Ansicht (unten rechts bzw. 2026 im Label).
// Die Lenk-Tasten folgen der Blick-Verdrehung (Pulsar-Rotation, orient).
export function playHint({ drive, shoot, orient } = {}) {
  const keys = steerHintKeys(orient);
  return shoot ? keys + ' STEER - SPACE FIRE - Q MAP'
    : drive ? keys + ' STEER - Q MAP'
      : 'ARROWS MOVE - Q MAP';
}

// Hinweis-Zeile der Karte: Q nur solange das Ziel offen ist; nach Game
// Over wird Q zum Retry.
export function mapHint({ reachedGoal, gameOver } = {}) {
  return reachedGoal ? 'X EXIT' : gameOver ? 'Q RETRY  X EXIT' : 'Q RETURN  X EXIT';
}

// GAME-OVER-Puls: die FARBE pulsiert zwischen Feind-Rot und Weiss
// (1.2 Hz) bei voller Deckkraft -- blosses Helligkeits-Pulsieren wirkte
// ueber den Labyrinth-Linien "durchgestrichen" (Boris).
export function gameOverColor(t) {
  return mixColors(TANKER_RED, '#ffffff', 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.2 * t));
}
