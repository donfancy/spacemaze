# SPACE MAZE

Ein 3D-Vektorlabyrinth im Browser, im Stil der frühen 80er-Atari-Arcade-Automaten
(Battlezone, Tempest, Star Wars) — grüner Phosphor-Look, alles nur Linien.
Plain Vanilla JavaScript, 2D-Canvas, selbstgerechnetes 3D.

## Starten

```bash
node server.js        # oder: npm start
```

Dann im Browser öffnen:

- Spiel:       http://localhost:3001/
- Debug-Modus: http://localhost:3001/?debug

Der Dev-Server (Port 3001) ist ein winziger statischer Datei-Server ohne
Abhängigkeiten und lädt die ES-Module direkt — kein Build-Schritt nötig.

## Tests

```bash
npm test
```

Nutzt den eingebauten `node:test`-Runner (keine externen Dependencies).

## Steuerung (aktueller Stand)

- Startbildschirm: `↑/↓/←/→` Level wählen (1–15), `S` startet (Andock-Flug an den Würfel)
- Im Labyrinth (Ego-Ansicht, Tank-Steuerung, Level 1–5): `↑/W` vor, `↓/S` zurück,
  `←/A`/`→/D` drehen, `Q` Rückschwenk zur Karte (am Ziel automatisch nach 20 s);
  Anfahren, Bremsen und Drehen laufen über Beschleunigungs-Rampen
- `M` schaltet den Sound stumm/laut (alles synthetisch per Web Audio: leises
  Fahrgeräusch, dumpfer Bump an der Wand, ab Level 6 Motor + Kurven-Sirren und
  elektrisches Brutzeln bei Kollisionen, Drei-Ton-Fanfare am Ziel; dazu ein
  „Nagen" beim Labyrinth-Wachstum, Whoosh-Gleittöne beim Reinfallen
  (abwärts) und Rausschweben (aufwärts), ein dezenter Tick bei der Level-Wahl
  (Tonhöhe steigt mit dem Level) und ein leiser Schwebe-Whoosh beim
  An-/Abdock-Flug; ab Level 11 Pew-Schüsse, Verpuffen, Abschuss-Boom und
  der Game-Over-Crash)
- Ab Level 6 Fahrt-Modus: automatischer Vortrieb, nur `←/→` lenken; Kurven
  neigen die Kamera, Wandkontakt federt seitlich ab (die Fahrt geht weiter,
  ohne Gegenlenken schlägt man weiter vorne wieder ein) — mit Kollisionswellen
  auf der Wand und mechanischem Kamera-Nachschwingen
- Das Ziel ist ein Boden-Quadrat (das Zielfeld, um 1/4 eingerückt — erst darin
  gilt das Ziel als erreicht), auf dessen Kante flimmernde Lichtsäulen
  entlangwandern und in den Himmel strahlen: hinter Mauern gedimmt
  durchscheinend, oberhalb der Wand-Sichtlinie frei — so strahlt das Ziel von
  weitem hoch; beim Erreichen blitzen alle Säulen weiß auf und erlöschen
- Ab Level 11 Kampf-Modus: das Labyrinth wird größer und hat (per Generator-Bias)
  längere gerade Gangstücke; darin schweben pulsierende **rote Rauten** —
  Berührung ist ein krachendes GAME OVER, das den Spieler zur Karte
  hinausschleudert (dort `Q` = neuer Versuch). `Space` feuert (Dauerfeuer
  erlaubt, aber wie bei Tempest: max. 8 Schuss gleichzeitig unterwegs);
  die weißen rotierenden Projektil-Sterne verpuffen an Wänden, Treffer lassen
  Rauten in Splitter zerplatzen. Ein Fadenkreuz zeigt die Zielrichtung: bei
  Geradeausflug exakt die Blickrichtung, beim Lenken schlägt es weiter aus
  als die Flugbahn. Ab Level 13 patrouilliert ein wachsender Teil der Rauten
  seinen Gang auf und ab
- Auf der Karte: lebende Rauten erscheinen als kleine rote Kreuze; `Q`
  weiterspielen (fällt zurück an die Spielerlage, solange das
  Ziel offen ist; nach GAME OVER: Neustart des Levels vom Start), `X` beenden
  (nach 5 min automatisch) — die Karte blendet aus und die Kamera fliegt
  symmetrisch zum Start zurück in den Orbit

## Architektur

Strikte Trennung **Berechnung ↔ Rendering**, damit alles Rechnerische headless
testbar ist und Refactoring sicher bleibt:

```
src/
  math/
    vec3.js        Vektor-Mathematik (rein, getestet)
    camera.js      6-DOF-Kamera + optionale freie Basis, worldToView (rein, getestet)
    quat.js        Quaternionen: Slerp fuer die Schwenks (rein, getestet)
    oscillator.js  gedaempfter Oszillator: Kamera-Schwingungen (rein, getestet)
  render/
    projection.js  3D→2D-Projektion + Near-Clipping (rein, getestet)
    occlusion.js   analytische Hidden-Line-Bestimmung via Wand-Grundrisse (getestet)
    glyphs.js      eckiger Monospace-Vektorfont als Liniendaten (getestet)
    vectorText.js  Text-Layout → Polylinien in Pixeln (rein, getestet)
    compass.js     Kompass-Rose als Liniendaten (rein, getestet)
    sway.js        Bildraum-Schwenk: Kurvenneigung/Schwingung ohne Kamera-Roll (getestet)
    renderer.js    EINZIGER Canvas-berührender Teil (Phosphor-Glow)
  world/
    maze.js        Labyrinth-Generator (DFS-Backtracker, seedbar, getestet)
    mazeGeometry.js  Korridor-Konturen, Wandzug-Zusammenfassung, Wachstum (getestet)
    metric.js      Achsen-Metrik: ungleiche Zellbreiten → schmale Wände (getestet)
    mazeWorld.js   begehbare Welt: Wände, Kollision (Spieler-Quadrat), getestet
    drive.js       Fahr-Dynamik ab Level 6: Auto-Vortrieb, Abfedern (getestet)
    walk.js        Geh-Kinetik Level 1–5: Rampen + Kollisions-Flanke (getestet)
    enemies.js     rote Rauten ab Level 11: Platzierung, Patrouillen, Treffer (getestet)
    shots.js       Schießen à la Tempest: max 8 unterwegs, Zielrichtung, Verpuffen (getestet)
    burst.js       Splitter-Explosionen (Verpuffen bis Game-Over-Crash, getestet)
    waves.js       Kollisionswellen auf der Wandfläche (getestet)
    goal.js        Ziel-Zone (eingerückt) + Leuchtfeuer: Quadrat, Strahlen (getestet)
    cubeFaces.js   Würfel-Seitenflächen als Andock-Ziele + Grid-Mapping (getestet)
    cameraPaths.js Kamera-Choreografie: Orbit, An-/Abdocken (getestet)
    visibility.js  Kantenklassifikation für den Drahtwürfel (getestet)
    shapes.js      Welt-Geometrie-Erzeuger: Würfel, Gitter (rein, getestet)
    trail.js       präzise Weg-Aufzeichnung (getestet)
  core/
    states.js      Zustands-Automat als reine Funktion (getestet)
    levels.js      Level 1–15 als reine Daten: Maze-Größe n, Metrik, Fahr-Modus,
                   Geraden-Bias, Feinde, Schießen
    game.js        Orchestrierung + animierte Übergänge
  scenes/
    startscreen.js Orbit um den Drahtwürfel, Level-Wahl, An-/Abdock-Flug
    mazegen.js     Labyrinth wächst auf der Andock-Fläche
    falling.js     Schwenk aus der Kartensicht in die Ego-Begehung
    playing.js     Ego-Begehung mit Hidden Lines und Kompass
    rising.js      Rückschwenk zur Kartensicht (Wände schrumpfen)
    map.js         Kartensicht mit abgelaufenem Weg; X blendet aus → Abdocken
    mazeView.js    gemeinsamer Flächen-Renderer (Posen, Overlay, Hidden Lines)
  sound/
    patches.js     Klänge als reine Daten: Bump, Brutzeln, Fanfare, Motor,
                   Schuss/Verpuffen/Abschuss/Crash (getestet)
    audio.js       EINZIGER Web-Audio-berührender Teil (Patches → Knoten, Motor-Stimmen)
  util/
    rng.js         seedbarer Zufall (getestet)
  debug/
    debugConsole.js  Live-Werte + Log (per ?debug eingeblendet)
  main.js          Browser-Entry: Canvas, Eingabe, requestAnimationFrame-Loop

test/              node:test Unit- & Integrationstests
server.js          statischer Dev-Server (Port 3001)
public/            index.html + style.css
```

### Grundkonzept

Jeder Zustand hat (a) eine 3D-Szene, die durch die 6-DOF-Kamera projiziert wird,
und (b) ein **fixes 2D-Text-Overlay** (kameraunabhängig). Gerendert wird immer
voll: Canvas löschen, alles neu zeichnen, im `requestAnimationFrame`-Takt.

Zustände (der komplette Zyklus läuft):

```
STARTSCREEN → MAZE_GEN → FALLING → PLAYING → RISING → MAP → STARTSCREEN
                              ↑ (Q: RESUME, solange das Ziel offen ist) ↲
```

Die Übergänge sind nahtlos inszeniert (Andock-/Abdock-Flug, Rein-/Rausschwenk
per Quaternion-Slerp); nur wo nötig wird über Schwarz geblendet. Die gesamte
Begehung spielt AUF der gewählten Würfelseite — Schlüssel dafür sind die freie
Kamera-Oben-Richtung (`camera.basis`), `faceLocalToWorld` und `scenes/mazeView.js`.

## Deployment (später)

Für den Cloud-Server bündeln wir alle Module + HTML zu einer einzigen
`.html`-Datei. Bis dahin entwickeln wir modular über den Dev-Server.
