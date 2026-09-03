# PLAN STURM — die Tempest-Feind-Mechanik

Boris' Entscheidung (3.9.2026): eine alternative, noch Tempest-nähere
Feind-Mechanik, die mehr „Sturm" ins Labyrinth bringt. Entwickelt auf dem
Branch `sturm-feinde`; was nach main geht, entscheiden wir später.
Getestet wird in der **2026-Engine**, die 1980-Darstellung ist zurückgestellt
(sie darf nur nicht abstürzen). Die Feinde verhalten sich **über alle Levels
einheitlich** (Tanker ab 11, Spinner ab 16, Pulsare ab 26).

Ausblick (NICHT heute, erst wenn die Mechanik „sitzt"): 3 Leben, Ziel →
nächstes Level (Superzapper lädt nach), Punktezählung, Level 1–20 als
Übungslevel, das eigentliche Spiel beginnt mit 21.

**Boris' Entscheidungen zu den offenen Fragen (3.9.2026):** Lauerer auf der
Krone mit **30 %** Größe; **bis zu 6 Tanker** pro Gang; „shooting alley"
heißt: in langen Gängen dürfen **ALLE Feindarten** zugleich auftauchen
(keine gegenseitige Gang-Sperre mehr — Tanker, Spinner und Pulsar teilen
sich die längsten Gänge); Auslöser nur in der Blick-Halbebene, aber wer
sich danach umdreht, wird von den Jägern **auch in den Rücken** beschossen;
Jäger sind **gangbunden** (durch kommt nur, wer sie abschießt — oder beim
Pulsar den Gang wechselt); Flipper-Paare auch in 11–15; Pulsare
**langsamer**: 2,5 s zu / 0,8 s offen als Start; Superzapper auf **Z und Y**
(kein Cmd/Alt-Stress), Effekt Blitz + Explosionen, später evtl. ein
Aufleuchten, das durch die Wand-Kantenlinien läuft; der Autopilot zappt.

## Grundprinzipien

- **Reine Module zuerst.** Jede Mechanik lebt als Daten + Berechnung in
  `src/world/` (headless testbar), `scenes/playing.js` orchestriert,
  `render2026/backend.js` zeichnet nur. Die 1980-Zeichner (`egoWorld.js`)
  bekommen das Minimum, damit `npm test` und die Engine nicht brechen.
- **Jede Stufe endet spielbar, getestet, committed** (`npm test` grün,
  Sichtprüfung im Browser durch Boris, CDP-Skripte nach Bedarf).
- **Messlatte fürs Tuning ist der Autopilot** („geübter Spieler"): die
  Durchkommens-Tests simulieren mit den ECHTEN Konstanten. „Machbar, aber
  knapp" heißt: der Autopilot kommt meistens durch, nicht immer.
- **Replay/Attract bleiben intakt.** Neue Feind-Felder reisen per
  `structuredClone` automatisch mit (recorder.js); die 2026-Wiedergabe
  zeichnet aus reinen Daten, also müssen ALLE Animationszustände
  (Purzeln, Klappen, Phantom-Wände) Funktionen der Feind-Daten + Zeit sein,
  nie Closure-Zustand des Zeichners.

## Die Mechaniken

### 1. Tanker-Alleys („lauern, purzeln, jagen")

Heute: Tanker stehen/patrouillieren in Kammern (Hälfte auf dem Weg).
Neu (Boris' Spec):
- Tanker **lauern** an langen geraden Gängen: **oben auf der Wandkrone**
  der End-Wand (verkleinert dargestellt) oder weiter hinten auf den
  **Seitenwand-Kronen**. Lauern = langsames Hin-und-her-Schieben.
- Kommt der Spieler „in Sicht" (er schwenkt in den Gang ein), **purzeln**
  sie **einer nach dem anderen** (nicht gleichzeitig) in den Gang und
  wachsen dabei auf ihre normale Größe.
- Dann jagen sie **zügig** auf den Spieler zu und **schießen** — dieselben
  Schüsse wie die Spinner (gangbreit tödlich, abfangbar per eigenem Feuer).
- **Treffer → IMMER ein Flipper-Paar** (links + rechts, leicht versetzt) —
  die 3-Felder-Regel entfällt. Flipper entstehen NIE anders.

Ableitungen (Vorschlag, s. offene Fragen):
- Platzierung über `corridorCandidates` (foePlacement.js): Weg-Gänge zuerst,
  längste zuerst; KEINE Gang-Sperre gegen Spinner/Pulsare (Boris: in
  langen Gängen tauchen alle Feinde auf). `enemies.count` bleibt die
  Gesamtzahl pro Level, verteilt in Gruppen bis `enemies.group` (max 6,
  nie mehr als Kammern) pro Gang. Gruppe: bis 3 auf der End-Wand-Krone
  (nebeneinander, Krone ist 1 Einheit tief, Gang 5 breit), der Rest auf den
  Seitenkronen weiter hinten.
- Zustands-Automat pro Tanker: `lurk` (Krone, Größe 0.3, Schwingen ±0.3
  Gangbreiten, unverwundbar + harmlos) → `drop` (0.6 s Purzeln: Position
  von der Krone auf Schwebehöhe, Größe 0.5→1, Taumel-Rotation; Abstand
  zwischen zwei Purzlern 0.6 s) → `hunt` (Alley-gebunden: läuft auf die
  Längs-Position des Spielers zu, huntSpeed 1.0 Gangbreiten/s — fliehbar
  bei cruise 1.5; an den Gang-Enden bleibt er stehen und wartet).
- Auslöser: Spieler IM Gang (quer in der Gangbreite, längs in der Spanne)
  UND die Gruppe vor ihm (Blick-Halbebene, keine Schüsse in den Rücken —
  die Spinner-Regel). Einmal ausgelöst, purzelt die ganze Gruppe.
- Feuer: nur im `hunt`, nur bei Spieler im Gang — Blickrichtung egal
  (wer sich umdreht, kriegt es in den Rücken; Boris), fireRate 0.4/s
  pro Tanker; Schuss-Objekt = Spinner-Schuss-Form (axis/dir/wall/cross/
  runLen/t) → `foeShots` und alle bestehenden Funktionen (Flug, Treffer,
  Abfangen, Zeichnung) gelten unverändert.
- Berührung eines gepurzelten Tankers = Crash (wie heute). Lauerer sind
  außer Reichweite (auf der Krone).
- Rendering 2026: die Okta-Raute auf der Krone (y = Wandhöhe + halbe
  Raute), Skalierung aus dem Zustand, Purzeln als Interpolation +
  Taumel. Karte/Minimap: Kreuze wie heute (auch Lauerer).
- Autopilot: `foes` = nur gepurzelte Tanker (Lauerer sind untreffbar).

### 2. Flipper: der Rettungsschuss

Heute: Flipper wandern, klappen zufällig, abschießbar nur seitlich
eingerastet (Fadenkreuz-Seitenzielen). Neu:
- Erreicht ein Flipper die Ego-Ebene → Spieler zerstört (wie heute).
- **Zwangs-Flip knapp vor dem Spieler**: spätestens bei `flipDist`
  (~1.2 Gangbreiten, Vorschlag) klappt er IMMER — aus jeder Stellung.
- **Diagonal-Kill**: WÄHREND des Klappens (Diagonalstellung, 45° ± Fenster)
  zerstört ihn ein gerader Schuss (Gangmitte, Augenhöhe). Für den geübten
  Spieler machbar, Dauerfeuer soll ihn NICHT zuverlässig liefern.
- Vorschlag für „nicht zuverlässig": zwei Bedingungen — der Schuss kreuzt
  die Flipper-Ebene im Diagonal-Fenster (±15° um 45°, d.h. ein Drittel der
  0.3-s-Drehung = 0.1 s) UND der Schuss wurde NACH Klappbeginn abgefeuert.
  Gezielter Druck beim Klappbeginn: sicher. Dauerfeuer (5/s, Cooldown-Phase
  zufällig zum Klappbeginn): ~50 % — Glück, kein Verlass. Test als
  Monte-Carlo: Timing-Schuss 100 %, Dauerfeuer in [0.3, 0.7].
- Gilt für jede Diagonale (auch die zufälligen Flips unterwegs).
- Flipper-Paare gibt es damit auch in Level 11–15 (Spec: einheitlich).

### 3. Spinner: Wandern statt Dauerwachstum

Heute: Spike wächst kontinuierlich, Spinner pendelt Vorlauf/Rückzug,
verwundbar nur beim Vorlauf, an der Wand geschützt. Neu:
- Der Spike ist an der **Wand verankert**; der Spinner **wandert vor und
  zurück** (Wand ↔ Spitze) und kommt bei jedem Vorlauf um `step` weiter —
  **so verlängert er den Spike**. Kein Wachstum ohne Wandern.
- **Nur der Spinner schießt** (aus dem Körper; seine Schüsse laufen durch
  den eigenen Spike). Einheitlich: Spinner feuern in ALLEN Spinner-Levels.
- Abschießbar nur **vorne am Spike** (Körper an der Spitze) **oder wenn der
  Spike weit genug zurückgedrängt** ist (Spitze unter die Körperlage
  gekürzt → Körper frei). Der Schild an der Wand entfällt (Spike 0 + Körper
  an der Wand = verwundbar).
- Aktivierung erst bei **Annäherung**: der Spike beginnt zu wachsen, wenn
  der Spieler **1–2 Ecken** vor dem Spike-Gang ist (Knicke des eindeutigen
  Wegs zum Gang-Eingang, per BFS pro Spinner vorberechnet). Kein
  Längen-Deckel nötig — der Spieler muss genug schießen (Sicherheitsdeckel:
  der Gang-Einstieg bleibt frei, `capMargin`).
- Toter Spinner: der **Spike bleibt** stehen (Länge eingefroren, kürzbar,
  Spitze weiter eine Einbahn-Sperre) — Superzapper-konsistent.
- Durchkommens-Garantie neu formulieren: Kürz-Rate bei Dauerfeuer gegen
  Verlängerung pro Vorlauf; Test mit echten Konstanten, mit und ohne Feuer.

### 4. Pulsare: immer 360°, und die Wand wird durchlässig

- Berührung → **immer 360°** (links oder rechts). Die Steuerung bleibt
  dauerhaft normal (orient stets 0 — die gyroDirs-Rotation des Tastenkreuzes
  wird nie aktiv, der Code bleibt). Pulsare bleiben unzerstörbar.
- **Wand-Phantome**: ist die Zackenstrecke **zusammengezogen**, werden
  Wandstücke für einen kurzen Moment **flirrend unsichtbar** und der Spieler
  kann **in den Nachbargang wechseln**. Beim Wiedererscheinen wird er
  zurückgedrückt oder ganz in den anderen Gang geschoben, je nachdem, wo
  seine Mitte rechnerisch steht.
- Umfang: seitlich eingerastet → bis **5 Wandstücke** auf DIESER Seite
  (zentriert am Pulsar; gerader Gang, sonst weniger); oben/unten → **3 je
  Seite**; im Klappen → **1** auf der berührten Seite. Außenwände nie.
- Takt (Boris): **2,5 s zu, 0,8 s offen** als Start — der Pulsar-Puls wird
  entsprechend langsamer (Zusammenziehen = offen).
- „Wandstück" = ein Gitterfeld der Seitenwand (Zwischenwand-Stück = eine
  Gangbreite lang, Pfeiler = eine Einheit). Durchfahren kann der Spieler
  (Quadrat 0.5 Gangbreiten) nur die Zwischenwand-Stücke — dahinter liegt
  immer eine Kammer; Pfeiler-Löcher sind Optik.
- Technik: Overlay `maze.openings` (Set aus Zellschlüsseln), gelesen von
  `isOpenCell`/`isWalkable`/`rectWalkable`/`hasLineOfSight` — das Grid
  selbst bleibt unveränderlich (Geometrie-Caches sicher). Pure Funktion
  `pulsarOpenings(pulsars, maze, time)` → [{gx, gy, alpha}], playing setzt
  das Overlay pro Frame, `exit` räumt es weg. Schüsse (eigene + Feind) und
  Sichtlinien gehen durch offene Phantome.
- Rückdrücken (`resolveWallOverlap`, pur): liegt das Spieler-Quadrat beim
  Schließen in einer Wandzelle, wird es quer auf die nähere Seite gesetzt
  (Mitte entscheidet), Bump-Impuls + Brutzel-Sound.
- Rendering 2026: die Wände sind zusammengefasste Quads — Phantome per
  Shader-Ausschnitt (`onBeforeCompile` auf wallMat/lineMat/wallGridMat +
  Spiegel): Uniform-Liste von Loch-Boxen (xz-Footprint der Zelle) + Alpha,
  Fragment-`discard` mit Zeit-Flirren (Hash). Deckel (wallCaps) teilen
  wallMat und verschwinden mit. Kein Geometrie-Umbau.
- Karte/Trail: ein Gangwechsel zeichnet die Weglinie durch die Wand — so
  soll es sein (die Karte erzählt die Geschichte).

### 5. Superzapper

- Zerstört **alle aktiven Feinde im Sichtfeld**: gepurzelte/jagende Tanker,
  Flipper (jede Stellung), Spinner-Körper; **alle Feind-Schüsse** erlöschen
  sofort. NICHT: lauernde Tanker (Krone), Spikes, Pulsare.
- „Sichtfeld" (Vorschlag): Blickkegel der Kamera (±halbes fov) + freie
  Sichtlinie (`hasLineOfSight`), ohne Distanzgrenze.
- **Einer pro Leben** = pro Anlauf (Retry lädt neu, Resume von der Karte
  behält den Verbrauch). Später: Nachladen beim Level-Aufstieg.
- Effekt: die Feinde explodieren **von nah nach fern** mit ~80 ms Versatz
  (Zap-Warteschlange in playing: sofort entschärft, gestaffelt zerplatzt),
  weißer Blitz, neuer Zapper-Sound (patches.js).
- Taste: **Z oder Y** (Boris' Entscheid — deutsche und US-Tastatur haben
  die beiden vertauscht, so passt es überall; Cmd/Alt hätten Browser-Fallen,
  s.u.); Touch: eigener ZAP-Chip. Anzeige in der
  Steuer-Zeile solange verfügbar (`playHint`).
- Autopilot/Demo: darf zappen, wenn es eng wird (z.B. ≥ 3 Feinde im
  Sichtfeld) — zeigt die Mechanik im Attract-Mode her.

### 6. Level-Tabelle

- `flippers: {count}` entfällt (keine Einzel-Flipper); das Paar kommt aus
  jedem Tanker-Abschuss. `enemies` ab 11 = Alleys; `spinners` ab 16 immer
  feuernd; `pulsars` ab 26.
- `straight` in 11–15 von 0.6 auf ~0.75 anheben, damit genug lange Gänge
  („shooting alleys") entstehen. Farben unverändert.

## Stufenplan

### Stufe 0 — Branch + Plan + Level-Umbau
- Branch `sturm-feinde`, dieses Dokument, Fragen geklärt.
- Level-Tabelle (levels.js): Flipper-Platzierung raus, Paar-Regel immer,
  straight-Bias; Tests anpassen. Alles läuft weiter wie heute (nur ohne
  Einzel-Flipper).

### Stufe 1 — Tanker-Alleys
- `world/enemies.js` neu: Gruppen-Platzierung auf Gängen (foePlacement),
  Zustands-Automat lurk/drop/hunt, Auslöser, Jagd, Feuer (Spinner-Schuss-
  Form), Positionen (Krone/Gang), `enemySegments` mit Höhe + Skalierung.
- playing.js: Trigger + Schritt + Feuer, Paar bei jedem Abschuss,
  Autopilot-foes nur Jäger.
- 2026: Tanker auf der Krone (klein), Purzel-Animation, Jagd.
- Tests: Platzierung (Weg zuerst, tankerfrei um S/G, kein Gang doppelt),
  Purzel-Reihenfolge/Abstände, Auslöser nur in Blick-Halbebene, Jagd bleibt
  im Gang, Feuer nur im Duell, Paar bei jedem Treffer, Durchkommens-Test
  einer Alley mit Dauerfeuer (Autopilot-Duell).

### Stufe 2 — Flipper-Rettungsschuss
- flippers.js: Zwangs-Flip bei flipDist, Diagonal-Fenster, Abfeuer-
  Zeitstempel im Schuss (shots.js: `born`), `flipperShotHit` erweitert.
- Tests: Zwangs-Flip kommt immer vor dem Kontakt; Timing-Schuss trifft;
  Monte-Carlo Dauerfeuer in [0.3, 0.7]; Seitenschuss wie bisher.
- Autopilot: bleibt beim Seitenzielen (Diagonal-Kill ist die menschliche
  Reserve).

### Stufe 3 — Spinner-Wandern
- spinners.js: neues Modell (Spike wandverankert, Körper pendelt, step pro
  Vorlauf), Aktivierung per Ecken-BFS (`world/reach.js` pur: Knicke des
  eindeutigen Wegs), Verwundbarkeit (Spitze/freigekürzt), Schuss aus dem
  Körper, Spike überlebt den Spinner.
- Tests: Zyklus, Verwundbarkeit, Aktivierung (2 Ecken ja, 3 nein),
  Durchkommens-Garantie neu (mit/ohne Feuer, feuernder Spinner).
- 2026: Zeichnung aus den neuen Daten (Wendel ab Wand, Körper reitend).

### Stufe 4 — Pulsare: 360° + Wand-Phantome
- gyro.js: Betrag fest 360°. pulsars.js: `pulsarOpenings` (Zustand →
  Zellen + Alpha), Phase „zusammengezogen" als Fenster mit Flirren.
- mazeWorld.js/maze.js: `openings`-Overlay in den vier Lesern;
  `resolveWallOverlap`. playing: Overlay pro Frame, Rückdrücken beim
  Schließen, Sound.
- 2026: Shader-Ausschnitt mit Flirren (wallMat/lineMat/wallGridMat +
  Spiegel), Uniform-Liste der Loch-Boxen.
- Tests: Öffnungs-Muster (5/3+3/1, Außenwand nie, Gang-Ende weniger),
  Overlay-Durchfahrt (rectWalkable), Rückdrücken beide Seiten, Schüsse
  durch Phantome, Overlay weg nach exit.

### Stufe 5 — Superzapper
- `world/zapper.js` (pur): Sichtfeld-Auswahl (Kegel + Sichtlinie), Zap-
  Warteschlange nah→fern, betroffene Arten. playing: einmal pro Anlauf,
  Feind-Schüsse leeren, gestaffelte Bursts, Blitz; `game.zapper` für
  Resume. main.js: Meta/Alt/AltGraph/Z inkl. Fallen-Handling; touch.js/
  layout.js: ZAP-Chip; hud.js: Hinweis. Sound: zapPatch.
- 2026: Blitz (DOM) + Bursts; optional Lichtbogen-Linien zu den Opfern.
- Autopilot: Zap bei ≥ 3 Feinden im Sichtfeld, Demo-Test.
- Tests: Auswahl (Rücken/Wand/Lauerer/Spike/Pulsar ausgeschlossen),
  Reihenfolge nah→fern, einmal pro Anlauf, Resume behält, Retry lädt.

### Stufe 6 — Tuning + Doku
- Messläufe mit dem Autopiloten über 11–30 (Seeds), Konstanten nach
  „machbar, aber knapp" stellen; Sichtprüfung durch Boris.
- CLAUDE.md/README aktualisieren, 1980-Minimum prüfen (kein Absturz),
  Entscheidung Branch → main.

## Fallen und Notizen

- **Meta/Alt als Spieltaste (verworfen):** bei gehaltenem Cmd liefert
  macOS für andere Tasten KEINE keyup-Events (gehaltene Pfeile „kleben"),
  Cmd+Pfeil = Browser Zurück/Vor, Cmd+S = Sichern-Dialog; Windows: Alt
  allein fokussiert in manchen Browsern die Menüleiste, AltGr kommt als
  Ctrl+Alt(Graph). Darum Z/Y.
- **Phantom-Wände und die Geometrie-Caches:** `mergedOutline` (mazeWorld)
  und die 2026-Wandgeometrie hängen am unveränderlichen Grid — das Overlay
  ändert nur die Begehbarkeit, nie das Grid. Die 1980-Occlusion nutzt
  `wallFootprints` (Grid) → Phantome sind dort weiter Verdecker; egal, 1980
  ist zurückgestellt.
- **Rand-Zellen:** Öffnungen nur für Zellen mit 0 < x,y < n-1, und nur,
  wenn die Gegenseite eine offene Kammer ist.
- **Spinner-Aktivierung im Replay:** rein aus den Daten (`active`-Flag im
  Spinner), die Wiedergabe braucht keine BFS.
- **Recorder-Sample-Größe:** Tanker bekommen ein paar Felder mehr
  (mode, t, pos) — unkritisch (30 Hz, structuredClone).
- **Tanker auf der Krone und Near-Plane:** in Level 11+ ist die Wandhöhe
  1 Gangbreite (EYE_RATIO 0.5); die Krone ist ÜBER dem Auge — Lauerer
  sieht man von weitem; direkt darunter sind sie außerhalb des Bildes.
