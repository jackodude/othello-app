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
import {
  getPushPermissionState,
  getStoredPushEndpoint,
  isPushSupported,
  removeStoredPushEndpoint,
  storePushEndpoint,
  urlBase64ToArrayBuffer,
  type PushPermissionState,
} from './hooks/pushNotifications';
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
    playerToken,
    opponentJoined,
    isAuthenticated,
    isYourTurn,
    scores,
    result,
    playMove,
    startNewGame,
    claimWhiteFromInvitation,
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
  const [invitationInput, setInvitationInput] = useState('');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>(() => {
      if (typeof Notification === 'undefined') {
        return 'default';
      }

      return Notification.permission;
    });
  const [isNotificationBusy, setIsNotificationBusy] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
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
  const storedPushEndpoint =
    typeof window === 'undefined'
      ? null
      : getStoredPushEndpoint(window.localStorage, joinCode ?? null);
  const pushState: PushPermissionState = getPushPermissionState({
    isSupported: typeof window !== 'undefined' && isPushSupported(),
    permission: notificationPermission,
    hasStoredEndpoint: Boolean(storedPushEndpoint),
  });

  async function readPushConfig(): Promise<string | null> {
    const response = await fetch('/api/push/public-key');
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as {
      readonly enabled?: boolean;
      readonly publicKey?: string | null;
    };

    return body.enabled && body.publicKey ? body.publicKey : null;
  }

  async function handleEnableNotifications() {
    if (!joinCode || !playerToken || !isPushSupported()) {
      return;
    }

    setIsNotificationBusy(true);
    setNotificationMessage(null);

    try {
      const publicKey = await readPushConfig();
      if (!publicKey) {
        setNotificationMessage('Notifications are not configured on this server.');
        return;
      }

      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== 'granted') {
        setNotificationMessage('Notifications are blocked for this browser.');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(publicKey),
      });

      const response = await fetch(
        `/api/games/${encodeURIComponent(joinCode)}/push-subscriptions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify(subscription.toJSON()),
        },
      );

      if (!response.ok) {
        await subscription.unsubscribe();
        setNotificationMessage('Unable to enable notifications.');
        return;
      }

      storePushEndpoint(window.localStorage, joinCode, subscription.endpoint);
      setNotificationMessage('Notifications enabled for this game.');
    } catch {
      setNotificationMessage('Unable to enable notifications.');
    } finally {
      setIsNotificationBusy(false);
    }
  }

  async function handleDisableNotifications() {
    if (!joinCode || !playerToken || !isPushSupported()) {
      return;
    }

    setIsNotificationBusy(true);
    setNotificationMessage(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch(`/api/games/${encodeURIComponent(joinCode)}/push-subscriptions`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify(subscription.toJSON()),
        });
        await subscription.unsubscribe();
      } else if (storedPushEndpoint) {
        await fetch(`/api/games/${encodeURIComponent(joinCode)}/push-subscriptions`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            endpoint: storedPushEndpoint,
            keys: { p256dh: 'unknown', auth: 'unknown' },
          }),
        });
      }

      removeStoredPushEndpoint(window.localStorage, joinCode);
      setNotificationMessage('Notifications disabled for this game.');
    } catch {
      setNotificationMessage('Unable to disable notifications.');
    } finally {
      setIsNotificationBusy(false);
    }
  }

  return (
    <main className="app">
      <header className="header">
        <h1>Othello</h1>
        <p className="subtitle">Classic Reversi for two players</p>
      </header>

      <div className="top-controls" aria-label="Game controls">
        <button
          type="button"
          className="settings-button"
          aria-label="Settings"
          aria-expanded={isSettingsOpen}
          aria-controls="settings-panel"
          onClick={() => setIsSettingsOpen((isOpen) => !isOpen)}
        >
          <span aria-hidden="true">&#9881;</span>
        </button>
        {hasSelectedGame && !showGameSelection && (
          <button type="button" className="load-game-button" onClick={switchGame}>
            Switch game
          </button>
        )}
      </div>

      {isSettingsOpen && (
        <section id="settings-panel" className="settings-panel" aria-label="Settings">
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

          {isAuthenticated && hasSelectedGame && (
            <div className="notification-panel" aria-label="Push notifications">
              <div>
                <strong>Notifications</strong>
                <p>
                  {pushState === 'unsupported'
                    ? 'This browser does not support web push notifications.'
                    : pushState === 'blocked'
                      ? 'Notifications are blocked in this browser.'
                      : pushState === 'enabled'
                        ? 'Enabled for opponent moves and game updates.'
                        : 'Get notified when it is your turn.'}
                </p>
              </div>
              {pushState === 'enabled' ? (
                <button
                  type="button"
                  className="load-game-button"
                  disabled={isNotificationBusy}
                  onClick={() => void handleDisableNotifications()}
                >
                  Disable
                </button>
              ) : (
                <button
                  type="button"
                  className="load-game-button"
                  disabled={isNotificationBusy || pushState === 'unsupported' || pushState === 'blocked'}
                  onClick={() => void handleEnableNotifications()}
                >
                  Enable
                </button>
              )}
              {notificationMessage && (
                <span className="notification-panel__message" role="status">
                  {notificationMessage}
                </span>
              )}
            </div>
          )}
        </section>
      )}

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

      {(isLoading || !hasSelectedGame) && (
        <div className="connection-status" aria-live="polite">
          {isLoading ? 'Loading game...' : 'No game selected'}
        </div>
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
            isSubmittingMove={isSubmittingMove}
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
          <p>Start a new game or paste an invitation.</p>
        </section>
      )}
    </main>
  );
}

export default App;
