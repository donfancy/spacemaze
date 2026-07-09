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
- `npm test` — alle Tests (so verifiziere ich; Stand: 223 grün).
- `node server.js` / `npm start` — Dev-Server auf Port 3001.
  **Boris startet den Server selbst** in einer eigenen Shell — NICHT für ihn starten.
- Debug-Overlay im Browser: `http://localhost:3001/?debug`.
- Boris sieht aktuell die Terminal-Ausgaben evtl. NICHT (Client-Hänger) — wichtige
  Ergebnisse im Antworttext zusammenfassen; visuell prüft er im Browser.

## Architektur-Kurzüberblick
- `src/math/` — vec3, camera (6-DOF + optionale freie Basis), projection
- `src/world/` — maze (Generator), mazeGeometry, metric (Achsen-Metrik), mazeWorld,
  drive (Fahr-Dynamik), walk (Geh-Kinetik mit Rampen), waves (Kollisionswellen),
  goal (Ziel-Zone + Leuchtfeuer), cubeFaces, shapes, visibility
- `src/render/` — renderer.js (EINZIGER Canvas-Teil), projection.js, occlusion.js
- `src/sound/` — patches.js (Klaenge als reine Daten, testbar), audio.js
  (EINZIGER Web-Audio-Teil, analog renderer.js)
- `src/core/` — states.js (Zustands-Automat), game.js (Orchestrierung)
- `src/scenes/` — startscreen, mazegen, falling, playing, rising, map + mazeView.js
  (gemeinsamer Flächen-Renderer)

## Stand & wichtige technische Punkte
- **Der komplette Zyklus läuft**: Startscreen (Level-Auswahl per Pfeiltasten) →
  andocken → Labyrinth wächst → Reinfallen → Ego-Begehung (Tank-Steuerung,
  Hidden Lines) → Q/20s → Rückschwenk → Karte mit Weg. Auf der Karte: solange
  das Ziel offen ist, fällt Q zurück an die Spielerlage (Weg bleibt, `RESUME`/
  `game.resume`); X (oder 5 min) → Karte blendet aus (Rahmen bleibt), dann
  Abdock-Flug zurück in den Orbit (`game.undock`, Startscreen-Phase `undocking`,
  `orbitTimeFacing`) — symmetrisch zum Andocken.
- Levels 1–10 in `src/core/levels.js` (reine Daten): n = 9/11/13/15/17 (Blockwelt,
  Tank-Steuerung) und 17/19/21/23/25 (Level 6–10: schmale Wände + Fahrt);
  `game.level` hält die Auswahl, MazeGen liest daraus. Ab Level 6 SCHMALE WÄNDE:
  gleiche Maze-Topologie, aber `world/metric.js` streckt die Achsen ungleich
  (gerade Zellen = Wände 1 Einheit, ungerade = Gänge 5). Grid↔Welt geht überall
  durch die Metrik (`toUnits`/`toGrid`); Gameplay-Maßstab ist die GANG-Breite
  (`cellSize`), Geometrie-Maßstab die Einheit (`unitSize`).
- Level 6–10 (`drive: true`) haben außerdem FAHRT-Modus: `world/drive.js` (Auto-
  Vortrieb, nur ←/→ lenken, cooldown gegen Doppel-Trigger). Aufprall = seitlicher
  FEDER-IMPULS (`state.push`, Weltraum, klingt mit `pushDecay` linear auf 0 ab):
  drückt senkrecht von der Wand weg, Vorwärtstempo und Blickrichtung bleiben —
  man driftet zurück und schlägt weiter vorne erneut ein. Das Netto-Tempo weg
  von der Wand direkt nach dem Treffer ist ein FESTER Anteil der
  Reisegeschwindigkeit (`bounce` — NICHT proportional zur Wucht, sonst
  „zittert" man an der Wand). Alle Übergänge als RAMPEN (linear ratenbegrenzt,
  `rampToward`): Lenkrate fährt von 0 hoch (`steerRamp`), Tempo mit konstanter
  Beschleunigung (`accel` — gilt auch fürs Losfahren nach dem Reinfallen), Q
  bremst erst (`brake` + kurzer Halt `BRAKE_HOLD`, abgehoben wird erst, wenn
  auch der Feder-Impuls abgeklungen ist), dann Abheben. `world/waves.js`: Kollisionswellen starten als weißes Blitz-Kreuz am
  Sichtlinien-Auftreffpunkt, Arme wachsen mit, an die zusammenhängende Kontur-
  Fläche geklippt. Kamera-Gefühl in `scenes/playing.js` (Kurvenneigung `bank`
  + `math/oscillator.js` für mechanisches Nachschwingen — als Bildraum-Sway
  gerendert, NICHT in der Kamerabasis, siehe Hidden-Lines-Falle 4).
- SOUND (alles synthetisch, Web Audio, keine Samples): `sound/patches.js` baut
  Klaenge als reine Daten (Bump Level 1–5, elektrisches Brutzeln ab Level 6,
  Drei-Ton-Fanfare am Ziel, fall/rise-Whoosh mit Gleitton — Dauer = Schwenk-
  Dauer, in enter() gespielt —, gnaw-"Nagen" synchron zum Maze-Wachstum,
  Motor-Parameter als `engineParams`), `sound/audio.js`
  ist der EINZIGE AudioContext-Teil (Autoplay-Falle: unlock() bei jedem
  Tastendruck; drei stehende Motor-Stimmen, per setTargetAtTime zipperfrei
  nachgefuehrt; M = Mute in main.js). Szenen rufen `game.audio?.play/engine`
  (null in Tests). `playing.exit()` blendet den Motor aus (engine(null)).
- Tank-Steuerung (Level 1–5) laeuft ueber `world/walk.js`: gleiche Rampen-Idee
  wie drive.js (accel/brake/steerRamp via rampToward), Kollisions-Meldung als
  FLANKE (ein Bump beim Auftreffen, kein Dauerfeuer beim Anliegen; `contact`
  pro Achse). `vel` ist das ANGESTREBTE Tempo — Waende blockieren nur die
  Bewegung (klassisches Gleiten, sonst kollabiert es); fuers Fahrgeraeusch
  liefert walkStep das ERREICHTE Tempo (`speed`).
- Die Begehung spielt AUF der Andock-Würfelseite (nicht horizontal). Schlüssel:
  freie Kamera-Oben-Richtung (`camera.basis`), `faceLocalToWorld`, `scenes/mazeView.js`.
- Hidden Lines: `render/occlusion.js` (analytisch). VIER Fallen beachten —
  Occlusion beim Schwenk per `occWeight` einblenden; Near-Plane mit `cell`
  skalieren — auch bei `renderer.renderScene` (Effekte nah am Auge wie die
  Kollisionswellen brauchen den `near`-Override, sonst clippt der feste
  Standardwert alles weg);
  Kollisionsradius (0.25 Gangbreiten) muss über der Near-Plane (0.1) bleiben, sonst
  verlieren nahe Wände ihre Verdeckung (Kollision prüft dafür das GANZE
  Spieler-Quadrat via `rectWalkable` — bei schmalen Wänden reichen Eck-Checks
  nicht, ein 1-Einheit-Pfosten passt zwischen zwei Ecken); und die 3D-Kamera
  muss HORIZONTAL bleiben — Roll/Nicken (Kurvenneigung, Schwingungen) NIE in die
  Kamerabasis, sondern als Bildraum-Transform (`render/sway.js`,
  `renderer.pushSway/popSway`), sonst bricht die azimutale Annahme.
- Schwenks (Reinfallen/Rückschwenk) interpolieren die Orientierung per
  Quaternion-Slerp (`math/quat.js`, `blendPose` in `mazeView.js`) — getrenntes
  forward/up-Lerp kippt um, wenn beide antiparallel werden (Ego-Blick „Süd“).
- Nächste mögliche Themen (Boris, 9.7.2026): was die höheren Levels bringen —
  „ein paar Farben" und SHOOTING; dazu weiter: echter "Trench Run", Politur.
  Aufgeschobene (Performance-)Ideen mit Messwerten: siehe IDEAS.md.
- Performance-Basics sind drin: kollineare Wandzüge werden zusammengefasst
  (`mergeCollinear` — Unter-/Oberkanten lang, Pfosten bleiben an jeder
  Zellgrenze, Verdecker ~3x weniger; Occlusion-Pass skaliert mit
  Kanten × Verdecker); Ziel-Strahlen werden pro Flacker-Stufe in EINEM
  Stroke gezeichnet (shadowBlur ist der teuerste Canvas-Pfad).
