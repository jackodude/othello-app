import { useCallback, useEffect, useRef, useState } from 'react';

import { createInitialGameState, getGameResult, getScores } from '../game';
import type { GameState, Player, Position } from '../game';
import {
  addSavedJoinCode,
  orderSavedGameCards,
  readSavedJoinCodes,
  removeSavedGameFromDevice,
  type SavedGameCard,
} from './gameLibrary';
import { createGamePoller } from './gamePolling';
import {
  getLastMovePositions,
  readLastPresentedMoveVersion,
  reconstructBoardBeforeLastMove,
  shouldAnimateLastMove,
  writeLastPresentedMoveVersion,
  type LastMove,
} from './gamePresentation';
import { parseInvitation } from './invitation';

interface GameRecord {
  readonly id: string;
  readonly joinCode: string;
  readonly state: GameState;
  readonly version: number;
  readonly lastMove: LastMove | null;
  readonly playerColor?: Player;
  readonly opponentJoined: boolean;
  readonly playerToken?: string;
  readonly invitation?: string;
  readonly playerName?: string | null;
  readonly opponentName?: string | null;
  readonly players?: {
    readonly black: { readonly name: string | null };
    readonly white: { readonly name: string | null };
  };
  readonly winner?: Player | 'draw' | null;
  readonly endedReason?: 'normal' | 'forfeit' | 'cancelled';
  readonly forfeitedBy?: Player | null;
  readonly rematch?: {
    readonly joinCode: string;
    readonly requestedBy: Player;
    readonly requestedAt?: string | null;
    readonly waiting: boolean;
    readonly accepted: boolean;
  } | null;
}

type GameErrorKind = 'not-found' | 'unauthorized' | 'api';

const SELECTED_JOIN_CODE_KEY = 'othello.selectedJoinCode';
const PLAYER_TOKEN_PREFIX = 'othello.playerToken.';
const INVITATION_PREFIX = 'othello.invitation.';
const POLL_INTERVAL_MS = 2000;
const PLACEMENT_MS = 140;
const MOVE_ANIMATION_MS = 620;

interface UseGameOptions {
  readonly animateMoves: boolean;
  readonly displayName?: string | null;
}

function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase();
}

function playerTokenKey(joinCode: string): string {
  return `${PLAYER_TOKEN_PREFIX}${normalizeJoinCode(joinCode)}`;
}

function invitationKey(joinCode: string): string {
  return `${INVITATION_PREFIX}${normalizeJoinCode(joinCode)}`;
}

function readStoredJoinCode(): string | null {
  const queryCode =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('game');
  const storedCode = queryCode || localStorage.getItem(SELECTED_JOIN_CODE_KEY);
  const normalizedCode = storedCode ? normalizeJoinCode(storedCode) : '';

  return normalizedCode || null;
}

function storeJoinCode(joinCode: string): void {
  localStorage.setItem(SELECTED_JOIN_CODE_KEY, normalizeJoinCode(joinCode));
}

function readStoredPlayerToken(joinCode: string): string | null {
  return localStorage.getItem(playerTokenKey(joinCode));
}

function storePlayerToken(joinCode: string, playerToken: string): void {
  localStorage.setItem(playerTokenKey(joinCode), playerToken);
}

function readStoredInvitation(joinCode: string): string | null {
  return localStorage.getItem(invitationKey(joinCode));
}

function storeInvitation(joinCode: string, invitation: string): void {
  localStorage.setItem(invitationKey(joinCode), invitation);
}

function removeStoredPlayerToken(joinCode: string): void {
  localStorage.removeItem(playerTokenKey(joinCode));
}

function authorizationHeaders(playerToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${playerToken}`,
  };
}

async function readGameResponse(response: Response): Promise<GameRecord> {
  if (!response.ok) {
    const error = new Error(`Game request failed with status ${response.status}`);
    if (response.status === 401) {
      error.name = 'UnauthorizedError';
    } else if (response.status === 404) {
      error.name = 'NotFoundError';
    }
    throw error;
  }

  return response.json() as Promise<GameRecord>;
}

async function createGame(displayName?: string | null): Promise<GameRecord> {
  return readGameResponse(
    await fetch('/api/games', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ displayName }),
    }),
  );
}

async function getGame(joinCode: string, playerToken: string): Promise<GameRecord> {
  return readGameResponse(
    await fetch(`/api/games/${encodeURIComponent(normalizeJoinCode(joinCode))}`, {
      headers: authorizationHeaders(playerToken),
    }),
  );
}

async function joinGame(
  joinCode: string,
  inviteToken: string,
  displayName?: string | null,
): Promise<GameRecord> {
  return readGameResponse(
    await fetch(`/api/games/${encodeURIComponent(normalizeJoinCode(joinCode))}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inviteToken, displayName }),
    }),
  );
}

async function submitMove(
  joinCode: string,
  playerToken: string,
  move: Position,
  expectedVersion: number,
): Promise<GameRecord> {
  return readGameResponse(
    await fetch(
      `/api/games/${encodeURIComponent(normalizeJoinCode(joinCode))}/moves`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authorizationHeaders(playerToken),
        },
        body: JSON.stringify({ ...move, expectedVersion }),
      },
    ),
  );
}

async function createRematchGame(
  joinCode: string,
  playerToken: string,
  displayName?: string | null,
): Promise<GameRecord> {
  return readGameResponse(
    await fetch(`/api/games/${encodeURIComponent(normalizeJoinCode(joinCode))}/rematch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authorizationHeaders(playerToken),
      },
      body: JSON.stringify({ displayName }),
    }),
  );
}

async function forfeitGame(
  joinCode: string,
  playerToken: string,
): Promise<GameRecord> {
  return readGameResponse(
    await fetch(`/api/games/${encodeURIComponent(normalizeJoinCode(joinCode))}/forfeit`, {
      method: 'POST',
      headers: authorizationHeaders(playerToken),
    }),
  );
}

async function cancelGame(
  joinCode: string,
  playerToken: string,
): Promise<GameRecord> {
  return readGameResponse(
    await fetch(`/api/games/${encodeURIComponent(normalizeJoinCode(joinCode))}/cancel`, {
      method: 'POST',
      headers: authorizationHeaders(playerToken),
    }),
  );
}

async function acceptRematchGame(
  joinCode: string,
  playerToken: string,
): Promise<GameRecord> {
  return readGameResponse(
    await fetch(
      `/api/games/${encodeURIComponent(normalizeJoinCode(joinCode))}/rematch/accept`,
      {
        method: 'POST',
        headers: authorizationHeaders(playerToken),
      },
    ),
  );
}

async function updateGamePlayerProfile(
  joinCode: string,
  playerToken: string,
  displayName: string,
): Promise<GameRecord> {
  return readGameResponse(
    await fetch(
      `/api/games/${encodeURIComponent(normalizeJoinCode(joinCode))}/player-profile`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authorizationHeaders(playerToken),
        },
        body: JSON.stringify({ displayName }),
      },
    ),
  );
}

async function getSavedGames(
  credentials: readonly { readonly joinCode: string; readonly playerToken: string }[],
): Promise<SavedGameCard[] | null> {
  const response = await fetch('/api/games/saved', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ credentials }),
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as { readonly games?: SavedGameCard[] };
  return body.games ?? [];
}

async function readTestControlCapability(): Promise<boolean> {
  const response = await fetch('/api/test-controls');
  if (!response.ok) {
    return false;
  }

  const body = (await response.json()) as { readonly enabled?: boolean };
  return body.enabled === true;
}

async function skipGameToEnd(
  joinCode: string,
  playerToken: string,
): Promise<GameRecord> {
  return readGameResponse(
    await fetch(
      `/api/games/${encodeURIComponent(normalizeJoinCode(joinCode))}/test/skip-to-end`,
      {
        method: 'POST',
        headers: authorizationHeaders(playerToken),
      },
    ),
  );
}

function getErrorKind(error: unknown): GameErrorKind {
  if (error instanceof Error && error.name === 'UnauthorizedError') {
    return 'unauthorized';
  }
  return error instanceof Error && error.name === 'NotFoundError'
    ? 'not-found'
    : 'api';
}

export function useGame({
  animateMoves,
  displayName,
}: UseGameOptions = { animateMoves: true }) {
  const [game, setGame] = useState<GameRecord | null>(null);
  const [displayedGame, setDisplayedGame] = useState<GameRecord | null>(null);
  const [selectedJoinCode, setSelectedJoinCode] = useState<string | null>(
    readStoredJoinCode,
  );
  const [playerToken, setPlayerToken] = useState<string | null>(() => {
    const storedCode = readStoredJoinCode();
    return storedCode ? readStoredPlayerToken(storedCode) : null;
  });
  const [isLoading, setIsLoading] = useState(() => readStoredJoinCode() !== null);
  const [isSubmittingMove, setIsSubmittingMove] = useState(false);
  const [isCreatingRematch, setIsCreatingRematch] = useState(false);
  const [acceptingRematchParentCode, setAcceptingRematchParentCode] = useState<string | null>(null);
  const [isForfeiting, setIsForfeiting] = useState(false);
  const [isSkippingToEnd, setIsSkippingToEnd] = useState(false);
  const [areTestControlsEnabled, setAreTestControlsEnabled] = useState(false);
  const [savedGames, setSavedGames] = useState<readonly SavedGameCard[]>([]);
  const [isLoadingSavedGames, setIsLoadingSavedGames] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<GameErrorKind | null>(null);
  const [syncWarningMessage, setSyncWarningMessage] = useState<string | null>(null);
  const [recentPositions, setRecentPositions] = useState<readonly Position[]>([]);
  const [animationPhase, setAnimationPhase] = useState<'idle' | 'placing' | 'flipping'>('idle');
  const [isSwitchingGame, setIsSwitchingGame] = useState(false);
  const initialJoinCodeRef = useRef(selectedJoinCode);
  const initialPlayerTokenRef = useRef(playerToken);
  const currentVersionRef = useRef<number | null>(null);
  const animationTimersRef = useRef<readonly number[]>([]);
  const acceptingRematchParentCodeRef = useRef<string | null>(null);
  const isRefreshingSavedGamesRef = useRef(false);

  const gameState = displayedGame?.state ?? game?.state ?? createInitialGameState();
  const scores = getScores(gameState.board);
  const result =
    gameState.status === 'finished' ? game?.winner ?? getGameResult(scores) : null;

  useEffect(() => {
    currentVersionRef.current = game?.version ?? null;
  }, [game?.version]);

  const clearAnimationTimers = useCallback(() => {
    for (const timerId of animationTimersRef.current) {
      window.clearTimeout(timerId);
    }
    animationTimersRef.current = [];
  }, []);

  const markMovePresented = useCallback((loadedGame: GameRecord) => {
    if (loadedGame.lastMove && typeof window !== 'undefined') {
      writeLastPresentedMoveVersion(
        window.localStorage,
        loadedGame.joinCode,
        loadedGame.lastMove.version,
      );
    }
  }, []);

  const presentGame = useCallback(
    (loadedGame: GameRecord) => {
      clearAnimationTimers();
      setGame(loadedGame);
      setRecentPositions(getLastMovePositions(loadedGame.lastMove));

      const lastPresentedVersion =
        typeof window === 'undefined'
          ? null
          : readLastPresentedMoveVersion(window.localStorage, loadedGame.joinCode);
      const shouldAnimate =
        animateMoves &&
        shouldAnimateLastMove({
          joinCode: loadedGame.joinCode,
          lastMove: loadedGame.lastMove,
          currentVersion: loadedGame.version,
          lastPresentedVersion,
        });
      const previousBoard = shouldAnimate
        ? reconstructBoardBeforeLastMove(loadedGame.state.board, loadedGame.lastMove)
        : null;

      if (!shouldAnimate || !previousBoard) {
        setDisplayedGame(loadedGame);
        setAnimationPhase('idle');
        markMovePresented(loadedGame);
        return;
      }

      const preMoveGame: GameRecord = {
        ...loadedGame,
        state: {
          ...loadedGame.state,
          board: previousBoard,
        },
      };

      setDisplayedGame(preMoveGame);
      setAnimationPhase('placing');

      const placementTimer = window.setTimeout(() => {
        setDisplayedGame(loadedGame);
        setAnimationPhase('flipping');
      }, PLACEMENT_MS);
      const completionTimer = window.setTimeout(() => {
        setDisplayedGame(loadedGame);
        setAnimationPhase('idle');
        markMovePresented(loadedGame);
      }, MOVE_ANIMATION_MS);
      animationTimersRef.current = [placementTimer, completionTimer];
    },
    [animateMoves, clearAnimationTimers, markMovePresented],
  );

  useEffect(() => {
    return () => {
      clearAnimationTimers();
    };
  }, [clearAnimationTimers]);

  useEffect(() => {
    if (animateMoves || animationPhase === 'idle' || !game) {
      return;
    }

    const timerId = window.setTimeout(() => {
      clearAnimationTimers();
      setDisplayedGame(game);
      setAnimationPhase('idle');
      markMovePresented(game);
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [animateMoves, animationPhase, clearAnimationTimers, game, markMovePresented]);

  useEffect(() => {
    let isActive = true;

    async function loadTestControlsCapability() {
      const enabled = await readTestControlCapability();
      if (isActive) {
        setAreTestControlsEnabled(enabled);
      }
    }

    void loadTestControlsCapability();

    return () => {
      isActive = false;
    };
  }, []);

  const applyAuthenticatedGame = useCallback(
    (loadedGame: GameRecord, token: string) => {
      presentGame(loadedGame);
      setSelectedJoinCode(loadedGame.joinCode);
      setPlayerToken(token);
      setSyncWarningMessage(null);
      setIsSwitchingGame(false);
      storeJoinCode(loadedGame.joinCode);
      storePlayerToken(loadedGame.joinCode, token);
      if (loadedGame.invitation) {
        storeInvitation(loadedGame.joinCode, loadedGame.invitation);
      }
      addSavedJoinCode(window.localStorage, loadedGame.joinCode);
    },
    [presentGame],
  );

  const refreshSavedGames = useCallback(async (showLoading = true) => {
    if (isRefreshingSavedGamesRef.current) {
      return;
    }

    const joinCodes = readSavedJoinCodes(window.localStorage);
    const credentials = joinCodes
      .map((code) => ({
        joinCode: code,
        playerToken: readStoredPlayerToken(code),
      }))
      .filter(
        (
          credential,
        ): credential is { readonly joinCode: string; readonly playerToken: string } =>
          Boolean(credential.playerToken),
      );

    isRefreshingSavedGamesRef.current = true;
    if (showLoading) {
      setIsLoadingSavedGames(true);
    }
    try {
      const refreshedGames = await getSavedGames(credentials);
      if (refreshedGames) {
        setSavedGames(orderSavedGameCards(refreshedGames));
      }
    } catch {
      // Keep the last known library; transient refresh failures should not hide actions.
    } finally {
      isRefreshingSavedGamesRef.current = false;
      if (showLoading) {
        setIsLoadingSavedGames(false);
      }
    }
  }, []);

  const loadGame = useCallback(
    async (joinCode: string) => {
      const normalizedCode = normalizeJoinCode(joinCode);
      if (!normalizedCode) {
        setGame(null);
        setDisplayedGame(null);
        setSelectedJoinCode(null);
        setPlayerToken(null);
        setErrorMessage('Enter a join code.');
        setErrorKind('api');
        return;
      }

      const storedToken = readStoredPlayerToken(normalizedCode);
      if (!storedToken) {
        setGame(null);
        setDisplayedGame(null);
        setSelectedJoinCode(normalizedCode);
        setPlayerToken(null);
        setErrorMessage('No saved player credential for that game.');
        setErrorKind('unauthorized');
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);
      setErrorKind(null);

      try {
        applyAuthenticatedGame(await getGame(normalizedCode, storedToken), storedToken);
      } catch (error) {
        const kind = getErrorKind(error);
        setGame(null);
        setDisplayedGame(null);
        setSelectedJoinCode(normalizedCode);
        setPlayerToken(kind === 'unauthorized' ? null : storedToken);
        setErrorKind(kind);
        setErrorMessage(
          kind === 'unauthorized'
            ? 'Saved player credential is invalid.'
            : kind === 'not-found'
              ? 'No game found for that join code.'
              : 'Unable to load the game.',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [applyAuthenticatedGame],
  );

  useEffect(() => {
    let isActive = true;

    async function restoreSelectedGame() {
      const initialJoinCode = initialJoinCodeRef.current;
      const initialPlayerToken = initialPlayerTokenRef.current;
      if (!initialJoinCode) {
        return;
      }

      if (!initialPlayerToken) {
        if (isActive) {
          setErrorMessage('No saved player credential for that game.');
          setErrorKind('unauthorized');
          setIsLoading(false);
        }
        return;
      }

      try {
        const loadedGame = await getGame(initialJoinCode, initialPlayerToken);
        if (isActive) {
          applyAuthenticatedGame(loadedGame, initialPlayerToken);
          setIsSwitchingGame(false);
          addSavedJoinCode(window.localStorage, initialJoinCode);
        }
      } catch (error) {
        if (isActive) {
          const kind = getErrorKind(error);
          setGame(null);
          setDisplayedGame(null);
          setPlayerToken(kind === 'unauthorized' ? null : initialPlayerToken);
          setErrorKind(kind);
          setErrorMessage(
            kind === 'unauthorized'
              ? 'Saved player credential is invalid.'
              : kind === 'not-found'
                ? 'No game found for that join code.'
                : 'Unable to load the game.',
          );
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void restoreSelectedGame();

    return () => {
      isActive = false;
    };
  }, [applyAuthenticatedGame]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refreshSavedGames();
    }, 0);

    return () => {
      window.clearTimeout(refreshTimer);
    };
  }, [refreshSavedGames, game?.version, game?.joinCode, isSwitchingGame]);

  useEffect(() => {
    if (!isSwitchingGame && game) {
      return;
    }

    const refreshTimer = window.setInterval(() => {
      void refreshSavedGames(false);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshTimer);
    };
  }, [game, isSwitchingGame, refreshSavedGames]);

  useEffect(() => {
    if (!game?.joinCode || !playerToken) {
      return;
    }

    const poller = createGamePoller<GameRecord>({
      intervalMs: POLL_INTERVAL_MS,
      getVisibilityState: () => document.visibilityState,
      addVisibilityListener: (listener) => {
        document.addEventListener('visibilitychange', listener);
      },
      removeVisibilityListener: (listener) => {
        document.removeEventListener('visibilitychange', listener);
      },
      setTimer: (listener, delayMs) => window.setTimeout(listener, delayMs),
      clearTimer: (timerId) => {
        window.clearTimeout(timerId as number);
      },
      fetchGame: () => getGame(game.joinCode, playerToken),
      getCurrentVersion: () => currentVersionRef.current,
      getGameVersion: (polledGame) => polledGame.version,
      onNewerGame: (polledGame) => {
        presentGame(polledGame);
      },
      onRepeatedFailure: () => {
        setSyncWarningMessage('Sync is temporarily delayed.');
      },
      onSuccess: () => {
        setSyncWarningMessage(null);
      },
      onError: (error) => {
        if (getErrorKind(error) !== 'unauthorized') {
          return 'continue';
        }

        setPlayerToken(null);
        setErrorKind('unauthorized');
        setErrorMessage('Player credential is no longer valid.');
        setSyncWarningMessage(null);
        return 'stop';
      },
    });

    poller.start();

    return () => {
      poller.stop();
    };
  }, [game?.joinCode, playerToken, presentGame]);

  const playMove = useCallback(
    async (move: Position) => {
      if (
        !game ||
        !selectedJoinCode ||
        !playerToken ||
        !game.opponentJoined ||
        game.playerColor !== game.state.currentPlayer ||
        game.state.status === 'finished' ||
        isSubmittingMove
      ) {
        return;
      }

      setIsSubmittingMove(true);
      setErrorMessage(null);
      setErrorKind(null);

      try {
        const updatedGame = await submitMove(
          selectedJoinCode,
          playerToken,
          move,
          game.version,
        );
        presentGame(updatedGame);
        setSyncWarningMessage(null);
      } catch (error) {
        const kind = getErrorKind(error);
        setErrorMessage(
          kind === 'unauthorized'
            ? 'Player credential is no longer valid.'
            : 'Unable to submit that move.',
        );
        setErrorKind(kind);
        if (kind === 'unauthorized') {
          setPlayerToken(null);
        } else {
          try {
            presentGame(await getGame(selectedJoinCode, playerToken));
          } catch {
            setGame(null);
            setDisplayedGame(null);
          }
        }
      } finally {
        setIsSubmittingMove(false);
      }
    },
    [game, isSubmittingMove, playerToken, presentGame, selectedJoinCode],
  );

  const startNewGame = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setErrorKind(null);

    try {
      const createdGame = await createGame(displayName);
      if (!createdGame.playerToken) {
        throw new Error('Missing player token');
      }
      applyAuthenticatedGame(createdGame, createdGame.playerToken);
    } catch {
      setErrorMessage('Unable to start a new game.');
      setErrorKind('api');
    } finally {
      setIsLoading(false);
    }
  }, [applyAuthenticatedGame, displayName]);

  const createRematch = useCallback(async () => {
    if (!game || !selectedJoinCode || !playerToken || game.state.status !== 'finished') {
      return;
    }

    setIsCreatingRematch(true);
    setErrorMessage(null);
    setErrorKind(null);

    try {
      const rematch = await createRematchGame(selectedJoinCode, playerToken, displayName);
      if (!rematch.playerToken) {
        throw new Error('Missing player token');
      }
      applyAuthenticatedGame(rematch, rematch.playerToken);
    } catch (error) {
      const kind = getErrorKind(error);
      setErrorKind(kind);
      setErrorMessage(
        kind === 'unauthorized'
          ? 'Player credential is no longer valid.'
          : 'Unable to create a rematch.',
      );
      if (kind === 'unauthorized') {
        setPlayerToken(null);
      }
    } finally {
      setIsCreatingRematch(false);
    }
  }, [applyAuthenticatedGame, displayName, game, playerToken, selectedJoinCode]);

  const forfeitCurrentGame = useCallback(
    async (targetJoinCode?: string) => {
      if (isForfeiting) {
        return;
      }

      const forfeitJoinCode = normalizeJoinCode(targetJoinCode ?? selectedJoinCode ?? '');
      const token = forfeitJoinCode ? readStoredPlayerToken(forfeitJoinCode) : null;
      if (!forfeitJoinCode || !token) {
        setErrorKind('unauthorized');
        setErrorMessage('No saved player credential for that game.');
        return;
      }

      setIsForfeiting(true);
      setErrorMessage(null);
      setErrorKind(null);

      try {
        const forfeitedGame = await forfeitGame(forfeitJoinCode, token);
        if (forfeitJoinCode === selectedJoinCode || !game) {
          presentGame(forfeitedGame);
          setSelectedJoinCode(forfeitedGame.joinCode);
          setPlayerToken(token);
          storeJoinCode(forfeitedGame.joinCode);
        }
        await refreshSavedGames();
      } catch (error) {
        const kind = getErrorKind(error);
        setErrorKind(kind);
        setErrorMessage(
          kind === 'unauthorized'
            ? 'Player credential is no longer valid.'
            : 'Unable to forfeit the game.',
        );
        if (kind === 'unauthorized' && forfeitJoinCode === selectedJoinCode) {
          setPlayerToken(null);
        }
        try {
          if (forfeitJoinCode === selectedJoinCode) {
            presentGame(await getGame(forfeitJoinCode, token));
          } else {
            await refreshSavedGames();
          }
        } catch {
          // Keep the current view if the game finished before the refresh completed.
        }
      } finally {
        setIsForfeiting(false);
      }
    },
    [game, isForfeiting, presentGame, refreshSavedGames, selectedJoinCode],
  );

  const cancelCurrentGame = useCallback(
    async (targetJoinCode?: string) => {
      if (isForfeiting) {
        return;
      }

      const cancelJoinCode = normalizeJoinCode(targetJoinCode ?? selectedJoinCode ?? '');
      const token = cancelJoinCode ? readStoredPlayerToken(cancelJoinCode) : null;
      if (!cancelJoinCode || !token) {
        setErrorKind('unauthorized');
        setErrorMessage('No saved player credential for that game.');
        return;
      }

      setIsForfeiting(true);
      setErrorMessage(null);
      setErrorKind(null);

      try {
        const cancelledGame = await cancelGame(cancelJoinCode, token);
        if (cancelJoinCode === selectedJoinCode || !game) {
          presentGame(cancelledGame);
          setSelectedJoinCode(cancelledGame.joinCode);
          setPlayerToken(token);
          storeJoinCode(cancelledGame.joinCode);
        }
        await refreshSavedGames();
      } catch (error) {
        setErrorKind(getErrorKind(error));
        setErrorMessage('Unable to cancel the game.');
        await refreshSavedGames();
      } finally {
        setIsForfeiting(false);
      }
    },
    [game, isForfeiting, presentGame, refreshSavedGames, selectedJoinCode],
  );

  const acceptRematch = useCallback(async () => {
    if (!game || !selectedJoinCode || !playerToken || !game.rematch || isCreatingRematch) {
      return;
    }

    setIsCreatingRematch(true);
    setErrorMessage(null);
    setErrorKind(null);

    try {
      const acceptedGame = await acceptRematchGame(selectedJoinCode, playerToken);
      if (!acceptedGame.playerToken) {
        throw new Error('Missing player token');
      }
      applyAuthenticatedGame(acceptedGame, acceptedGame.playerToken);
    } catch (error) {
      setErrorKind(getErrorKind(error));
      setErrorMessage('Unable to accept the rematch.');
    } finally {
      setIsCreatingRematch(false);
    }
  }, [applyAuthenticatedGame, game, isCreatingRematch, playerToken, selectedJoinCode]);

  const acceptRematchFromParent = useCallback(
    async (parentJoinCode: string) => {
      const normalizedParentCode = normalizeJoinCode(parentJoinCode);
      if (
        !normalizedParentCode ||
        acceptingRematchParentCodeRef.current === normalizedParentCode
      ) {
        return;
      }

      const parentToken = readStoredPlayerToken(normalizedParentCode);
      if (!parentToken) {
        setErrorKind('unauthorized');
        setErrorMessage('No saved player credential for that rematch.');
        return;
      }

      acceptingRematchParentCodeRef.current = normalizedParentCode;
      setAcceptingRematchParentCode(normalizedParentCode);
      setErrorMessage(null);
      setErrorKind(null);

      try {
        const acceptedGame = await acceptRematchGame(normalizedParentCode, parentToken);
        const acceptedToken =
          acceptedGame.playerToken ?? readStoredPlayerToken(acceptedGame.joinCode);
        if (!acceptedToken) {
          throw new Error('Missing player token');
        }
        applyAuthenticatedGame(acceptedGame, acceptedToken);
        await refreshSavedGames();
      } catch (error) {
        setErrorKind(getErrorKind(error));
        setErrorMessage('Unable to accept the rematch.');
        await refreshSavedGames();
      } finally {
        acceptingRematchParentCodeRef.current = null;
        setAcceptingRematchParentCode(null);
      }
    },
    [applyAuthenticatedGame, refreshSavedGames],
  );

  const skipToEnd = useCallback(async () => {
    if (
      !game ||
      !selectedJoinCode ||
      !playerToken ||
      game.state.status === 'finished' ||
      isSkippingToEnd
    ) {
      return;
    }

    setIsSkippingToEnd(true);
    setErrorMessage(null);
    setErrorKind(null);

    try {
      presentGame(await skipGameToEnd(selectedJoinCode, playerToken));
    } catch (error) {
      const kind = getErrorKind(error);
      setErrorKind(kind);
      setErrorMessage(
        kind === 'unauthorized'
          ? 'Player credential is no longer valid.'
          : 'Unable to finish the game for testing.',
      );
      if (kind === 'unauthorized') {
        setPlayerToken(null);
      }
    } finally {
      setIsSkippingToEnd(false);
    }
  }, [game, isSkippingToEnd, playerToken, presentGame, selectedJoinCode]);

  const claimWhite = useCallback(
    async (joinCode: string, inviteToken: string) => {
      const normalizedCode = normalizeJoinCode(joinCode);
      if (!normalizedCode || !inviteToken) {
        setErrorMessage('Enter a join code and invitation token.');
        setErrorKind('api');
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);
      setErrorKind(null);

      try {
        const joinedGame = await joinGame(normalizedCode, inviteToken, displayName);
        if (!joinedGame.playerToken) {
          throw new Error('Missing player token');
        }
        applyAuthenticatedGame(joinedGame, joinedGame.playerToken);
      } catch (error) {
        const kind = getErrorKind(error);
        setErrorKind(kind);
        setErrorMessage(
          kind === 'not-found'
            ? 'No game found for that join code.'
            : 'Unable to join as White.',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [applyAuthenticatedGame, displayName],
  );

  const syncDisplayNameToSavedGames = useCallback(
    async (nextDisplayName: string) => {
      const joinCodes = readSavedJoinCodes(window.localStorage);
      const updates = joinCodes
        .map((code) => ({
          joinCode: code,
          playerToken: readStoredPlayerToken(code),
        }))
        .filter(
          (
            credential,
          ): credential is { readonly joinCode: string; readonly playerToken: string } =>
            Boolean(credential.playerToken),
        )
        .map(async ({ joinCode, playerToken: storedToken }) => {
          try {
            const updatedGame = await updateGamePlayerProfile(
              joinCode,
              storedToken,
              nextDisplayName,
            );
            if (joinCode === selectedJoinCode && playerToken === storedToken) {
              presentGame(updatedGame);
            }
          } catch {
            // Individual stale or unavailable games should not discard the local profile.
          }
        });

      await Promise.all(updates);
      await refreshSavedGames();
    },
    [playerToken, presentGame, refreshSavedGames, selectedJoinCode],
  );

  const claimWhiteFromInvitation = useCallback(
    async (invitation: string) => {
      const parsedInvitation = parseInvitation(invitation);
      if (!parsedInvitation) {
        setErrorMessage('Paste an invitation in CODE:TOKEN format.');
        setErrorKind('api');
        return;
      }

      await claimWhite(parsedInvitation.joinCode, parsedInvitation.inviteToken);
    },
    [claimWhite],
  );

  const clearCredential = useCallback(() => {
    if (selectedJoinCode) {
      removeStoredPlayerToken(selectedJoinCode);
    }
    setPlayerToken(null);
    setGame(null);
    setDisplayedGame(null);
    setErrorMessage('Saved player credential removed.');
    setErrorKind('unauthorized');
  }, [selectedJoinCode]);

  const switchGame = useCallback(() => {
    setIsSwitchingGame(true);
    setGame(null);
    setDisplayedGame(null);
    setPlayerToken(null);
    setErrorMessage(null);
    setErrorKind(null);
    setSyncWarningMessage(null);
  }, []);

  const removeSavedGameFromHistory = useCallback(
    (joinCode: string) => {
      const normalizedCode = normalizeJoinCode(joinCode);
      removeSavedGameFromDevice(window.localStorage, normalizedCode);
      setSavedGames((currentGames) =>
        currentGames.filter((savedGame) => savedGame.joinCode !== normalizedCode),
      );

      if (selectedJoinCode === normalizedCode) {
        localStorage.removeItem(SELECTED_JOIN_CODE_KEY);
        setIsSwitchingGame(true);
        setGame(null);
        setDisplayedGame(null);
        setSelectedJoinCode(null);
        setPlayerToken(null);
        setErrorMessage(null);
        setErrorKind(null);
        setSyncWarningMessage(null);
      }
    },
    [selectedJoinCode],
  );

  const visibleInvitation =
    game?.playerColor === 'black' &&
    !game.opponentJoined &&
    game.state.status === 'playing'
      ? game.invitation ?? readStoredInvitation(game.joinCode)
      : null;

  return {
    gameState,
    joinCode: game?.joinCode ?? selectedJoinCode,
    invitation: visibleInvitation,
    playerColor: game?.playerColor ?? null,
    playerName: game?.playerName ?? null,
    opponentName: game?.opponentName ?? null,
    playerToken,
    opponentJoined: game?.opponentJoined ?? false,
    isAuthenticated: Boolean(game && playerToken),
    isYourTurn:
      Boolean(game?.opponentJoined) &&
      game?.state.status !== 'finished' &&
      game?.playerColor === game?.state.currentPlayer,
    version: game?.version ?? null,
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
    loadGame,
    refreshSavedGames,
    syncDisplayNameToSavedGames,
    claimWhite,
    claimWhiteFromInvitation,
    clearCredential,
    switchGame,
    removeSavedGameFromHistory,
    hasSelectedGame: game !== null,
    showGameSelection: !game || isSwitchingGame,
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
    lastMove: game?.lastMove ?? null,
    endedReason: game?.endedReason ?? 'normal',
    forfeitedBy: game?.forfeitedBy ?? null,
    rematch: game?.rematch ?? null,
    isAnimatingMove: animationPhase !== 'idle',
  };
}
