import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

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
import {
  filterSavedGameCards,
  deriveRematchInboxItems,
  deriveMatchStats,
  getLibraryStatusLabel,
  isCompletedGame,
  readGameLibraryFilter,
  writeGameLibraryFilter,
  type GameLibraryFilter,
} from './hooks/gameLibrary';
import {
  shouldShowCancelAction,
  shouldShowInvitationPanel,
  shouldShowForfeitAction,
  shouldShowLegalMoves,
  shouldShowRematchButton,
  shouldShowSkipToEndButton,
} from './hooks/gameUiState';
import {
  loadPlayerProfile,
  normalizeDisplayName,
  savePlayerProfile,
} from './hooks/playerProfile';
import { INVITATION_COPY_LABEL } from './hooks/invitationUi';
import { useGame } from './hooks/useGame';
import './App.css';

interface BeforeInstallPromptEvent extends Event {
  readonly prompt: () => Promise<void>;
}

function App() {
  const [preferences, setPreferences] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_GAME_PREFERENCES;
    }

    return loadGamePreferences(window.localStorage);
  });
  const [playerProfile, setPlayerProfile] = useState(() => {
    if (typeof window === 'undefined') {
      return { displayName: null };
    }

    return loadPlayerProfile(window.localStorage);
  });
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileNameInput, setProfileNameInput] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return false;
    }

    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  const {
    gameState,
    joinCode,
    invitation,
    playerColor,
    opponentName,
    playerToken,
    opponentJoined,
    isAuthenticated,
    isYourTurn,
    scores,
    result,
    playMove,
    startNewGame,
    createRematch,
    acceptRematch,
    acceptRematchFromParent,
    forfeitCurrentGame,
    cancelCurrentGame,
    skipToEnd,
    claimWhiteFromInvitation,
    switchGame,
    loadGame,
    removeSavedGameFromHistory,
    syncDisplayNameToSavedGames,
    hasSelectedGame,
    showGameSelection,
    isLoading,
    isSubmittingMove,
    isCreatingRematch,
    acceptingRematchParentCode,
    isForfeiting,
    isSkippingToEnd,
    areTestControlsEnabled,
    savedGames,
    isLoadingSavedGames,
    errorMessage,
    errorKind,
    syncWarningMessage,
    recentPositions,
    animationPhase,
    lastMove,
    endedReason,
    forfeitedBy,
    rematch,
    isAnimatingMove,
  } = useGame({
    animateMoves: preferences.animateDiscChanges && !prefersReducedMotion,
    displayName: playerProfile.displayName,
  });
  const [invitationInput, setInvitationInput] = useState('');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [forfeitTarget, setForfeitTarget] = useState<{
    readonly joinCode: string;
    readonly opponentName: string | null;
    readonly kind: 'forfeit' | 'cancel';
  } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{
    readonly joinCode: string;
    readonly opponentName: string | null;
  } | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<GameLibraryFilter>(() =>
    typeof window === 'undefined'
      ? 'in-progress'
      : readGameLibraryFilter(window.localStorage),
  );
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

  useEffect(() => {
    if (!window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    function handleMotionPreferenceChange() {
      setPrefersReducedMotion(mediaQuery.matches);
    }

    mediaQuery.addEventListener('change', handleMotionPreferenceChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMotionPreferenceChange);
    };
  }, []);

  function handleJoinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void claimWhiteFromInvitation(invitationInput);
  }

  function openProfileModal() {
    setProfileNameInput(playerProfile.displayName ?? '');
    setProfileError(null);
    setIsProfileModalOpen(true);
  }

  function closeProfileModal() {
    setIsProfileModalOpen(false);
    setProfileError(null);
    window.setTimeout(() => profileButtonRef.current?.focus(), 0);
  }

  function handleProfileModalKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      closeProfileModal();
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = normalizeDisplayName(profileNameInput);
    if (!displayName) {
      setProfileError('Enter a display name of 24 characters or fewer.');
      return;
    }

    const nextProfile = { displayName };
    setPlayerProfile(nextProfile);
    savePlayerProfile(window.localStorage, nextProfile);
    closeProfileModal();
    await syncDisplayNameToSavedGames(displayName);
  }

  const showLegalMoves = shouldShowLegalMoves({
    isAuthenticated,
    opponentJoined,
    gameStatus: gameState.status,
    isYourTurn,
    isSubmittingMove: isSubmittingMove || isSkippingToEnd,
    isLoading,
  });
  const boardDisabled = !showLegalMoves || isAnimatingMove;
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
    opponentName,
    endedReason,
    forfeitedBy,
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

  function handleSkipToEnd() {
    if (!window.confirm('Finish this game immediately for testing?')) {
      return;
    }

    void skipToEnd();
  }

  function handleSavedGameSelect(savedJoinCode: string) {
    void loadGame(savedJoinCode);
  }

  function openForfeitConfirmation(target: {
    readonly joinCode: string;
    readonly opponentName: string | null;
    readonly kind: 'forfeit' | 'cancel';
  }) {
    setForfeitTarget(target);
  }

  function closeForfeitConfirmation() {
    if (!isForfeiting) {
      setForfeitTarget(null);
    }
  }

  async function confirmForfeit() {
    if (!forfeitTarget || isForfeiting) {
      return;
    }

    if (forfeitTarget.kind === 'cancel') {
      await cancelCurrentGame(forfeitTarget.joinCode);
    } else {
      await forfeitCurrentGame(forfeitTarget.joinCode);
    }
    setForfeitTarget(null);
  }

  function handleForfeitModalKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      closeForfeitConfirmation();
    }
  }

  function closeRemoveConfirmation() {
    setRemoveTarget(null);
  }

  function confirmRemoveFromHistory() {
    if (!removeTarget) {
      return;
    }

    removeSavedGameFromHistory(removeTarget.joinCode);
    setRemoveTarget(null);
  }

  function handleRemoveModalKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      closeRemoveConfirmation();
    }
  }

  const canForfeitActiveGame = shouldShowForfeitAction({
    isAuthenticated,
    opponentJoined,
    gameStatus: gameState.status,
    isTerminalActionInFlight: isCreatingRematch || isSkippingToEnd || isForfeiting,
  });
  const canCancelActiveGame = shouldShowCancelAction({
    isAuthenticated,
    playerColor,
    opponentJoined,
    gameStatus: gameState.status,
    isTerminalActionInFlight: isCreatingRematch || isSkippingToEnd || isForfeiting,
  });
  const filteredSavedGames = filterSavedGameCards(savedGames, libraryFilter);
  const rematchInboxItems = deriveRematchInboxItems(savedGames);
  const matchStats = deriveMatchStats(savedGames);

  function updateLibraryFilter(nextFilter: GameLibraryFilter) {
    setLibraryFilter(nextFilter);
    writeGameLibraryFilter(window.localStorage, nextFilter);
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
          <button
            type="button"
            className="load-game-button"
            aria-label="Home"
            onClick={switchGame}
          >
            Home
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

          <div className="profile-settings">
            <div>
              <strong>Player Profile</strong>
              <p>{playerProfile.displayName ?? 'Not set'}</p>
            </div>
            <button
              ref={profileButtonRef}
              type="button"
              className="load-game-button"
              onClick={openProfileModal}
            >
              Edit profile
            </button>
          </div>

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

      {isProfileModalOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onKeyDown={handleProfileModalKeyDown}
        >
          <div
            className="profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-modal-title"
          >
            <form className="profile-form" onSubmit={(event) => void handleProfileSubmit(event)}>
              <h2 id="profile-modal-title">Edit profile</h2>
              <label className="join-form__label" htmlFor="display-name">
                Display name
              </label>
              <input
                id="display-name"
                className="token-input"
                value={profileNameInput}
                maxLength={24}
                autoFocus
                onChange={(event) => setProfileNameInput(event.target.value)}
              />
              {profileError && (
                <p className="profile-form__error" role="alert">
                  {profileError}
                </p>
              )}
              <div className="profile-form__actions">
                <button type="button" className="load-game-button" onClick={closeProfileModal}>
                  Cancel
                </button>
                <button type="submit" className="new-game-button">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {forfeitTarget && (
        <div
          className="modal-backdrop"
          role="presentation"
          onKeyDown={handleForfeitModalKeyDown}
        >
          <div
            className="profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="forfeit-modal-title"
          >
            <div className="profile-form">
              <h2 id="forfeit-modal-title">
                {forfeitTarget.kind === 'cancel'
                  ? 'Cancel this game?'
                  : 'Forfeit this game?'}
              </h2>
              {forfeitTarget.kind === 'cancel' ? (
                <p className="modal-copy">
                  This invitation will stop working and the game will be moved to
                  your completed games. This cannot be undone.
                </p>
              ) : (
                <p className="modal-copy">
                  You will lose this game and{' '}
                  {forfeitTarget.opponentName || 'your opponent'} will be declared
                  the winner. This cannot be undone.
                </p>
              )}
              <div className="profile-form__actions">
                <button
                  type="button"
                  className="load-game-button"
                  disabled={isForfeiting}
                  onClick={closeForfeitConfirmation}
                >
                  {forfeitTarget.kind === 'cancel' ? 'Keep game' : 'Keep playing'}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={isForfeiting}
                  onClick={() => void confirmForfeit()}
                >
                  {isForfeiting
                    ? forfeitTarget.kind === 'cancel'
                      ? 'Cancelling...'
                      : 'Forfeiting...'
                    : forfeitTarget.kind === 'cancel'
                      ? 'Cancel game'
                      : 'Forfeit game'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {removeTarget && (
        <div
          className="modal-backdrop"
          role="presentation"
          onKeyDown={handleRemoveModalKeyDown}
        >
          <div
            className="profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-modal-title"
          >
            <div className="profile-form">
              <h2 id="remove-modal-title">Remove this game?</h2>
              <p className="modal-copy">
                This removes the game from your history on this device. It will not
                remove it for the other player.
              </p>
              <div className="profile-form__actions">
                <button
                  type="button"
                  className="load-game-button"
                  onClick={closeRemoveConfirmation}
                >
                  Keep game
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={confirmRemoveFromHistory}
                >
                  Remove game
                </button>
              </div>
            </div>
          </div>
        </div>
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
          <section className="join-panel" aria-label="Join game">
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
                  placeholder="Enter invite code"
                  disabled={isLoading}
                />
                <button type="submit" className="load-game-button" disabled={isLoading}>
                  Join
                </button>
              </div>
            </form>
          </section>

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

          <section className="match-stats" aria-label="Match stats">
            <h2>Match stats</h2>
            {matchStats.lastCompletedMatch ? (
              <>
                <div className="match-stats__section">
                  <h3>Last completed match</h3>
                  <dl className="match-stats__details">
                    <div>
                      <dt>Opponent</dt>
                      <dd>{matchStats.lastCompletedMatch.opponentName}</dd>
                    </div>
                    <div>
                      <dt>Result</dt>
                      <dd>
                        {matchStats.lastCompletedMatch.result === 'win'
                          ? 'You won'
                          : matchStats.lastCompletedMatch.result === 'loss'
                            ? 'You lost'
                            : 'Draw'}
                      </dd>
                    </div>
                    <div>
                      <dt>Final score</dt>
                      <dd>{matchStats.lastCompletedMatch.finalScore}</dd>
                    </div>
                    <div>
                      <dt>Finished</dt>
                      <dd>{matchStats.lastCompletedMatch.finishedDate}</dd>
                    </div>
                  </dl>
                </div>
                <div className="match-stats__section">
                  <h3>Overall record</h3>
                  <dl className="match-stats__record">
                    <div>
                      <dt>Games played</dt>
                      <dd>{matchStats.gamesPlayed}</dd>
                    </div>
                    <div>
                      <dt>Wins</dt>
                      <dd>{matchStats.wins}</dd>
                    </div>
                    <div>
                      <dt>Losses</dt>
                      <dd>{matchStats.losses}</dd>
                    </div>
                    <div>
                      <dt>Win percentage</dt>
                      <dd>{matchStats.winPercentage}%</dd>
                    </div>
                  </dl>
                </div>
              </>
            ) : (
              <div className="match-stats__empty">
                <p>No completed games yet.</p>
                <p>Finish your first game to start building your record.</p>
              </div>
            )}
          </section>

          {rematchInboxItems.length > 0 && (
            <section className="rematch-inbox" aria-label="Pending rematches">
              <div className="rematch-inbox__header">
                <h2>Rematches</h2>
              </div>
              <div className="rematch-inbox__list">
                {rematchInboxItems.map((item) => (
                  <article
                    key={`${item.parentCode}:${item.childCode}`}
                    className="rematch-card"
                  >
                    <div>
                      <h3>
                        {item.requiresAcceptance
                          ? `${item.opponentName} wants to play again`
                          : `Waiting for ${item.opponentName} to accept`}
                      </h3>
                      <p>
                        {item.requiresAcceptance
                          ? 'Accept to enter the new game.'
                          : 'The rematch is ready when they accept.'}
                      </p>
                    </div>
                    {item.requiresAcceptance && (
                      <button
                        type="button"
                        className="new-game-button rematch-card__accept"
                        disabled={acceptingRematchParentCode === item.parentCode}
                        onClick={() => void acceptRematchFromParent(item.parentCode)}
                      >
                        {acceptingRematchParentCode === item.parentCode
                          ? 'Accepting...'
                          : 'Accept'}
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="game-library" aria-label="Saved games">
            <div className="game-library__header">
              <h2>Your games</h2>
              {isLoadingSavedGames && <span>Refreshing...</span>}
            </div>
            <div className="library-filter" role="tablist" aria-label="Game filter">
              {[
                ['in-progress', 'In progress'],
                ['completed', 'Completed'],
                ['all', 'All'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={libraryFilter === value}
                  className={libraryFilter === value ? 'library-filter__tab--active' : ''}
                  onClick={() => updateLibraryFilter(value as GameLibraryFilter)}
                >
                  {label}
                </button>
              ))}
            </div>
            {filteredSavedGames.length > 0 ? (
              <div className="game-library__list">
                {filteredSavedGames.map((savedGame) => (
                  <div
                    key={savedGame.joinCode}
                    className={[
                      'game-card',
                      savedGame.joinCode === joinCode ? 'game-card--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <button
                      type="button"
                      className="game-card__select"
                      onClick={() => handleSavedGameSelect(savedGame.joinCode)}
                    >
                      <span className="game-card__opponent">
                        {savedGame.opponentName || 'Opponent'}
                      </span>
                      <span className="game-card__status">
                        {getLibraryStatusLabel(savedGame)}
                      </span>
                      <span className="game-card__meta">
                        You are {savedGame.playerColor === 'black' ? 'Black' : 'White'}
                        {' - '}
                        {savedGame.progress}%
                      </span>
                    </button>
                    {shouldShowCancelAction({
                      isAuthenticated: true,
                      playerColor: savedGame.playerColor,
                      opponentJoined: savedGame.opponentJoined,
                      gameStatus: savedGame.state.status,
                      isTerminalActionInFlight: isForfeiting,
                    }) && (
                      <button
                        type="button"
                        className="game-card__action"
                        aria-label="Cancel game invitation"
                        title="Cancel game"
                        onClick={(event) => {
                          event.stopPropagation();
                          openForfeitConfirmation({
                            joinCode: savedGame.joinCode,
                            opponentName: savedGame.opponentName,
                            kind: 'cancel',
                          });
                        }}
                      >
                        Cancel
                      </button>
                    )}
                    {shouldShowForfeitAction({
                      isAuthenticated: true,
                      opponentJoined: savedGame.opponentJoined,
                      gameStatus: savedGame.state.status,
                      isTerminalActionInFlight: isForfeiting,
                    }) && (
                      <button
                        type="button"
                        className="game-card__action"
                        aria-label={`Forfeit game against ${savedGame.opponentName || 'Opponent'}`}
                        title="Forfeit game"
                        onClick={(event) => {
                          event.stopPropagation();
                          openForfeitConfirmation({
                            joinCode: savedGame.joinCode,
                            opponentName: savedGame.opponentName,
                            kind: 'forfeit',
                          });
                        }}
                      >
                        Forfeit
                      </button>
                    )}
                    {isCompletedGame(savedGame) && (
                      <button
                        type="button"
                        className="game-card__remove"
                        aria-label={`Remove game against ${savedGame.opponentName || 'Opponent'} from history`}
                        title="Remove from history"
                        onClick={(event) => {
                          event.stopPropagation();
                          setRemoveTarget({
                            joinCode: savedGame.joinCode,
                            opponentName: savedGame.opponentName,
                          });
                        }}
                      >
                        <span aria-hidden="true">🗑</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="game-library__empty">
                {libraryFilter === 'completed'
                  ? 'No completed games yet.'
                  : libraryFilter === 'all'
                    ? 'No saved games on this device.'
                    : 'No games in progress.'}
              </p>
            )}
          </section>
        </>
      )}

      {isLoading && (
        <div className="connection-status" aria-live="polite">
          Loading game...
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
              className="new-game-button invitation-box__copy"
              aria-label={INVITATION_COPY_LABEL}
              onClick={() => void handleCopyInvitation()}
            >
              {INVITATION_COPY_LABEL}
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
            opponentName={opponentName}
          />

          {shouldShowRematchButton(isAuthenticated, gameState.status) && (
            <div className="rematch-action">
              {rematch?.waiting && rematch.requestedBy !== playerColor ? (
                <button
                  type="button"
                  className="new-game-button"
                  disabled={isCreatingRematch || acceptingRematchParentCode === joinCode}
                  onClick={() => {
                    if (joinCode) {
                      void acceptRematchFromParent(joinCode);
                    } else {
                      void acceptRematch();
                    }
                  }}
                >
                  {isCreatingRematch || acceptingRematchParentCode === joinCode
                    ? 'Joining rematch...'
                    : 'Accept rematch'}
                </button>
              ) : rematch?.waiting && rematch.requestedBy === playerColor ? (
                <div className="connection-status" role="status">
                  Waiting for {opponentName || 'opponent'}
                </div>
              ) : (
                <button
                  type="button"
                  className="new-game-button"
                  disabled={isCreatingRematch || endedReason === 'cancelled'}
                  onClick={() => void createRematch()}
                >
                  {isCreatingRematch ? 'Creating rematch...' : 'Play Again'}
                </button>
              )}
            </div>
          )}

          {canCancelActiveGame && joinCode && (
            <button
              type="button"
              className="danger-button danger-button--secondary"
              disabled={isForfeiting}
              onClick={() =>
                openForfeitConfirmation({
                  joinCode,
                  opponentName,
                  kind: 'cancel',
                })
              }
            >
              Cancel game
            </button>
          )}

          {canForfeitActiveGame && joinCode && (
            <button
              type="button"
              className="danger-button danger-button--secondary"
              disabled={isForfeiting}
              onClick={() =>
                openForfeitConfirmation({
                  joinCode,
                  opponentName,
                  kind: 'forfeit',
                })
              }
            >
              Forfeit game
            </button>
          )}

          {shouldShowSkipToEndButton({
            testControlsEnabled: areTestControlsEnabled,
            isAuthenticated,
            gameStatus: gameState.status,
          }) && (
            <button
              type="button"
              className="test-control-button"
              disabled={isSkippingToEnd}
              onClick={handleSkipToEnd}
            >
              {isSkippingToEnd ? 'Finishing game...' : 'Skip to end'}
            </button>
          )}

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
            animationPhase={animationPhase}
            lastMove={lastMove}
          />
        </>
      ) : null}
    </main>
  );
}

export default App;
