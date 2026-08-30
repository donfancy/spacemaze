// Der GLEITER: Spieler-Avatar fuer die Aussen-Kameras der 2026-Wiedergabe
// (Replay-Modus -- in der Ego-Ansicht ist der Spieler unsichtbar, von aussen
// braucht er eine Gestalt). Tempest-Verwandter: ein pfeilfoermiger Vektor-
// Dart mit gekerbtem Heck und Seitenflosse, dunkler Koerper unter
// gluehenden Kanten (Tanker-Prinzip), neigt sich in Kurven (bank).
//
// Reines Modell (kein Three.js): Koordinaten in GANGBREITEN (cell = 1),
// Blickrichtung -z (Konvention wie forward), y nach oben, Ursprung im
// Rumpf-Zentrum. Der Renderer skaliert mit der Gangbreite und setzt
// Position/Drehung -- die Geometrie ist statisch.

// Eckpunkte (x, y, z): Nase voraus (-z), Fluegelspitzen hinten aussen,
// Heck-Kerbe innen (der Tempest-Look), Kiel unterm Rumpf, Flosse oben.
const NOSE = [0, 0.10, -0.30];
const WING_L = [-0.26, 0.02, 0.22];
const WING_R = [0.26, 0.02, 0.22];
const NOTCH = [0, 0.06, 0.10];   // Heck-Kerbe (zwischen den Fluegelspitzen)
const KEEL = [0, -0.07, 0.02];   // Kiel unter dem Rumpf
const FIN_TOP = [0, 0.22, 0.14]; // Seitenflosse (bleibt unter der Augenhoehe)
const FIN_FRONT = [0, 0.09, -0.04];
const FIN_BACK = [0, 0.07, 0.22];

export const GLIDER = {
  height: 0.26, // Flughoehe des Rumpf-Zentrums ueber dem Boden (Gangbreiten)
  bankGain: 1.6, // Kurvenneigung des Rumpfs relativ zum Kamera-bank

  // Gluehende Kanten (Konturen-Paare [a, b]).
  segments: [
    [NOSE, WING_L], [NOSE, WING_R],       // Vorderkanten
    [WING_L, NOTCH], [WING_R, NOTCH],     // Heck mit Kerbe
    [NOSE, KEEL], [KEEL, NOTCH],          // Kiel-Linie unterm Rumpf
    [WING_L, KEEL], [WING_R, KEEL],       // Kiel an die Fluegel gespannt
    [FIN_FRONT, FIN_TOP], [FIN_TOP, FIN_BACK], // Flosse
  ],

  // Dunkle Fuellung (Dreiecke aus je 3 Punkten, DoubleSide beim Rendern).
  triangles: [
    [NOSE, WING_L, NOTCH], [NOSE, NOTCH, WING_R],   // Oberseite
    [NOSE, KEEL, WING_L], [NOSE, WING_R, KEEL],     // Unterseite zum Kiel
    [KEEL, NOTCH, WING_L], [KEEL, WING_R, NOTCH],   // Heck-Unterseite
    [FIN_FRONT, FIN_TOP, FIN_BACK],                 // Flosse
  ],
};
