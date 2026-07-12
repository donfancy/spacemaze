// Farbpalette + reine Farb-Mathe -- kein Canvas, headless testbar.
// Die Levels waehlen hier ihre Linienfarbe (core/levels.js -> levelColor),
// der Renderer nutzt PHOSPHOR_GREEN als Grundfarbe, und der Startscreen
// blendet beim An-/Abdocken mit mixColors zwischen Gruen und der Level-Farbe.

export const PHOSPHOR_GREEN = '#4dff7a'; // klassischer Vektor-Phosphor
export const TEMPEST_BLUE = '#4d7aff';   // Tempest-Blau (Level 6-10)

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
