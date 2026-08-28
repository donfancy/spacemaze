// Farbpalette + reine Farb-Mathe -- kein Canvas, headless testbar.
// Die Levels waehlen hier ihre Linienfarbe (core/levels.js -> levelColor),
// der Renderer nutzt PHOSPHOR_GREEN als Grundfarbe, und der Startscreen
// blendet beim An-/Abdocken mit mixColors zwischen Gruen und der Level-Farbe.

export const PHOSPHOR_GREEN = '#4dff7a'; // klassischer Vektor-Phosphor
export const TEMPEST_BLUE = '#4d7aff';   // Tempest-Blau (Level 6-10)
export const ARCADE_YELLOW = '#ffe14d';  // Spinner/Spikes auf Gruen (21-25), Pulsare (ab 26)
export const NEON_MAGENTA = '#ff4dea';   // Flipper (ab Level 21)
export const ARCADE_RED = '#ff4d4d';     // Linienfarbe der Pulsar-Levels (26-30)
export const TANKER_RED = '#ff3b30';     // Tanker-Rauten (Standard; ab 26 blau, s. levels.js)

// '#rrggbb' -> [r, g, b] (0..255).
export function parseHex(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// [r, g, b] -> '#rrggbb'; Kanaele werden gerundet und auf 0..255 geklemmt.
export function toHex(rgb) {
  const ch = (v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0');
  return `#${ch(rgb[0])}${ch(rgb[1])}${ch(rgb[2])}`;
}

// Luminanz (Rec.-709-Gewichte) einer '#rrggbb'-Farbe in LINEAR-sRGB, 0..1 --
// exakt so sieht sie der Bloom-Pass der 2026-Engine (THREE.Color wandelt
// hex-Farben in den linearen Arbeitsfarbraum): Phosphor-Gruen ~0.745,
// Tempest-Blau ~0.227.
export function linearLuminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Der LUMINANZ-NORMIERTE Glow-Boost der 2026-Diagramm-Ansichten (Karte/
// MazeGen; Boris' "Overglow ab Level 11"-Fix): der Bloom-Schwellwert
// arbeitet auf Luminanz -- Phosphor-Gruen (lum ~0.81) landet mit dem festen
// Ego-Boost weit darueber und ueberglueht die dichte Karte, Blau kaum.
// mix 0 = Ego (voller `ego`-Boost), mix 1 = Diagramm (Ziel-Luminanz
// `targetLum` knapp ueberm Schwellwert, gedeckelt durch `maxBoost` --
// dunkle Farben brauchen mehr Boost). Pur und testbar; das Backend
// reicht seine Konstanten (EGO_BOOST usw.) herein.
export function diagramBoost(hex, mix, { ego, targetLum, maxBoost = ego }) {
  const lum = Math.max(linearLuminance(hex), 1e-3);
  return ego + (Math.min(maxBoost, targetLum / lum) - ego) * mix;
}

// Linear zwischen zwei '#rrggbb'-Farben; t wird auf [0,1] geklemmt.
export function mixColors(a, b, t) {
  const k = Math.min(1, Math.max(0, t));
  const ca = parseHex(a);
  const cb = parseHex(b);
  return toHex([
    ca[0] + (cb[0] - ca[0]) * k,
    ca[1] + (cb[1] - ca[1]) * k,
    ca[2] + (cb[2] - ca[2]) * k,
  ]);
}
