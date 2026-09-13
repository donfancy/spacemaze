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
//   `enemies`          { count, group?, alleys? }: Tanker (world/enemies.js)
//                      -- LAUERN seit dem Sturm-Branch auf den Wandkronen
//                      langer Gaenge, purzeln bei Sichtkontakt herunter, jagen
//                      und feuern; jeder Abschuss hinterlaesst ein Flipper-
//                      PAAR (world/flippers.js). `count` = Tanker insgesamt;
//                      die ersten `alleys` Gaenge sind VOLLE "shooting
//                      alleys" (Gruppen bis `group`, Standard ENEMY.group),
//                      der Rest lauert EINZELN verstreut ueber weitere Gaenge
//                      (13.9.2026, Boris: "mehr Feinde verteilen")
// Ab Level 16 (wieder blau, neue Feinde):
//   `spinners`         { count }: gruene Spiral-Spinner an den End-Waenden
//                      langer Gangstuecke (world/spinners.js); sie wandern
//                      und verlaengern dabei ihren Spike, der den Gang
//                      sperrt und per Dauerfeuer gekuerzt werden will --
//                      und sie FEUERN (seit dem Sturm-Branch in allen
//                      Spinner-Levels, kein shoot-Flag mehr)
// Ab Level 21 (wieder gruen):
//   `spinners.color`   Linienfarbe der Spinner (gelb -- auf gruenen Waenden
//                      waere das Spinner-Gruen unsichtbar); spinnerColor()
//   Flipper (magenta X, world/flippers.js) werden NICHT mehr platziert --
//   sie entstehen ausschliesslich paarweise aus Tanker-Abschuessen (ab 11).
// Ab Level 26 (ARCADE-ROT, alle bisherigen Feinde plus Pulsare):
//   `enemies.color`    Linienfarbe der Tanker (Tempest-blau -- ihr Rot ist
//                      jetzt die Wandfarbe); enemyColor()
//   `pulsars`          { count }: gelbe pulsierende Zackenlinien im Gang-
//                      Querschnitt (world/pulsars.js) -- unzerstoerbar,
//                      nicht toedlich: Beruehrung ROTIERT die Blickachse
//                      (world/gyro.js), gespielt wird in der verdrehten Welt
//   `rainbowStars`     der Sternenhimmel funkelt BUNT (Arcade-Palette)

import { PHOSPHOR_GREEN, TEMPEST_BLUE, ARCADE_YELLOW, ARCADE_RED, TANKER_RED } from '../render/colors.js';

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
  // Level 11+: groesser, laengere Geraden (straight 0.75 -- die Buehne fuer
  // die Tanker-Alleys), lauernde Tanker in wachsenden Gruppen + Schiessen.
  // Je zwei bis drei volle Alleys, dazu Einzel-Lauerer verstreut (ein
  // 27er-Maze hat ~10 Weg-Gaenge mit 3+ Kammern, ein 35er ~16).
  { n: 27, metric: THIN, drive: true, straight: 0.75, shoot: true, enemies: { count: 8, group: 2, alleys: 2 } },   // Level 11: 2x2 + 4
  { n: 29, metric: THIN, drive: true, straight: 0.75, shoot: true, enemies: { count: 11, group: 3, alleys: 2 } },  // Level 12: 2x3 + 5
  { n: 31, metric: THIN, drive: true, straight: 0.75, shoot: true, enemies: { count: 18, group: 4, alleys: 3 } },  // Level 13: 3x4 + 6
  { n: 33, metric: THIN, drive: true, straight: 0.75, shoot: true, enemies: { count: 22, group: 5, alleys: 3 } },  // Level 14: 3x5 + 7
  { n: 35, metric: THIN, drive: true, straight: 0.75, shoot: true, enemies: { count: 26, group: 6, alleys: 3 } },  // Level 15: 3x6 + 8
  // Level 16-20: wieder Tempest-blau, Groesse moderat (35-39), dafuer mehr
  // lange Geraden (straight steigt) -- die Buehne fuer die Spinner. Level 16
  // fuehrt sie solo ein, ab 17 kommen die Rauten zurueck (Mix, steigend).
  { n: 35, metric: THIN, drive: true, straight: 0.75, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 6 } },                                                                            // Level 16
  { n: 35, metric: THIN, drive: true, straight: 0.75, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 6 }, enemies: { count: 11, group: 3, alleys: 2 } },                               // Level 17: 2x3 + 5
  { n: 37, metric: THIN, drive: true, straight: 0.75, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 7 }, enemies: { count: 14, group: 4, alleys: 2 } },                               // Level 18: 2x4 + 6
  { n: 37, metric: THIN, drive: true, straight: 0.75, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 8 }, enemies: { count: 21, group: 5, alleys: 3 } },                               // Level 19: 3x5 + 6
  { n: 39, metric: THIN, drive: true, straight: 0.8, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 9 }, enemies: { count: 25, alleys: 3 } },                                         // Level 20: 3x6 + 7
  // Level 21-25: wieder Phosphor-GRUEN, die Labyrinthe wachsen weiter
  // (41-45), straight bleibt 0.8. Level 21 nur Tanker (volle Alleys +
  // Einzelne), ab 22 kehren die Spinner zurueck -- jetzt GELB (auf Gruen).
  // Bis 25 steigt alles (ein 43er-Maze hat ~19 Weg-Gaenge mit 3+ Kammern).
  { n: 41, metric: THIN, drive: true, straight: 0.8, shoot: true,
    enemies: { count: 26, alleys: 3 } },                                                                 // Level 21: 3x6 + 8
  { n: 43, metric: THIN, drive: true, straight: 0.8, shoot: true,
    enemies: { count: 28, alleys: 3 },
    spinners: { count: 7, color: ARCADE_YELLOW } },                                         // Level 22: 3x6 + 10
  { n: 43, metric: THIN, drive: true, straight: 0.8, shoot: true,
    enemies: { count: 32, alleys: 4 },
    spinners: { count: 8, color: ARCADE_YELLOW } },                                         // Level 23: 4x6 + 8
  { n: 45, metric: THIN, drive: true, straight: 0.8, shoot: true,
    enemies: { count: 35, alleys: 4 },
    spinners: { count: 9, color: ARCADE_YELLOW } },                                         // Level 24: 4x6 + 11
  { n: 45, metric: THIN, drive: true, straight: 0.8, shoot: true,
    enemies: { count: 36, alleys: 4 },
    spinners: { count: 10, color: ARCADE_YELLOW } },                                        // Level 25: 4x6 + 12
  // Level 26-30: ARCADE-ROT, die Labyrinthe wachsen weiter (47-51), bunte
  // Sterne, und ALLE bisherigen Feinde treten an -- Tanker jetzt BLAU (Rot
  // ist die Wandfarbe), Spinner wieder gruen (gelb gehoert den Neuen),
  // Flipper-Paare magenta. Neu: gelbe PULSARE -- unzerstoerbare
  // Zackenlinien, deren Beruehrung die Blickachse um 360 Grad verdreht.
  { n: 47, metric: THIN, drive: true, straight: 0.8, shoot: true, color: ARCADE_RED, rainbowStars: true,
    pulsars: { count: 3 }, enemies: { count: 28, alleys: 3, color: TEMPEST_BLUE },
    spinners: { count: 8 } },                                        // Level 26: 3x6 + 10
  { n: 47, metric: THIN, drive: true, straight: 0.8, shoot: true, color: ARCADE_RED, rainbowStars: true,
    pulsars: { count: 4 }, enemies: { count: 32, alleys: 4, color: TEMPEST_BLUE },
    spinners: { count: 9 } },                                        // Level 27: 4x6 + 8
  { n: 49, metric: THIN, drive: true, straight: 0.8, shoot: true, color: ARCADE_RED, rainbowStars: true,
    pulsars: { count: 5 }, enemies: { count: 35, alleys: 4, color: TEMPEST_BLUE },
    spinners: { count: 9 } },                                        // Level 28: 4x6 + 11
  { n: 49, metric: THIN, drive: true, straight: 0.8, shoot: true, color: ARCADE_RED, rainbowStars: true,
    pulsars: { count: 6 }, enemies: { count: 36, alleys: 4, color: TEMPEST_BLUE },
    spinners: { count: 10 } },                                       // Level 29: 4x6 + 12
  { n: 51, metric: THIN, drive: true, straight: 0.8, shoot: true, color: ARCADE_RED, rainbowStars: true,
    pulsars: { count: 8 }, enemies: { count: 40, alleys: 5, color: TEMPEST_BLUE },
    spinners: { count: 10 } },                                       // Level 30: 5x6 + 10
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

// Tanker-Farbe eines Levels: Standard Rauten-Rot, ab 26 Tempest-blau
// (enemies.color) -- auch Karten-Kreuze und Abschuss-Splitter folgen ihr.
export function enemyColor(level) {
  return levelConfig(level)?.enemies?.color ?? TANKER_RED;
}

// Auswahl schrittweise aendern, an den Raendern begrenzt (kein Umlauf).
export function stepLevel(level, delta) {
  const next = level + delta;
  return next < MIN_LEVEL ? MIN_LEVEL : next > MAX_LEVEL ? MAX_LEVEL : next;
}
