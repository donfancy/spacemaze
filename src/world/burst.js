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
