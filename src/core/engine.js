// Engine-Wahl: '1980' (Canvas-Vektor, renderer.js) oder '2026' (Three.js,
// render2026/backend.js). Reine Berechnung, kein DOM -> headless testbar.
//
// Stand Stufe 3 (PLAN2026.md): der Startscreen hat einen Schalter (Pfeil
// hoch/runter), die Wahl wird in localStorage gemerkt. Vorrang-Regel beim
// Laden: URL-Parameter (?engine=2026) VOR gemerkter Wahl VOR Default 1980.
// localStorage selbst fasst nur main.js an (DOM-Schicht) -- hier ist nur
// die pure Aufloesung.

export const ENGINE_1980 = '1980';
export const ENGINE_2026 = '2026';
export const ENGINES = [ENGINE_1980, ENGINE_2026];

// Liest die Engine aus einem URL-Query-String ('?engine=2026').
// Unbekannte oder fehlende Werte fallen auf '1980' zurueck.
export function parseEngine(search) {
  const value = new URLSearchParams(search).get('engine');
  return ENGINES.includes(value) ? value : ENGINE_1980;
}

// Aufloesung mit Vorrang: expliziter URL-Parameter > gemerkte Wahl > 1980.
// `stored` ist der localStorage-Wert (oder null); Unsinn faellt sicher durch.
export function resolveEngine(search, stored) {
  const param = new URLSearchParams(search).get('engine');
  if (ENGINES.includes(param)) return param;
  if (ENGINES.includes(stored)) return stored;
  return ENGINE_1980;
}

// Der Schalter kennt nur zwei Stellungen: die jeweils andere.
export function otherEngine(engine) {
  return engine === ENGINE_2026 ? ENGINE_1980 : ENGINE_2026;
}
