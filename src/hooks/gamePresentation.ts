import type { Board, GameResult, GameStatus, Player, Position } from '../game';

interface StatusInput {
  readonly gameStatus: GameStatus;
  readonly result: GameResult | null;
  readonly playerColor: Player | null;
  readonly opponentJoined: boolean;
  readonly isYourTurn: boolean;
}

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

export function isPositionListed(
  positions: readonly Position[],
  row: number,
  col: number,
): boolean {
  return positions.some((position) => position.row === row && position.col === col);
}
