interface GamePollerOptions<TGame> {
  readonly intervalMs: number;
  readonly getVisibilityState: () => 'visible' | 'hidden';
  readonly addVisibilityListener: (listener: () => void) => void;
  readonly removeVisibilityListener: (listener: () => void) => void;
  readonly setTimer: (listener: () => void, delayMs: number) => unknown;
  readonly clearTimer: (timerId: unknown) => void;
  readonly fetchGame: () => Promise<TGame>;
  readonly getCurrentVersion: () => number | null;
  readonly onNewerGame: (game: TGame) => void;
  readonly onRepeatedFailure: () => void;
  readonly onSuccess: () => void;
  readonly getGameVersion: (game: TGame) => number;
}

export interface GamePoller {
  readonly start: () => void;
  readonly stop: () => void;
}

const FAILURE_WARNING_THRESHOLD = 2;

export function createGamePoller<TGame>({
  intervalMs,
  getVisibilityState,
  addVisibilityListener,
  removeVisibilityListener,
  setTimer,
  clearTimer: clearScheduledTimer,
  fetchGame,
  getCurrentVersion,
  onNewerGame,
  onRepeatedFailure,
  onSuccess,
  getGameVersion,
}: GamePollerOptions<TGame>): GamePoller {
  let timerId: unknown = null;
  let isStopped = true;
  let isRequestInFlight = false;
  let consecutiveFailures = 0;

  function clearTimer() {
    if (timerId !== null) {
      clearScheduledTimer(timerId);
      timerId = null;
    }
  }

  function scheduleNextPoll() {
    clearTimer();

    if (isStopped || getVisibilityState() === 'hidden') {
      return;
    }

    timerId = setTimer(() => {
      void poll();
    }, intervalMs);
  }

  async function poll() {
    if (
      isStopped ||
      isRequestInFlight ||
      getVisibilityState() === 'hidden'
    ) {
      return;
    }

    isRequestInFlight = true;

    try {
      const game = await fetchGame();
      consecutiveFailures = 0;
      onSuccess();

      const currentVersion = getCurrentVersion();
      if (currentVersion === null || getGameVersion(game) > currentVersion) {
        onNewerGame(game);
      }
    } catch {
      consecutiveFailures += 1;
      if (consecutiveFailures >= FAILURE_WARNING_THRESHOLD) {
        onRepeatedFailure();
      }
    } finally {
      isRequestInFlight = false;
      scheduleNextPoll();
    }
  }

  function handleVisibilityChange() {
    if (isStopped) {
      return;
    }

    if (getVisibilityState() === 'hidden') {
      clearTimer();
      return;
    }

    void poll();
  }

  return {
    start() {
      if (!isStopped) {
        return;
      }

      isStopped = false;
      addVisibilityListener(handleVisibilityChange);
      scheduleNextPoll();
    },
    stop() {
      isStopped = true;
      clearTimer();
      removeVisibilityListener(handleVisibilityChange);
    },
  };
}
