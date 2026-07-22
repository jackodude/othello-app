import type { Cell, Player, Position } from '../game';
import {
  indexToPosition,
  isPositionListed,
  type LastMove,
} from '../hooks/gamePresentation';

interface BoardProps {
  board: readonly (readonly Cell[])[];
  legalMoves: readonly Position[];
  currentPlayer: Player;
  onCellClick: (position: Position) => void;
  disabled: boolean;
  showLegalMoves: boolean;
  showLegalMoveIndicators: boolean;
  recentPositions: readonly Position[];
  animateChanges: boolean;
  animationPhase: 'idle' | 'placing' | 'flipping';
  lastMove: LastMove | null;
}

function isLegalMoveAt(
  legalMoves: readonly Position[],
  row: number,
  col: number,
): boolean {
  return legalMoves.some((move) => move.row === row && move.col === col);
}

export function Board({
  board,
  legalMoves,
  currentPlayer,
  onCellClick,
  disabled,
  showLegalMoves,
  showLegalMoveIndicators,
  recentPositions,
  animateChanges,
  animationPhase,
  lastMove,
}: BoardProps) {
  const placedPosition = lastMove ? indexToPosition(lastMove.placedIndex) : null;
  const flippedPositions =
    lastMove?.flippedIndices
      .map(indexToPosition)
      .filter((position): position is Position => position !== null) ?? [];

  return (
    <div className="board" role="grid" aria-label="Othello board">
      {board.map((row, rowIndex) =>
        row.map((cell, colIndex) => {
          const isPlayableLegalMove =
            showLegalMoves && isLegalMoveAt(legalMoves, rowIndex, colIndex);
          const shouldShowLegalHint =
            showLegalMoveIndicators && isPlayableLegalMove;
          const isRecent = isPositionListed(recentPositions, rowIndex, colIndex);
          const isPlacedDisc =
            placedPosition?.row === rowIndex && placedPosition.col === colIndex;
          const isFlippedDisc = isPositionListed(flippedPositions, rowIndex, colIndex);
          const shouldAnimatePlacement =
            animateChanges && animationPhase === 'flipping' && isPlacedDisc;
          const shouldAnimateFlip =
            animateChanges && animationPhase === 'flipping' && isFlippedDisc;
          const cellLabel = cell
            ? `${cell} disc${isRecent ? ', changed on the last move' : ''}`
            : isPlayableLegalMove
              ? `Empty square, legal move for ${currentPlayer}`
              : 'Empty square';

          return (
            <button
              key={`${rowIndex}-${colIndex}`}
              type="button"
              className={[
                'cell',
                cell ? `cell--${cell}` : '',
                isPlayableLegalMove ? 'cell--legal' : '',
                shouldShowLegalHint ? 'cell--hinted' : '',
                isRecent ? 'cell--recent' : '',
                animateChanges && isRecent ? 'cell--animated' : '',
                shouldAnimatePlacement ? 'cell--placing' : '',
                shouldAnimateFlip ? 'cell--flipping' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              role="gridcell"
              aria-label={cellLabel}
              disabled={disabled || !isPlayableLegalMove}
              onClick={() => onCellClick({ row: rowIndex, col: colIndex })}
            >
              {cell && (
                <span
                  className={[
                    'disc',
                    `disc--${cell}`,
                    isRecent ? 'disc--recent' : '',
                    animateChanges && isRecent ? 'disc--animated' : '',
                    shouldAnimatePlacement ? 'disc--placing' : '',
                    shouldAnimateFlip ? 'disc--flipping' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-hidden="true"
                />
              )}
              {!cell && shouldShowLegalHint && (
                <span
                  className={`hint hint--${currentPlayer}`}
                  aria-hidden="true"
                />
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}
