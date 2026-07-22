import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { Board } from './components/Board';
import { GameStatus } from './components/GameStatus';
import {
  DEFAULT_GAME_PREFERENCES,
  loadGamePreferences,
  saveGamePreferences,
  shouldShowVisualLegalMoves,
} from './hooks/gamePreferences';
import {
  isInstallDismissed,
  isIosLike,
  isStandaloneDisplay,
  recordInstallDismissal,
  shouldShowIosInstallGuidance,
} from './hooks/installPrompt';
import { getRelativeStatusMessage } from './hooks/gamePresentation';
import { shouldShowInvitationPanel, shouldShowLegalMoves } from './hooks/gameUiState';
import { useGame } from './hooks/useGame';
import './App.css';

interface BeforeInstallPromptEvent extends Event {
  readonly prompt: () => Promise<void>;
}

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
    recentPositions,
  } = useGame();
  const [joinCodeInput, setJoinCodeInput] = useState(() => joinCode ?? '');
  const [invitationInput, setInvitationInput] = useState('');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallHelpDismissed, setIsInstallHelpDismissed] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }

    return isInstallDismissed(window.localStorage, Date.now());
  });
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof navigator === 'undefined') {
      return true;
    }

    return navigator.onLine;
  });
  const [preferences, setPreferences] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_GAME_PREFERENCES;
    }

    return loadGamePreferences(window.localStorage);
  });

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      if (!isInstallDismissed(window.localStorage, Date.now())) {
        setInstallPrompt(event as BeforeInstallPromptEvent);
        setIsInstallHelpDismissed(false);
      }
    }

    function handleOnline() {
      setIsOnline(true);
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  function handleLoadSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadGame(joinCodeInput);
  }

  function handleJoinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void claimWhiteFromInvitation(invitationInput);
  }

  const showLegalMoves = shouldShowLegalMoves({
    isAuthenticated,
    opponentJoined,
    gameStatus: gameState.status,
    isYourTurn,
    isSubmittingMove,
    isLoading,
  });
  const boardDisabled = !showLegalMoves;
  const showVisualLegalMoves = shouldShowVisualLegalMoves(
    showLegalMoves,
    preferences,
  );
  const visibleRecentPositions = preferences.highlightLastMove
    ? recentPositions
    : [];

  function updatePreference<Key extends keyof typeof preferences>(
    key: Key,
    value: (typeof preferences)[Key],
  ) {
    setPreferences((currentPreferences) => {
      const nextPreferences = {
        ...currentPreferences,
        [key]: value,
      };
      saveGamePreferences(window.localStorage, nextPreferences);
      return nextPreferences;
    });
  }

  const statusMessage = getRelativeStatusMessage({
    gameStatus: gameState.status,
    result,
    playerColor,
    opponentJoined,
    isYourTurn,
  });

  async function handleCopyInvitation() {
    if (!invitation) {
      return;
    }

    try {
      await navigator.clipboard?.writeText(invitation);
      setCopyFeedback('Copied invitation');
      window.setTimeout(() => setCopyFeedback(null), 1800);
    } catch {
      setCopyFeedback('Copy failed');
    }
  }

  async function handleInstallClick() {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  function dismissInstallHelp() {
    recordInstallDismissal(window.localStorage, Date.now());
    setInstallPrompt(null);
    setIsInstallHelpDismissed(true);
  }

  const canUseNativeInstallPrompt = Boolean(installPrompt);
  const isStandalone = typeof window !== 'undefined'
    ? isStandaloneDisplay(navigator, window.matchMedia('(display-mode: standalone)'))
    : false;
  const showIosGuidance = typeof navigator !== 'undefined'
    ? shouldShowIosInstallGuidance({
        canUseNativePrompt: canUseNativeInstallPrompt,
        dismissed: isInstallHelpDismissed,
        isIos: isIosLike(navigator),
        isStandalone,
      })
    : false;

  return (
    <main className="app">
      <header className="header">
        <h1>Othello</h1>
        <p className="subtitle">Classic Reversi, shared by join code</p>
      </header>

      <details className="settings-panel">
        <summary>Settings</summary>
        <fieldset className="settings-panel__options">
          <legend>Game preferences</legend>
          <label className="settings-option">
            <input
              type="checkbox"
              checked={preferences.highlightLastMove}
              onChange={(event) =>
                updatePreference('highlightLastMove', event.target.checked)
              }
            />
            <span>Highlight last move</span>
          </label>
          <label className="settings-option">
            <input
              type="checkbox"
              checked={preferences.animateDiscChanges}
              onChange={(event) =>
                updatePreference('animateDiscChanges', event.target.checked)
              }
            />
            <span>Animate disc changes</span>
          </label>
          <label className="settings-option">
            <input
              type="checkbox"
              checked={preferences.showLegalMoveIndicators}
              onChange={(event) =>
                updatePreference('showLegalMoveIndicators', event.target.checked)
              }
            />
            <span>Show legal move indicators</span>
          </label>
        </fieldset>
      </details>

      {(canUseNativeInstallPrompt || showIosGuidance) && (
        <section className="install-panel" aria-label="Install Othello">
          <div>
            <strong>Install Othello</strong>
            <p>
              {canUseNativeInstallPrompt
                ? 'Add this game to your device for quicker access.'
                : 'On iPhone or iPad, use Share, then Add to Home Screen.'}
            </p>
          </div>
          <div className="install-panel__actions">
            {canUseNativeInstallPrompt && (
              <button
                type="button"
                className="load-game-button"
                onClick={() => void handleInstallClick()}
              >
                Install
              </button>
            )}
            <button type="button" className="load-game-button" onClick={dismissInstallHelp}>
              Not now
            </button>
          </div>
        </section>
      )}

      {!isOnline && (
        <div className="offline-warning" role="status">
          App shell is available offline. Live games need an internet connection.
        </div>
      )}

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
            <span>{statusMessage}</span>
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
              aria-label="Copy White invitation"
              onClick={() => void handleCopyInvitation()}
            >
              Copy
            </button>
          </div>
          {copyFeedback && (
            <span className="copy-feedback" role="status">
              {copyFeedback}
            </span>
          )}
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
            playerColor={playerColor}
            scores={scores}
            isFinished={gameState.status === 'finished'}
            result={result}
            consecutivePasses={gameState.consecutivePasses}
            statusMessage={statusMessage}
          />

          <Board
            board={gameState.board}
            legalMoves={gameState.legalMoves}
            currentPlayer={gameState.currentPlayer}
            onCellClick={playMove}
            disabled={boardDisabled}
            showLegalMoves={showLegalMoves}
            showLegalMoveIndicators={showVisualLegalMoves}
            recentPositions={visibleRecentPositions}
            animateChanges={preferences.animateDiscChanges}
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
