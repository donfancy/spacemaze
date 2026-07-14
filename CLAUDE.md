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
- `npm test` — alle Tests (so verifiziere ich; Stand: 310 grün).
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
- Levels 1–25 in `src/core/levels.js` (reine Daten): n = 9/11/13/15/17 (Blockwelt,
  Tank-Steuerung), 17/19/21/23/25 (Level 6–10: schmale Wände + Fahrt),
  27/29/31/33/35 (Level 11–15: Kampf — `straight` 0.6 = Geradeaus-Bias des
  Generators, `shoot`, `enemies {count, patrol}`), 35/35/37/37/39
  (Level 16–20: Spinner — Größe eingefroren, dafür `straight` 0.7→0.8 für
  lange Gänge; 16 nur Spinner, ab 17 Mix mit Rauten, `spinners {count}`)
  und 41/43/43/45/45 (Level 21–25: wieder wachsend, `straight` 0.8 — Flipper,
  feuernde gelbe Spinner, s.u.);
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
  auch der Feder-Impuls abgeklungen ist), dann Abheben. Am ZIEL steht der
  Wagen sofort (vel/push hart 0), aber `driveStep` läuft weiter: die Lenkung
  dreht den Blick — Umschauen wie in der Tank-Steuerung (12.7.2026). `world/waves.js`: Kollisionswellen starten als weißes Blitz-Kreuz am
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
  0.175 statt 0.1 — man ahnt sie hinterm Eck; 12.7.2026 von 0.25 abgetönt). Berührung = Crash: Explosion
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
  symmetrisch zurück. Level 11–15 bleiben grün; 16–20 wieder blau; 21–25
  wieder grün. Feind-Farben in colors.js: ARCADE_YELLOW (Spinner ab 21),
  NEON_MAGENTA (Flipper).
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
  eine Kreuzung nur, wenn gerade die SPITZE dort ankommt. WÄNDE SCHÜTZEN
  (12.7.2026 gefixt): `spinnerPlayerHit`/`spinnerShotHit` ignorieren alles
  hinter der Spinner-Wand (t<0 in Gang-Koordinaten) — der zurückgezogene
  Körper sitzt AUF der Wandfläche und tötete sonst durch die 1 Einheit
  dünne End-Wand den Spieler, der im Nachbargang dagegen fuhr.
- CRASH-ZERBERSTEN (12.7.2026): beim Spieler-Crash zerbirst das GANZE Bild —
  `render/shatter.js` (pur) zerlegt alle projizierten Linien in Splitter
  (max. `chunk` px), die radial vom Einschlag wegfliegen und um die eigene
  Mitte taumeln; Zufall aus räumlichem Hash der QUANTISIERTEN Original-Lage
  (deterministisch, über Frames stabil → feste Flugbahnen, kein Flackern).
  Bildraum-Effekt wie der Sway (Kamera bleibt horizontal!): Renderer hat
  `pushShatter/popShatter` (wirkt in drawPolylines auf ALLES inkl. HUD/Text)
  und `flash(alpha, color)` für den weißen Einschlag-Blitz (CRASH_FLASH).
  playing rampt `amount` mit 1−(1−p)² hoch (Einschlag am Bildschirm via
  worldToScreen als Zentrum); rising startet nach Game Over voll zerscherbt
  und klingt mit (1−e)² ab — beim Raus-Wooshen sortiert sich das Bild,
  die Karte kommt sauber an.
- FLIPPER-LEVELS 21–25 (14.7.2026, umgesetzt): wieder GRÜN (kein `color`-Feld),
  Rauten heißen offiziell TANKER. Spinner dort GELB (`spinners.color` =
  ARCADE_YELLOW aus colors.js, `spinnerColor(level)` in levels.js — auch die
  Karten-Kreuze folgen ihr) und FEUERND (`spinners.shoot`): NUR IM DUELL —
  steht der Spieler im Gang des Spinners UND hat ihn vor sich (Blick-
  Halbebene; wer flieht, kriegt nichts in den Rücken) — löst sich mit
  `fireRate` 0.3/s ein sirrender Schuss von der Spike-Spitze, unabhängig
  von Vorlauf/Rückzug (14.7.2026 geändert: an den Vorlauf gekoppelt schossen
  alle nur am Level-Anfang, danach nie mehr, sagt Boris)
  (`spinnerFire`/`spinnerShotsStep`/... in spinners.js, `whirrPatch`), fliegt
  mit 2.2 Gangbreiten/s die Gangmitte entlang, tödlich über die GANZE
  Gangbreite (Kreuzungs-Check wie die Spike-Spitze, Wand schützt bei t<0) —
  NICHT ausweichbar, aber ABFANGBAR: eigene Schüsse zerstören ihn
  (`spinnerShotIntercept`, 'zap', ERSTER in der hitTest-Kette von playing).
  Gerendert als gezackter Stern quer zum Gang in FLIRRENDEN Farben
  (FIREWORK_COLORS, harte Wechsel mit 12 Hz). Durchkommens-Garantie-Test
  simuliert das Duell MIT feuerndem Spinner (Stress: 4-fache Feuerrate).
  FLIPPER (`world/flippers.js`, pur): magenta (NEON_MAGENTA) gestreckte
  X-Konturen (Boris' Skizze: 2 sich kreuzende Diagonalen mit gekerbten
  Spitzen) im GANG-QUERSCHNITT, lange Seite zwischen zwei Gangkanten (unten/
  rechts/oben/links, Drehung um die Gang-Längsachse, X-Mitte (0.5−lift) von
  der Gangmitte). Sie wandern den Gang entlang (0.85 Gangbreiten/s — schneller
  als Tanker-Patrouille 0.6, fliehbar bei cruise 1.5) und FLIPPEN um 90°:
  Seiten rasten LANGE ein (holdSide 2.2s ± 0.8), oben/unten nur kurz
  (holdShort 0.3s, klappt in derselben Drehrichtung durch; Flip-Zufall als
  LCG auf f.rnd, deterministisch). Ihre QUERSCHNITTS-EBENE ist in JEDER
  Stellung tödlich (Berühren/Kreuzen, prev+prevAlong beidseitig bewegt; quer
  nur der eigene Gang) — vorbei kommt nur, wer sie abschießt, und das geht
  NUR in Links-/Rechts-Stellung (X kreuzt dort die Augen-/Schusshöhe nahe
  der Wand — mit dem Fadenkreuz-Lenkausschlag zur Seite zielen; hitTest via
  `flipperShotHit`). Platzierung wie Spinner (lange Gänge, Weg zuerst,
  S/G-Schutzzone), Spinner-Gänge bleiben frei (`avoid` in spawnFoes —
  Spinner werden ZUERST gewürfelt). PAAR-REGEL: Tanker-Abschuss aus ≥ 3
  Feldern (`pairFields` × (wall+corridor)×unit) spawnt `spawnFlipperPair` an
  dessen Stelle: einer links, einer rechts, versetzt (pairGap), beide rücken
  auf den Spieler zu, danach normale Flipper. `game.flippers` mit denselben
  Resume/Retry-Regeln; Karten-/Schwenk-Kreuze magenta. Level 21 führt
  Flipper solo ein (+ Tanker als Paar-Quelle), ab 22 Spinner-Mix, bis 25
  steigt das Trio.
- STERNENHIMMEL (14.7.2026): ab Level 4 (1–3 sind "legacy 1974", sagt Boris)
  funkeln in der Ego-Ansicht 250 weltfeste Sterne in der Level-Farbe am
  Himmel — beim Drehen zieht der Himmel vorbei, Drehungen werden spürbar.
  `world/stars.js` (pur): `createStars` deterministisch aus maze.seed
  (Flächen-Gleichverteilung auf der Halbkugel, el = asin(u));
  `skylineElevation` — sichtbar ist ein Stern nur OBERHALB der Wand-
  Silhouette seiner Richtung, sonst schiene er durch die Wände. FALLE
  (14.7.2026 gefixt): die Silhouette MUSS als exakter Grid-DDA laufen
  (Zellkante zu Zellkante über die Metrik, Reichweite 6 Gangbreiten) — ein
  abtastender Raycast (0.5er-Schritte) traf die Wandfläche systematisch zu
  spät und übersprang schräg gestreifte 1-Einheit-Wände: 95 % der
  Silhouetten zu niedrig, Sterne schienen durch die Wand (Boris sah es
  sofort). Der DDA ist exakt (Test: 0/20000 zu niedrig) und mit 0.03 ms
  pro 250-Sterne-Frame sogar billiger. Gezeichnet in playing.js als
  Bildschirm-Kreuzchen (worldToScreen eines Punkts 60 Gangbreiten weit —
  quasi unendlich, kein Parallax-Zittern), nach Funkel-Stufe gebatcht
  (`starTwinkle`, ein Stroke pro Stufe), INNERHALB des Sway (Kurvenneigung
  kippt den Himmel mit — Kamera bleibt horizontal!).
- ZIEL-FEUERWERK (12.7.2026): am Ziel spriessen zusätzlich zum weißen
  Aufblitzen ~70 senkrechte Strahlen (`world/fireworks.js`, pur) gestaffelt
  in einer Scheibe (2.2 Zellen) um die Zielmitte; jeder schaltet von
  unsichtbar HART (Arcade-Palette, kein Blenden) durch Rot→Gelb→Grün→Blau→
  Magenta→Cyan nach Weiß und verlischt. Höhen endlich (max 8 Zellen — die
  Spitzen funkeln sichtbar), deterministisch aus maze.seed, OHNE Verdeckung,
  gebatcht pro Farbe×Helligkeits-Stufe (shadowBlur-Regel wie Ziel-Strahlen).
- Nächste mögliche Themen: echter "Trench Run", Politur; Score/HUD.
  Aufgeschobene (Performance-)Ideen mit Messwerten: siehe IDEAS.md.
- Performance-Basics sind drin: kollineare Wandzüge werden zusammengefasst
  (`mergeCollinear` — Unter-/Oberkanten lang, Pfosten bleiben an jeder
  Zellgrenze, Verdecker ~3x weniger; Occlusion-Pass skaliert mit
  Kanten × Verdecker); Ziel-Strahlen werden pro Flacker-Stufe in EINEM
  Stroke gezeichnet (shadowBlur ist der teuerste Canvas-Pfad).
