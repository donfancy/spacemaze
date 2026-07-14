// Level-Definitionen: reine Daten + reine Funktionen -> headless testbar.
// `n` ist die Labyrinth-Groesse; `metric` (optional, { wall, corridor }) sind
// die Darstellungs-Breiten der Zellen (world/metric.js): ohne Angabe Blockwelt
// (Waende so breit wie Gaenge), mit wall=1/corridor=5 schmale Waende.
// `drive` (optional) schaltet die Fahr-Dynamik ein (world/drive.js): auto-
// matischer Vortrieb, nur lenken, Abprall mit Wellen und Kamera-Schwingung.
// `color` (optional) ist die Linienfarbe des Levels (Waende, Marker, Text);
// ohne Angabe Phosphor-Gruen. Level 6-10 sind Tempest-blau.
// Ab Level 11 (Kampf-Levels):
//   `straight` (0..1)  Geradeaus-Bias des Generators (laengere Gangstuecke)
//   `shoot`            Space feuert Projektile (world/shots.js, Tempest-Regel)
//   `enemies`          { count, patrol }: Anzahl roter Rauten (world/enemies.js)
//                      und Anteil davon, der im Gang patrouilliert (0..1)
// Ab Level 16 (wieder blau, neue Feinde):
//   `spinners`         { count }: gruene Spiral-Spinner an den End-Waenden
//                      langer Gangstuecke (world/spinners.js); ihr Spike
//                      sperrt den Gang und will per Dauerfeuer gekuerzt werden
// Ab Level 21 (wieder gruen, Feind-Trio):
//   `spinners.shoot`   Spinner feuern beim Vorlaufen sirrende Schuesse
//                      (abfangbar per Dauerfeuer)
//   `spinners.color`   Linienfarbe der Spinner (gelb -- auf gruenen Waenden
//                      waere das Spinner-Gruen unsichtbar); spinnerColor()
//   `flippers`         { count }: magenta X-Flipper in langen Gaengen
//                      (world/flippers.js); ihre Querschnitts-Ebene ist
//                      toedlich, abschiessbar nur in Links-/Rechts-Stellung.
//                      Tanker (rote Rauten), die aus >= 3 Feldern abgeschossen
//                      werden, hinterlassen ein Flipper-PAAR.

import { PHOSPHOR_GREEN, TEMPEST_BLUE, ARCADE_YELLOW } from '../render/colors.js';

const THIN = { wall: 1, corridor: 5 }; // schmale Waende (ab Level 6)

export const LEVELS = [
  { n: 9 },   // Level 1
  { n: 11 },  // Level 2
  { n: 13 },  // Level 3
  { n: 15 },  // Level 4
  { n: 17 },  // Level 5
  { n: 17, metric: THIN, drive: true, color: TEMPEST_BLUE }, // Level 6: schmale Waende, Fahrt
  { n: 19, metric: THIN, drive: true, color: TEMPEST_BLUE }, // Level 7
  { n: 21, metric: THIN, drive: true, color: TEMPEST_BLUE }, // Level 8
  { n: 23, metric: THIN, drive: true, color: TEMPEST_BLUE }, // Level 9
  { n: 25, metric: THIN, drive: true, color: TEMPEST_BLUE }, // Level 10
  // Level 11+: groesser, laengere Geraden, rote Rauten-Feinde + Schiessen.
  { n: 27, metric: THIN, drive: true, straight: 0.6, shoot: true, enemies: { count: 6, patrol: 0 } },    // Level 11
  { n: 29, metric: THIN, drive: true, straight: 0.6, shoot: true, enemies: { count: 8, patrol: 0 } },    // Level 12
  { n: 31, metric: THIN, drive: true, straight: 0.6, shoot: true, enemies: { count: 10, patrol: 0.4 } }, // Level 13
  { n: 33, metric: THIN, drive: true, straight: 0.6, shoot: true, enemies: { count: 12, patrol: 0.7 } }, // Level 14
  { n: 35, metric: THIN, drive: true, straight: 0.6, shoot: true, enemies: { count: 14, patrol: 1 } },   // Level 15
  // Level 16-20: wieder Tempest-blau, Groesse moderat (35-39), dafuer mehr
  // lange Geraden (straight steigt) -- die Buehne fuer die Spinner. Level 16
  // fuehrt sie solo ein, ab 17 kommen die Rauten zurueck (Mix, steigend).
  { n: 35, metric: THIN, drive: true, straight: 0.7, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 5 } },                                                                            // Level 16
  { n: 35, metric: THIN, drive: true, straight: 0.7, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 5 }, enemies: { count: 6, patrol: 0.5 } },                                        // Level 17
  { n: 37, metric: THIN, drive: true, straight: 0.75, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 6 }, enemies: { count: 8, patrol: 0.7 } },                                        // Level 18
  { n: 37, metric: THIN, drive: true, straight: 0.75, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 7 }, enemies: { count: 10, patrol: 1 } },                                         // Level 19
  { n: 39, metric: THIN, drive: true, straight: 0.8, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 8 }, enemies: { count: 12, patrol: 1 } },                                         // Level 20
  // Level 21-25: wieder Phosphor-GRUEN, die Labyrinthe wachsen weiter
  // (41-45), straight bleibt 0.8. Neu: magenta FLIPPER (Level 21 fuehrt sie
  // solo ein, mit Tankern als Paar-Quelle), ab 22 kehren die Spinner zurueck
  // -- jetzt GELB (auf Gruen) und FEUERND (shoot). Bis 25 steigt das Trio.
  { n: 41, metric: THIN, drive: true, straight: 0.8, shoot: true,
    flippers: { count: 5 }, enemies: { count: 10, patrol: 1 } },                                         // Level 21
  { n: 43, metric: THIN, drive: true, straight: 0.8, shoot: true,
    flippers: { count: 5 }, enemies: { count: 10, patrol: 1 },
    spinners: { count: 5, shoot: true, color: ARCADE_YELLOW } },                                         // Level 22
  { n: 43, metric: THIN, drive: true, straight: 0.8, shoot: true,
    flippers: { count: 6 }, enemies: { count: 12, patrol: 1 },
    spinners: { count: 6, shoot: true, color: ARCADE_YELLOW } },                                         // Level 23
  { n: 45, metric: THIN, drive: true, straight: 0.8, shoot: true,
    flippers: { count: 7 }, enemies: { count: 13, patrol: 1 },
    spinners: { count: 7, shoot: true, color: ARCADE_YELLOW } },                                         // Level 24
  { n: 45, metric: THIN, drive: true, straight: 0.8, shoot: true,
    flippers: { count: 8 }, enemies: { count: 14, patrol: 1 },
    spinners: { count: 8, shoot: true, color: ARCADE_YELLOW } },                                         // Level 25
];

export const MIN_LEVEL = 1;
export const MAX_LEVEL = LEVELS.length;

// Konfiguration eines Levels (1-basiert); ausserhalb des Bereichs: null.
export function levelConfig(level) {
  return Number.isInteger(level) && level >= MIN_LEVEL && level <= MAX_LEVEL
    ? LEVELS[level - 1]
    : null;
}

// Linienfarbe eines Levels; ausserhalb des Bereichs/ohne Angabe Phosphor-Gruen.
export function levelColor(level) {
  return levelConfig(level)?.color ?? PHOSPHOR_GREEN;
}

// Spinner-Farbe eines Levels: Level 16-20 Spinner-Gruen (auf Blau), ab 21
// gelb (spinners.color) -- auch die Karten-Kreuze folgen dieser Farbe.
export function spinnerColor(level) {
  return levelConfig(level)?.spinners?.color ?? PHOSPHOR_GREEN;
}

// Auswahl schrittweise aendern, an den Raendern begrenzt (kein Umlauf).
export function stepLevel(level, delta) {
  const next = level + delta;
  return next < MIN_LEVEL ? MIN_LEVEL : next > MAX_LEVEL ? MAX_LEVEL : next;
}
