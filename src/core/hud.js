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
// Over wird Q zum Retry. `replay` (es gibt eine abspielbare Aufzeichnung)
// bietet R an -- der Aufrufer reicht dafuer hasRecording(game.recording).
export function mapHint({ reachedGoal, gameOver, replay } = {}) {
  const r = replay ? 'R REPLAY  ' : '';
  return reachedGoal ? r + 'X EXIT'
    : gameOver ? 'Q RETRY  ' + r + 'X EXIT'
      : 'Q RETURN  ' + r + 'X EXIT';
}

// Steuer-Zeile der Wiedergabe. `cams` nur in der 2026-Engine (die
// Zusatz-Kameras gibt es 1980 nicht -- Hidden-Lines-Regel).
export function replayHint({ cams } = {}) {
  return 'SPACE PAUSE - LEFT/RIGHT SPEED - '
    + (cams ? 'C CAMERA - ' : '') + 'M SOUND - X MAP';
}

// Statuszeile der Wiedergabe: Position/Dauer und Tempo (Pfeile zeigen die
// Richtung, PAUSE gewinnt).
export function replayStatus({ t, duration, speed, paused } = {}) {
  const fmt = (s) => {
    const m = Math.floor(Math.max(0, s) / 60);
    const ss = Math.floor(Math.max(0, s) % 60);
    return m + ':' + String(ss).padStart(2, '0');
  };
  const tempo = paused ? 'PAUSE'
    : speed < 0 ? '<< ' + -speed + 'x'
      : speed > 1 ? '>> ' + speed + 'x' : '';
  return ('REPLAY ' + fmt(t) + ' / ' + fmt(duration) + '  ' + tempo).trimEnd();
}

// GAME-OVER-Puls: die FARBE pulsiert zwischen Feind-Rot und Weiss
// (1.2 Hz) bei voller Deckkraft -- blosses Helligkeits-Pulsieren wirkte
// ueber den Labyrinth-Linien "durchgestrichen" (Boris).
export function gameOverColor(t) {
  return mixColors(TANKER_RED, '#ffffff', 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.2 * t));
}
