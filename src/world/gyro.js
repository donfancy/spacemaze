// Gyro (ab Level 26): die ROTATION der Blickachse nach einer Pulsar-
// Beruehrung. Der Blick rollt um die eigene Achse -- kurz rasch beschleunigt,
// dann ebenso rasch gebremst (Dreiecks-Tempoprofil) -- und rastet nach 270,
// 360 oder 450 Grad wieder im 90-Grad-Raster ein. Das Spiel laeuft in der
// verdrehten Welt weiter (bis zum naechsten Pulsar). Reine Berechnung.
//
// WICHTIG (Hidden-Lines-Falle 4): der Roll geht NIE in die 3D-Kamerabasis,
// sondern als Bildraum-Sway (render/sway.js) aufs fertige Bild -- ein Roll
// um die Blickachse ist EXAKT eine 2D-Rotation um die Bildmitte, die
// Occlusion-Annahme (horizontale Kamera) bleibt heil.
//
// Steuerung bleibt "logisch": gelenkt wird mit dem Pfeil, der auf dem
// (verdrehten) Bildschirm dorthin zeigt, wohin der Blick schwenken soll --
// bei 90/270 Grad also mit runter/rauf, bei 180 Grad mit vertauschtem
// links/rechts. Das Mapping wechselt erst beim EINRASTEN (waehrend der
// Rotation lenkt man mit der alten Belegung weiter, Boris' Spec) -- darum
// haelt `orient` die zuletzt eingerastete Stellung getrennt vom Winkel.

export const GYRO = {
  amounts: [1.5 * Math.PI, 2 * Math.PI, 2.5 * Math.PI], // 270/360/450 Grad
  accel: 16, // rad/s^2: bis zur Haelfte beschleunigen, dann ebenso bremsen
             // (360 Grad dauern damit ~1.25 s, Spitze ~10 rad/s -- krass)
};

export function createGyro() {
  return { roll: 0, orient: 0, spinning: false, from: 0, delta: 0, t: 0, dur: 0 };
}

// Rotation starten: Betrag (270/360/450 Grad) und Drehrichtung aus rng
// (deterministisch testbar). Dauer aus dem Dreiecksprofil: der halbe Weg
// wird in dur/2 mit konstanter Beschleunigung geschafft ->
// theta/2 = accel/2 * (dur/2)^2. Liefert die Dauer (fuer den Sound).
export function startSpin(g, rng) {
  const theta = GYRO.amounts[Math.min(GYRO.amounts.length - 1,
    Math.floor(rng() * GYRO.amounts.length))];
  const dir = rng() < 0.5 ? -1 : 1;
  g.spinning = true;
  g.from = g.roll;
  g.delta = dir * theta;
  g.t = 0;
  g.dur = 2 * Math.sqrt(theta / GYRO.accel);
  return g.dur;
}

// Ein Simulationsschritt: Weg-Anteil s(p) des Dreiecksprofils ist stueckweise
// quadratisch (2p^2 bzw. 1-2(1-p)^2). Am Ende rastet der Roll EXAKT im
// 90-Grad-Raster ein (normalisiert auf [0, 2*PI)) und `orient` wechselt --
// erst ab da gilt das neue Tasten-Mapping.
export function gyroStep(g, dt) {
  if (!g.spinning) return;
  g.t += dt;
  if (g.t >= g.dur) {
    // Erst die Stellung bestimmen, dann den Roll EXAKT aufs Raster setzen
    // (Float-Modulo von PI-Vielfachen laesst sonst Winzreste stehen).
    const norm = (((g.from + g.delta) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    g.orient = Math.round(norm / (Math.PI / 2)) % 4;
    g.roll = g.orient * (Math.PI / 2);
    g.spinning = false;
    return;
  }
  const p = g.t / g.dur;
  const s = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
  g.roll = g.from + g.delta * s;
}

// Welcher Pfeil lenkt nach WELT-links? Herleitung ueber den Bildraum-Roll
// (sway: Canvas-Winkel = -roll, Canvas-y waechst nach unten): Welt-links
// erscheint bei 0 Grad links, bei 90 Grad UNTEN, bei 180 rechts, bei 270
// oben -- man drueckt den Pfeil, der auf die gewuenschte Seite zeigt.
const LEFT_KEY = ['left', 'down', 'right', 'up'];

// Lenk-Eingabe (turn in [-1,1], links positiv wie ueberall) aus den vier
// Richtungs-Tasten unter der eingerasteten Stellung `orient` (0..3).
// keys = { left, right, up, down } (Booleans).
export function gyroTurn(orient, keys) {
  const k = orient & 3;
  return (keys[LEFT_KEY[k]] ? 1 : 0) - (keys[LEFT_KEY[(k + 2) % 4]] ? 1 : 0);
}
