// Gyro (ab Level 26): die ROTATION der Blickachse nach einer Pulsar-
// Beruehrung. Der Blick rollt um die eigene Achse -- kurz rasch beschleunigt,
// dann ebenso rasch gebremst (Dreiecks-Tempoprofil) -- und rastet wieder im
// 90-Grad-Raster ein. STURM-Branch (Boris, 3.9.2026): der Betrag ist IMMER
// 360 Grad (links- oder rechtsherum) -- die verdrehte Welt war unspielbar;
// die Maschinerie fuer 270/450 (orient, gyroDirs, das rotierende
// Tastenkreuz) bleibt liegen und ist mit orient 0 wirkungslos. Reine
// Berechnung.
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
  amounts: [2 * Math.PI], // immer 360 Grad (Sturm-Branch; frueher 270/360/450)
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

// Das GANZE Tastenkreuz unter der eingerasteten Stellung: alle vier Pfeile
// rotieren gemeinsam (dieselbe Herleitung wie LEFT_KEY -- die Rolle, die
// aufrecht auf "up" liegt, wandert bei 90 Grad dorthin, wo "up" auf dem
// verdrehten Bildschirm erscheint: nach links). Damit folgen auch Boost
// (logisch up) und Ausrichten (logisch down, Fahrt-Modus ab Level 6) der
// Verdrehung, exakt wie die Lenk-Tasten. keys = physische Tasten
// { left, right, up, down }, Ergebnis = logische Rollen.
export function gyroDirs(orient, keys) {
  const k = orient & 3;
  return {
    left: !!keys[LEFT_KEY[k]],
    right: !!keys[LEFT_KEY[(k + 2) % 4]],
    up: !!keys[LEFT_KEY[(k + 3) % 4]],
    down: !!keys[LEFT_KEY[(k + 1) % 4]],
  };
}

// Lenk-Eingabe (turn in [-1,1], links positiv wie ueberall) aus den vier
// Richtungs-Tasten unter der eingerasteten Stellung `orient` (0..3).
// keys = { left, right, up, down } (Booleans).
export function gyroTurn(orient, keys) {
  const d = gyroDirs(orient, keys);
  return (d.left ? 1 : 0) - (d.right ? 1 : 0);
}

// Winkel auf den KUERZESTEN Weg normalisieren ([-PI, PI)): der Rueckschwenk
// dreht eine Rest-Verdrehung (game.viewRoll) sanft aus -- 270 Grad sollen
// als -90 ausgedreht werden, nicht als Dreiviertel-Drehung zurueck.
export function shortestRoll(angle) {
  return ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

// Anzeige der Lenk-Tasten fuer die Steuer-Zeile (erst Lenk-links, dann
// Lenk-rechts, z.B. 'DOWN/UP' bei 90 Grad) -- direkt aus LEFT_KEY
// abgeleitet und damit garantiert die Inverse des gyroTurn-Mappings.
export function steerHintKeys(orient) {
  const k = (orient ?? 0) & 3;
  return LEFT_KEY[k].toUpperCase() + '/' + LEFT_KEY[(k + 2) % 4].toUpperCase();
}

// Anzeige der Boost-/Ausrichten-Tasten (logisch up/down im Fahrt-Modus) --
// dieselbe Rotation wie gyroDirs, garantiert die Inverse des Mappings.
export function assistHintKeys(orient) {
  const k = (orient ?? 0) & 3;
  return {
    boost: LEFT_KEY[(k + 3) % 4].toUpperCase(),
    align: LEFT_KEY[(k + 1) % 4].toUpperCase(),
  };
}
