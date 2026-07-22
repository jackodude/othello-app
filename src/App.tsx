import { Board } from './components/Board';
import { GameStatus } from './components/GameStatus';
import { useGame } from './hooks/useGame';
import './App.css';

function App() {
  const {
    gameState,
    version,
    scores,
    result,
    playMove,
    startNewGame,
    isLoading,
    isSubmittingMove,
    errorMessage,
  } = useGame();

  return (
    <main className="app">
      <header className="header">
        <h1>Othello</h1>
        <p className="subtitle">Classic Reversi, served by the Worker</p>
      </header>

      <div className="connection-status" aria-live="polite">
        {isLoading ? 'Loading game...' : `Game version ${version ?? '-'}`}
      </div>

      {errorMessage && (
        <p className="error-message" role="alert">
          {errorMessage}
        </p>
      )}

      <GameStatus
        currentPlayer={gameState.currentPlayer}
        scores={scores}
        isFinished={gameState.status === 'finished'}
        result={result}
        consecutivePasses={gameState.consecutivePasses}
      />

      <Board
        board={gameState.board}
        legalMoves={gameState.legalMoves}
        currentPlayer={gameState.currentPlayer}
        onCellClick={playMove}
        disabled={isLoading || isSubmittingMove || gameState.status === 'finished'}
      />

      <button
        type="button"
        className="new-game-button"
        onClick={startNewGame}
        disabled={isLoading}
      >
        {isLoading ? 'Loading...' : 'New Game'}
      </button>
    </main>
  );
}

export default App;
