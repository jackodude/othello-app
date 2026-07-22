import { useState } from 'react';
import type { FormEvent } from 'react';

import { Board } from './components/Board';
import { GameStatus } from './components/GameStatus';
import { useGame } from './hooks/useGame';
import './App.css';

function App() {
  const {
    gameState,
    joinCode,
    version,
    scores,
    result,
    playMove,
    startNewGame,
    loadGame,
    hasSelectedGame,
    isLoading,
    isSubmittingMove,
    errorMessage,
    errorKind,
    syncWarningMessage,
  } = useGame();
  const [joinCodeInput, setJoinCodeInput] = useState(() => joinCode ?? '');

  function handleJoinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadGame(joinCodeInput);
  }

  const boardDisabled =
    !hasSelectedGame ||
    isLoading ||
    isSubmittingMove ||
    gameState.status === 'finished';

  return (
    <main className="app">
      <header className="header">
        <h1>Othello</h1>
        <p className="subtitle">Classic Reversi, shared by join code</p>
      </header>

      <section className="game-controls" aria-label="Game selection">
        <button
          type="button"
          className="new-game-button"
          onClick={startNewGame}
          disabled={isLoading}
        >
          {isLoading && !hasSelectedGame ? 'Loading...' : 'New Game'}
        </button>

        <form className="join-form" onSubmit={handleJoinSubmit}>
          <label className="join-form__label" htmlFor="join-code">
            Join code
          </label>
          <div className="join-form__row">
            <input
              id="join-code"
              className="join-form__input"
              value={joinCodeInput}
              onChange={(event) => setJoinCodeInput(event.target.value.toUpperCase())}
              maxLength={6}
              autoComplete="off"
              spellCheck={false}
              disabled={isLoading}
            />
            <button type="submit" className="load-game-button" disabled={isLoading}>
              Load
            </button>
          </div>
        </form>
      </section>

      <div className="connection-status" aria-live="polite">
        {isLoading
          ? 'Loading game...'
          : hasSelectedGame
            ? `Code ${joinCode} - Version ${version ?? '-'}`
            : 'No game selected'}
      </div>

      {isSubmittingMove && (
        <div className="connection-status" aria-live="polite">
          Submitting move...
        </div>
      )}

      {syncWarningMessage && (
        <div className="sync-warning" role="status">
          {syncWarningMessage}
        </div>
      )}

      {errorMessage && (
        <p
          className={[
            'error-message',
            errorKind === 'not-found' ? 'error-message--not-found' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="alert"
        >
          {errorMessage}
        </p>
      )}

      {hasSelectedGame ? (
        <>
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
            disabled={boardDisabled}
          />
        </>
      ) : (
        <section className="empty-state" aria-live="polite">
          <h2>No game selected</h2>
          <p>Create a new game or load one with a join code.</p>
        </section>
      )}
    </main>
  );
}

export default App;
