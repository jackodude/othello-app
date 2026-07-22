import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGamePoller } from './gamePolling';

interface PollGame {
  readonly version: number;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

describe('createGamePoller', () => {
  let visibilityState: 'visible' | 'hidden';
  let visibilityListener: (() => void) | null;
  let currentVersion: number | null;
  let fetchGame: ReturnType<typeof vi.fn<() => Promise<PollGame>>>;
  let onNewerGame: ReturnType<typeof vi.fn<(game: PollGame) => void>>;
  let onRepeatedFailure: ReturnType<typeof vi.fn<() => void>>;
  let onSuccess: ReturnType<typeof vi.fn<() => void>>;
  let scheduledListener: (() => void) | null;

  beforeEach(() => {
    visibilityState = 'visible';
    visibilityListener = null;
    scheduledListener = null;
    currentVersion = 1;
    fetchGame = vi.fn<() => Promise<PollGame>>();
    onNewerGame = vi.fn<(game: PollGame) => void>();
    onRepeatedFailure = vi.fn<() => void>();
    onSuccess = vi.fn<() => void>();
  });

  function createPoller() {
    return createGamePoller<PollGame>({
      intervalMs: 2000,
      getVisibilityState: () => visibilityState,
      addVisibilityListener: (listener) => {
        visibilityListener = listener;
      },
      removeVisibilityListener: (listener) => {
        if (visibilityListener === listener) {
          visibilityListener = null;
        }
      },
      setTimer: (listener) => {
        scheduledListener = listener;
        return listener;
      },
      clearTimer: (timerId) => {
        if (scheduledListener === timerId) {
          scheduledListener = null;
        }
      },
      fetchGame,
      getCurrentVersion: () => currentVersion,
      getGameVersion: (game) => game.version,
      onNewerGame,
      onRepeatedFailure,
      onSuccess,
    });
  }

  async function runScheduledPoll() {
    const listener = scheduledListener;
    listener?.();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('updates when the server version is newer', async () => {
    fetchGame.mockResolvedValueOnce({ version: 2 });
    const poller = createPoller();

    poller.start();
    await runScheduledPoll();

    expect(onNewerGame).toHaveBeenCalledWith({ version: 2 });
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('does not replace state when the version is unchanged', async () => {
    fetchGame.mockResolvedValueOnce({ version: 1 });
    const poller = createPoller();

    poller.start();
    await runScheduledPoll();

    expect(onNewerGame).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('does not overlap polling requests', async () => {
    const firstRequest = deferred<PollGame>();
    fetchGame.mockReturnValueOnce(firstRequest.promise);
    const poller = createPoller();

    poller.start();
    scheduledListener?.();
    scheduledListener?.();
    await Promise.resolve();

    expect(fetchGame).toHaveBeenCalledOnce();

    firstRequest.resolve({ version: 2 });
    await Promise.resolve();
    await Promise.resolve();

    expect(onNewerGame).toHaveBeenCalledWith({ version: 2 });
  });

  it('pauses polling while hidden', async () => {
    visibilityState = 'hidden';
    fetchGame.mockResolvedValue({ version: 2 });
    const poller = createPoller();

    poller.start();
    await runScheduledPoll();

    expect(fetchGame).not.toHaveBeenCalled();
  });

  it('fetches immediately when becoming visible', async () => {
    visibilityState = 'hidden';
    fetchGame.mockResolvedValueOnce({ version: 2 });
    const poller = createPoller();

    poller.start();
    visibilityState = 'visible';
    visibilityListener?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchGame).toHaveBeenCalledOnce();
    expect(onNewerGame).toHaveBeenCalledWith({ version: 2 });
  });

  it('keeps existing state through a transient polling failure', async () => {
    fetchGame
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({ version: 1 });
    const poller = createPoller();

    poller.start();
    await runScheduledPoll();
    await runScheduledPoll();

    expect(onNewerGame).not.toHaveBeenCalled();
    expect(onRepeatedFailure).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('warns after repeated polling failures and clears on success', async () => {
    fetchGame
      .mockRejectedValueOnce(new Error('temporary'))
      .mockRejectedValueOnce(new Error('still temporary'))
      .mockResolvedValueOnce({ version: 1 });
    const poller = createPoller();

    poller.start();
    await runScheduledPoll();
    await runScheduledPoll();
    await runScheduledPoll();

    expect(onRepeatedFailure).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('cleanup stops further polling', async () => {
    fetchGame.mockResolvedValue({ version: 2 });
    const poller = createPoller();

    poller.start();
    poller.stop();
    await runScheduledPoll();

    expect(fetchGame).not.toHaveBeenCalled();
    expect(visibilityListener).toBeNull();
  });
});
