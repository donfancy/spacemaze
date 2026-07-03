// Praezise Weg-Aufzeichnung als Polyline. Rein rechnerisch -> headless testbar.
// Punkte sind [x, z] in lokalen Flaechen-Koordinaten (Welt-Einheiten), also die
// echte Spielerposition -- nicht mehr nur Zellmitten.
//
// Damit die Liste kompakt bleibt:
//   - neue Punkte erst ab einer Mindestdistanz zum letzten Punkt (minDist),
//   - nahezu geradlinige Fortsetzungen VERLAENGERN das letzte Segment, statt
//     einen Punkt anzuhaengen (ein gerader Gang = genau 2 Punkte).
// Kurven (Drehen waehrend der Fahrt) reissen die Kollinearitaet und erzeugen
// automatisch Zwischenpunkte.

export function recordTrailPoint(trail, x, z, opts = {}) {
  const minDist = opts.minDist ?? 0;
  const maxTurn = opts.maxTurn ?? 0.02; // Radiant: bis hierhin zaehlt es als "geradeaus"
  const force = opts.force ?? false;    // Mindestdistanz ignorieren (letzter Punkt beim Verlassen)

  if (trail.length === 0) {
    trail.push([x, z]);
    return trail;
  }

  const [lx, lz] = trail[trail.length - 1];
  const dx = x - lx;
  const dz = z - lz;
  const dist = Math.hypot(dx, dz);
  if (dist === 0) return trail;
  if (dist < minDist && !force) return trail;

  if (trail.length >= 2) {
    // Richtung des letzten Segments vs. Fortsetzung zum neuen Punkt: bleibt der
    // Knick unter maxTurn (und geht es vorwaerts), letzten Punkt verschieben.
    const [ax, az] = trail[trail.length - 2];
    const ex = lx - ax;
    const ez = lz - az;
    const elen = Math.hypot(ex, ez);
    const sinTurn = Math.abs(ex * dz - ez * dx) / (elen * dist);
    const forwards = ex * dx + ez * dz > 0;
    if (forwards && sinTurn < maxTurn) {
      trail[trail.length - 1] = [x, z];
      return trail;
    }
  }

  trail.push([x, z]);
  return trail;
}
