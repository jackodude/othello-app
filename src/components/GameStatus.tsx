import type { GameResult, Player, Scores } from '../game';

interface GameStatusProps {
  currentPlayer: Player;
  scores: Scores;
  isFinished: boolean;
  result: GameResult | null;
  consecutivePasses: number;
}

function formatPlayerName(player: Player): string {
  return player === 'black' ? 'Black' : 'White';
}

function formatResult(result: GameResult): string {
  if (result === 'draw') {
    return 'Draw';
  }

  return `${formatPlayerName(result)} wins`;
}

export function GameStatus({
  currentPlayer,
  scores,
  isFinished,
  result,
  consecutivePasses,
}: GameStatusProps) {
  const statusMessage = isFinished
    ? result
      ? formatResult(result)
      : 'Game over'
    : consecutivePasses > 0
      ? `${formatPlayerName(currentPlayer)} to move (opponent passed)`
      : `${formatPlayerName(currentPlayer)} to move`;

  return (
    <section className="status" aria-live="polite">
      <div className="scoreboard">
        <div className="score score--black">
          <span className="score__disc" aria-hidden="true" />
          <span className="score__label">Black</span>
          <span className="score__value">{scores.black}</span>
        </div>
        <div className="score score--white">
          <span className="score__disc" aria-hidden="true" />
          <span className="score__label">White</span>
          <span className="score__value">{scores.white}</span>
        </div>
      </div>
      <p className={`turn turn--${isFinished ? 'finished' : currentPlayer}`}>
        {statusMessage}
      </p>
    </section>
  );
}
