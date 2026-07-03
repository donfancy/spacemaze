# SPACE MAZE — Projekt-Instruktionen

3D-Vektorlabyrinth im Atari-Stil (Battlezone/Tempest/Star Wars), Browser, plain
vanilla JS, 2D-Canvas mit selbstgerechnetem 3D — grüner Phosphor-Look, alles Linien.
Boris' Kindheitstraum von 1981. Architektur-Details: siehe README.md.

## Goldene Regeln (von Boris gesetzt)
- **Immer fragen, wenn etwas unklar ist** — lieber kurz nachfragen als annehmen.
- **Alles testen, was headless testbar ist.** Rendering strikt von der Berechnung
  trennen: Mathe, Projektion, Maze, Geometrie, Spielzustand, Occlusion = reine
  Module ohne Canvas/DOM; nur `src/render/renderer.js` fasst das Canvas an. Vor
  "fertig" immer `npm test` laufen lassen.
- Inkrementell: einfach anfangen, dann komplexere Levels, durch Tests abgesichert.

## Konventionen
- ES-Module, kein Build-Tool beim Entwickeln. Code-Kommentare auf Deutsch
  (ASCII, Umlaute umschreiben: ae/oe/ue). Antworten an Boris auf Deutsch, duzen.
- Tests mit `node:test` (zero dependencies).
- Git-Commits enden mit dem Co-Authored-By-Trailer.

## Befehle
- `npm test` — alle Tests (so verifiziere ich; Stand: 129 grün).
- `node server.js` / `npm start` — Dev-Server auf Port 3001.
  **Boris startet den Server selbst** in einer eigenen Shell — NICHT für ihn starten.
- Debug-Overlay im Browser: `http://localhost:3001/?debug`.
- Boris sieht aktuell die Terminal-Ausgaben evtl. NICHT (Client-Hänger) — wichtige
  Ergebnisse im Antworttext zusammenfassen; visuell prüft er im Browser.

## Architektur-Kurzüberblick
- `src/math/` — vec3, camera (6-DOF + optionale freie Basis), projection
- `src/world/` — maze (Generator), mazeGeometry, mazeWorld, cubeFaces, shapes, visibility
- `src/render/` — renderer.js (EINZIGER Canvas-Teil), projection.js, occlusion.js
- `src/core/` — states.js (Zustands-Automat), game.js (Orchestrierung)
- `src/scenes/` — startscreen, mazegen, falling, playing, rising, map + mazeView.js
  (gemeinsamer Flächen-Renderer)

## Stand & wichtige technische Punkte
- **Der komplette Zyklus läuft**: Startscreen (Level-Auswahl per Pfeiltasten) →
  andocken → Labyrinth wächst → Reinfallen → Ego-Begehung (Tank-Steuerung,
  Hidden Lines) → Q/20s → Rückschwenk → Karte mit Weg → Q/5min → Startscreen.
- Levels 1–5 in `src/core/levels.js` (reine Daten): Maze-Größe n = 9/11/13/15/17;
  `game.level` hält die Auswahl, MazeGen liest daraus.
- Die Begehung spielt AUF der Andock-Würfelseite (nicht horizontal). Schlüssel:
  freie Kamera-Oben-Richtung (`camera.basis`), `faceLocalToWorld`, `scenes/mazeView.js`.
- Hidden Lines: `render/occlusion.js` (analytisch). Zwei Fallen beachten —
  Occlusion beim Schwenk per `occWeight` einblenden; Near-Plane mit `cell` skalieren.
- Nächste mögliche Themen: höhere Levels, echter "Trench Run", Politur.
