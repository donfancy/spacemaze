# Code-Review SpaceMaze — Gesamtbestand (28.8.2026)

Review ueber beide Engines (1980 + 2026), Core, World, Sound, Tests.
Fuenf parallele Review-Paesse (Mathe/World-Basis, Feind-Module, Render+Szenen
klassisch, 2026-Engine, Core/Sound/Testabdeckung), kritische Funde am Code
verifiziert. `npm test`: 354 gruen (CLAUDE.md sagt noch 346 — aktualisieren).

**Gesamteindruck:** Der Bestand ist in sehr gutem Zustand. Die Architektur-
Regeln halten (kein Canvas/DOM ausserhalb renderer.js, Core importiert nie
Three.js, Naht sauber), die Testsuite testet Invarianten statt Beispiele,
kein Speicherleck beim wiederholten Level-Durchlauf gefunden. Die Funde
unten sind ein echter Gameplay-Bug, eine Handvoll Robustheits-Patches,
und vor allem: Duplikation, die mit jeder weiteren Feindart teurer wird.

---

## A) GROESSERE THEMEN (Diskussion / Design / echte Bugs)

### A1. BUG: Flipper sind durch die Trennwand abschiessbar
`world/flippers.js:226-239` + `world/shots.js:85-96`. `shotsStep` wertet
`hitTest(nx, nz)` am Substep-Punkt aus BEVOR `isWalkable` prueft — der Punkt
kann bis zu eine Substep-Weite (0.5 Einheiten) IN der Wand liegen.
`flipperShotHit` prueft nur `Math.hypot(...) < shotRadius*cell` ohne
Gang-Beschraenkung: Seiten-Trefferpunkt 0.8 Einheiten vor der Wandflaeche,
Substep bis 0.5 in der Wand → 1.3 < 1.5 → Flipper stirbt durch die
1-Einheit-Trennwand, unsichtbar fuer den Schuetzen. Dieselbe Bug-Klasse wie
der am 12.7. gefixte Spinner-Wand-Bug (dort schuetzt `t < 0`).
**Fix:** in `flipperShotHit` denselben Quer-Check wie in `flipperPlayerHit`
(Z. 254): `Math.abs(cross - f.cross) >= 0.5*cell → continue` + Regressionstest.

### A2. BUG: spawnFlipperPair geht von der Geburtszelle des Tankers aus
`world/flippers.js:154-172`. Spannen-Suche und `cross` werden aus
`enemy.gx/gy` (Geburtskammer) berechnet — ein patrouillierender Tanker kann
beim Abschuss aber Kammern entfernt stehen; wird er quer durch einen anderen
Gang abgeschossen, spawnt das Straf-Paar im falschen Gang (oder als
unbeweglicher Flipper). **Fix:** aktuelle Zelle via `cellAt(maze, enemy.x,
enemy.z, unit)` nutzen; Test mit patrouilliertem Tanker + z-Achse ergaenzen
(der bestehende Test deckt nur den stehenden Tanker auf der Geburtskammer).

### A3. viewState-Naht: playing.js ohne Null-Guard
`scenes/playing.js:928-935`. Alle anderen Szenen guarden `if (!maze) return
null` — Playing nicht; vor dem ersten `enter()` wirft `walkState.steer`
einen TypeError. Die Naht ist die offizielle Engine-Schnittstelle, der
Vertrag sollte symmetrisch sein. **Fix:** Dreizeiler.

### A4. applyEngine: Import-Fehler laesst den 2026-Schalter stumm haengen
`main.js:36-43`. Schlaegt der dynamische Import fehl, bleibt
`backendLoading` als rejected Promise stehen: unhandled rejection, kein
Retry moeglich, Startscreen zeigt "2026", gerendert wird still 1980.
**Fix:** `.catch(() => { backendLoading = null; game.engine = ENGINE_1980; })`
(+ Log). Wird beim Deployment-Thema (Stufe 6) real.

### A5. 2026-Backend hat kein Lebenszyklus-Ende
`render2026/backend.js`. Beim Umschalten 2026→1980 bleibt der WebGL-Kontext
samt Composer, HalfFloat-MSAA-Target (~130 MB GPU bei 2x dpr Full-HD) und
der LETZTEN Labyrinth-Welt unbegrenzt stehen; auch beim Rueckflug zum
Startscreen lebt die alte Welt weiter. Kein Leak im engen Sinn (gedeckelt),
aber auf iPad/Handy echtes Budget. **Vorschlag:** (a) `disposeWorld(world);
world = null` beim Eintritt in STARTSCREEN, (b) `backend.dispose()` fuer
einen spaeteren harten Schalter.

### A6. Duplikations-Cluster (das grosse Struktur-Thema vor Stufe 6)
Wird mit jeder Feindart/Aenderung teurer; Reihenfolge = Empfehlung:
1. **Feind-Platzierung 3x kopiert:** Kandidaten-Scan (findPath + Filter +
   guard-Set + straightRuns + 5-stufiger Sortier-Komparator) praktisch
   zeichengleich in createSpinners/createFlippers/createPulsars →
   `world/foePlacement.js` mit `corridorCandidates(...)`; dazu
   avoid/taken-Pruefung, `spanOf`, `openSpan`. Auch der Flip-Automat
   (orientIndex/LCG/QUARTER/holdSide) ist zwischen flippers und pulsars
   dupliziert, die `…Markers`-Funktionen 3x.
2. **backend.js: 8x "wachsender Puffer + Spiegel + Dispose"-Muster**
   (Sparks, Shots, Bursts, FoeLines, FlipperFill, FoeShots, Fireworks,
   FoeMarkers) → ein Helper `growableBuffer(...)`; spart ~250-300 Zeilen
   und macht die fehleranfaellige Dispose-Logik an EINER Stelle korrekt.
3. **Engine-Drift 1980/2026:** HUD-Texte weichen bereits ab (map.js:96
   "Q RETURN X EXIT" vs. backend.js:1338 "Q RESUME · X LAUNCH"),
   GAME-OVER-Farbpuls 2x implementiert, steerKeys-Tabelle 2x
   (playing.js:875 / backend.js:1331), Fade-Formel 2x (game.js:166 /
   backend.js:1401) → pures `core/hud.js` (steerKeys, mapHint,
   gameOverPulse, transitionAlpha), beide Engines konsumieren, testbar.
   FRAGE an Boris: ist die Wortlaut-Abweichung Absicht (2026-Ton)?
4. **Paarweise synchron zu haltende Konstanten:** EGO_BOOST 2.2
   (backend.js:161 vs. 3x hart in world3d.js:105-112 — setLineGlow rechnet
   dagegen!), Spiegel-Dim 0.85 (3x), CUBE_SIZE (4x: mazeView exportiert,
   startscreen/mazegen/startscreen3d definieren eigene) → exportieren
   und importieren.
5. **Achsweise Kollisions-Bewegung 3x:** mazeWorld.tryMove (nur noch von
   Tests gerufen!) + Laufzeit-Kopien in walk.js:62-75 und drive.js:89-103
   inkl. identischem Tie-Break → gemeinsamer Helfer `moveAxiswise(...)`,
   tryMove wird Zweizeiler darueber.

### A7. Performance-Posten (fuer den Stufe-6-Pass; erst messen, dann anfassen)
- **Schwenks bauen die Wand-Geometrie jeden Frame komplett neu:**
  falling.js:76 / rising.js:94 rufen `faceWalls(maze, face, hoehe*e)` mit
  animierter Hoehe → volle Kette corridorOutline (O(n²), n=51: 2601 Zellen)
  + mergeCollinear pro Frame, obwohl nur die Hoehe variiert. Vorschlag:
  gemergte 2D-Zuege pro Maze cachen, pro Frame nur Extrusion + Mapping.
- **Tanker = groesster Draw-Call-Posten in 2026:** 4 Calls pro Tanker
  (Body + Kanten, x2 Spiegel), Level 15 = 56 Calls nur Tanker → InstancedMesh.
- **Kleinvieh GC-Druck** (kein CPU-Problem, Messwerte sind gut): occludeEdge
  allokiert Closure + Arrays pro Kante/Frame; playing.js klont 4 Feindlisten
  per filter pro Frame; Stern-Schleife ~500 Kleinst-Arrays/Frame; backend
  ruft viewState() bis 3x pro Frame (cachen), updateGrowth disposed/baut
  BufferGeometry pro Wachstums-Tick (setDrawRange stattdessen), Burst-Pool
  index-basiert (Slot-Verrutschen erzwingt Realloc mitten in der Explosion).
  → nach IDEAS.md, bei gemessenem Bedarf.

### A8. API-Fallen (laden zum kuenftigen Fehler ein)
- **maze.seed von der Zufallsquelle entkoppelbar:** maze.js:78-79 — bei
  `options.rng` ohne `seed` ist `maze.seed` Zufallsmuell, aber spawnFoes/
  createStars/Feuerwerk leiten daraus ab. Vorschlag: rng-Option streichen
  (Tests auf `{seed}` umstellen) oder `seed: null` setzen → laut scheitern.
- **camera.roll ist totes UND per Projektregel verbotenes Feature:**
  camera.js:19/49/58 — niemand setzt es (Gyro-Roll laeuft korrekt als
  Bildraum-Sway), kein Test deckt es, `forward()` mit roll ist sogar No-op.
  Entfernen (oder bewusst behalten + 2 Tests).
- **renderer.worldToScreen nutzt festes near=0.1** entgegen der eigenen
  Near-Plane-Regel (renderer.js:165): das Fadenkreuz ankert bei 2.5*cell —
  bei n=51 nur noch Faktor 2 ueber der Near-Plane, bei groesseren Mazes
  verschwindet es kommentarlos. Fix: optionaler near-Parameter.

### A9. Toter Fade-Pfad in game.js — FRAGE an Boris
game.js:74-89 u.a.: der animierte 0.7s-Fade in `dispatch()` wird von ALLEN
11 Aufrufen mit `{fade:false}` umgangen — ~40 Zeilen Zustandslogik, die nur
Tests ausfuehren. Behalten als Gestaltungsoption (dann Kommentar + Tests auf
Produktionspfad) oder entfernen?

### A10. Audio: der allererste Sound der Session wird verschluckt
audio.js:28-30/52-53: `unlock()` ruft `ctx.resume()` (async), `play()` gated
auf `state === 'running'` → der erste Tick nach dem ersten Tastendruck faellt
still aus. Fix: bei `suspended` trotzdem schedulen (Nodes starten beim Resume)
oder letzten Patch nach `resume().then()` nachspielen; engine() weiter gaten.

### A11. Shatter-Zentrum springt beim Uebergang Playing → Rising
playing.js:609-613 zerscherbt um den Einschlagpunkt, rising.js:86-89 um die
Bildmitte → am Uebergabe-Frame ruckt die Scherbenlage einmal (bricht die
"feste Flugbahnen"-Zusicherung). Fix-Idee: Einschlag-Bildschirmpunkt wie
viewRoll ueber game mitgeben. VORHER visuell pruefen, ob es ueberhaupt stoert.

### A12. proto2026: halb totes Gewicht — Entscheidung fuer Boris
proto2026/world3d.js ist eine divergierende Kopie von src/render2026/world3d.js.
Noch Wert: README (GPU-Fallen, aus src referenziert), HUD-Draw-Call-Zaehler
(will Stufe 6 laut Plan), Live-Toggles B/R/N/1/2/3/H fuer den Gestaltungs-Pass.
Empfehlung: bis zum Stufe-6-Gestaltungs-Pass behalten (Zaehler + Toggles
ernten), dann loeschen und Fallen-Liste nach PLAN2026.md ziehen.

### A13. Testluecken (Suite ist stark; das hier fehlt konkret)
- **playing.js (946 Z.) ist die groesste ungetestete Logikmasse.** Extrahieren
  + testen (kein Big-Bang, stueckweise im Zuge von Stufe 6):
  hitTest-Ketten-Prioritaet zap→flipper→spike (spielentscheidend, nirgends
  abgesichert), Flipper-Paar-Bedingung, spawnShotEvent-Mapping,
  viewRoll-Normalisierung in exit() (Modulo-Arithmetik), Steuer-Hinweis-
  Tabelle → als `steerHintKeys(orient)` neben gyroTurn nach world/gyro.js
  (ist die INVERSE des Mappings — Invarianten-Test dagegen!), bucketAdd/
  FLICKER-Quantisierung als render/strokeBuckets.js.
- **mazeView.js (258 Z.) ohne Testdatei** trotz purer Geometrie (unitSize,
  mapPose, egoPose, blendPose — die Quaternion-Falle!). Billig testbar.
- **Feinde:** Flipper/Pulsar-Platzierung nur im Hand-Maze mit 1 Kandidaten
  getestet (Sortierung "Weg zuerst, laenger zuerst" nie ausgeuebt);
  spawnFlipperPair nur x-Achse/stehend (haette A2 gezeigt);
  flipperPlayerHit mitten im Flip ungetestet; pulsarsStep-Zweig "Flip endet
  unter Beschuss seitlich" + shotThreat-Richtungs-Check ungetestet;
  spinnerShotsStep-Kompaktierung nur mit 1 Schuss.
- **Engine-Naht:** Gegentest "1980 MIT injiziertem Backend → Backend wird
  NICHT gerufen" fehlt; Luminanz-Normierung des Karten-Glow als pure
  Funktion (z.B. `diagramBoost(hex, mix)`) nach colors.js ziehen + testen;
  falling.viewState() Resume-Pfad, rising gameOver, startscreen blink.
- **Sonstiges:** quatFromBasis-Zweig "m00 am groessten" (180°-Drehung um x
  als Sample ergaenzen → alle 4 Shepperd-Zweige); states.test RESUME-
  Uebergang; game.test Retry-Determinismus (Positionsvergleich, eine Zeile);
  rotateSegmentsY nur mit 0 und 2π getestet (Vorzeichenfehler bestuende).

---

## B) KLEINIGKEITEN / CLEANUP (mechanisch umsetzbar)

### Bugs im Kleinen / Robustheit
1. server.js:44-48 — Traversal-Check `startsWith(ROOT)` ohne Separator:
   `ROOT + sep` pruefen (laesst sonst `spacemaze-foo`-Geschwister durch).
2. server.js:50 — Verzeichnis-Anfrage liefert 500 (EISDIR) statt 404.
3. backend.js:1337 — `viewState?.()?.fade < 0.99`: 1980 dimmt den Karten-
   Hinweis mit fade, 2026 blendet hart; und `undefined < 0.99` ist false.
4. audio.js:70 — `if (v.filter.q)` ist Falsy-Check, `q: 0` wuerde ignoriert.
5. pulsars.js:231-233 — Rearm misst nur Laengs-Abstand; euklidisch messen.
6. patches.js:133-144 — gnawPatch: Huellkurven kollidieren bei Dauer < ~0.7s;
   Math.max-Guard oder Invarianten-Kommentar.
7. playing.js:236-254 — Burst-`seed: bursts.length + n` verschiebt sich nach
   dem filter; laufender Zaehler waere deterministischer.
8. flippers.js:210 — Flip-Ende per Float-Modulo statt exaktem Snap wie
   pulsars.js:201 / gyro.js — konsistent rasten.

### Duplikate zusammenziehen (Einzeiler-Kategorie)
9. `#ff3b30`/TANKER_RED 3x: mazeView.js:152 (ENEMY_MARK_COLOR), map.js:84-90
   (handgerollter Hex-Puls `ch(0x3b)` → `mixColors(TANKER_RED,'#fff',k)`),
   backend.js:1370 (gleiche Magic-Bytes) — colors.js nutzen. (Geht in A6.3 auf.)
10. `isOpen`/`isOpenCell` 5x: enemies.js:25, spinners.js:75, flippers.js:70,
    drive.js:45, waves.js:9 — ein Export (maze.js oder mazeWorld.js).
11. `easeInOut` 2x wortgleich (falling.js:25, rising.js:28) + clamp01-Variante
    (mazegen.js:31) — gemeinsamer Ort.
12. openSpan aus enemies.js:30-36 in flippers.js:163-166 nachgebaut — importieren.
13. hash01 2x (goal.js:103, burst.js:11) + sin-Hash 2x (stars.js:35,
    fireworks.js:30) — util/hash.js.
14. Funkel-Formel 2x in backend.js (354 vs. 1126) — Helper.
15. startscreen.js:174/222 — Blink-Formel `(t%1.1)<0.72` 2x (render +
    viewState) — Konstante/Helper, sonst blinken die Engines asynchron.
16. playing.js:664 vs. 749 — goalNear und `NEAR_RATIO*cell` derselbe Wert
    unter zwei Namen.
17. playing.js:129-130 — FLIPPER_COLOR/PULSAR_COLOR sind reine Import-Aliasse;
    Stil vereinheitlichen (enemyCol aus levels, Rest lokal hartverdrahtet).
18. main.js:51 + backend.js:1414 — dpr doppelt auf 2 geklemmt; eine Stelle.

### Totes / Redundantes
19. states.js:39-41 — isValidState nur von Tests genutzt (behalten nur als API).
20. Produktions-tote Exporte: vec3()/add/scale/length (vec3.js), pick (rng.js),
    topDownDock (cameraPaths.js), cubeEdges/floorGrid/rotateSegmentsY
    (shapes.js) — streichen oder als Test-Helfer kommentieren
    (reachable/isPillar sind legitime Invarianten-Helfer: Kommentar dran).
21. enemies.js:117 — `p.axis === 'x' ? 'x' : 'z'` ist ein No-Op.
22. stars.js:56 — `% 6` nach `Math.floor(hash*6)` redundant.
23. pulsars.js:99 — aeusseres `orientIndex(k*QUARTER)` ist Identitaet.
24. server.js:7+9 — doppelter node:path-Import; normalize() nach join()
    redundant.
25. test/enemies.test.js:8 — cellCenter importiert, nie benutzt.
26. test/levels.test.js:15-24 — deepEqual + Formel-Schleifen pruefen dasselbe
    doppelt.
27. levels.js:96-108 — `spinners.color: PHOSPHOR_GREEN` redundant zum
    spinnerColor()-Default (falls nicht bewusst als Doku).

### Mikro-Performance (gratis mitnehmbar)
28. walk.js:41 / drive.js:59 — `{...WALK, ...(opts.params ?? {})}` allokiert
    2 Objekte pro Sim-Schritt, obwohl params nie gesetzt: nur bei Bedarf mergen.
29. shots.js:115 — params-Spread pro Schuss pro Frame in shotSegments —
    einmal beim Aufrufer bauen.
30. maze.js:209 — findPath mit queue.shift() (O(n) pro Pop) — Lese-Index.
31. occlusion.js:63 — invEAt-Closure pro occludeEdge-Aufruf — inline.
32. backend.js:1125 — `hdr(...)` alloziert pro Frame eine THREE.Color —
    Scratch-Color (BEACON_COLOR-Muster).
33. backend.js:725-731 / 1003-1008 — kinds-Array + Closures pro Frame neu —
    hoisten.
34. backend.js:437 — tankers.src mit null statt undefined initialisieren
    (spart leeren Erst-Rebuild).
35. world3d.js:118-128 — disposeWorld: geteilte Texturen (m.map) mit ins
    seen-Set (mehrfach-dispose ist idempotent, aber unsauber).
36. spinners.js:324-329 — spinnerFire: runCoords (Z. 198) nutzen statt inline.

### Doku / Kosmetik
37. CLAUDE.md — Testzahl 346 → 354.
38. vectorText.js:36 — Docstring behauptet tracking-Default 0.4, real 1.2.
39. goal.js:57 — `perEdge: 2` erzeugt 3 Strahlen (perEdge+1) — Name luegt.
40. goal.js:82-99 — beamOcclusionCut mischt Punktformate ([x,z] vs. [x,0,z])
    in einer Signatur — Parameter umbenennen (camXZ/footXZ).
41. burst.js:79-96 — unbenannte Streu-Konstanten: je 1 Kommentar
    (Traegheit/Taumel/Jitter), wie es die Nachbarn vormachen.
42. stars.js:36 / fireworks.js:46 — `(seed % 9973)`-Aequivalenzklassen:
    Kommentar (Tests behaupten "anderer Seed → anders").
43. proto2026/README.md:33 — stale `vendor/`-Verweis (liegt in public/vendor/).
44. renderer.js:154 — Praezedenz `scene.intensity ?? opts.intensity ?? 1`
    einen Satz kommentieren (playing verlaesst sich darauf).
45. main.js:74-76 — M (Mute) faellt zusaetzlich in game.keys durch; return
    nach dem Toggle.
46. package.json — `"private": true` + `"engines"` (Node >= 20) ergaenzen.
47. game.js:102 / mazegen.js:61 / falling.js:52 — spawnFoes wird beim ersten
    frischen Anlauf doppelt gewuerfelt (deterministisch gleich, nur doppelte
    Arbeit) — Kommentar oder fresh-Flag.
48. game.js:15 — core importiert unitSize/cellSize aus scenes/mazeView —
    fuer pure Masse besser Richtung world/metric.

---

## Explizit sauber (geprueft, keine Funde)
metric.js (inkl. negativer Koordinaten), waves.js (Klemmen + Sicherheitsnetz),
walk/drive-Kollisionslogik (konsistent mit den dokumentierten Fallen),
oscillator.js, trail.js, stars.js-DDA (Guard beweisbar ausreichend),
cubeFaces.js, visibility.js, gyro.js (tadellos inkl. Tests), shots.js-
Substep/Tempest-Logik, die prev/prevTip-Einbahn-Semantik der Spinner,
states.js-Automat, levels.js (konsequent reine Daten), patches.js-Invarianten,
audio.js-Voice-Aufraeumen (onended), 2026-Naht-Dispatch mit Rueckfall,
disposeWorld-Traverse (kein wachsendes Leak ueber Level-Durchlaeufe).
