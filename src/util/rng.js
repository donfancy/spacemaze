// Seedbarer, deterministischer Pseudo-Zufallsgenerator (mulberry32).
// Wichtig fuer reproduzierbare, testbare Labyrinth-Erzeugung:
// gleicher Seed -> exakt gleiche Zufallsfolge -> exakt gleiches Labyrinth.

// Liefert eine Funktion () => Zahl in [0, 1).
export function createRng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Zufaelliger 32-Bit-Seed -- fuer echte (nicht-deterministische) Spielsessions.
export function randomSeed() {
  return (Math.floor(Math.random() * 0x100000000)) >>> 0;
}

// Ganzzahl in [0, max) aus einem rng.
export function randInt(rng, max) {
  return Math.floor(rng() * max);
}

// Zufaelliges Element eines (nicht-leeren) Arrays.
export function pick(rng, arr) {
  return arr[randInt(rng, arr.length)];
}
