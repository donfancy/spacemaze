# Ideen-Liste (wenn es mal noetig wird)

Aufgeschoben, nicht vergessen — mit Kontext, damit der Einstieg spaeter leicht faellt.

## Performance: Occlusion-Pass fuer sehr grosse Levels (n > 50)

Stand 7.7.2026, nach dem Zusammenfassen kollinearer Wandzuege (`mergeCollinear`)
und dem Stroke-Batching der Ziel-Strahlen. Headless gemessen (Occlusion-Pass =
`projectOccluders` + `occludeEdge` ueber alle Wandkanten, eine Ego-Pose):

| Maze  | vorher  | nachher |
|-------|---------|---------|
| n=25  | 2.1 ms  | 0.8 ms  |
| n=51  | 11 ms   | 2.8 ms  |
| n=99  | bis 301 ms | bis 52 ms |

Fuer Levels bis ~50 reicht das. Wenn die 99 kommen, in dieser Reihenfolge:

1. **Eine Verdeckungs-Rechnung pro Wandzug statt pro Kante.** Unterkante,
   Oberkante und alle Pfosten eines Zuges haben identische xz-Lage — die
   azimutale Verdeckung (occludeEdge) ist fuer alle DIESELBE. Heute wird sie
   pro Kante neu gerechnet. Die verdeckten t-Intervalle einmal pro Zug
   bestimmen und auf Unter-/Oberkante anwenden; Pfosten sind Punktauswertungen
   der Intervalle. Erwartung: Faktor ~3–4 im Occlusion-Pass.

2. **Screen-x-Bucketing der Verdecker.** `occludeEdge` scannt ALLE Verdecker
   linear, obwohl die meisten den x-Bereich der Kante gar nicht ueberlappen.
   Die projizierten Spans einmal pro Frame nach Bildschirm-x sortieren oder in
   Buckets legen und pro Kante nur Ueberlapper testen: aus O(Kanten x
   Verdecker) wird ~O((Kanten + Verdecker) * log). Das erledigt auch den
   Worst-Case (Blick eine lange offene Flucht entlang, viele sichtbare Kanten).

Danach, falls immer noch noetig: GC-Druck senken (pro Frame entstehen viele
kurzlebige Arrays in occludeEdge/faceSegments — Puffer wiederverwenden);
Wellen-Strokes wie die Strahlen buendeln; Glow-Kosten am dpr festmachen
(shadowBlur skaliert mit Pixelflaeche).
