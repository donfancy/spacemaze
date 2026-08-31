# MAZESTORM — Projekt-Instruktionen

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
- SMOOTH-PASS An-/Abdocken (31.8.2026, Boris' "unstetig in der 1.
  Ableitung"-Jagd): (1) BEIDE Startscreen-Fluege sind C1 -- die Orbit-Uhr
  t laeuft im Flug WEITER und dockPose blendet gegen die BEWEGTE
  Orbit-Pose (Andocken: bewegter Start, Abdocken: bewegtes Ziel; die
  Abdock-Uhr startet UNDOCK_DURATION vor dem zugewandten Bahnpunkt).
  (2) dockPose-Ease = QUINTIC-Smootherstep (C2): der alte Cosinus
  bremste bis zum letzten Frame maximal und kam "hart" an. Beides
  getestet per Finite-Differenzen (test/dockFlight.test.js). (3) 2026:
  Nebel-Himmel blendet im Flug aus/ein (start.scene.backgroundIntensity
  = (1-p)^2 bzw. p^2 -- am Schnitt zur Draufsicht steht ringsum eh nur
  Schwarz+Sterne, horizonFade), Glanzlicht wischt in der AUSLAUFENDEN
  Andock-/anlaufenden Abdock-Bewegung ueber die WUERFELflaeche
  (sweepDockSheen in backend.js, faceLocalToWorld-Projektion der alten
  Platten-Diagonale; das Welt-sheenLight ist entfernt). PERLEN-FALLE
  dabei: der Licht-Pfad MUSS im Flaechen-Fussabdruck geklemmt bleiben
  (schwebt das Punktlicht daneben, beleuchtet es die fast kantengleiche
  NACHBARflaeche -- ihr duenner heller Streifen bloomt zu gruenen
  Perlenketten), plus Orts-Huellkurve sin(pi c) gegen den Kanten-Balken
  nahe der Ecke (HDR-Kante ueber hell angestrahlter Flaeche). STERNE:
  die 2026-Draufsichten sind STERNENLOS (Boris' Entscheid) -- die
  Sternfelder von Startscreen (Seed 1980, volle Kugel, Wuerfel-System)
  und Welt (maze.seed, Halbkugel, Maze-System) sind nie deckungsgleich,
  am Szenenschnitt spraengen die Sterne als Hard-Cut; stattdessen
  blenden sie NUR in den Bewegungen (Startscreen-Fluege: skyA linear,
  Nebel skyA^2; Schwenks/Replay-Blenden: mit der Ego-Naehe e --
  twinkleMats/animateWorld tragen dafuer einen starDim). DREI Quellen
  muessen dem starDim folgen, sonst bleibt ein Rest-Teppich:
  world.starGroups, scene.backgroundIntensity (gebackener Skybox-Staub)
  UND world.mirrorStarMats -- die SPIEGEL-Sterne haengen bei
  y=-600*sin(el) UNTER der Welt, die Draufsicht schaut rings um die
  Platte direkt auf sie (das war der hartnaeckige "Sternen-Cut",
  Sichtpruefungs-Befund). Und die
  Wuerfel-Kanten liegen GEOMETRISCH auf den Flaechen (polygonOffset 2/2
  wie die Platine statt edges.scale 1.01 -- der 1%-Spalt zwischen
  Randlinie und Flaeche am Andock-Ende ist weg, die Platten-Kontur
  liegt praezise an).
- TASTEN-STRINGENZ (30.8.2026, Boris): S = IMMER Starten/Weiterspielen
  (Startscreen, Demo, Karte: Resume/Retry), X = IMMER Exit/eine Ebene raus
  (Begehung → Karte, Karte → Orbit, Replay → Karte), R = Replay (nur Karte),
  I = Info-Seite "HOW TO PLAY" (Startscreen; X schliesst auch sie).
  Q und die WASD-Aliase sind KOMPLETT entfernt.
- INFO-SEITE (30.8.2026): Inhalt als reine Daten `INFO_TITLE`/`INFO_LINES`
  in core/hud.js (EINE Quelle beider Engines); Startscreen zeichnet sie im
  Orbit ueber dem gedimmten Wuerfel (1980) bzw. als DOM-Panel (2026,
  `infoEl` in backend.js), "PRESS S" blinkt weiter, "I INFO" als dezenter
  Hinweis unten. Manuell geoeffnet haelt sie die Attract-Uhr an; der
  Attract-Mode zeigt sie automatisch in der Orbit-Pause zwischen den Demos
  (viewState().info, in der Demo geschluckte Tasten unveraendert).
- TITEL-DISPLAY "MAZESTORM" (30.8.2026, Tempest-Hommage): `world/title.js`
  (pur, testbar): Phasen-Uhr TITLE {assemble 3s, hold 3.4s, finale 1.6s},
  5x7-Voxel-Schrift `titleCells` (seit 31.8.2026 EIN Wort MAZESTORM --
  Umbenennung wegen Namenskollision, die halbe Wort-Luecke ist Geschichte;
  PARALLAXE-TRICK: das M ist 7 statt 5 Spalten breit mit Luft zwischen den
  Strichen ("Durchschuss") -- die aeusseren Buchstaben stehen in der
  kamera-verankerten 2026-Schrift-Ebene schraeg im Blick und stauchen sich,
  das 5er-M war dort nicht mehr als M lesbar (Boris' Befund); der
  Letter-Vorschub folgt der Glyphen-Breite),
  Farb-Zyklus ueber FIREWORK_COLORS, Finale weiss. Laeuft STUMM beim
  allerersten Laden (bootPlayed) und in jeder Attract-Pause: RUHIGE
  Nur-Wuerfel-Zeit (ORBIT_CALM 7s, nur zwischen den Demos -- die erste
  Sequenz nach DEMO_IDLE beginnt direkt mit dem Titel, die Ruhe war die
  Idle-Zeit) -> TITEL (8s) -> HOW TO PLAY (ATTRACT_INFO 6s) -> Demo
  (attractWait ueberbrueckt die erste Runde vor game.beginDemo; jede
  Taste raeumt Titel + Wartesequenz weg). 1980: Zoom aus der Tiefe (titleZoom) +
  2 Echo-Konturen in Nachbarfarben (titleColor(t, ring)), Wuerfel dimmt
  (drawCube-dim), Blitz via renderer.flash. 2026: InstancedMesh-Voxel
  fliegen von der Wuerfel-Oberflaeche (voxelOrigin) in eine
  KAMERA-VERANKERTE Schrift-Ebene (TITLE_DIST 2.0 -- MUSS am inneren
  Orbit-Radius vor dem Wuerfel liegen, Winkelgroesse ist distanz-invariant
  weil die Voxel-Groesse aus dem Sichtfeld kommt), zerbersten im Finale
  (voxelBurst) + DOM-Blitz; Wuerfel-Kanten dimmen auf 0.3. Voxel-LOOK
  (Boris' Tuning 30.8.): Flaechen tragen den Farbzyklus LUMINANZ-NORMIERT
  unter der Bloom-Schwelle (TITLE_BODY_LUM 0.4 -- roher HDR-Zyklus liess
  den Schriftzug "pumpen"), dazu WEISSE Glut-Kanten (dyn. LineSegments,
  12 Kanten/Voxel, 0.42 > 0.41 gegen Z-Fighting); NUR das Finale geht
  als weisser Overflow in den Bloom. Jeder Voxel poppt erst beim EIGENEN
  Abheben auf (voxelSize 0 bis zum Start -- sonst steht der Schriftzug
  vorab als Mini-Voxel-Teppich auf der Wuerfel-Oberflaeche). Sichtpruefung:
  Scratchpad-Skript cdp-title.mjs (CDP-Muster, Viewport-FALLE:
  Emulation.setDeviceMetricsOverride erst NACH der ersten Navigation).
- ES-Module, kein Build-Tool beim Entwickeln. Code-Kommentare auf Deutsch
  (ASCII, Umlaute umschreiben: ae/oe/ue). Antworten an Boris auf Deutsch, duzen.
- Tests mit `node:test` (zero dependencies).
- Git-Commits enden mit dem Co-Authored-By-Trailer.

## Befehle
- `npm test` — alle Tests (so verifiziere ich; Stand: 448 grün).
- `npm run build` — Deployment-Build nach `dist/` (tools/build.mjs, pure
  Kopie: index.html an die Wurzel + favicon.ico + public/ + src/, ohne
  proto2026; Inhalt 1:1 in den WEBROOT von mazestorm.io/.de — wegen der
  absoluten /public//src-Pfade zwingend Domain-Wurzel, s. README).
- `node server.js` / `npm start` — Dev-Server auf Port 3001.
  **Boris startet den Server selbst** in einer eigenen Shell — NICHT für ihn starten.
- Debug-Overlay im Browser: `http://localhost:3001/?debug`.
- 2026-Engine (PLAN2026.md): `http://localhost:3001/?engine=2026` (Stand:
  Stufe 5 — ALLE Levels 1–30 komplett in 2026: voller Zyklus, Startscreen
  in Prototyp-Optik samt **Live-Schalter „1980 / 2026“** (←/→ Level, ↑/↓
  Engine; Wahl in localStorage, URL-Param hat Vorrang, main.js
  `applyEngine` blendet live um), Quaternion-Schwenks (`setWallHeight`,
  fov 75↔70), Karte mit Weg/Markern/Feind-Kreuzen (Karten-Glow
  LUMINANZ-normiert, `setLineGlow`); Tanker als rotierende Okta-Rauten
  mit Boden-Spiegelung, Spinner/Flipper/Pulsare als HDR-Linien DIREKT aus
  den puren Segment-Funktionen, Gyro-Roll als ECHTER Kamera-Roll (steckt
  in viewState().roll, Dauerzustand ok), Schuesse bunt-rotierend +
  Spinner-Schuesse flirrend, Splitter + Truemmer (`burstShards`), Crash =
  Splitter/Truemmer + Kamera-Shake + Licht-Puls + DOM-Blitz, Feuerwerk,
  bunte Sterne ab 26; `viewState()`-Naht in ALLEN Szenen; Naht =
  `game.renderBackend`). NEAR_STAR-FALLE: Schuss-Sterne an der Kamera
  malen sonst Riesen-Strahlen (1980 clippte das weg) — Radius waechst mit
  der Kamera-Distanz auf. CDP-FALLE: unter `--headless=new` steht rAF ohne
  erzwungene Frames still — Sichtpruefungs-Skripte pumpen Frames per
  Wegwerf-Screenshot und pollen `window.mazestorm`; ZEITRAFFER dabei
  beachten: ~5 rAF a 0.1s pro Pump = 0.5s Spielzeit, kurze Effekte sofort
  fotografieren (Details PLAN2026.md, Stufe-3/4/5-Notizen).
- Boris sieht aktuell die Terminal-Ausgaben evtl. NICHT (Client-Hänger) — wichtige
  Ergebnisse im Antworttext zusammenfassen; visuell prüft er im Browser.

## Architektur-Kurzüberblick
- `src/math/` — vec3, camera (yaw/pitch + optionale freie Basis; BEWUSST ohne
  roll — Hidden-Lines-Regel 4, Roll läuft nur als Bildraum-Sway), projection
- `src/world/` — maze (Generator), mazeGeometry, metric (Achsen-Metrik), mazeWorld,
  drive (Fahr-Dynamik), walk (Geh-Kinetik mit Rampen), waves (Kollisionswellen),
  goal (Ziel-Zone + Leuchtfeuer), cubeFaces, shapes, visibility, enemies/spinners/
  flippers/pulsars (Feinde), foePlacement (GEMEINSAME Feind-Platzierung:
  corridorCandidates/straightRuns/openSpan + Querschnitts-Kinematik der
  Flipper/Pulsare), gyro (Blickachsen-Rotation ab 26), shots, stars
- `src/render/` — renderer.js (EINZIGER Canvas-Teil), projection.js, occlusion.js
- `src/sound/` — patches.js (Klaenge als reine Daten, testbar), audio.js
  (EINZIGER Web-Audio-Teil, analog renderer.js)
- `src/core/` — states.js (Zustands-Automat), game.js (Orchestrierung; dispatch
  ist IMMER nahtlos — der frühe Fade-über-Schwarz ist entfernt), hud.js
  (geteilte HUD-Texte/-Farben BEIDER Engines, 1980-Wording ist die Referenz)
- `src/scenes/` — startscreen, mazegen, falling, playing, rising, map + mazeView.js
  (gemeinsamer Flächen-Renderer)

## Stand & wichtige technische Punkte
- **Gesamt-Review 28.8.2026 (REVIEW.md) umgesetzt:** Flipper-Wand-Bug +
  Paar-Spawn gefixt, world/foePlacement.js + core/hud.js + makeBuffer
  (backend.js) gegen Dreifach-/Achtfach-Duplikate, toter Fade-Pfad raus,
  Schwenk-Wand-Cache (mergedOutline), backend.dispose() + Welt-Freigabe am
  Startscreen, tote Exporte entfernt, 369 Tests. Aufgeschobenes: IDEAS.md
  (Perf) und PLAN2026.md Stufe 6 (proto-Abschied, playing-Zerlegung).
- **Stufe 6 begonnen — SKYBOX (29.8.2026):** prozeduraler Nebel-Himmel in
  der 2026-Engine, ein Crescendo über die Levels (dezent in Level 1, voll im
  Arcade-Finale; auch Startscreen). `render2026/skyTheme.js` (pur: Rezept aus
  Level + Seed) + `render2026/skybox.js` (einmaliger Cubemap-Bake, FBM-Nebel +
  Galaxien-Band + Staub; unter der Bloom-Schwelle, Dither, horizonFade;
  ersetzt die Dunst-Sprites; skyRT-dispose in disposeWorld). Details/Fallen:
  PLAN2026.md Stufe 6.
- **Stufe 6 — PLATINE/FRÄSEN in der Kartensicht (29.8.2026):** die
  2026-Draufsichten zeigen KEIN Boden-Raster mehr („karriert", Boris),
  sondern die Würfelfläche als beleuchtete PLATTE (Material + Licht-Rezept
  des Startscreen-Würfels, `buildPlate`/`plateLights` in world3d.js), in
  die sich die Gänge als SCHWARZE Kanäle mit Leuchtkante fräsen (ein Quad
  pro maze.order-Zelle, setDrawRange synchron zum Wachstum). Schwenks =
  Crossfade Platte↔Raster (`setPlate` in backend.js), Karten-Exit heilt
  die Kanäle zu und die Platte wird zur Abdock-Würfelfläche — beide Cuts
  weg, Ego unverändert. FALLE: transparent-Toggle braucht
  material.needsUpdate (OPAQUE-Define). Harmonisierung des Szenenwechsels:
  Platten-Lichter = die per `worldToFaceLocal` (cubeFaces.js, pur) auf die
  Andock-Fläche PROJIZIERTEN Startscreen-Akzente (`ACCENT_LIGHTS`, ×kLocal²)
  — der Licht-Verlauf läuft am Schnitt weiter; Rahmen-Glow blendet
  (setLineGlow(markerFade) bzw. (fade)); GLANZLICHT wischt beim
  Ankommen/Abschied diagonal über die Platte (`sweepSheen`). Details:
  PLAN2026.md Stufe 6 (dort auch die offene Ego-Hälfte: Wände als
  gefrästes Volumen + Deckel).
- **Stufe 6 — MINI-MAP statt Kompass (29.8.2026):** die 2026-Ego-Ansicht
  hat rechts unten eine runde, MITDREHENDE Ausschnitts-Karte (heading up
  wie die 1980-Kompass-Rose: oben = Blickrichtung). `render2026/minimap.js`
  (pur, testbar): Wand-Kontur in Gangbreiten + `minimapModel` in Scheiben-
  Koordinaten (Einheitskreis, analytisch geclippt); Inhalt: Wände, Trail,
  Feind-Kreuze in den Karten-Farben, S/G, mitdrehende N-Marke, Ziel
  außerhalb = gelber Chevron-Pfeil am Rand (pulst wie das Leuchtfeuer).
  Renderseite: kamera-verankerte Gruppe IN der Welt-Szene (erbt die
  Bloom-Kette, screen-fest auch beim Gyro-Roll), Farben luminanz-normiert
  wie die große Karte; Crash blendet die Scheibe aus. FALLE: updateMinimap
  NACH dem Kamera-Setzen rufen (sonst hängt die Scheibe einen Frame nach),
  und die N/S/G-Sprites NICHT in world.markerMats (Ego blendet die per
  setMarkerFade(0) aus). Details: PLAN2026.md Stufe 6.
- **Stufe 6 — Kampf-Politur (29.8.2026):** Spiegel-FALLE gefixt: TRANSPARENTE
  Spiegel-Objekte (Schüsse/Feuerwerk/Splitter) sortierten gegen die
  halbtransparente Bodenplatte nach Objekt-POSITION (dynamische Puffer sitzen
  am Welt-Ursprung) — je nach Blickrichtung schrieb die Platte zuerst Tiefe
  und schluckte das Spiegelbild (Schüsse spiegelten nur in manchen
  Gangrichtungen); Fix: `renderOrder = -1` auf der Spiegel-Gruppe (wirkt als
  groupOrder, Spiegel zeichnet IMMER vor der Platte). Splitter + Trümmer
  spiegeln sich jetzt wie der Feind (mirrorMaterial, Glow im Spiegel auf
  MIRROR_LINE_DIM gedeckelt) und haben einen BLITZ-Verlauf (`burstGlow` pur
  in burst.js: erst über der Feind-Glut, dann dunkler verglimmen — statt
  konstant heller als der Feind). Tanker-Körper + Flipper-Füllung `fog:
  false`: der Nebel wusch die dunklen Flächen auf Wand-Hintergrund, von
  weitem blieben nur die HDR-Kanten (Drahtgitter-Look); Kanten behalten den
  Nebel als Tiefen-Hinweis.
- **REPLAY-MODUS + ATTRACT-MODE (30.8.2026, beide Engines):**
  `core/recorder.js` (pur): die Begehung zeichnet 30-Hz-Zustands-Snapshots
  (Spieler-Kanäle; Schüsse per `phase` interpoliert; Feind-Listen geklont)
  plus eine EVENT-Spur (bump/collision/reached/crash/gyro/burst/sound) auf —
  Pause und Vor-/RÜCKspulen sind reine Zeiger-Bewegung, kein Re-Simulieren
  (Ringpuffer ~10 min). Resume schreibt dieselbe Aufnahme nahtlos weiter
  (ganzer Lauf am Stück), frischer Anlauf/Retry beginnt neu. R auf der
  Karte → State REPLAY: Space Pause, ←/→ Tempo-Leiter ±1/2/4/8x, X
  zurück; Sounds/Motor nur bei 1x vorwärts (aus der Event-Spur). Die
  1980-Wiedergabe nutzt EXAKT den Welt-Zeichner der Live-Begehung:
  `scenes/egoWorld.js` (aus playing.render gehoben — Beginn der
  playing-Zerlegung; buildEgoStatics/renderEgoWorld/collisionWaveSet).
  2026 (`drawReplay` in backend.js): C schaltet ego/chase/bird/total/orbit —
  Außen-Kameras sind reine Funktionen der interpolierten Pose (spulen
  deterministisch mit), der Spieler fliegt als TEMPEST-GLEITER
  (`world/glider.js` pur: Dart mit Heck-Kerbe/Kiel/Flosse, dunkler Körper
  unter Glut-Kanten, bank-Neigung; verschwindet im Crash-Moment). FALLEN:
  hohe Kameras überglühen (Karten-Glow-Regel) → `RCAM_GLOW` blendet
  setLineGlow Richtung Diagramm-Normierung; Tanker-Meshes hängen an der
  IDENTITÄT der enemies-Liste → Replay führt STABILE Puppen
  (`syncPuppets`) und eine stabile gameLike-Fassade. Alle Übergänge
  SMOOTH: Rein-/Rausschwenk (1.2 s/1.0 s, Falling/Rising-Rezeptur, EINE
  umkehrbare Uhr) + 0.8-s-Kamera-Blenden (`computeReplayCamera` liefert
  Posen pur, die Blende lerpt/slerpt inkl. fov/Nebel/Glow; Gleiter
  blendet per Kamera-ABSTAND aus). QUATERNION-ALIASING-FALLE:
  `q.slerpQuaternions(a, b, t)` mit q === b zerstört das Ziel (Three.js
  kopiert erst a nach this) — der Slerp steht still und springt am
  Blenden-Ende (Blickrichtungs-Cut, nur die Position flog weich, denn
  lerpVectors liest vor dem Schreiben); Fix: a in place slerpen, dann
  kopieren. `backend.debugCamera()` = Debug-Haken für Kamera-
  Stetigkeitsmessungen per CDP.
  ATTRACT-MODE: 30 s Idle im Orbit → Autopilot-Demo (`world/autopilot.js`
  pur: pure-pursuit auf findPath, tippt game.keys — die Demo läuft durch
  die UNVERÄNDERTE Spiel-Logik; `keyForTurn`/`keyForRole` = Inverse des
  gyroTurn-/gyroDirs-Mappings; PROFI-FAHRSTIL 30.8.2026: im Fahrt-Modus
  lenkt der Autopilot nur echte Kurven selbst (driveSteer 0.35 rad),
  sonst hält der Ausricht-Assistent (logisch ↓) die Spur — kein
  Schlingerkurs; gefeuert wird NUR bei Feind in Sicht (`foeInSight`:
  fireDist 7 Gangbreiten + Blickkegel 0.5 rad; playing.js reicht Tanker,
  Spinner-SPITZEN + sirrende Schüsse als `mode.foes` — Pulsare
  NICHT: unzerstörbar, ihre Rotation ist Teil der Show; SICHTLINIE
  Pflicht, 31.8.2026 — Boris' Befund „schießt auf Feinde hinter der
  Wand", das waren ~49 % aller Feuer-Frames: playing filtert foes UND
  flippers per `hasLineOfSight` (mazeWorld.js, exakter Grid-DDA über
  die Metrik wie skylineElevation — die Sternen-FALLE gilt: ein
  abtastender Raycast überspränge schräge 1-Einheit-Wände; der
  Autopilot selbst kennt kein Maze, die Naht liefert nur Sichtbares);
  auf freier
  Geraden ≥ boostRun 3 Gangbreiten ohne Feind BOOSTET er (logisch ↑,
  Brems-Rampe schafft den Abbau vor Kurve/Duell); Demo-Tod ist
  arcade-ok; Durchkommens-Tests Tank + Fahrt.
  TANK-KURVENGEFÜHL (31.8.2026, Boris sah Bump an JEDER Ecke): der
  Vorausblick zog schon ~0.9 Gangbreiten vor der Kurvenkammer diagonal
  auf den Quergang-Punkt — die Diagonale läuft praktisch exakt über die
  Innenecke. Fix in autopilot.js: Vorausblick klemmt im Tank-Modus an
  KNICK-Wegpunkten (isTurnPoint), aufgerückt wird dort erst dicht an der
  Kammermitte (turnAdvance 0.25 statt advance 0.55), losgefahren erst
  fast ausgerichtet (walkAlign 0.6→0.35) — reinfahren, auf der Stelle
  drehen, sauber raus; Test verlangt NULL Bumps (90 Seeds geprüft).
  FLIPPER-DUELL (31.8.2026, Boris: „scheitert an jedem Flipper"): der
  Gangmitte-Geradeaus-Schuss verfehlt den Seiten-Trefferpunkt
  (0.5−lift = 0.34 > shotRadius 0.3) IMMER — der Autopilot zielt jetzt
  wie ein Mensch mit dem Fadenkreuz-Lenkausschlag (`flipperDuel`:
  playing reicht `mode.flippers` als Objekte — nicht mehr in foes — und
  `mode.steer`, die Ziel-Regelung pulst den gerampten steer per
  Bang-Bang auf aim/deflect). Duell-Erkennung: Quer-Fenster duelWindow
  1.0 Gangbreiten (unter dem parallelen Nachbargang 1.2 — Wand schützt
  dort) + Blick-HALBEBENE statt Kegel (ein Kegel bricht nah und beim
  Einbiegen genau dann ab, wenn es zählt); ANGESTEUERT wird nur bis
  kurz hinter den nächsten Weg-Knick (nextTurnDist als Luftlinie —
  NICHT straightRunAhead: dessen approach-Zweig kollabiert beim
  seitlichen Ziel-Versatz und würgte das Duell selbst ab), echte
  Kurven gewinnen gegen das Zielen. DRIVE-BY-Feuer in jeder Fahrlage:
  sobald das Fadenkreuz einen treffbaren Punkt in duelFire 0.28
  Gangbreiten Quer-Toleranz hat (auch mitten im Einlenken — das Kreuz
  streicht beim Einbiegen zwangsläufig über den Punkt, das rettet
  Begegnungen direkt hinter der Kurve); untreffbar geklappt (side 0)
  = weiterfahren ohne Boost und ohne sinnloses Feuer. Messlauf 16
  Level-Läufe: 13 komplett durch (~90 % der Duelle gewonnen, Rest
  Pech-Timing = arcade-ok); Durchkommens-Test mit echten Flippern.
  Rotation 3/7/12/17/22/27, immer OHNE
  Ton (`audio.setSuppressed`, unabhängig von M) und ohne Controls: ←/→
  ändern nur die AUSWAHL (`displayLevel` in hud.js), ↑/↓ Engine live, Rest
  geschluckt (game.demoKey; main.js hält User-Tasten aus game.keys).
  Overlay (LEVEL/Schalter/PRESS S, `blinkOn` aus hud.js) bleibt die ganze
  Demo: 1980 `scenes/demoOverlay.js`, 2026 DOM. Zyklus: Ziel (6 s
  Feuerwerk)/Game Over → Karte (5 s) → Abdocken → Orbit (7 s) → nächste
  Demo. S in der Demo = Boris' Übergang: hinauf zur Karte, Fläche HEILT
  zu (2026: Kanäle → Platte), dann normales Fräsen des GEWÄHLTEN Levels
  (neue Übergänge MAP/MAZE_GEN --START--> MAZE_GEN).
- **Der komplette Zyklus läuft**: Startscreen (Level-Auswahl per Pfeiltasten) →
  andocken → Labyrinth wächst → Reinfallen → Ego-Begehung (Tank-Steuerung,
  Hidden Lines) → X/20s → Rückschwenk → Karte mit Weg. Auf der Karte: solange
  das Ziel offen ist, fällt S zurück an die Spielerlage (Weg bleibt, `RESUME`/
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
  feuernde gelbe Spinner, s.u.) und 47/47/49/49/51 (Level 26–30: ARCADE-ROT,
  alle Feinde + Pulsare + Blick-Rotation, s.u.);
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
  Beschleunigung (`accel` — gilt auch fürs Losfahren nach dem Reinfallen), X
  bremst erst (`brake` + kurzer Halt `BRAKE_HOLD`, abgehoben wird erst, wenn
  auch der Feder-Impuls abgeklungen ist), dann Abheben. Am ZIEL steht der
  Wagen sofort (vel/push hart 0), aber `driveStep` läuft weiter: die Lenkung
  dreht den Blick — Umschauen wie in der Tank-Steuerung (12.7.2026).
  BOOST + AUSRICHTEN (30.8.2026, alle Fahrt-Level ab 6): ↑ gehalten =
  doppeltes Tempo (`DRIVE.boost` Faktor, Zieltempo boost×cruise über die
  vorhandenen Rampen — accel rauf, brake beim Loslassen; Motor-Tonhöhe
  steigt mit bis speed 2, Lautstärke bleibt beim Cruise-Pegel gedeckelt,
  `revs` in engineParams). ↓ gehalten = Lenk-Assistent `world/align.js`
  (pur): lenkt weich auf die MITTE des Gangendes in Blickrichtung
  (seitlicher Versatz → Schrägkurs zur Mitte, beendet das Wand-Pinball);
  liefert nur eine turn-Eingabe in [-1,1] durch die normale Lenk-Rampe,
  greift NICHT quer zum Gang (nächste Achsen-Richtung führt in die Wand →
  null) und nicht dicht am Ziel (`minDist`, sonst schlägt der Zielwinkel
  um); Handarbeit (←/→) gewinnt immer. Unter der Pulsar-Verdrehung
  rotiert das GANZE Tastenkreuz (`gyroDirs` in gyro.js, gleiche
  Herleitung wie LEFT_KEY — bei 90° lenken ↓/↑ und ←/→ sind
  Boost/Ausrichten); Steuer-Zeile zeigt alles an (`assistHintKeys`,
  playHint). Der Autopilot nutzt beide wie ein Profi: Ausrichten statt
  Zickzack-Lenken, Boost auf freier Geraden (s. ATTRACT-MODE).
  `world/waves.js`: Kollisionswellen starten als weißes Blitz-Kreuz am
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
  S dort = Retry (gleiche Maze, `game.resume` bleibt false → frischer Fall zum
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
- PULSAR-LEVELS 26–30 (15.7.2026, umgesetzt): ARCADE-ROT (`ARCADE_RED` in
  colors.js), Sterne BUNT (`rainbowStars` in levels.js, `tint`-Farbindex aus
  stars.js × FIREWORK_COLORS, gebatcht pro Farbe×Funkel-Stufe), ALLE Feinde:
  Tanker BLAU (`enemies.color`/`enemyColor(level)` — Rot ist die Wandfarbe;
  auch Karten-Kreuze und Splitter folgen ihr), Spinner wieder grün, Flipper
  magenta. NEU die gelben PULSARE (`world/pulsars.js`, pur): pulsierende
  Zackenlinien im Gang-Querschnitt (flache Enden, Zackenstrecke atmet
  spreadMin↔spreadMax), Platzierung wie Flipper (lange Gänge, Weg zuerst,
  S/G-Schutz; Spinner- UND Flipper-Gänge bleiben frei — spawnFoes würfelt
  sie ZULETZT), FESTE Position in der Gangmitte. Sie klappen wie Flipper um
  die Gang-Achse, rasten aber in JEDER Stellung lange ein (holdMin–holdMax).
  UNZERSTÖRBAR: eigene Schüsse im Gang (< dodgeRange 3 Gangbreiten, Flugzeit
  0.375 s > flipTime 0.25) lassen die Seiten-Stellung rechtzeitig nach
  unten/oben wegklappen (landet ein Flip unter Beschuss seitlich, klappt er
  durch); es gibt KEINE Treffer-Funktion. NICHT tödlich: Berühren/Kreuzen
  der Ebene (eigener Gang, ganzer Querschnitt) ROTIERT die Blickachse —
  Schlupfloch: seitlich eingerastet + Spieler ≥ passMargin zur GEGENSEITE
  gezogen. Nach Berührung entschärft (`armed`), bis der Spieler rearmDist
  Abstand hat (sonst löste die Durchfahrt während der Rotation erneut aus);
  während `gyro.spinning` löst kein weiterer Pulsar aus. Die ROTATION
  (`world/gyro.js`, pur): Betrag 270/360/450° und Richtung aus foeRng
  (deterministisch), Dreiecks-Tempoprofil (accel 16 rad/s², 360° ≈ 1.25 s),
  rastet EXAKT im 90°-Raster ein (orient 0..3, Roll normalisiert — Snap
  setzt orient×90°, kein Float-Modulo-Rest). GERENDERT als Bildraum-Roll im
  Sway (`bank + rollOsc + gyro.roll` — Hidden-Lines-Falle 4: NIE in die
  Kamerabasis; ein Roll um die Blickachse ist exakt eine 2D-Rotation, auch
  als 90/180/270°-DAUERZUSTAND). Steuerung "logisch" (`gyroTurn`): man
  drückt den Pfeil, der auf dem verdrehten Bildschirm zur Zielseite zeigt
  (Welt-links erscheint bei 90° UNTEN → ↓ lenkt links; 180° = ←/→
  vertauscht); das Mapping wechselt erst beim EINRASTEN (Boris' Spec), die
  Steuer-Zeile unten zeigt die aktuelle Belegung. Beim Abheben übergibt
  `playing.exit` die Rest-Verdrehung kürzester-Weg-normalisiert als
  `game.viewRoll`; der Rückschwenk (rising) dreht sie mit dem Ease sanft
  aus (Karte kommt aufrecht an, danach 0; Playing startet immer aufrecht —
  auch Resume). Sound: `gyroPatch(dur)` — Gleitton folgt dem Dreiecksprofil,
  Einrast-Tick genau bei dur. `game.pulsars` mit denselben Resume/Retry-
  Regeln (sterben nie, `alive:true` hält die Marker-Pipeline einheitlich);
  Karten-/Schwenk-Kreuze gelb.
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
- 2026-VARIANTE (25.8.2026, AKTUELLES GROSSPROJEKT): gleiches Spiel, EIN Core,
  ZWEI Engines — moderne Three.js-Grafik, Startscreen-Schalter "1980/2026".
  **Stufenplan: PLAN2026.md** (dort auch die Testrezepte: CDP-Headless-Chrome,
  Server auf 3999, NIE 3001). Prototyp + gelernte GPU-Fallen:
  public/proto2026/ (README). Three.js r185 vendored, kein Build-Tool.
- Nächste mögliche Themen: **TOUCH-BEDIENUNG (Backlog-Pflicht, Boris
  31.8.2026 — seit dem Live-Gang auf mazestorm.io testet er andere
  Plattformen, mobil ist das Spiel ohne Tasten unspielbar)**; echter
  "Trench Run", Politur; Score/HUD.
  Aufgeschobene (Performance-)Ideen mit Messwerten: siehe IDEAS.md.
- Performance-Basics sind drin: kollineare Wandzüge werden zusammengefasst
  (`mergeCollinear` — Unter-/Oberkanten lang, Pfosten bleiben an jeder
  Zellgrenze, Verdecker ~3x weniger; Occlusion-Pass skaliert mit
  Kanten × Verdecker); Ziel-Strahlen werden pro Flacker-Stufe in EINEM
  Stroke gezeichnet (shadowBlur ist der teuerste Canvas-Pfad).
