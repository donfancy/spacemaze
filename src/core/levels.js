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
//   `enemies`          { count, group? }: Tanker (world/enemies.js) -- LAUERN
//                      seit dem Sturm-Branch in Gruppen (bis `group`, Standard
//                      ENEMY.group) auf den Wandkronen langer Gaenge, purzeln
//                      bei Sichtkontakt herunter, jagen und feuern; jeder
//                      Abschuss hinterlaesst ein Flipper-PAAR (world/flippers.js)
// Ab Level 16 (wieder blau, neue Feinde):
//   `spinners`         { count }: gruene Spiral-Spinner an den End-Waenden
//                      langer Gangstuecke (world/spinners.js); ihr Spike
//                      sperrt den Gang und will per Dauerfeuer gekuerzt werden
// Ab Level 21 (wieder gruen):
//   `spinners.shoot`   Spinner feuern beim Vorlaufen sirrende Schuesse
//                      (abfangbar per Dauerfeuer)
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
  { n: 27, metric: THIN, drive: true, straight: 0.75, shoot: true, enemies: { count: 6, group: 2 } },   // Level 11
  { n: 29, metric: THIN, drive: true, straight: 0.75, shoot: true, enemies: { count: 8, group: 3 } },   // Level 12
  { n: 31, metric: THIN, drive: true, straight: 0.75, shoot: true, enemies: { count: 10, group: 4 } },  // Level 13
  { n: 33, metric: THIN, drive: true, straight: 0.75, shoot: true, enemies: { count: 12, group: 5 } },  // Level 14
  { n: 35, metric: THIN, drive: true, straight: 0.75, shoot: true, enemies: { count: 14, group: 6 } },  // Level 15
  // Level 16-20: wieder Tempest-blau, Groesse moderat (35-39), dafuer mehr
  // lange Geraden (straight steigt) -- die Buehne fuer die Spinner. Level 16
  // fuehrt sie solo ein, ab 17 kommen die Rauten zurueck (Mix, steigend).
  { n: 35, metric: THIN, drive: true, straight: 0.75, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 5 } },                                                                            // Level 16
  { n: 35, metric: THIN, drive: true, straight: 0.75, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 5 }, enemies: { count: 6, group: 3 } },                                           // Level 17
  { n: 37, metric: THIN, drive: true, straight: 0.75, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 6 }, enemies: { count: 8, group: 4 } },                                           // Level 18
  { n: 37, metric: THIN, drive: true, straight: 0.75, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 7 }, enemies: { count: 10, group: 5 } },                                          // Level 19
  { n: 39, metric: THIN, drive: true, straight: 0.8, shoot: true, color: TEMPEST_BLUE,
    spinners: { count: 8 }, enemies: { count: 12 } },                                                    // Level 20
  // Level 21-25: wieder Phosphor-GRUEN, die Labyrinthe wachsen weiter
  // (41-45), straight bleibt 0.8. Level 21 nur Tanker-Alleys (volle
  // Gruppen), ab 22 kehren die Spinner zurueck -- jetzt GELB (auf Gruen)
  // und FEUERND (shoot). Bis 25 steigt alles.
  { n: 41, metric: THIN, drive: true, straight: 0.8, shoot: true,
    enemies: { count: 10 } },                                                                            // Level 21
  { n: 43, metric: THIN, drive: true, straight: 0.8, shoot: true,
    enemies: { count: 10 },
    spinners: { count: 5, shoot: true, color: ARCADE_YELLOW } },                                         // Level 22
  { n: 43, metric: THIN, drive: true, straight: 0.8, shoot: true,
    enemies: { count: 12 },
    spinners: { count: 6, shoot: true, color: ARCADE_YELLOW } },                                         // Level 23
  { n: 45, metric: THIN, drive: true, straight: 0.8, shoot: true,
    enemies: { count: 13 },
    spinners: { count: 7, shoot: true, color: ARCADE_YELLOW } },                                         // Level 24
  { n: 45, metric: THIN, drive: true, straight: 0.8, shoot: true,
    enemies: { count: 14 },
    spinners: { count: 8, shoot: true, color: ARCADE_YELLOW } },                                         // Level 25
  // Level 26-30: ARCADE-ROT, die Labyrinthe wachsen weiter (47-51), bunte
  // Sterne, und ALLE bisherigen Feinde treten an -- Tanker jetzt BLAU (Rot
  // ist die Wandfarbe), Spinner wieder gruen (gelb gehoert den Neuen),
  // Flipper-Paare magenta. Neu: gelbe PULSARE -- unzerstoerbare
  // Zackenlinien, deren Beruehrung die Blickachse um 360 Grad verdreht.
  { n: 47, metric: THIN, drive: true, straight: 0.8, shoot: true, color: ARCADE_RED, rainbowStars: true,
    pulsars: { count: 3 }, enemies: { count: 12, color: TEMPEST_BLUE },
    spinners: { count: 6, shoot: true } },                                        // Level 26
  { n: 47, metric: THIN, drive: true, straight: 0.8, shoot: true, color: ARCADE_RED, rainbowStars: true,
    pulsars: { count: 4 }, enemies: { count: 12, color: TEMPEST_BLUE },
    spinners: { count: 7, shoot: true } },                                        // Level 27
  { n: 49, metric: THIN, drive: true, straight: 0.8, shoot: true, color: ARCADE_RED, rainbowStars: true,
    pulsars: { count: 5 }, enemies: { count: 13, color: TEMPEST_BLUE },
    spinners: { count: 7, shoot: true } },                                        // Level 28
  { n: 49, metric: THIN, drive: true, straight: 0.8, shoot: true, color: ARCADE_RED, rainbowStars: true,
    pulsars: { count: 6 }, enemies: { count: 14, color: TEMPEST_BLUE },
    spinners: { count: 8, shoot: true } },                                        // Level 29
  { n: 51, metric: THIN, drive: true, straight: 0.8, shoot: true, color: ARCADE_RED, rainbowStars: true,
    pulsars: { count: 8 }, enemies: { count: 15, color: TEMPEST_BLUE },
    spinners: { count: 8, shoot: true } },                                        // Level 30
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
