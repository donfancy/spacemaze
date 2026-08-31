// Favicon-Generator MAZESTORM: blockiges "M" aus dem 5x7-Titel-Font,
// Phosphor-Gruen auf Schwarz mit dimmem Glow-Halo. Erzeugt PNGs
// (16/32/48/180/192/512), favicon.ico (16+32+48 als PNG-Eintraege) und
// favicon.svg -- alles zero-dependency (zlib aus Node).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) throw new Error('Aufruf: node genFavicon.mjs <public-Verzeichnis>');

// --- Bitmap 16x16: M (5x7, Titel-Font) x2 = 10x14, zentriert ------------
const M = ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'];
const N = 16;
const grid = Array.from({ length: N }, () => new Array(N).fill(0)); // 0 bg, 1 halo, 2 gruen
for (let r = 0; r < 7; r++) {
  for (let c = 0; c < 5; c++) {
    if (M[r][c] !== '#') continue;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) grid[1 + r * 2 + dy][3 + c * 2 + dx] = 2;
    }
  }
}
// Leucht-Zellen als Rechtecke (fuer den Distanz-Glow beim Rastern).
const lit = [];
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) if (grid[y][x] === 2) lit.push([x, y]);
}
const GREEN = [77, 255, 122]; // #4dff7a
// Abstand eines Punkts (Raster-Koordinaten) zur naechsten Leucht-Zelle.
function litDist(px, py) {
  let best = Infinity;
  for (const [x, y] of lit) {
    const dx = Math.max(x - px, 0, px - (x + 1));
    const dy = Math.max(y - py, 0, py - (y + 1));
    const d = Math.hypot(dx, dy);
    if (d < best) best = d;
    if (best === 0) return 0;
  }
  return best;
}

// --- PNG-Encoder (RGBA, keine Interlace) ---------------------------------
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 Bit, RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0; // Filter none
    for (let x = 0; x < size; x++) {
      // Pixel-Mitte in Raster-Koordinaten: die Schrift bleibt bewusst
      // blockig (1981), aber der Glow faellt WEICH mit dem Abstand ab.
      const d = litDist((x + 0.5) * N / size, (y + 0.5) * N / size);
      const k = d === 0 ? 1 : 0.55 * Math.exp(-1.6 * d);
      const o = row + 1 + x * 4;
      raw[o] = Math.round(GREEN[0] * k);
      raw[o + 1] = Math.round(GREEN[1] * k);
      raw[o + 2] = Math.round(GREEN[2] * k);
      raw[o + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- ICO: 16/32/48 als eingebettete PNGs (Vista+-Standard) ---------------
function ico(sizes) {
  const pngs = sizes.map(png);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // Typ Icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s; e[1] = s;           // Breite/Hoehe (16/32/48 passen in 1 Byte)
    e.writeUInt16LE(1, 4);        // Planes
    e.writeUInt16LE(32, 6);       // Bit pro Pixel
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}

// --- SVG: dieselben Pixel als rects, mit weichem Glow --------------------
function svg() {
  const rects = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (grid[y][x] === 2) rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">
<rect width="16" height="16" fill="#000"/>
<g fill="#4dff7a" filter="url(#g)">${rects.join('')}</g>
<filter id="g" x="-30%" y="-30%" width="160%" height="160%">
<feDropShadow dx="0" dy="0" stdDeviation="0.6" flood-color="#4dff7a" flood-opacity="0.85"/>
</filter>
</svg>\n`;
}

writeFileSync(join(OUT, 'favicon.ico'), ico([16, 32, 48]));
writeFileSync(join(OUT, 'favicon.svg'), svg());
writeFileSync(join(OUT, 'apple-touch-icon.png'), png(180));
writeFileSync(join(OUT, 'icon-192.png'), png(192));
writeFileSync(join(OUT, 'icon-512.png'), png(512));
writeFileSync(join(OUT, 'site.webmanifest'), JSON.stringify({
  name: 'MAZESTORM',
  short_name: 'MAZESTORM',
  icons: [
    { src: '/public/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/public/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
  theme_color: '#000000',
  background_color: '#000000',
  display: 'fullscreen',
}, null, 2) + '\n');
console.log('Favicon-Set geschrieben nach', OUT);
