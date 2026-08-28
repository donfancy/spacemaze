// Splitter-Explosionen: kurze Liniensegmente, die von einem Punkt radial
// auseinanderfliegen und dabei verblassen -- vom kleinen "Verpuffen" eines
// Projektils an der Wand bis zur krachenden Game-Over-Explosion (nur die
// Parameter unterscheiden sich). Reine Berechnung, kein Canvas -> testbar.
//
// Die Streuung ist DETERMINISTISCH aus (seed, Splitter-Index) abgeleitet
// (Hash-Sinus wie beim gnaw-Patch): gleiche Explosion sieht in jedem Frame
// konsistent aus, ohne dass ein Zufallszustand mitgefuehrt werden muss.

// Pseudo-Zufall in [0,1) aus zwei Zahlen (deterministisch, ohne Zustand).
function hash01(i, seed) {
  const s = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// Splitter-Segmente einer Explosion im Alter `age`.
// opts: {
//   center: [x, y, z]  Ursprung (Weltkoordinaten der Spielflaeche)
//   count              Anzahl Splitter
//   speed              mittleres Flugtempo (Welt-Einheiten/s)
//   life               Lebensdauer (s)
//   size               Splitter-Halblaenge zu Beginn (Welt-Einheiten)
//   seed               Streuungs-Seed (verschiedene Explosionen streuen anders)
//   shardCount         (optional) Anzahl FLAECHIGER Truemmer (burstShards)
//   shardSize          (optional) Kantenmass der Truemmer (Standard 2*size)
// }
// Liefert { segments, fade } (fade 1 -> 0 ueber die Lebensdauer) oder null,
// wenn die Explosion vorbei (oder noch nicht geboren) ist.
export function burstSegments(age, opts) {
  const { center, count = 12, speed = 1, life = 0.6, size = 0.1, seed = 0 } = opts;
  if (age < 0 || age >= life) return null;
  const fade = 1 - age / life;
  const [cx, cy, cz] = center;
  const segments = [];
  for (let i = 0; i < count; i++) {
    // Richtung: Azimut gleichverteilt, Hoehenwinkel gemaessigt (die Splitter
    // fliegen eher seitlich als senkrecht -- wirkt auf der Flaeche natuerlicher).
    const az = 2 * Math.PI * hash01(i + 1, seed);
    const el = (hash01(i + 1, seed + 31) - 0.5) * 1.6;
    const v = speed * (0.5 + hash01(i + 1, seed + 67));
    const dx = Math.cos(az) * Math.cos(el);
    const dy = Math.sin(el);
    const dz = Math.sin(az) * Math.cos(el);
    // Splitter liegen ENTLANG ihrer Flugrichtung und schrumpfen beim Verblassen.
    const r = v * age;
    const s = size * fade;
    segments.push([
      [cx + dx * (r - s), cy + dy * (r - s), cz + dz * (r - s)],
      [cx + dx * (r + s), cy + dy * (r + s), cz + dz * (r + s)],
    ]);
  }
  return { segments, fade };
}

// FLAECHIGE Truemmer derselben Explosion (2026-Engine: "Panzerplatten" des
// zerplatzten Feinds -- die 1980-Engine kennt nur Linien und ignoriert sie):
// unregelmaessige Dreiecke, die wie die Splitter radial wegfliegen und dabei
// um eine eigene, feste Achse taumeln. Gleiche deterministische Streuung
// (hash01 aus seed + Index, eigener Index-Versatz gegen Gleichlauf mit den
// Splittern), gleiche Lebensdauer und derselbe fade.
// opts wie burstSegments; gerendert werden `shardCount` Dreiecke mit
// Kantenmass `shardSize`. Liefert { triangles: [[a,b,c], ...], fade } mit
// Punkten [x,y,z] -- oder null (vorbei, ungeboren oder shardCount 0).
const SHARD_SPIN = 6; // rad/s mittlere Taumel-Rate

export function burstShards(age, opts) {
  const { center, speed = 1, life = 0.6, size = 0.1, seed = 0 } = opts;
  const count = opts.shardCount ?? 0;
  const edge = opts.shardSize ?? size * 2;
  if (age < 0 || age >= life || count <= 0) return null;
  const fade = 1 - age / life;
  const [cx, cy, cz] = center;
  const triangles = [];
  for (let i = 0; i < count; i++) {
    const j = i + 101; // eigener Hash-Versatz (nicht dieselbe Bahn wie Splitter i)
    const az = 2 * Math.PI * hash01(j, seed);
    const el = (hash01(j, seed + 31) - 0.5) * 1.6;
    // Truemmer fliegen etwas traeger als die Funken-Splitter (schwere Platten).
    const v = speed * (0.35 + 0.65 * hash01(j, seed + 67));
    const mx = cx + Math.cos(az) * Math.cos(el) * v * age;
    const my = cy + Math.sin(el) * v * age;
    const mz = cz + Math.sin(az) * Math.cos(el) * v * age;
    // Taumel: feste zufaellige Achse (normalisiert), Winkel waechst mit age.
    let ax = hash01(j, seed + 11) - 0.5;
    let ay = hash01(j, seed + 23) - 0.5;
    let azz = hash01(j, seed + 41) - 0.5;
    const al = Math.hypot(ax, ay, azz) || 1;
    ax /= al; ay /= al; azz /= al;
    const ang = SHARD_SPIN * (0.6 + 0.8 * hash01(j, seed + 53)) * age // Taumel-Tempo 0.6x-1.4x
      + hash01(j, seed + 71) * 2 * Math.PI;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    // Unregelmaessiges Dreieck in der lokalen xy-Ebene, dann Rodrigues-Drehung.
    const tri = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * 2 * Math.PI + (hash01(j * 3 + k, seed + 83) - 0.5) * 0.9;
      const r = edge * (0.55 + 0.6 * hash01(j * 3 + k, seed + 97)); // Ecken-Radius 0.55x-1.15x
      const vx = Math.cos(a) * r, vy = Math.sin(a) * r, vz = 0;
      const dot = ax * vx + ay * vy + azz * vz;
      tri.push([
        mx + vx * cosA + (ay * vz - azz * vy) * sinA + ax * dot * (1 - cosA),
        my + vy * cosA + (azz * vx - ax * vz) * sinA + ay * dot * (1 - cosA),
        mz + vz * cosA + (ax * vy - ay * vx) * sinA + azz * dot * (1 - cosA),
      ]);
    }
    triangles.push(tri);
  }
  return { triangles, fade };
}
