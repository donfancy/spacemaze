// Spielzustands-Automat als reine Daten + reine Funktion -> headless testbar.
// Die eigentliche Animation/Logik der Zustaende lebt in game.js und scenes/*,
// hier steht nur, welcher Zustand bei welchem Ereignis auf welchen folgt.

export const State = {
  STARTSCREEN: 'STARTSCREEN',   // schwarzer Bildschirm, "PRESS S TO START"
  MAZE_GEN: 'MAZE_GEN',         // Labyrinth wird erzeugt (Animation)
  FALLING: 'FALLING',           // Schwenk aus der Kartensicht in die Ego-Begehung
  PLAYING: 'PLAYING',           // Spielablauf
};

export const GameEvent = {
  START: 'START',           // Spieler drueckt S im Startscreen
  MAZE_READY: 'MAZE_READY', // Labyrinth-Erzeugung fertig -> Reinfallen
  FALL_DONE: 'FALL_DONE',   // Reinfall-Schwenk abgeschlossen -> Spielablauf
  EXIT: 'EXIT',             // Spiel verlassen -> zurueck zum Startscreen
};

// Erlaubte Uebergaenge: State -> Event -> Folgestate.
const TRANSITIONS = {
  [State.STARTSCREEN]: { [GameEvent.START]: State.MAZE_GEN },
  [State.MAZE_GEN]: { [GameEvent.MAZE_READY]: State.FALLING },
  [State.FALLING]: { [GameEvent.FALL_DONE]: State.PLAYING },
  [State.PLAYING]: { [GameEvent.EXIT]: State.STARTSCREEN },
};

// Liefert den Folgezustand fuer (state, event) oder null, wenn der Uebergang
// in diesem Zustand nicht definiert ist (Ereignis wird dann ignoriert).
export function nextState(state, event) {
  return TRANSITIONS[state]?.[event] ?? null;
}

export function isValidState(state) {
  return Object.values(State).includes(state);
}
