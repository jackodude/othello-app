import type { Cell, Player, Position } from '../game';

interface BoardProps {
  board: readonly (readonly Cell[])[];
  legalMoves: readonly Position[];
  currentPlayer: Player;
  onCellClick: (position: Position) => void;
  disabled: boolean;
  showLegalMoves: boolean;
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
}: BoardProps) {
  return (
    <div className="board" role="grid" aria-label="Othello board">
      {board.map((row, rowIndex) =>
        row.map((cell, colIndex) => {
          const isLegal = showLegalMoves && isLegalMoveAt(legalMoves, rowIndex, colIndex);
          const cellLabel = cell
            ? `${cell} disc`
            : isLegal
              ? `Empty square, legal move for ${currentPlayer}`
              : 'Empty square';

          return (
            <button
              key={`${rowIndex}-${colIndex}`}
              type="button"
              className={[
                'cell',
                cell ? `cell--${cell}` : '',
                isLegal ? 'cell--legal' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              role="gridcell"
              aria-label={cellLabel}
              disabled={disabled || !isLegal}
              onClick={() => onCellClick({ row: rowIndex, col: colIndex })}
            >
              {cell && <span className={`disc disc--${cell}`} aria-hidden="true" />}
              {!cell && isLegal && (
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
