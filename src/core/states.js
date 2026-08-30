// Spielzustands-Automat als reine Daten + reine Funktion -> headless testbar.
// Die eigentliche Animation/Logik der Zustaende lebt in game.js und scenes/*,
// hier steht nur, welcher Zustand bei welchem Ereignis auf welchen folgt.

export const State = {
  STARTSCREEN: 'STARTSCREEN',   // schwarzer Bildschirm, "PRESS S TO START"
  MAZE_GEN: 'MAZE_GEN',         // Labyrinth wird erzeugt (Animation)
  FALLING: 'FALLING',           // Schwenk aus der Kartensicht in die Ego-Begehung
  PLAYING: 'PLAYING',           // Spielablauf
  RISING: 'RISING',             // Rueckschwenk aus der Begehung zur Kartensicht
  MAP: 'MAP',                   // Kartensicht mit abgelaufenem Weg (Q: weiter, X: Ende)
  REPLAY: 'REPLAY',             // Wiedergabe des aufgezeichneten Laufs (R auf der Karte)
};

export const GameEvent = {
  START: 'START',           // Spieler drueckt S im Startscreen (bzw. in der Demo)
  MAZE_READY: 'MAZE_READY', // Labyrinth-Erzeugung fertig -> Reinfallen
  FALL_DONE: 'FALL_DONE',   // Reinfall-Schwenk abgeschlossen -> Spielablauf
  EXIT: 'EXIT',             // Spiel verlassen (Q im Spiel, X auf der Karte/im Replay)
  RISE_DONE: 'RISE_DONE',   // Rueckschwenk abgeschlossen -> Kartensicht
  RESUME: 'RESUME',         // Q auf der Karte (Ziel noch offen) -> zurueck ins Labyrinth
  REPLAY: 'REPLAY',         // R auf der Karte -> Wiedergabe des Laufs
};

// Erlaubte Uebergaenge: State -> Event -> Folgestate.
// START auf Karte/MazeGen: der Attract-Mode (Demo) startet nach S das
// GEWAEHLTE Level direkt aus der laufenden Demo -- die Karten-Szene heilt
// die Flaeche zu und faengt das normale Fraesen an (MAZE_GEN -> MAZE_GEN
// ist ein bewusstes Re-Enter mit frischem Maze).
const TRANSITIONS = {
  [State.STARTSCREEN]: { [GameEvent.START]: State.MAZE_GEN },
  [State.MAZE_GEN]: {
    [GameEvent.MAZE_READY]: State.FALLING,
    [GameEvent.START]: State.MAZE_GEN,
  },
  [State.FALLING]: { [GameEvent.FALL_DONE]: State.PLAYING },
  [State.PLAYING]: { [GameEvent.EXIT]: State.RISING },
  [State.RISING]: { [GameEvent.RISE_DONE]: State.MAP },
  [State.MAP]: {
    [GameEvent.EXIT]: State.STARTSCREEN,
    [GameEvent.RESUME]: State.FALLING,
    [GameEvent.REPLAY]: State.REPLAY,
    [GameEvent.START]: State.MAZE_GEN,
  },
  [State.REPLAY]: { [GameEvent.EXIT]: State.MAP },
};

// Liefert den Folgezustand fuer (state, event) oder null, wenn der Uebergang
// in diesem Zustand nicht definiert ist (Ereignis wird dann ignoriert).
export function nextState(state, event) {
  return TRANSITIONS[state]?.[event] ?? null;
}
