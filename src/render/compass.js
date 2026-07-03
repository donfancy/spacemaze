// Kompass-Rose als reine 2D-Screen-Geometrie -> headless testbar; gezeichnet
// wird sie in playing.js ueber renderer.drawPolylines/drawText.
//
// Konvention wie die Ego-Steuerung (mazeView/mazeWorld): yaw=0 blickt nach
// Norden (= oben auf der Karte, -vAxis), positives yaw dreht nach links
// (Westen). Die Rose ist "heading up": oben ist immer die Blickrichtung.
// Die Buchstaben haengen radial ausgerichtet an der Kreis-Kante (jeweils mit
// einem Tick) und rotieren MIT der Scheibe als starre Einheit -- blickt man
// nach Westen, haengt das W oben, auf der Seite liegend wie auf einer echten
// Kompass-Scheibe.

const DIRECTIONS = [
  { label: 'N', bearing: 0 },
  { label: 'W', bearing: Math.PI / 2 },
  { label: 'S', bearing: Math.PI },
  { label: 'E', bearing: -Math.PI / 2 },
];

export function compassLayout(yaw, { cx, cy, radius, circleSegments = 24 }) {
  // Kreis als eine geschlossene Polyline.
  const circle = [];
  for (let i = 0; i <= circleSegments; i++) {
    const a = (i / circleSegments) * 2 * Math.PI;
    circle.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  // Peilmarke oben: kleines Dach ueber dem Kreis (Blickrichtung).
  const lubber = [
    [cx - radius * 0.14, cy - radius * 1.28],
    [cx, cy - radius * 1.02],
    [cx + radius * 0.14, cy - radius * 1.28],
  ];

  // Buchstaben knapp innerhalb der Kante, Winkel relativ zur Blickrichtung:
  // alpha = bearing - yaw, oben = alpha 0, links = alpha +90. Jeder Buchstabe
  // ist um -alpha mitgedreht (Oben-Richtung zeigt radial nach aussen), dazu ein
  // Tick an der Kante -- so rotiert die Scheibe sichtbar als Einheit.
  const letterRadius = radius * 0.66;
  const ticks = [];
  const labels = DIRECTIONS.map(({ label, bearing }) => {
    const a = bearing - yaw;
    const dirX = -Math.sin(a); // Einheitsrichtung vom Zentrum zur Kante
    const dirY = -Math.cos(a);
    ticks.push([
      [cx + dirX * radius * 0.88, cy + dirY * radius * 0.88],
      [cx + dirX * radius, cy + dirY * radius],
    ]);
    return {
      label,
      x: cx + dirX * letterRadius,
      y: cy + dirY * letterRadius,
      angle: -a, // mitrotieren: Buchstaben-Oben = radial nach aussen
      major: label === 'N', // Norden heller hervorheben
    };
  });

  return { polylines: [circle, lubber, ...ticks], labels };
}
