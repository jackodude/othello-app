import type { Board, Cell, GameResult, GameStatus, Player, Position } from '../game';

interface StatusInput {
  readonly gameStatus: GameStatus;
  readonly result: GameResult | null;
  readonly playerColor: Player | null;
  readonly opponentJoined: boolean;
  readonly isYourTurn: boolean;
}

export interface LastMove {
  readonly version: number;
  readonly player: Player;
  readonly placedIndex: number;
  readonly flippedIndices: readonly number[];
}

interface AnimationEligibilityInput {
  readonly joinCode: string | null;
  readonly lastMove: LastMove | null;
  readonly currentVersion: number | null;
  readonly lastPresentedVersion: number | null;
}

interface StorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export const LAST_PRESENTED_MOVE_PREFIX = 'othello.presentedMoveVersion.';

export function getRelativeStatusMessage({
  gameStatus,
  result,
  playerColor,
  opponentJoined,
  isYourTurn,
}: StatusInput): string {
  if (gameStatus === 'finished') {
    if (result === 'draw') {
      return 'Draw';
    }
    if (result && playerColor) {
      return result === playerColor ? 'You win' : 'You lose';
    }
    return 'Game complete';
  }

  if (!opponentJoined) {
    return 'Waiting for opponent';
  }

  return isYourTurn ? 'Your turn' : "Opponent's turn";
}

export function getChangedPositions(
  previousBoard: Board | null,
  nextBoard: Board,
): Position[] {
  if (!previousBoard) {
    return [];
  }

  const changed: Position[] = [];

  for (let row = 0; row < nextBoard.length; row += 1) {
    for (let col = 0; col < nextBoard[row].length; col += 1) {
      if (previousBoard[row]?.[col] !== nextBoard[row][col]) {
        changed.push({ row, col });
      }
    }
  }

  return changed;
}

export function indexToPosition(index: number): Position | null {
  if (!Number.isInteger(index) || index < 0 || index >= 64) {
    return null;
  }

  return {
    row: Math.floor(index / 8),
    col: index % 8,
  };
}

export function positionToIndex(position: Position): number {
  return position.row * 8 + position.col;
}

export function getLastMovePositions(lastMove: LastMove | null): Position[] {
  if (!lastMove) {
    return [];
  }

  const positions = [lastMove.placedIndex, ...lastMove.flippedIndices]
    .map(indexToPosition)
    .filter((position): position is Position => position !== null);

  return positions;
}

export function getLastPresentedMoveKey(joinCode: string): string {
  return `${LAST_PRESENTED_MOVE_PREFIX}${joinCode.trim().toUpperCase()}`;
}

export function readLastPresentedMoveVersion(
  storage: Pick<StorageLike, 'getItem'>,
  joinCode: string,
): number | null {
  const storedValue = storage.getItem(getLastPresentedMoveKey(joinCode));
  if (!storedValue) {
    return null;
  }

  const parsedValue = Number(storedValue);
  return Number.isInteger(parsedValue) && parsedValue >= 1 ? parsedValue : null;
}

export function writeLastPresentedMoveVersion(
  storage: Pick<StorageLike, 'setItem'>,
  joinCode: string,
  version: number,
): void {
  storage.setItem(getLastPresentedMoveKey(joinCode), String(version));
}

export function shouldAnimateLastMove({
  joinCode,
  lastMove,
  currentVersion,
  lastPresentedVersion,
}: AnimationEligibilityInput): boolean {
  if (!joinCode || !lastMove || lastMove.version !== currentVersion) {
    return false;
  }

  return lastPresentedVersion === null || lastMove.version > lastPresentedVersion;
}

export function reconstructBoardBeforeLastMove(
  finalBoard: Board,
  lastMove: LastMove | null,
): Board | null {
  if (!lastMove) {
    return null;
  }

  const placedPosition = indexToPosition(lastMove.placedIndex);
  if (!placedPosition) {
    return null;
  }

  const previousPlayer: Cell = lastMove.player === 'black' ? 'white' : 'black';
  const board = finalBoard.map((row) => [...row]);
  board[placedPosition.row][placedPosition.col] = null;

  for (const index of lastMove.flippedIndices) {
    const position = indexToPosition(index);
    if (!position) {
      return null;
    }
    board[position.row][position.col] = previousPlayer;
  }

  return board;
}

export function isPositionListed(
  positions: readonly Position[],
  row: number,
  col: number,
): boolean {
  return positions.some((position) => position.row === row && position.col === col);
}
