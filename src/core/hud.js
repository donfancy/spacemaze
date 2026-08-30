// HUD-Texte und -Farben, die BEIDE Engines anzeigen (1980: die Szenen
// zeichnen selbst, 2026: DOM-Overlays im Backend) -- EINE Quelle statt
// zweier driftender Kopien; das Wording ist das der 1980-Version
// (Boris' Entscheidung, 28.8.2026). Reine Strings/Farben, kein
// Canvas/DOM -> headless testbar.

import { steerHintKeys, assistHintKeys } from '../world/gyro.js';
import { TANKER_RED, mixColors } from '../render/colors.js';

// Steuer-Zeile der Ego-Ansicht (unten rechts bzw. 2026 im Label).
// Die Lenk-Tasten folgen der Blick-Verdrehung (Pulsar-Rotation, orient) --
// auch Boost/Ausrichten (Fahrt-Modus) rotieren mit dem Tastenkreuz.
export function playHint({ drive, shoot, orient } = {}) {
  if (!drive && !shoot) return 'ARROWS MOVE - Q MAP';
  const { boost, align } = assistHintKeys(orient);
  const assist = boost + ' BOOST - ' + align + ' ALIGN - ';
  return steerHintKeys(orient) + ' STEER - ' + assist
    + (shoot ? 'SPACE FIRE - ' : '') + 'Q MAP';
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

// "PRESS S TO START"-Blinken: EINE Formel fuer Startscreen (1980 + 2026)
// und das Demo-Overlay des Attract-Mode -- sonst blinkt es asynchron.
export function blinkOn(t) {
  return (t % 1.1) < 0.72;
}

// Angezeigtes Level: waehrend der Demo laeuft ein Demo-Level auf game.level,
// die ANZEIGE (und das, was S startet) ist aber die gemerkte Auswahl.
export function displayLevel(g) {
  return g.demo && g.demoSavedLevel != null ? g.demoSavedLevel : g.level;
}

// GAME-OVER-Puls: die FARBE pulsiert zwischen Feind-Rot und Weiss
// (1.2 Hz) bei voller Deckkraft -- blosses Helligkeits-Pulsieren wirkte
// ueber den Labyrinth-Linien "durchgestrichen" (Boris).
export function gameOverColor(t) {
  return mixColors(TANKER_RED, '#ffffff', 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.2 * t));
}
