// Achsen-Metrik: bildet Grid-Koordinaten auf "Achsen-Einheiten" ab, wenn die
// Zellen ungleich breit sind. Reine Berechnung, kein Canvas -> headless testbar.
//
// Idee (Spec von Boris): Das Labyrinth-Grid bleibt EXAKT wie bisher (Kammern auf
// ungeraden, Pfosten auf geraden Indizes, Zwischenwaende dazwischen). Nur die
// DARSTELLUNG streckt die Achsen ungleichmaessig: Zellen mit GERADEM Index
// (Pfosten- und Wand-Spuren) sind `wall` Einheiten breit, Zellen mit UNGERADEM
// Index (Kammer-/Gang-Spuren) `corridor` Einheiten. Mit wall=1, corridor=5
// entstehen schmale Waende (1 Einheit) und breite Gaenge (5 Einheiten);
// wall=corridor=1 ist die klassische Blockwelt (toUnits = Identitaet).
//
// Die Abbildung ist pro Achse stueckweise linear und wirkt auf KONTINUIERLICHE
// Grid-Koordinaten (g=2.5 = Mitte der Zelle 2). Ausserhalb von [0,n] wird das
// Paritaetsmuster einfach fortgesetzt (fuer Randabstaende, z.B. Kompass-Marker).

// Breite der Zelle mit Index i (Paritaet, auch fuer negative i).
function cellWidth(i, wall, corridor) {
  return ((i % 2) + 2) % 2 === 0 ? wall : corridor;
}

// Einheiten-Position der VORDERKANTE von Zelle i: unter den Zellen 0..i-1 sind
// ceil(i/2) gerade und floor(i/2) ungerade (gilt formelgleich auch fuer i < 0).
function cellStart(i, wall, corridor) {
  return Math.ceil(i / 2) * wall + Math.floor(i / 2) * corridor;
}

// Erzeugt eine Metrik. { wall, corridor } sind die Zellbreiten in Einheiten.
export function createMetric({ wall = 1, corridor = 1 } = {}) {
  if (!(wall > 0) || !(corridor > 0)) {
    throw new Error('Metrik-Breiten muessen > 0 sein: wall=' + wall + ', corridor=' + corridor);
  }
  const pair = wall + corridor;
  return {
    wall,
    corridor,

    // Gesamtbreite eines Grids mit n Zellen in Einheiten.
    total(n) {
      return cellStart(n, wall, corridor);
    },

    // Kontinuierliche Grid-Koordinate -> Einheiten.
    toUnits(g) {
      const i = Math.floor(g);
      return cellStart(i, wall, corridor) + (g - i) * cellWidth(i, wall, corridor);
    },

    // Einheiten -> kontinuierliche Grid-Koordinate (Umkehrung von toUnits).
    toGrid(u) {
      const p = Math.floor(u / pair); // Index des (gerade,ungerade)-Zellenpaars
      const rem = u - p * pair;
      return rem < wall
        ? 2 * p + rem / wall
        : 2 * p + 1 + (rem - wall) / corridor;
    },
  };
}

// Die klassische Blockwelt: alle Zellen 1 Einheit breit, toUnits = Identitaet.
export const UNIFORM_METRIC = createMetric();

// Metrik eines Mazes (generateMaze setzt sie; Fallback fuer Hand-Mazes in Tests).
export function mazeMetric(maze) {
  return maze.metric ?? UNIFORM_METRIC;
}
