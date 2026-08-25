# SPACE MAZE 2026 — Prototyp

Diskussionsgrundlage fuer die "2026-Variante": dasselbe Labyrinth wie im Spiel
(ECHTER Generator `src/world/maze.js`, echte Metrik, echte Farb-Palette, echter
Loesungsweg), aber GPU-gerendert mit Three.js — Flaechen, Bloom-Neon, Nebel,
Spiegel-Boden, Sternenhimmel, farbige Flutlichter, Ziel-Leuchtfeuer und drei
dekorative Tanker.

## Starten

Dev-Server wie immer (`npm start`), dann im Browser:

    http://localhost:3001/proto2026/index.html

Optional: `?seed=123` (bestimmtes Labyrinth), `?t0=0.5` (Autopilot startet
mitten auf der Route), `?probe` (Telemetrie in verstecktem DOM-Knoten,
fuer Headless-Tests).

## Tasten

- **B** Bloom an/aus, **R** Spiegel-Boden an/aus, **N** Nebel an/aus
- **F** Freiflug statt Autopilot (Klick faengt die Maus, WASD + Maus, Shift = Boost)
- **1/2/3** Farbthema Phosphor / Tempest / Arcade, **H** psychedelischer Farbzyklus

Das HUD zeigt FPS, Frame-Zeit, Draw-Calls und Dreiecke — damit lassen sich die
Kosten der Effekte live vergleichen (Toggle druecken, FPS beobachten).

## Architektur

- `world3d.js` — Szenen-AUFBAU aus den puren Spiel-Modulen (kein Spielzustand)
- `main.js` — Render-Loop, Autopilot (CatmullRom-Kurve ueber den Loesungsweg,
  Kurvenneigung, weiches Nachschwenken), Eingabe, HUD
- `vendor/` — Three.js r185 als ES-Module (kein Build-Tool, kein npm-Paket)

## Gelernte Fallen (fuers echte Projekt)

- Punktlicht mit `decay: 2` explodiert an nahen Waenden (1/d²) ins Bloom-Weiss.
  Loesung: Licht ueber die Kamera haengen (Mindestabstand) und klein halten.
- Albedo denkt in LINEAREM Farbraum: sRGB `0x1a` reflektiert nur ~1 % — solche
  Waende schlucken jedes Licht. Flaechen brauchen deutlich hellere Grundfarbe.
- Der Bloom-Schwellwert (0.85) trennt Neon von Flaeche: Leuchtkanten als
  HDR-Farben (`multiplyScalar(2+)`), alles andere unter 1.0 halten.
- Verdeckung, Sterne-hinter-Waenden, Silhouetten: alles GRATIS durch den
  Z-Buffer — der komplette `occlusion.js`/`skylineElevation`-Aufwand entfaellt.
