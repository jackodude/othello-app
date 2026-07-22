import type {
  Board,
  Cell,
  GameResult,
  GameState,
  Player,
  Position,
  Scores,
} from './types';

export const BOARD_SIZE = 8;

const DIRECTIONS: readonly Position[] = [
  { row: -1, col: -1 },
  { row: -1, col: 0 },
  { row: -1, col: 1 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
];

export function getOpponent(player: Player): Player {
  return player === 'black' ? 'white' : 'black';
}

export function createInitialBoard(): Board {
  const emptyRow = (): Cell[] => Array.from({ length: BOARD_SIZE }, () => null);

  const board: Cell[][] = Array.from({ length: BOARD_SIZE }, emptyRow);

  board[3][3] = 'white';
  board[3][4] = 'black';
  board[4][3] = 'black';
  board[4][4] = 'white';

  return board;
}

function cloneBoard(board: Board): Cell[][] {
  return board.map((row) => [...row]);
}

function isInBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function positionsEqual(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

export function getFlipsInDirection(
  board: Board,
  move: Position,
  direction: Position,
  player: Player,
): Position[] {
  const opponent = getOpponent(player);
  const flips: Position[] = [];
  let row = move.row + direction.row;
  let col = move.col + direction.col;

  while (isInBounds(row, col) && board[row][col] === opponent) {
    flips.push({ row, col });
    row += direction.row;
    col += direction.col;
  }

  if (flips.length === 0 || !isInBounds(row, col) || board[row][col] !== player) {
    return [];
  }

  return flips;
}

export function getAllFlips(
  board: Board,
  move: Position,
  player: Player,
): Position[] {
  if (!isInBounds(move.row, move.col) || board[move.row][move.col] !== null) {
    return [];
  }

  const flipped = new Map<string, Position>();

  for (const direction of DIRECTIONS) {
    for (const position of getFlipsInDirection(board, move, direction, player)) {
      flipped.set(`${position.row},${position.col}`, position);
    }
  }

  return [...flipped.values()];
}

export function isLegalMove(
  board: Board,
  move: Position,
  player: Player,
): boolean {
  return getAllFlips(board, move, player).length > 0;
}

export function getLegalMoves(board: Board, player: Player): Position[] {
  const moves: Position[] = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const move = { row, col };
      if (isLegalMove(board, move, player)) {
        moves.push(move);
      }
    }
  }

  return moves;
}

function setCell(board: Cell[][], row: number, col: number, player: Player): void {
  board[row][col] = player;
}

export function getScores(board: Board): Scores {
  let black = 0;
  let white = 0;

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = board[row][col];
      if (cell === 'black') {
        black += 1;
      } else if (cell === 'white') {
        white += 1;
      }
    }
  }

  return { black, white };
}

export function getGameResult(scores: Scores): GameResult {
  if (scores.black > scores.white) {
    return 'black';
  }
  if (scores.white > scores.black) {
    return 'white';
  }
  return 'draw';
}

function buildGameState(
  board: Board,
  currentPlayer: Player,
  consecutivePasses: number,
): GameState {
  const legalMoves = getLegalMoves(board, currentPlayer);

  if (legalMoves.length > 0) {
    return {
      board,
      currentPlayer,
      status: 'playing',
      legalMoves,
      consecutivePasses,
    };
  }

  const nextConsecutivePasses = consecutivePasses + 1;

  if (nextConsecutivePasses >= 2) {
    return {
      board,
      currentPlayer,
      status: 'finished',
      legalMoves: [],
      consecutivePasses: nextConsecutivePasses,
    };
  }

  const opponent = getOpponent(currentPlayer);
  const opponentMoves = getLegalMoves(board, opponent);

  if (opponentMoves.length > 0) {
    return {
      board,
      currentPlayer: opponent,
      status: 'playing',
      legalMoves: opponentMoves,
      consecutivePasses: nextConsecutivePasses,
    };
  }

  return {
    board,
    currentPlayer: opponent,
    status: 'finished',
    legalMoves: [],
    consecutivePasses: nextConsecutivePasses,
  };
}

export function resolveTurnState(
  board: Board,
  currentPlayer: Player,
  consecutivePasses: number,
): GameState {
  return buildGameState(board, currentPlayer, consecutivePasses);
}

export function createInitialGameState(): GameState {
  const board = createInitialBoard();
  return resolveTurnState(board, 'black', 0);
}

export function applyMove(state: GameState, move: Position): GameState | null {
  if (state.status === 'finished') {
    return null;
  }

  const isListedMove = state.legalMoves.some((legalMove) =>
    positionsEqual(legalMove, move),
  );

  if (!isListedMove) {
    return null;
  }

  const flips = getAllFlips(state.board, move, state.currentPlayer);
  if (flips.length === 0) {
    return null;
  }

  const nextBoard = cloneBoard(state.board);
  setCell(nextBoard, move.row, move.col, state.currentPlayer);

  for (const flip of flips) {
    setCell(nextBoard, flip.row, flip.col, state.currentPlayer);
  }

  const nextPlayer = getOpponent(state.currentPlayer);
  return resolveTurnState(nextBoard, nextPlayer, 0);
}

export function isLegalMovePosition(
  legalMoves: readonly Position[],
  move: Position,
): boolean {
  return legalMoves.some((legalMove) => positionsEqual(legalMove, move));
}
