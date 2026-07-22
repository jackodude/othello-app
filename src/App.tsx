import { useState } from 'react';
import type { FormEvent } from 'react';

import { Board } from './components/Board';
import { GameStatus } from './components/GameStatus';
import { shouldShowInvitationPanel, shouldShowLegalMoves } from './hooks/gameUiState';
import { useGame } from './hooks/useGame';
import './App.css';

function App() {
  const {
    gameState,
    joinCode,
    invitation,
    playerColor,
    opponentJoined,
    isAuthenticated,
    isYourTurn,
    version,
    scores,
    result,
    playMove,
    startNewGame,
    loadGame,
    claimWhiteFromInvitation,
    clearCredential,
    switchGame,
    hasSelectedGame,
    showGameSelection,
    isLoading,
    isSubmittingMove,
    errorMessage,
    errorKind,
    syncWarningMessage,
  } = useGame();
  const [joinCodeInput, setJoinCodeInput] = useState(() => joinCode ?? '');
  const [invitationInput, setInvitationInput] = useState('');

  function handleLoadSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadGame(joinCodeInput);
  }

  function handleJoinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void claimWhiteFromInvitation(invitationInput);
  }

  const isActiveGame = gameState.status !== 'finished';
  const showLegalMoves = shouldShowLegalMoves({
    isAuthenticated,
    opponentJoined,
    gameStatus: gameState.status,
    isYourTurn,
    isSubmittingMove,
    isLoading,
  });
  const boardDisabled = !showLegalMoves;

  const turnMessage = !hasSelectedGame
    ? null
    : !isActiveGame
      ? 'Game complete'
      : !opponentJoined
        ? 'Waiting for opponent to join'
        : isYourTurn
          ? 'Your turn'
          : "Opponent's turn";

  return (
    <main className="app">
      <header className="header">
        <h1>Othello</h1>
        <p className="subtitle">Classic Reversi, shared by join code</p>
      </header>

      {showGameSelection && (
        <>
          <section className="game-controls" aria-label="Game selection">
            <button
              type="button"
              className="new-game-button"
              onClick={startNewGame}
              disabled={isLoading}
            >
              {isLoading ? 'Loading...' : 'New Game'}
            </button>

            <form className="join-form" onSubmit={handleLoadSubmit}>
              <label className="join-form__label" htmlFor="join-code">
                Load saved game by join code
              </label>
              <div className="join-form__row">
                <input
                  id="join-code"
                  className="join-form__input"
                  value={joinCodeInput}
                  onChange={(event) =>
                    setJoinCodeInput(event.target.value.toUpperCase())
                  }
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

          <section className="join-panel" aria-label="Join as White">
            <form className="join-form" onSubmit={handleJoinSubmit}>
              <label className="join-form__label" htmlFor="invitation">
                Paste invitation
              </label>
              <div className="join-form__row">
                <input
                  id="invitation"
                  className="token-input"
                  value={invitationInput}
                  onChange={(event) => setInvitationInput(event.target.value)}
                  placeholder="CODE:INVITE_TOKEN"
                  disabled={isLoading}
                />
                <button type="submit" className="load-game-button" disabled={isLoading}>
                  Join as White
                </button>
              </div>
            </form>
          </section>
        </>
      )}

      <div className="connection-status" aria-live="polite">
        {isLoading
          ? 'Loading game...'
          : hasSelectedGame
            ? `Code ${joinCode} - Version ${version ?? '-'}`
            : 'No game selected'}
      </div>

      {hasSelectedGame && (
        <section className="identity-panel" aria-label="Player identity">
          <div className="identity-panel__summary">
            <strong>
              {playerColor ? `You are ${playerColor === 'black' ? 'Black' : 'White'}` : 'No player identity'}
            </strong>
            {turnMessage && <span>{turnMessage}</span>}
          </div>
          <button type="button" className="load-game-button" onClick={switchGame}>
            Switch game
          </button>
          {errorKind === 'unauthorized' && (
            <button type="button" className="load-game-button" onClick={clearCredential}>
              Remove saved credential
            </button>
          )}
        </section>
      )}

      {shouldShowInvitationPanel({ playerColor, opponentJoined, invitation }) && (
        <section className="invitation-panel" aria-label="Invitation for White">
          <div>
            <strong>White invitation</strong>
            <p>Share this one-time invitation so White can claim the game.</p>
          </div>
          <div className="invitation-box">
            <span>{invitation}</span>
            <button
              type="button"
              className="load-game-button"
              onClick={() => invitation && void navigator.clipboard?.writeText(invitation)}
            >
              Copy
            </button>
          </div>
        </section>
      )}

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
            errorKind === 'unauthorized' ? 'error-message--unauthorized' : '',
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
            showLegalMoves={showLegalMoves}
          />
        </>
      ) : (
        <section className="empty-state" aria-live="polite">
          <h2>No game selected</h2>
          <p>Create a new game, resume with a saved credential, or claim White.</p>
        </section>
      )}
    </main>
  );
}

export default App;
