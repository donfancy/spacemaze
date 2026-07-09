// Sound-Patches: REINE Funktionen, die Klaenge als Daten beschreiben --
// kein AudioContext, headless testbar (analog zur Trennung Berechnung/
// renderer.js). Alles synthetisch im Stil der 1981er Arcade-Automaten
// (Battlezone): Oszillatoren + gefiltertes Rauschen, keine Samples.
//
// Ein Patch: { duration, voices: [voice...] } mit
//   voice = {
//     type: 'osc' | 'noise',
//     shape: 'sine'|'square'|'triangle'|'sawtooth',   (nur osc)
//     freq: [[t, hz], ...],   Tonhoehen-Huellkurve (nur osc)
//     gain: [[t, v], ...],    Lautstaerke-Huellkurve, beginnt und endet bei 0
//     filter: { type, freq: [[t, hz], ...], q? }      (optional, faerbt Rauschen)
//   }
// Zeiten in Sekunden ab Patch-Start, aufsteigend; Rampen dazwischen linear.

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// Dumpfer "Bump" (Level 1-5): tiefer, fallender Sinus-Koerper plus ein kurzer,
// weicher Rauschanschlag -- ein Poltern, kein Krachen.
export function bumpPatch(impact = 1) {
  const a = 0.3 + 0.7 * clamp01(impact);
  return {
    duration: 0.3,
    voices: [
      { type: 'osc', shape: 'sine',
        freq: [[0, 120], [0.25, 45]],
        gain: [[0, 0], [0.015, 0.5 * a], [0.3, 0]] },
      { type: 'noise',
        filter: { type: 'lowpass', freq: [[0, 400], [0.18, 120]] },
        gain: [[0, 0], [0.01, 0.2 * a], [0.18, 0]] },
    ],
  };
}

// Elektrisches "Brutzeln" (Fahr-Modus, Level 6-10): Rauschen mit GEZACKTER
// Huellkurve (das Knistern der Entladung) durch einen fallenden Bandpass,
// darunter ein harter Rechteck-Krach und der dumpfe Aufprall-Koerper.
export function sizzlePatch(impact = 1) {
  const a = 0.4 + 0.6 * clamp01(impact);
  const dur = 0.45 + 0.25 * clamp01(impact);
  return {
    duration: dur,
    voices: [
      { type: 'noise',
        filter: { type: 'bandpass', freq: [[0, 2600], [dur, 350]], q: 1.2 },
        gain: [[0, 0], [0.01, 0.55 * a], [0.06, 0.22 * a], [0.1, 0.45 * a],
               [0.16, 0.18 * a], [0.22, 0.32 * a], [0.3, 0.12 * a], [dur, 0]] },
      { type: 'osc', shape: 'square',
        freq: [[0, 220], [0.2, 40]],
        gain: [[0, 0], [0.008, 0.3 * a], [0.25, 0]] },
      { type: 'osc', shape: 'sine',
        freq: [[0, 110], [0.2, 50]],
        gain: [[0, 0], [0.015, 0.35 * a], [0.3, 0]] },
    ],
  };
}

// Ziel-Fanfare: drei aufsteigende Toene (C-Dur-Dreiklang C5-E5-G5, Rechteck
// wie ein Arcade-Jingle), der letzte klingt laenger aus.
export function fanfarePatch() {
  const notes = [
    [523.25, 0.0, 0.18],
    [659.25, 0.19, 0.18],
    [783.99, 0.38, 0.6],
  ];
  return {
    duration: 1.0,
    voices: notes.map(([hz, at, len]) => ({
      type: 'osc', shape: 'square',
      freq: [[at, hz]],
      gain: [[at, 0], [at + 0.02, 0.22], [at + len * 0.6, 0.16], [at + len, 0]],
    })),
  };
}

// Dauerklang "Motor": Ziel-Parameter fuer die drei stehenden Stimmen in
// audio.js (motor-Brumm, rumble-Rauschen, whine-Kurven-Sirren). Pur -- das
// Mapping Spielzustand -> Klang ist damit testbar.
//   mode 'walk' (Level 1-5): kaum merkliches Gleiten, nur waehrend der
//     Bewegung (speed = ERREICHTES Tempo 0..1, steer = |Lenkung| 0..1).
//   mode 'drive' (Level 6-10): deutlicher Motor, Tonhoehe folgt dem Tempo,
//     in Kurven sirrt es proportional zur Neigung (bank 0..1).
export function engineParams(mode, input = {}) {
  const speed = clamp01(input.speed ?? 0);
  const steer = clamp01(input.steer ?? 0);
  const bank = clamp01(input.bank ?? 0);
  if (mode === 'walk') {
    return {
      motor: { shape: 'triangle', freq: 40 + 16 * speed, gain: 0.03 * speed },
      rumble: { cutoff: 150 + 150 * speed, gain: 0.025 * Math.max(speed, 0.4 * steer) },
      whine: { freq: 200, gain: 0 },
    };
  }
  return {
    // Grund-Fahrton bewusst zurueckhaltend (war Boris zu laut) -- die
    // Ereignisse (Brutzeln) und das Kurven-Sirren tragen den Charakter.
    motor: { shape: 'sawtooth', freq: 45 + 55 * speed, gain: 0.04 * speed },
    rumble: { cutoff: 250 + 450 * speed, gain: 0.05 * speed },
    whine: { freq: 220 + 240 * bank, gain: 0.06 * bank },
  };
}
