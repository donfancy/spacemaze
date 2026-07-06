// Gedaempfter harmonischer Oszillator: x'' = -omega^2 x - 2 zeta omega x'.
// Fuer "mechanische" Kamera-Schwingungen nach Kollisionen: kick() versetzt dem
// System einen Geschwindigkeits-Impuls, step() integriert (semi-implizites
// Euler -- stabil bei Frame-dt), x ist die Auslenkung (z.B. Roll-Winkel).
// Reine Berechnung, kein Canvas -> headless testbar.

export function createOscillator({ freq = 7, damping = 0.35 } = {}) {
  const omega = 2 * Math.PI * freq;
  return {
    x: 0,
    v: 0,

    // Impuls: addiert Geschwindigkeit (Stoss von aussen).
    kick(dv) {
      this.v += dv;
    },

    step(dt) {
      this.v += (-omega * omega * this.x - 2 * damping * omega * this.v) * dt;
      this.x += this.v * dt;
      return this.x;
    },

    reset() {
      this.x = 0;
      this.v = 0;
    },
  };
}
