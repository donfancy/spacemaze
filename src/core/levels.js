// Level-Definitionen: reine Daten + reine Funktionen -> headless testbar.
// Vorerst unterscheidet nur die Labyrinth-Groesse n die Levels; weitere
// Eigenschaften (Gegner, Zeitlimit, ...) kommen spaeter einfach als Felder dazu.

export const LEVELS = [
  { n: 9 },   // Level 1
  { n: 11 },  // Level 2
  { n: 13 },  // Level 3
  { n: 15 },  // Level 4
  { n: 17 },  // Level 5
];

export const MIN_LEVEL = 1;
export const MAX_LEVEL = LEVELS.length;

// Konfiguration eines Levels (1-basiert); ausserhalb des Bereichs: null.
export function levelConfig(level) {
  return Number.isInteger(level) && level >= MIN_LEVEL && level <= MAX_LEVEL
    ? LEVELS[level - 1]
    : null;
}

// Auswahl schrittweise aendern, an den Raendern begrenzt (kein Umlauf).
export function stepLevel(level, delta) {
  const next = level + delta;
  return next < MIN_LEVEL ? MIN_LEVEL : next > MAX_LEVEL ? MAX_LEVEL : next;
}
