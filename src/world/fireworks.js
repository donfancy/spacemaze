// Ziel-FEUERWERK: beim Erreichen des Ziels spriessen rund um die Ziel-Zone
// viele senkrechte Strahlen aus dem Boden. Jeder Strahl lebt kurz und
// durchlaeuft dabei von unsichtbar alle KLASSISCHEN Arcade-Farben
// (Rot, Gelb, Gruen, Blau, Magenta, Cyan -- harte Wechsel, kein weiches
// Blenden: 1981 schaltete die Palette) bis nach Weiss und verschwindet.
// Geburtszeiten, Ort, Hoehe und Lebensdauer streuen pro Strahl -- zusammen
// funkelt es wie ein Feuerwerk. Reine Berechnung, deterministisch aus dem
// Seed (headless testbar), kein Canvas.

export const FIREWORK = {
  count: 70,      // Strahlen insgesamt
  duration: 2.8,  // s: Gesamtdauer des Feuerwerks
  minLife: 0.7,   // s: kuerzestes Strahlen-Leben
  maxLife: 1.2,   // s: laengstes
  riseIn: 0.15,   // Anteil des Lebens: von unsichtbar hochblenden
  fadeOut: 0.3,   // Anteil des Lebens: im Weiss verloeschen
};

// Die klassischen Farben in Boris' Reihenfolge, Weiss als Finale.
export const FIREWORK_COLORS = [
  '#ff2020', // Rot
  '#ffee00', // Gelb
  '#00ff44', // Gruen
  '#3355ff', // Blau (leicht aufgehellt -- reines Blau saeuft auf Schwarz ab)
  '#ff33ff', // Magenta
  '#00eeff', // Cyan
];
const WHITE = '#ffffff';

function hash(i, salt) {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Aktive Strahlen zum Alter `age` (s seit Ziel-Erreichen).
// opts = { seed, center: [x, z], spread, height } (Welt-Einheiten):
// Strahlen stehen gleichverteilt in einer Kreisscheibe um `center`.
// Liefert [{ x, z, top, color, intensity }] -- intensity 0..1,
// color aus FIREWORK_COLORS bzw. Weiss in der Schlussphase.
export function fireworkBeams(age, opts) {
  const { seed = 0, center, spread, height } = opts;
  const beams = [];
  if (age < 0 || age >= FIREWORK.duration) return beams;
  const steps = FIREWORK_COLORS.length + 1; // + Weiss
  for (let i = 0; i < FIREWORK.count; i++) {
    const h = (salt) => hash(i + (seed % 9973) * 0.618, salt);
    const life = FIREWORK.minLife + (FIREWORK.maxLife - FIREWORK.minLife) * h(4);
    const born = h(3) * (FIREWORK.duration - life);
    const p = (age - born) / life;
    if (p < 0 || p >= 1) continue;

    const angle = h(1) * 2 * Math.PI;
    const r = spread * Math.sqrt(h(2)); // gleichverteilt in der Scheibe
    const idx = Math.min(steps - 1, Math.floor(p * steps));
    // Huellkurve: hochblenden, voll strahlen, im Weiss verloeschen.
    const intensity = p < FIREWORK.riseIn
      ? p / FIREWORK.riseIn
      : p > 1 - FIREWORK.fadeOut ? (1 - p) / FIREWORK.fadeOut : 1;
    beams.push({
      x: center[0] + Math.cos(angle) * r,
      z: center[1] + Math.sin(angle) * r,
      top: height * (0.35 + 0.65 * h(5)),
      color: idx < FIREWORK_COLORS.length ? FIREWORK_COLORS[idx] : WHITE,
      intensity,
    });
  }
  return beams;
}
