// Kompass-Rose als reine 2D-Screen-Geometrie -> headless testbar; gezeichnet
// wird sie in playing.js ueber renderer.drawPolylines/drawText.
//
// Konvention wie die Ego-Steuerung (mazeView/mazeWorld): yaw=0 blickt nach
// Norden (= oben auf der Karte, -vAxis), positives yaw dreht nach links
// (Westen). Die Rose ist "heading up": oben ist immer die Blickrichtung, die
// Buchstaben rotieren entsprechend (blickt man nach Westen, steht W oben).

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

  // Buchstaben innen auf einem kleineren Radius; Winkel relativ zur
  // Blickrichtung: alpha = bearing - yaw, oben = alpha 0, links = alpha +90.
  const letterRadius = radius * 0.62;
  const labels = DIRECTIONS.map(({ label, bearing }) => {
    const a = bearing - yaw;
    return {
      label,
      x: cx - letterRadius * Math.sin(a),
      y: cy - letterRadius * Math.cos(a),
      major: label === 'N', // Norden heller hervorheben
    };
  });

  return { polylines: [circle, lubber], labels };
}
