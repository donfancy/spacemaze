// Bildraum-Schwenk fuer die "lockere Kamerafuehrung" im Fahrt-Modus.
// Reine Berechnung, kein Canvas -> headless testbar.
//
// Die Hidden-Line-Verdeckung (render/occlusion.js) setzt eine HORIZONTALE
// Kamera voraus (Verdeckung rein azimutal ueber Bildschirm-x). Roll/Nick
// duerfen deshalb NICHT in die 3D-Kamerabasis -- stattdessen aufs fertige Bild:
//   - Roll um die Blickachse ist EXAKT eine 2D-Rotation um die Bildmitte
//     (beide Projektionen unterscheiden sich nur um diese Drehung),
//   - kleines Nicken ist in sehr guter Naeherung eine vertikale Verschiebung
//     um tan(pitch) * Brennweite (der Keystone-Fehler ist bei ~1 Grad unsichtbar).
//
// Vorzeichen: roll > 0 = Kamera legt sich nach rechts -> Bild dreht sich
// ENTGEGEN (Canvas-Winkel -roll). pitch > 0 = Blick hebt sich -> Szene
// wandert im Bild nach unten (dy > 0, Canvas-y waechst nach unten).
export function swayTransform(roll, pitch, viewport) {
  const focal = (viewport.height / 2) / Math.tan(viewport.fov / 2); // Pixel
  return { angle: -roll, dy: Math.tan(pitch) * focal };
}
