export {
  applyMove,
  BOARD_SIZE,
  createInitialBoard,
  createInitialGameState,
  getAllFlips,
  getFlipsInDirection,
  getGameResult,
  getLegalMoves,
  getOpponent,
  getScores,
  isLegalMove,
  isLegalMovePosition,
  resolveTurnState,
} from './engine';

export type {
  Board,
  Cell,
  GameResult,
  GameState,
  Player,
  Position,
  Scores,
  GameStatus,
} from './types';
