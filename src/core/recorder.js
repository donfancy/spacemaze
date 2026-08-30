// Replay-Aufzeichnung (Stufe "Replay-Modus"): reine Daten + Berechnung,
// kein Canvas/DOM -> headless testbar.
//
// ANSATZ: Zustands-SCHNAPPSCHUESSE statt Eingabe-Wiedergabe. Die Begehung
// zeichnet ~30x pro Sekunde einen kompakten Snapshot auf (Spieler-Kanaele,
// Schuesse, geklonte Feind-Listen) plus eine EVENT-Spur (Bump, Kollision,
// Ziel, Crash, Gyro, Burst-Specs, Sounds). Damit sind Pause, Vor- UND
// Zurueckspulen reine Zeiger-Bewegung: sampleAt(t) interpoliert zwischen
// zwei Samples, Effekte/Sounds kommen aus den Events -- kein Re-Simulieren,
// keine Determinismus-Fallen.
//
// Die Zeitachse ist die kumulierte BEGEHUNGS-Zeit des Laufs: mehrteilige
// Laeufe (X -> Karte -> S zurueck) haengen nahtlos aneinander, die
// Karten-Besuche fehlen (Boris' Wunsch: der ganze Lauf am Stueck).

export const RECORDER = {
  rate: 30,           // Abtastrate (Hz) -- dazwischen wird interpoliert
  maxSamples: 18000,  // Deckel ~10 min: danach faellt vorn das Aelteste weg
};

// meta: reine Beschreibung des Laufs (level, seed, drive, shoot, ...).
export function createRecording(meta = {}) {
  return {
    rate: RECORDER.rate,
    t: 0,          // aufgezeichnete Spielzeit (Ende der Aufnahme)
    samples: [],   // [{t, px, pz, yaw, roll, pitch, bank, steer, speed,
                   //   shots, foeShots, enemies, spinners, flippers, pulsars}]
    events: [],    // [{t, type, ...daten}], chronologisch
    meta,
  };
}

// Beginn der Aufnahme (nach dem Ringpuffer-Deckel > 0).
export function recordingStart(rec) {
  return rec.samples.length ? rec.samples[0].t : 0;
}

export function recordingDuration(rec) {
  return rec.t;
}

export function hasRecording(rec) {
  return !!rec && rec.samples.length > 1;
}

// Ein Frame der Begehung: Uhr weiterzaehlen und -- wenn seit dem letzten
// Sample 1/rate vergangen ist -- einen Schnappschuss ablegen. `snap` wird
// GEKLONT (die Szene darf ihre Objekte weiterbewegen). Liefert true, wenn
// ein Sample entstand.
export function recordFrame(rec, dt, snap) {
  rec.t += dt;
  const last = rec.samples[rec.samples.length - 1];
  if (last && rec.t - last.t < 1 / rec.rate - 1e-9) return false;
  rec.samples.push({ t: rec.t, ...structuredClone(snap) });
  // Deckel: vorn abschneiden, verwaiste Events (vor dem neuen Anfang und
  // laenger tot als jede Effekt-Lebensdauer) mit wegwerfen.
  if (rec.samples.length > RECORDER.maxSamples) {
    rec.samples.shift();
    const t0 = rec.samples[0].t - EVENT_KEEP;
    let cut = 0;
    while (cut < rec.events.length && rec.events[cut].t < t0) cut++;
    if (cut) rec.events.splice(0, cut);
  }
  return true;
}

// Events vor dem Sample-Fenster bleiben so lange erhalten (laengste
// Effekt-Lebensdauer: Bursts ~1.2s, Wellen ~1.3s).
const EVENT_KEEP = 2;

// Ereignis an der aktuellen Aufnahme-Uhr festhalten.
export function recordEvent(rec, type, data = {}) {
  rec.events.push({ t: rec.t, type, ...structuredClone(data) });
}

const lerp = (a, b, f) => a + (b - a) * f;

// Schuesse zwischen zwei Samples interpolieren: Zuordnung ueber die pro
// Schuss eindeutige `phase` (eigene Schuesse: fired*2.4; Spinner-Schuesse:
// rng-Phase). Ohne Partner im Folge-Sample bleibt die alte Lage stehen
// (der Schuss stirbt gleich -- unsichtbar kurze Standzeit).
function lerpByPhase(listA, listB, f, fields) {
  if (!listA) return listA;
  const byPhase = new Map((listB ?? []).map((s) => [s.phase, s]));
  return listA.map((s) => {
    const b = byPhase.get(s.phase);
    if (!b) return s;
    const out = { ...s };
    for (const k of fields) out[k] = lerp(s[k], b[k], f);
    return out;
  });
}

// Interpolierter Zustand zur Zeit t (geklemmt auf die Aufnahme-Spanne).
// Spieler-Kanaele linear (alle stetig -- yaw/roll wickeln zwischen zwei
// Samples nie um), Schuesse per phase-Zuordnung, Feind-Listen als das
// juengere "davor"-Sample (Feinde bewegen sich < 0.03 Zellen pro Sample --
// unsichtbar; ihre Puls/Dreh-Animation haengt ohnehin an der stetigen Zeit).
export function sampleAt(rec, t) {
  const s = rec.samples;
  if (!s.length) return null;
  const tc = Math.max(s[0].t, Math.min(rec.t, t));
  // Binaersuche: groesster Index mit samples[i].t <= tc.
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid].t <= tc) lo = mid;
    else hi = mid - 1;
  }
  const a = s[lo];
  const b = s[lo + 1];
  if (!b) return { ...a, t: tc };
  const f = (tc - a.t) / (b.t - a.t);
  return {
    ...a,
    t: tc,
    px: lerp(a.px, b.px, f),
    pz: lerp(a.pz, b.pz, f),
    yaw: lerp(a.yaw, b.yaw, f),
    roll: lerp(a.roll, b.roll, f),
    pitch: lerp(a.pitch, b.pitch, f),
    bank: lerp(a.bank, b.bank, f),
    steer: lerp(a.steer, b.steer, f),
    speed: lerp(a.speed, b.speed, f),
    shots: lerpByPhase(a.shots, b.shots, f, ['x', 'z', 'age']),
    foeShots: lerpByPhase(a.foeShots, b.foeShots, f, ['t']),
  };
}

// Events im Intervall (t0, t1] -- fuer Sounds beim Vorwaerts-Abspielen.
export function eventsBetween(rec, t0, t1) {
  return rec.events.filter((e) => e.t > t0 && e.t <= t1);
}

// Events eines Typs, die zur Zeit t noch "leben" (Alter < life) -- fuer
// Bursts/Wellen, die reine Funktionen ihres Alters sind.
export function activeEvents(rec, t, type, life) {
  return rec.events.filter((e) => e.type === type && t >= e.t && t - e.t < life);
}

// Juengstes Event eines Typs bis zur Zeit t (oder null) -- z.B. der letzte
// Bump fuer das 2026-Feedback, 'reached' und 'crash' fuer den Zustand.
export function lastEventBefore(rec, t, type) {
  for (let i = rec.events.length - 1; i >= 0; i--) {
    const e = rec.events[i];
    if (e.t <= t && e.type === type) return e;
  }
  return null;
}
