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

// Elektrisches "Brutzeln" (Fahr-Modus, Level 6-10): eine Funken-Entladung,
// KEIN Schlag (12.7.2026 elektrischer gemacht -- der alte dumpfe Rechteck/
// Sinus-Bauch klang wie Schuss/Explosion, sagt Boris). Drei Schichten:
// helles Funken-KNISTERN (hoher, fallender Bandpass, schnelle unregel-
// maessige Zacken = Funkenspruehen), darunter der LICHTBOGEN -- ein Saege-
// zahn-Surren mit zitternder Tonhoehe, per Hochpass von jedem Bauch
// befreit ("bzzzt") -- und nur noch ein winziger Kontakt-Tick am Anfang.
export function sizzlePatch(impact = 1) {
  const a = 0.4 + 0.6 * clamp01(impact);
  const dur = 0.4 + 0.25 * clamp01(impact);
  return {
    duration: dur,
    voices: [
      // Funkenspruehen: spitzes Knistern, tief einbrechende Zacken.
      { type: 'noise',
        filter: { type: 'bandpass', freq: [[0, 5200], [dur, 1600]], q: 1.8 },
        gain: [[0, 0], [0.006, 0.55 * a], [0.02, 0.08 * a], [0.045, 0.42 * a],
               [0.07, 0.06 * a], [0.1, 0.36 * a], [0.13, 0.05 * a],
               [0.17, 0.28 * a], [0.21, 0.04 * a], [0.26, 0.2 * a],
               [0.31, 0.03 * a], [0.36, 0.12 * a], [dur, 0]] },
      // Lichtbogen: Saegezahn-Surren, Tonhoehe zittert und sackt beim
      // Ausklingen ab; der Hochpass laesst nur die Obertoene durch.
      { type: 'osc', shape: 'sawtooth',
        freq: [[0, 165], [0.05, 95], [0.09, 180], [0.14, 75], [0.2, 140],
               [0.28, 60], [dur, 45]],
        filter: { type: 'highpass', freq: [[0, 420]] },
        gain: [[0, 0], [0.01, 0.3 * a], [0.05, 0.1 * a], [0.08, 0.26 * a],
               [0.12, 0.08 * a], [0.16, 0.2 * a], [0.24, 0.05 * a],
               [0.3, 0.12 * a], [dur, 0]] },
      // Kontakt-Tick: kurzer heller Schnapper -- man spuert die Beruehrung,
      // ohne dass es knallt.
      { type: 'osc', shape: 'square',
        freq: [[0, 1400], [0.05, 320]],
        gain: [[0, 0], [0.005, 0.16 * a], [0.06, 0]] },
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

// Reinfallen: Wind-Whoosh, der zur Mitte anschwillt (dort ist der Schwenk am
// schnellsten) und weich landet, darunter ein FALLENDER Gleitton. Dauer =
// Schwenk-Dauer der Szene, damit der Klang genau mit der Landung endet.
export function fallPatch(duration = 1.7) {
  const d = duration;
  return {
    duration: d,
    voices: [
      { type: 'noise',
        filter: { type: 'lowpass', freq: [[0, 250], [0.5 * d, 1400], [d, 180]] },
        gain: [[0, 0], [0.45 * d, 0.18], [d, 0]] },
      { type: 'osc', shape: 'triangle',
        freq: [[0, 320], [d, 55]],
        gain: [[0, 0], [0.4 * d, 0.11], [0.9 * d, 0.04], [d, 0]] },
    ],
  };
}

// Rausschweben: das Reinfallen rueckwaerts -- der Gleitton STEIGT, der Whoosh
// ist weicher (man schwebt, man stuerzt nicht).
export function risePatch(duration = 1.7) {
  const d = duration;
  return {
    duration: d,
    voices: [
      { type: 'noise',
        filter: { type: 'lowpass', freq: [[0, 180], [0.5 * d, 1100], [d, 250]] },
        gain: [[0, 0], [0.5 * d, 0.14], [d, 0]] },
      { type: 'osc', shape: 'sine',
        freq: [[0, 60], [d, 340]],
        gain: [[0, 0], [0.45 * d, 0.1], [d, 0]] },
    ],
  };
}

// "Nagen" beim Labyrinth-Wachstum: eine Serie kurzer Knusper-Bisse (Rausch-
// Spitzen durch einen mittigen Bandpass), deterministisch gejittert in
// Timing, Pegel und Faerbung -- wie etwas, das sich in die Flaeche frisst.
// Dauer = Wachstumszeit der Szene; die Beiss-Rate ist fest (~10/s), damit es
// bei jeder Labyrinth-Groesse gleich klingt.
export function gnawPatch(duration = 2.6) {
  const bites = Math.max(6, Math.round(duration * 10));
  const span = duration - 0.06; // Luft, damit der letzte Biss vor dem Ende ausklingt
  const gain = [[0, 0]];
  const freq = [];
  for (let i = 0; i < bites; i++) {
    const ti = 0.005 + ((i + 0.5) / bites) * span + 0.02 * Math.sin(i * 12.9898);
    const level = 0.12 + 0.08 * Math.abs(Math.sin(i * 7.13));
    gain.push([ti, 0], [ti + 0.005, level], [ti + 0.04, 0]);
    freq.push([ti, 900 + 450 * Math.sin(i * 3.7)]);
  }
  gain.push([duration, 0]);
  return {
    duration,
    voices: [
      { type: 'noise', filter: { type: 'bandpass', freq, q: 2 }, gain },
    ],
  };
}

// Level-Waehl-Tick (Startscreen): winziger, weicher Dreieck-Blip. Die
// Tonhoehe steigt mit dem gewaehlten Level (pitch01 = 0..1 ueber die
// Level-Skala) -- man "hoert", wo man auf der Leiter steht.
export function tickPatch(pitch01 = 0) {
  const hz = 500 + 500 * clamp01(pitch01);
  return {
    duration: 0.07,
    voices: [
      { type: 'osc', shape: 'triangle',
        freq: [[0, hz]],
        gain: [[0, 0], [0.005, 0.09], [0.07, 0]] },
    ],
  };
}

// An-/Abdock-Flug (Startscreen <-> Karte): sehr dezenter Schwebe-Whoosh,
// deutlich leiser als fall/rise -- man gleitet nur ans Grid heran. Beim
// Andocken STEIGT der Gleitton sacht (Ankunft), beim Abdocken (out) faellt
// er. Dauer = Flugdauer, damit der Klang genau mit der Ankunft endet.
export function dockPatch(duration = 1.6, out = false) {
  const d = duration;
  const [f0, f1] = out ? [150, 70] : [70, 150];
  return {
    duration: d,
    voices: [
      { type: 'noise',
        filter: { type: 'lowpass', freq: [[0, 150], [0.5 * d, 700], [d, 150]] },
        gain: [[0, 0], [0.5 * d, 0.06], [d, 0]] },
      { type: 'osc', shape: 'sine',
        freq: [[0, f0], [d, f1]],
        gain: [[0, 0], [0.5 * d, 0.04], [d, 0]] },
    ],
  };
}

// Schuss: kurzer "Pew"-Zap (fallender Rechteck-Gleitton + Hauch Hochpass-
// Rauschen). Bewusst leise und knapp -- bei Dauerfeuer (5/s) darf er nicht nerven.
export function shotPatch() {
  return {
    duration: 0.12,
    voices: [
      { type: 'osc', shape: 'square',
        freq: [[0, 950], [0.1, 160]],
        gain: [[0, 0], [0.005, 0.14], [0.05, 0.08], [0.12, 0]] },
      { type: 'noise',
        filter: { type: 'highpass', freq: [[0, 2500]] },
        gain: [[0, 0], [0.004, 0.05], [0.05, 0]] },
    ],
  };
}

// Verpuffen eines Projektils an der Wand: weicher, kurzer Rausch-Puff.
export function poofPatch() {
  return {
    duration: 0.18,
    voices: [
      { type: 'noise',
        filter: { type: 'lowpass', freq: [[0, 1600], [0.15, 300]] },
        gain: [[0, 0], [0.01, 0.12], [0.18, 0]] },
    ],
  };
}

// Spike-Treffer (Spinner, ab Level 16): kurzer metallischer "Clink", deutlich
// hoeher als das Verpuffen -- so tickt das Dauerfeuer-Kuerzen hoerbar mit.
export function clinkPatch() {
  return {
    duration: 0.09,
    voices: [
      { type: 'osc', shape: 'square',
        freq: [[0, 1500], [0.08, 950]],
        gain: [[0, 0], [0.004, 0.1], [0.09, 0]] },
      { type: 'noise',
        filter: { type: 'highpass', freq: [[0, 3500]] },
        gain: [[0, 0], [0.003, 0.05], [0.04, 0]] },
    ],
  };
}

// Spinner-Schuss (ab Level 21): ein SIRREN -- schneller Saegezahn-Triller,
// dessen Tonhoehe eng und flott auf und ab flattert (wie ein gereiztes
// Insekt), dazu ein duenner Hochpass-Schleier. Bewusst kurz und nicht laut:
// er kuendigt den heranfliegenden Schuss an, mehr nicht.
export function whirrPatch() {
  const dur = 0.4;
  // Enges, schnelles Flattern um einen steigenden Grundton.
  const freq = [];
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * dur;
    freq.push([t, 620 + 90 * (i / 12) + (i % 2 === 0 ? 70 : -70)]);
  }
  return {
    duration: dur,
    voices: [
      { type: 'osc', shape: 'sawtooth',
        freq,
        filter: { type: 'highpass', freq: [[0, 500]] },
        gain: [[0, 0], [0.02, 0.11], [0.3, 0.08], [dur, 0]] },
      { type: 'noise',
        filter: { type: 'bandpass', freq: [[0, 3800], [dur, 2600]], q: 3 },
        gain: [[0, 0], [0.03, 0.04], [dur, 0]] },
    ],
  };
}

// Feind-Abschuss: mittlerer Krach -- Rauschexplosion mit gezackter Huellkurve
// (wie das Brutzeln, aber breiter), harter Rechteck-Schlag, dumpfer Koerper.
export function boomPatch() {
  return {
    duration: 0.5,
    voices: [
      { type: 'noise',
        filter: { type: 'lowpass', freq: [[0, 2400], [0.5, 150]] },
        gain: [[0, 0], [0.008, 0.62], [0.08, 0.25], [0.12, 0.42], [0.3, 0.15], [0.5, 0]] },
      { type: 'osc', shape: 'square',
        freq: [[0, 180], [0.3, 35]],
        gain: [[0, 0], [0.01, 0.25], [0.35, 0]] },
      { type: 'osc', shape: 'sine',
        freq: [[0, 100], [0.4, 45]],
        gain: [[0, 0], [0.015, 0.3], [0.45, 0]] },
    ],
  };
}

// Game-Over-Crash: DIE grosse Explosion -- lauter und laenger als der Feind-
// Abschuss, mit tiefem, lange austrudelndem Bass-Koerper und nachzackenden
// Truemmer-Wellen im Rauschen. Dazu (12.7.2026, passend zum zerberstenden
// Bild) das splitternde KLIRREN, das den Crash klar vom Abschuss-Boom
// unterscheidet: ein hochresonantes Scherben-Band, das von ganz oben
// herabfaellt, und gestaffelte Glas-Pings, die immer tiefer und leiser
// nachklingeln -- die Scherben regnen aus.
export function crashPatch() {
  // Glas-Pings: kurze Dreieck-Chirps, jeder spaeter, tiefer und leiser als
  // der vorige; jeder einzelne kippt zusaetzlich leicht nach unten.
  const pings = [
    [0.06, 5200], [0.16, 4300], [0.3, 3400], [0.48, 2600], [0.72, 1900], [0.98, 1300],
  ].map(([at, hz], i) => ({
    type: 'osc', shape: 'triangle',
    freq: [[at, hz], [at + 0.16, hz * 0.82]],
    gain: [[at, 0], [at + 0.008, 0.14 * (1 - i * 0.12)], [at + 0.16, 0]],
  }));
  return {
    duration: 1.3,
    voices: [
      { type: 'noise',
        filter: { type: 'lowpass', freq: [[0, 3200], [1.3, 60]] },
        gain: [[0, 0], [0.008, 0.8], [0.15, 0.35], [0.22, 0.55], [0.4, 0.25],
               [0.6, 0.32], [1.3, 0]] },
      { type: 'osc', shape: 'square',
        freq: [[0, 140], [0.8, 25]],
        gain: [[0, 0], [0.01, 0.4], [0.9, 0]] },
      { type: 'osc', shape: 'sine',
        freq: [[0, 65], [1.0, 28]],
        gain: [[0, 0], [0.02, 0.5], [1.2, 0]] },
      // Scherben-Klirren: hoch-resonantes Rauschband (hoher Q = es klingelt
      // statt zu rauschen) faellt von ganz oben herab, glitzernd gezackt.
      { type: 'noise',
        filter: { type: 'bandpass', freq: [[0, 6500], [1.1, 900]], q: 9 },
        gain: [[0, 0], [0.015, 0.3], [0.08, 0.1], [0.14, 0.24], [0.22, 0.08],
               [0.32, 0.18], [0.45, 0.06], [0.6, 0.12], [0.8, 0.04], [1.1, 0]] },
      ...pings,
    ],
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
