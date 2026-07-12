// Bildraum-"Zerbersten" fuer den Spieler-Crash: wirft die (bereits
// projizierten) Linien des Bildes als Scherben durcheinander. Reine
// Berechnung ohne Canvas -- der Renderer wendet sie in drawPolylines an
// (pushShatter/popShatter, analog zum Sway; siehe Hidden-Lines-Regel:
// solche Effekte gehoeren in den BILDRAUM, nie in die 3D-Kamera).
//
// Jede Polylinie wird in Splitter von hoechstens `chunk` Pixeln Laenge
// geteilt; jeder Splitter fliegt radial vom Einschlag (cx, cy) weg --
// gemischt mit einer eigenen Streu-Richtung -- und dreht sich dabei um
// seine Mitte. Die Zufallswerte kommen aus einem raeumlichen Hash der
// QUANTISIERTEN Original-Lage: deterministisch (headless testbar) und
// ueber die Frames stabil, solange die Szene steht -- mit wachsendem
// `amount` fliegen die Scherben also auf festen Bahnen auseinander,
// mit fallendem sortieren sie sich wieder ein (Rueckschwenk).
// amount 0..1: 0 = unveraendert, 1 = volles Chaos.

export const SHATTER = {
  scale: 0.3, // maximale Flugweite bei amount 1, Anteil von min(width, height)
  chunk: 60,  // px: maximale Splitter-Laenge (laengere Linien zerbrechen)
  spin: 2.2,  // rad: maximale Eigendrehung eines Splitters bei amount 1
};

const GRID = 24; // px: Quantisierung des raeumlichen Hashs

function hash(x, y, salt) {
  const s = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// opts = { amount, cx, cy, scale (px), chunk?, spin? }.
export function shatterPolylines(polylines, opts) {
  const amount = opts.amount ?? 0;
  if (amount <= 0) return polylines;
  const chunk = opts.chunk ?? SHATTER.chunk;
  const spin = opts.spin ?? SHATTER.spin;
  const scale = opts.scale ?? 200;
  const cx = opts.cx ?? 0;
  const cy = opts.cy ?? 0;

  const out = [];
  for (const poly of polylines) {
    if (!poly || poly.length < 2) continue;
    for (let i = 1; i < poly.length; i++) {
      const [x1, y1] = poly[i - 1];
      const [x2, y2] = poly[i];
      const parts = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / chunk));
      for (let p = 0; p < parts; p++) {
        const ax = x1 + ((x2 - x1) * p) / parts;
        const ay = y1 + ((y2 - y1) * p) / parts;
        const bx = x1 + ((x2 - x1) * (p + 1)) / parts;
        const by = y1 + ((y2 - y1) * (p + 1)) / parts;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const qx = Math.round(mx / GRID);
        const qy = Math.round(my / GRID);
        const h1 = hash(qx, qy, 1); // Flugweite
        const h2 = hash(qx, qy, 2); // Streu-Winkel
        const h3 = hash(qx, qy, 3); // Drehung
        // Flugrichtung: radial vom Zentrum weg, mit kraeftiger eigener Streuung.
        const rl = Math.hypot(mx - cx, my - cy) || 1;
        const sa = h2 * 2 * Math.PI;
        const dirx = (mx - cx) / rl + 0.9 * Math.cos(sa);
        const diry = (my - cy) / rl + 0.9 * Math.sin(sa);
        const dl = Math.hypot(dirx, diry) || 1;
        const d = amount * scale * (0.35 + 0.65 * h1);
        const dx = (dirx / dl) * d;
        const dy = (diry / dl) * d;
        // Splitter um die eigene Mitte drehen, dann verschieben.
        const rot = amount * spin * (h3 * 2 - 1);
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const tx = (x, y) => mx + (x - mx) * cos - (y - my) * sin + dx;
        const ty = (x, y) => my + (x - mx) * sin + (y - my) * cos + dy;
        out.push([[tx(ax, ay), ty(ax, ay)], [tx(bx, by), ty(bx, by)]]);
      }
    }
  }
  return out;
}
