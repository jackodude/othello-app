export type Player = 'black' | 'white';

export type Cell = Player | null;

export type Board = readonly (readonly Cell[])[];

export interface Position {
  readonly row: number;
  readonly col: number;
}

export type GameStatus = 'playing' | 'finished';

export interface Scores {
  readonly black: number;
  readonly white: number;
}

export interface GameState {
  readonly board: Board;
  readonly currentPlayer: Player;
  readonly status: GameStatus;
  readonly legalMoves: readonly Position[];
  readonly consecutivePasses: number;
}

export type GameResult = Player | 'draw';
