// Engine-Wahl: '1980' (Canvas-Vektor, renderer.js) oder '2026' (Three.js,
// render2026/backend.js). Reine Berechnung, kein DOM -> headless testbar.
//
// Stand Stufe 0 (PLAN2026.md): die Wahl kommt aus dem URL-Parameter
// ?engine=2026. Der Startscreen-Schalter (Stufe 3) bekommt spaeter Vorrang-
// Regeln (URL vor localStorage vor Default) -- die gehoeren dann hierher.

export const ENGINE_1980 = '1980';
export const ENGINE_2026 = '2026';
export const ENGINES = [ENGINE_1980, ENGINE_2026];

// Liest die Engine aus einem URL-Query-String ('?engine=2026').
// Unbekannte oder fehlende Werte fallen auf '1980' zurueck.
export function parseEngine(search) {
  const value = new URLSearchParams(search).get('engine');
  return ENGINES.includes(value) ? value : ENGINE_1980;
}
