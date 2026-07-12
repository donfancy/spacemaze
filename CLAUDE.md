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
- `npm test` — alle Tests (so verifiziere ich; Stand: 271 grün).
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
- Levels 1–20 in `src/core/levels.js` (reine Daten): n = 9/11/13/15/17 (Blockwelt,
  Tank-Steuerung), 17/19/21/23/25 (Level 6–10: schmale Wände + Fahrt),
  27/29/31/33/35 (Level 11–15: Kampf — `straight` 0.6 = Geradeaus-Bias des
  Generators, `shoot`, `enemies {count, patrol}`) und 35/35/37/37/39
  (Level 16–20: Spinner — Größe eingefroren, dafür `straight` 0.7→0.8 für
  lange Gänge; 16 nur Spinner, ab 17 Mix mit Rauten, `spinners {count}`);
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
  Fläche geklippt. FALLE (10.7.2026 gefixt): `collisionInfo` braucht die Lage
  ZUM ZEITPUNKT der Blockade (x wird vor z bewegt — blockiert x, zieht z im
  selben Schritt weiter), und der Sichtlinien-Auftreffpunkt wird auf die
  Kontaktspanne (±radius) geklemmt — sonst greift die Zellsuche beim Streifen
  eines frei stehenden Pfeilers eine falsche/offene Zelle und die Wellen laufen
  „in die Luft" (die Extent-Suche brückte über offene Lücken; waves.js hat
  jetzt zusätzlich ein Sicherheitsnetz: offene Startzelle → keine Ausdehnung).
  Kamera-Gefühl in `scenes/playing.js` (Kurvenneigung `bank`
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
- KAMPF-LEVELS 11–15 (10.7.2026, umgesetzt): rote pulsierende Rauten-Feinde
  (`world/enemies.js`: ~Hälfte auf dem Lösungsweg mit Schutzzone um S/G, Rest
  zufällig; `patrol`-Anteil pendelt im Gang; Rauten als Segmente durch die
  normale Hidden-Line-Pipeline via `renderFaceOverlay` mit `color`, verdeckt
  0.25 statt 0.1 — man ahnt sie hinterm Eck). Berührung = Crash: Explosion
  (`world/burst.js`, deterministische Splitter), `crashPatch`, nach 1.3 s
  schneller Rückschwenk (0.8 s) zur Karte mit GAME OVER (pulsiert in der
  FARBE rot↔weiß bei voller Deckkraft — Helligkeits-Pulsieren wirkte über
  den Linien „durchgestrichen", sagt Boris); S/G-Marker skalieren mit der
  projizierten Gangbreite (`drawFaceMarker`, sonst passen sie bei n=35
  nicht ins Raster);
  Q dort = Retry (gleiche Maze, `game.resume` bleibt false → frischer Fall zum
  Start, Feinde neu). SHOOTING (`world/shots.js`): Space-Dauerfeuer, Tempest-
  Regel max 8 unterwegs, Projektile = weiße rotierende Sterne (Billboard),
  verpuffen an Wänden (Substeps gegen Tunneln durch 1-Einheit-Wände!),
  Zielrichtung `aimYaw = yaw + steer*deflect` — das Fadenkreuz nutzt die
  GERAMPTE Lenkgröße und schlägt dadurch weich weiter aus als die Flugbahn.
  Feinde leben auf `game.enemies`/`game.spinners`: `game.spawnFoes(maze)`
  würfelt beide deterministisch aus maze.seed — MazeGen ruft es bei der
  Geburt der Karte (die START-KARTE zeigt die Feind-Kreuze nach dem
  Wachsen, `FOE_TIME`-Einblendung), Falling bei jedem frischen Anlauf
  (Retry nach Game Over), Playing nur als Fallback für Direkteinstieg;
  Resume behält Abschüsse. Space braucht preventDefault
  (main.js). Feind-Farbe #ff3b30, Schüsse weiß. Auf Karte, Start-Karte
  und in BEIDEN Schwenks erscheinen lebende Rauten als kleine rote Kreuze
  und Spinner als grüne (`drawEnemyMarkers` in mazeView — dank spawnFoes
  sind sie auch beim frischen Reinfallen schon die aktuellen).
  Startscreen-Sounds:
  Level-Wahl tickt (Tonhöhe steigt mit dem Level, an den Rändern still,
  `tickPatch`), An-/Abdock-Flug hat einen sehr dezenten Schwebe-Whoosh
  (`dockPatch`, deutlich leiser als fall/rise, Gleitton rauf/runter).
- FARB-THEMA pro Level (12.7.2026): `render/colors.js` (reine Palette + `mixColors`,
  headless testbar) hält `PHOSPHOR_GREEN` (#4dff7a) und `TEMPEST_BLUE` (#4d7aff);
  Level 6–10 haben `color: TEMPEST_BLUE` in levels.js (`levelColor(level)` mit
  Grün-Fallback). `game.render()` setzt `renderer.color` zentral pro Frame —
  alle Szenen, Marker und Beschriftungen erben die Farbe automatisch; explizite
  Farben (Feind-Rot, Schuss-/Blitz-Weiß, GAME-OVER-Puls) bleiben unberührt.
  Startscreen bleibt grün; beim Andocken blendet der Würfel per `mixColors`
  von Grün zur Level-Farbe (MazeGen übernimmt nahtlos), beim Abdocken
  symmetrisch zurück. Level 11–15 bleiben grün; 16–20 wieder blau.
- SPINNER-LEVELS 16–20 (12.7.2026, umgesetzt): `world/spinners.js` (pur).
  GRÜNE oktagonale Spiralen (auf blauem Level-Thema) an den End-Wänden
  langer gerader Gangstücke (`straightRuns`, min. 3 Kammern; Weg-Gänge
  bevorzugt, Schutzzone um S/G wie bei den Rauten, 1 pro Gang). Sie drehen
  sich (Oktagon-Raster, Ecken springen) und "erzeugen" dabei einen Spike
  entlang der Gangmitte (Mittellinie + Bohrer-Wendel, Höhe 0.35 Zellen —
  unter der Augenhöhe 0.5, damit er frontal sichtbar bleibt). Der Spike ist
  eine EINBAHN-SPERRE (12.7.2026 entschärft — Boris' Ecken-Todesfalle:
  hinter der Spitze in den Gang eingebogen und in Spike-Richtung gezwungen,
  war der rundum tödliche Spike unentrinnbar): tödlich ist NUR das Kreuzen
  der SPITZE von vorn (über die ganze Gangbreite `blockRadius` 0.5, kein
  seitliches Vorbeimogeln; auch die vorrückende Spitze spießt auf —
  Kreuzungs-Check via `prev`-Spielerlage + `prevTip` aus spinnersStep, das
  Kürzen passiert NACH dem Spieler-Check und die zurückspringende Spitze
  tötet nie). Schaft und Überfahren von hinten sind harmlos. Frontal hilft
  nur Dauerfeuer: jeder Treffer kürzt um `shorten` (0.35 Zellen),
  `clinkPatch` tickt dazu. Ausrichtung: auf Weg-Gängen sitzt der Spinner
  VORAUS in Laufrichtung (Pflicht-Begegnung immer frontal), bei bloßer
  Weg-Querung fern der Kreuzung, abseits per rng.
  Zyklus: Spike wächst beim Drehen (grow 0.3), ab `spikeRetreat` (2.0)
  zieht sich der Spinner zur Wand zurück (dort geschützt, Schüsse prallen
  ab = 'shield'), unter `spikeAdvance` (0.7) läuft er wieder vor — NUR beim
  Vorlaufen ist er abschießbar ('spinner', grüne Explosion). Spike-Deckel
  `cap` pro Gang (nie den ganzen Gang; `capMargin` 1.0 lässt am Einstieg
  Luft). DURCHKOMMENS-GARANTIE als Test (spinners.test.js): Simulation mit
  echten Konstanten — Kürz-Rate (SHOTS.rate 5/s × 0.35) minus grow ≈ 1.45
  Zellen/s gegen cruise 1.5; wer feuert, kommt durch, wer nicht, wird
  aufgespießt (Gegentest). shots.js hat dafür generisches `opts.hitTest`
  im Substep (Ereignis → Schuss stirbt). Auf Karte/Schwenks: grüne Kreuze
  (`spinnerMarkers` + Farb-Param an `drawEnemyMarkers`). `game.spinners`
  mit denselben Resume/Retry-Regeln wie `game.enemies`; `startCrash` ist
  jetzt generisch (at, {kill, color, height}). Quer-Kreuzungen über dem
  Schaft sind seit der Einbahn-Entschärfung passierbar — gefährlich ist
  eine Kreuzung nur, wenn gerade die SPITZE dort ankommt.
- Nächste mögliche Themen: echter "Trench Run", Politur; Score/HUD.
  Aufgeschobene (Performance-)Ideen mit Messwerten: siehe IDEAS.md.
- Performance-Basics sind drin: kollineare Wandzüge werden zusammengefasst
  (`mergeCollinear` — Unter-/Oberkanten lang, Pfosten bleiben an jeder
  Zellgrenze, Verdecker ~3x weniger; Occlusion-Pass skaliert mit
  Kanten × Verdecker); Ziel-Strahlen werden pro Flacker-Stufe in EINEM
  Stroke gezeichnet (shadowBlur ist der teuerste Canvas-Pfad).
