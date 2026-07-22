import { useCallback, useEffect, useRef, useState } from 'react';

import { createInitialGameState, getGameResult, getScores } from '../game';
import type { GameState, Player, Position } from '../game';
import { createGamePoller } from './gamePolling';
import { getChangedPositions } from './gamePresentation';
import { parseInvitation } from './invitation';

interface GameRecord {
  readonly id: string;
  readonly joinCode: string;
  readonly state: GameState;
  readonly version: number;
  readonly playerColor?: Player;
  readonly opponentJoined: boolean;
  readonly playerToken?: string;
  readonly invitation?: string;
}

type GameErrorKind = 'not-found' | 'unauthorized' | 'api';

const SELECTED_JOIN_CODE_KEY = 'othello.selectedJoinCode';
const PLAYER_TOKEN_PREFIX = 'othello.playerToken.';
const POLL_INTERVAL_MS = 2000;

function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase();
}

function playerTokenKey(joinCode: string): string {
  return `${PLAYER_TOKEN_PREFIX}${normalizeJoinCode(joinCode)}`;
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

async function createGame(): Promise<GameRecord> {
  return readGameResponse(
    await fetch('/api/games', {
      method: 'POST',
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
): Promise<GameRecord> {
  return readGameResponse(
    await fetch(`/api/games/${encodeURIComponent(normalizeJoinCode(joinCode))}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inviteToken }),
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

function getErrorKind(error: unknown): GameErrorKind {
  if (error instanceof Error && error.name === 'UnauthorizedError') {
    return 'unauthorized';
  }
  return error instanceof Error && error.name === 'NotFoundError'
    ? 'not-found'
    : 'api';
}

export function useGame() {
  const [game, setGame] = useState<GameRecord | null>(null);
  const [selectedJoinCode, setSelectedJoinCode] = useState<string | null>(
    readStoredJoinCode,
  );
  const [playerToken, setPlayerToken] = useState<string | null>(() => {
    const storedCode = readStoredJoinCode();
    return storedCode ? readStoredPlayerToken(storedCode) : null;
  });
  const [isLoading, setIsLoading] = useState(() => readStoredJoinCode() !== null);
  const [isSubmittingMove, setIsSubmittingMove] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<GameErrorKind | null>(null);
  const [syncWarningMessage, setSyncWarningMessage] = useState<string | null>(null);
  const [recentPositions, setRecentPositions] = useState<readonly Position[]>([]);
  const [isSwitchingGame, setIsSwitchingGame] = useState(false);
  const initialJoinCodeRef = useRef(selectedJoinCode);
  const initialPlayerTokenRef = useRef(playerToken);
  const currentVersionRef = useRef<number | null>(null);

  const gameState = game?.state ?? createInitialGameState();
  const scores = getScores(gameState.board);
  const result =
    gameState.status === 'finished' ? getGameResult(scores) : null;

  useEffect(() => {
    currentVersionRef.current = game?.version ?? null;
  }, [game?.version]);

  const applyAuthenticatedGame = useCallback(
    (loadedGame: GameRecord, token: string) => {
      setGame((currentGame) => {
        setRecentPositions(
          getChangedPositions(currentGame?.state.board ?? null, loadedGame.state.board),
        );
        return loadedGame;
      });
      setSelectedJoinCode(loadedGame.joinCode);
      setPlayerToken(token);
      setSyncWarningMessage(null);
      setIsSwitchingGame(false);
      storeJoinCode(loadedGame.joinCode);
      storePlayerToken(loadedGame.joinCode, token);
    },
    [],
  );

  const loadGame = useCallback(
    async (joinCode: string) => {
      const normalizedCode = normalizeJoinCode(joinCode);
      if (!normalizedCode) {
        setGame(null);
        setSelectedJoinCode(null);
        setPlayerToken(null);
        setErrorMessage('Enter a join code.');
        setErrorKind('api');
        return;
      }

      const storedToken = readStoredPlayerToken(normalizedCode);
      if (!storedToken) {
        setGame(null);
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
        }
      } catch (error) {
        if (isActive) {
          const kind = getErrorKind(error);
          setGame(null);
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
        setGame((currentGame) => {
          setRecentPositions(
            getChangedPositions(currentGame?.state.board ?? null, polledGame.state.board),
          );
          return polledGame;
        });
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
  }, [game?.joinCode, playerToken]);

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
        setGame((currentGame) => {
          setRecentPositions(
            getChangedPositions(currentGame?.state.board ?? null, updatedGame.state.board),
          );
          return updatedGame;
        });
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
            setGame(await getGame(selectedJoinCode, playerToken));
          } catch {
            setGame(null);
          }
        }
      } finally {
        setIsSubmittingMove(false);
      }
    },
    [game, isSubmittingMove, playerToken, selectedJoinCode],
  );

  const startNewGame = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setErrorKind(null);

    try {
      const createdGame = await createGame();
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
  }, [applyAuthenticatedGame]);

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
        const joinedGame = await joinGame(normalizedCode, inviteToken);
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
    [applyAuthenticatedGame],
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
    setErrorMessage('Saved player credential removed.');
    setErrorKind('unauthorized');
  }, [selectedJoinCode]);

  const switchGame = useCallback(() => {
    setIsSwitchingGame(true);
    setGame(null);
    setPlayerToken(null);
    setErrorMessage(null);
    setErrorKind(null);
    setSyncWarningMessage(null);
  }, []);

  return {
    gameState,
    joinCode: game?.joinCode ?? selectedJoinCode,
    invitation: game?.invitation ?? null,
    playerColor: game?.playerColor ?? null,
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
    loadGame,
    claimWhite,
    claimWhiteFromInvitation,
    clearCredential,
    switchGame,
    hasSelectedGame: game !== null,
    showGameSelection: !game || isSwitchingGame,
    isLoading,
    isSubmittingMove,
    errorMessage,
    errorKind,
    syncWarningMessage,
    recentPositions,
  };
}
