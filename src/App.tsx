import { useCallback, useEffect, useRef, useState } from 'react';
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
  classifyPushProvider,
  formatPushProvider,
  getPushPermissionState,
  getStoredPushEndpoint,
  hasCompletePushSubscription,
  isPushSupported,
  removeStoredPushEndpoint,
  sanitizePushError,
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
  PLAYER_TOKEN_PREFIX,
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

interface PushRegistrationSummary {
  readonly successful: number;
  readonly attempted: number;
  readonly savedGameCount: number;
  readonly currentGameRegistered: boolean | null;
  readonly lastError: string | null;
}

interface PushDiagnostics {
  readonly hasBrowserSubscription: boolean;
  readonly providerLabel: string;
  readonly registeredCount: number;
  readonly attemptedCount: number;
  readonly savedGameCount: number;
  readonly currentGameRegistered: boolean | null;
  readonly lastError: string | null;
  readonly testResult: string | null;
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
    opponentJoined,
    isAuthenticated,
    isYourTurn,
    version,
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
    acknowledgeCurrentTurn,
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
  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>(() => {
      if (typeof Notification === 'undefined') {
        return 'default';
      }

      return Notification.permission;
    });
  const [isNotificationBusy, setIsNotificationBusy] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [pushDiagnostics, setPushDiagnostics] = useState<PushDiagnostics>({
    hasBrowserSubscription: false,
    providerLabel: 'Unknown',
    registeredCount: 0,
    attemptedCount: 0,
    savedGameCount: 0,
    currentGameRegistered: null,
    lastError: null,
    testResult: null,
  });
  const acknowledgedTurnRef = useRef<string | null>(null);
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

    function handleVisibilityChange() {
      setIsDocumentVisible(document.visibilityState === 'visible');
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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

  useEffect(() => {
    if (
      !joinCode ||
      version === null ||
      !isAuthenticated ||
      !opponentJoined ||
      gameState.status !== 'playing' ||
      !isYourTurn ||
      !isDocumentVisible
    ) {
      return;
    }

    const turnKey = `${joinCode}:${version}:${gameState.currentPlayer}`;
    if (acknowledgedTurnRef.current === turnKey) {
      return;
    }

    acknowledgedTurnRef.current = turnKey;
    void acknowledgeCurrentTurn();
  }, [
    acknowledgeCurrentTurn,
    gameState.currentPlayer,
    gameState.status,
    isAuthenticated,
    isDocumentVisible,
    isYourTurn,
    joinCode,
    opponentJoined,
    version,
  ]);

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
      : getStoredPushEndpoint(window.localStorage);
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

  const readSavedPlayerToken = useCallback((savedJoinCode: string): string | null => {
    return window.localStorage.getItem(
      `${PLAYER_TOKEN_PREFIX}${savedJoinCode.trim().toUpperCase()}`,
    );
  }, []);

  const registerSubscriptionForSavedGames = useCallback(async (
    subscriptionJson: PushSubscriptionJSON,
  ): Promise<PushRegistrationSummary> => {
    if (savedGames.length === 0) {
      return {
        successful: 0,
        attempted: 0,
        savedGameCount: 0,
        currentGameRegistered: null,
        lastError: null,
      };
    }

    const registrations = savedGames.map(async (savedGame) => {
      const savedPlayerToken = readSavedPlayerToken(savedGame.joinCode);
      if (!savedPlayerToken) {
        return { joinCode: savedGame.joinCode, ok: false, error: 'Missing saved credential.' };
      }

      try {
        const response = await fetch(
          `/api/games/${encodeURIComponent(savedGame.joinCode)}/push-subscriptions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${savedPlayerToken}`,
            },
            body: JSON.stringify(subscriptionJson),
          },
        );

        return {
          joinCode: savedGame.joinCode,
          ok: response.ok,
          error: response.ok ? null : `Registration failed with ${response.status}.`,
        };
      } catch (error) {
        return {
          joinCode: savedGame.joinCode,
          ok: false,
          error: sanitizePushError(error),
        };
      }
    });

    const results = await Promise.all(registrations);
    const selectedJoinCode = joinCode?.trim().toUpperCase() ?? null;
    const currentResult = selectedJoinCode
      ? results.find((result) => result.joinCode.trim().toUpperCase() === selectedJoinCode)
      : undefined;

    return {
      successful: results.filter((result) => result.ok).length,
      attempted: results.length,
      savedGameCount: savedGames.length,
      currentGameRegistered: currentResult ? currentResult.ok : null,
      lastError: results.find((result) => !result.ok)?.error ?? null,
    };
  }, [joinCode, readSavedPlayerToken, savedGames]);

  const unregisterSubscriptionForSavedGames = useCallback(async (
    subscriptionJson: PushSubscriptionJSON,
  ): Promise<void> => {
    await Promise.all(
      savedGames.map(async (savedGame) => {
        const savedPlayerToken = readSavedPlayerToken(savedGame.joinCode);
        if (!savedPlayerToken) {
          return;
        }

        await fetch(`/api/games/${encodeURIComponent(savedGame.joinCode)}/push-subscriptions`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${savedPlayerToken}`,
          },
          body: JSON.stringify(subscriptionJson),
        });
      }),
    );
  }, [readSavedPlayerToken, savedGames]);

  const updatePushDiagnostics = useCallback((
    subscription: PushSubscription | null,
    registrationSummary?: PushRegistrationSummary,
    updates?: Partial<Pick<PushDiagnostics, 'lastError' | 'testResult'>>,
  ) => {
    const endpoint = subscription?.endpoint ?? storedPushEndpoint;
    setPushDiagnostics((current) => ({
      ...current,
      hasBrowserSubscription: Boolean(subscription),
      providerLabel: formatPushProvider(classifyPushProvider(endpoint)),
      registeredCount: registrationSummary?.successful ?? current.registeredCount,
      attemptedCount: registrationSummary?.attempted ?? current.attemptedCount,
      savedGameCount: registrationSummary?.savedGameCount ?? savedGames.length,
      currentGameRegistered:
        registrationSummary?.currentGameRegistered ?? current.currentGameRegistered,
      lastError: updates?.lastError ?? registrationSummary?.lastError ?? current.lastError,
      testResult: updates?.testResult ?? current.testResult,
    }));
  }, [savedGames.length, storedPushEndpoint]);

  async function handleEnableNotifications() {
    if (!isPushSupported()) {
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
      const existingSubscription = await registration.pushManager.getSubscription();
      const subscription = existingSubscription ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(publicKey),
      });
      const subscriptionJson = subscription.toJSON();
      if (!hasCompletePushSubscription(subscriptionJson)) {
        setNotificationMessage('Unable to enable notifications.');
        updatePushDiagnostics(subscription, undefined, {
          lastError: 'Browser returned an incomplete push subscription.',
        });
        return;
      }

      const registrationSummary = await registerSubscriptionForSavedGames(subscriptionJson);
      storePushEndpoint(window.localStorage, subscription.endpoint);
      updatePushDiagnostics(subscription, registrationSummary, { lastError: null });
      setNotificationMessage(
        registrationSummary.savedGameCount > 0 &&
        registrationSummary.successful === 0
          ? 'Notifications are enabled in this browser, but no saved games were registered.'
          : 'Notifications enabled.',
      );
    } catch (error) {
      const message = sanitizePushError(error);
      updatePushDiagnostics(null, undefined, { lastError: message });
      setNotificationMessage('Unable to enable notifications.');
    } finally {
      setIsNotificationBusy(false);
    }
  }

  async function handleDisableNotifications() {
    if (!isPushSupported()) {
      return;
    }

    setIsNotificationBusy(true);
    setNotificationMessage(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await unregisterSubscriptionForSavedGames(subscription.toJSON());
        await subscription.unsubscribe();
      } else if (storedPushEndpoint) {
        await unregisterSubscriptionForSavedGames({
          endpoint: storedPushEndpoint,
          keys: { p256dh: 'unknown', auth: 'unknown' },
        });
      }

      removeStoredPushEndpoint(window.localStorage);
      updatePushDiagnostics(null, {
        successful: 0,
        attempted: 0,
        savedGameCount: savedGames.length,
        currentGameRegistered: null,
        lastError: null,
      }, { testResult: null });
      setNotificationMessage('Notifications disabled.');
    } catch (error) {
      updatePushDiagnostics(null, undefined, { lastError: sanitizePushError(error) });
      setNotificationMessage('Unable to disable notifications.');
    } finally {
      setIsNotificationBusy(false);
    }
  }

  async function handleSendTestNotification() {
    if (!isPushSupported()) {
      return;
    }

    setIsNotificationBusy(true);
    setNotificationMessage(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const subscriptionJson = subscription?.toJSON();
      if (!subscription || !hasCompletePushSubscription(subscriptionJson)) {
        setNotificationMessage('No active push subscription found.');
        updatePushDiagnostics(subscription ?? null, undefined, {
          lastError: 'No active push subscription found.',
        });
        return;
      }

      const preferredGame = joinCode
        ? savedGames.find(
            (savedGame) =>
              savedGame.joinCode.trim().toUpperCase() === joinCode.trim().toUpperCase(),
          )
        : undefined;
      const savedGame = preferredGame ?? savedGames.find(
        (candidate) => Boolean(readSavedPlayerToken(candidate.joinCode)),
      );
      if (!savedGame) {
        setNotificationMessage('Save or open a game before sending a test notification.');
        updatePushDiagnostics(subscription, undefined, {
          lastError: 'No saved game credential is available for a test notification.',
        });
        return;
      }

      const playerToken = readSavedPlayerToken(savedGame.joinCode);
      if (!playerToken) {
        setNotificationMessage('No saved credential is available for this game.');
        updatePushDiagnostics(subscription, undefined, {
          lastError: 'No saved credential is available for this game.',
        });
        return;
      }

      const response = await fetch('/api/push/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${playerToken}`,
        },
        body: JSON.stringify({
          joinCode: savedGame.joinCode,
          endpoint: subscription.endpoint,
        }),
      });
      const body = (await response.json()) as {
        readonly success?: boolean;
        readonly provider?: string;
        readonly httpStatus?: number | null;
        readonly permanentFailure?: boolean;
        readonly temporaryFailure?: boolean;
        readonly error?: string | null;
      };
      const resultMessage = body.success
        ? `Test notification accepted by ${body.provider ?? 'push service'}.`
        : `Test notification failed${
            body.httpStatus ? ` with HTTP ${body.httpStatus}` : ''
          }.`;
      updatePushDiagnostics(subscription, undefined, {
        testResult: resultMessage,
        lastError: body.success ? null : body.error ?? resultMessage,
      });
      setNotificationMessage(resultMessage);
    } catch (error) {
      const message = sanitizePushError(error);
      updatePushDiagnostics(null, undefined, { lastError: message });
      setNotificationMessage('Unable to send a test notification.');
    } finally {
      setIsNotificationBusy(false);
    }
  }

  useEffect(() => {
    if (notificationPermission !== 'granted' || !isPushSupported()) {
      return;
    }

    let isActive = true;

    async function syncGlobalSubscription() {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!isActive || !subscription) {
          if (isActive) {
            updatePushDiagnostics(null);
          }
          return;
        }

        const subscriptionJson = subscription.toJSON();
        if (!hasCompletePushSubscription(subscriptionJson)) {
          if (isActive) {
            updatePushDiagnostics(subscription, undefined, {
              lastError: 'Browser returned an incomplete push subscription.',
            });
          }
          return;
        }

        const registrationSummary = await registerSubscriptionForSavedGames(subscriptionJson);
        if (isActive) {
          storePushEndpoint(window.localStorage, subscription.endpoint);
          updatePushDiagnostics(subscription, registrationSummary);
        }
      } catch (error) {
        if (isActive) {
          updatePushDiagnostics(null, undefined, { lastError: sanitizePushError(error) });
        }
        // Keep gameplay and the saved preference intact; explicit settings actions report errors.
      }
    }

    void syncGlobalSubscription();

    return () => {
      isActive = false;
    };
  }, [notificationPermission, registerSubscriptionForSavedGames, updatePushDiagnostics]);

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

          <div className="notification-panel" aria-label="Push notifications">
            <div>
              <strong>Notifications</strong>
              <p>
                {pushState === 'unsupported'
                  ? 'This browser does not support web push notifications.'
                  : pushState === 'blocked'
                    ? 'Notifications are blocked in this browser.'
                    : pushState === 'enabled'
                      ? 'Push notifications are enabled for this device.'
                      : 'Enable push notifications.'}
              </p>
            </div>
            {pushState === 'enabled' ? (
              <div className="notification-panel__actions">
                <button
                  type="button"
                  className="load-game-button"
                  disabled={isNotificationBusy}
                  onClick={() => void handleSendTestNotification()}
                >
                  Send test
                </button>
                <button
                  type="button"
                  className="load-game-button"
                  disabled={isNotificationBusy}
                  onClick={() => void handleDisableNotifications()}
                >
                  Disable
                </button>
              </div>
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
            <dl className="notification-panel__diagnostics" aria-label="Notification diagnostics">
              <div>
                <dt>Browser subscription</dt>
                <dd>{pushDiagnostics.hasBrowserSubscription ? 'Found' : 'Not found'}</dd>
              </div>
              <div>
                <dt>Push service</dt>
                <dd>{pushDiagnostics.providerLabel}</dd>
              </div>
              <div>
                <dt>Registered games</dt>
                <dd>
                  {pushDiagnostics.registeredCount}/{pushDiagnostics.savedGameCount}
                  {pushDiagnostics.currentGameRegistered === null
                    ? ''
                    : pushDiagnostics.currentGameRegistered
                      ? ' (current game ready)'
                      : ' (current game not registered)'}
                </dd>
              </div>
              {pushDiagnostics.testResult && (
                <div>
                  <dt>Test</dt>
                  <dd>{pushDiagnostics.testResult}</dd>
                </div>
              )}
              {pushDiagnostics.lastError && (
                <div>
                  <dt>Last issue</dt>
                  <dd>{pushDiagnostics.lastError}</dd>
                </div>
              )}
            </dl>
          </div>
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
