// Level-Definitionen: reine Daten + reine Funktionen -> headless testbar.
// `n` ist die Labyrinth-Groesse; `metric` (optional, { wall, corridor }) sind
// die Darstellungs-Breiten der Zellen (world/metric.js): ohne Angabe Blockwelt
// (Waende so breit wie Gaenge), mit wall=1/corridor=5 schmale Waende.
// `drive` (optional) schaltet die Fahr-Dynamik ein (world/drive.js): auto-
// matischer Vortrieb, nur lenken, Abprall mit Wellen und Kamera-Schwingung.
// Weitere Eigenschaften (Gegner, Zeitlimit, ...) kommen spaeter als Felder dazu.

const THIN = { wall: 1, corridor: 5 }; // schmale Waende (ab Level 6)

export const LEVELS = [
  { n: 9 },   // Level 1
  { n: 11 },  // Level 2
  { n: 13 },  // Level 3
  { n: 15 },  // Level 4
  { n: 17 },  // Level 5
  { n: 17, metric: THIN, drive: true }, // Level 6: schmale Waende, Fahrt
  { n: 19, metric: THIN, drive: true }, // Level 7
  { n: 21, metric: THIN, drive: true }, // Level 8
  { n: 23, metric: THIN, drive: true }, // Level 9
  { n: 25, metric: THIN, drive: true }, // Level 10
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
