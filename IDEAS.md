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

## Aufgeschobene Punkte aus dem Gesamt-Review (28.8.2026, REVIEW.md A7)

Beim Review notiert, bewusst NICHT umgesetzt (erst bei gemessenem Bedarf):

- **Tanker als InstancedMesh (2026):** groesster Draw-Call-Posten der
  Ego-Ansicht -- 4 Calls pro Tanker (Body + Kanten, x2 Spiegel), Level 15
  mit 14 Tankern = 56 Calls nur fuer Tanker. Puls/Drehen/Schweben als
  per-Instanz-Matrix: ein Call pro Material statt pro Feind. Gehoert in
  den Stufe-6-Performance-Pass (Draw-Call-Zaehler aus proto2026 ernten).
- **GC-Kleinvieh 1980 (kein CPU-Problem, Messwerte oben sind gut):**
  occludeEdge allokiert eine invEAt-Closure + 2-4 Arrays pro Kante/Frame;
  playing.render klont pro Frame vier Feindlisten per filter; die
  Stern-Schleife erzeugt ~500 Kleinst-Arrays + eine Map pro Frame;
  `dirs`-Objekt pro update. Erst anfassen, wenn GC-Pausen messbar sind.
- **updateTrail (2026) tauscht die Geometrie bei jedem neuen Wegpunkt** --
  mit Max-Kapazitaet (Weglaenge waechst monoton) + setDrawRange loesbar,
  lohnt erst bei sehr langen Wegen.

Bereits umgesetzt aus dem Review: mergedOutline-Cache (Schwenks bauten
die Wand-Geometrie jeden Frame komplett neu -- jetzt 0.33 ms/Frame bei
n=51 statt Vollscan), makeBuffer im Backend (kein Material-/Geometrie-
Churn), viewState 1x pro Frame, Growth-Puffer waechst statt zu tauschen.
