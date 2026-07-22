import { Board } from './components/Board';
import { GameStatus } from './components/GameStatus';
import { useGame } from './hooks/useGame';
import './App.css';

function App() {
  const { gameState, scores, result, playMove, startNewGame } = useGame();

  return (
    <main className="app">
      <header className="header">
        <h1>Othello</h1>
        <p className="subtitle">Classic Reversi — play locally on one device</p>
      </header>

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
        disabled={gameState.status === 'finished'}
      />

      <button type="button" className="new-game-button" onClick={startNewGame}>
        New Game
      </button>
    </main>
  );
}

export default App;
