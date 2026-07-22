import { beforeEach, describe, expect, it } from 'vitest';

import worker, { resetCurrentGameForTests } from './index';

const API_ORIGIN = 'https://othello.test';

function request(path: string, init?: RequestInit): Request {
  return new Request(`${API_ORIGIN}${path}`, init);
}

async function fetchJson(path: string, init?: RequestInit) {
  const workerRequest = request(path, init) as Parameters<typeof worker.fetch>[0];
  const response = await worker.fetch(workerRequest);
  const body = (await response.json()) as {
    readonly id?: string;
    readonly version?: number;
    readonly error?: string;
    readonly state?: {
      readonly currentPlayer?: string;
      readonly status?: string;
      readonly consecutivePasses?: number;
      readonly legalMoves?: unknown;
      readonly board?: readonly (readonly unknown[])[];
    };
  };

  return { response, body };
}

describe('game API', () => {
  beforeEach(() => {
    resetCurrentGameForTests();
  });

  it('creates a game', async () => {
    const { response, body } = await fetchJson('/api/games', { method: 'POST' });

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      id: '1',
      version: 1,
      state: {
        currentPlayer: 'black',
        status: 'playing',
        consecutivePasses: 0,
      },
    });
    expect(body.state?.legalMoves).toEqual(
      expect.arrayContaining([
        { row: 2, col: 3 },
        { row: 3, col: 2 },
        { row: 4, col: 5 },
        { row: 5, col: 4 },
      ]),
    );
  });

  it('returns the current game', async () => {
    await fetchJson('/api/games', { method: 'POST' });

    const { response, body } = await fetchJson('/api/games/current');

    expect(response.status).toBe(200);
    expect(body.id).toBe('1');
    expect(body.version).toBe(1);
  });

  it('returns 404 when there is no current game', async () => {
    const { response, body } = await fetchJson('/api/games/current');

    expect(response.status).toBe(404);
    expect(body.error).toBe('No current game');
  });

  it('applies a legal move through the engine', async () => {
    await fetchJson('/api/games', { method: 'POST' });

    const { response, body } = await fetchJson('/api/games/current/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: 3, version: 1 }),
    });

    expect(response.status).toBe(200);
    expect(body.version).toBe(2);
    expect(body.state?.board?.[2][3]).toBe('black');
    expect(body.state?.board?.[3][3]).toBe('black');
    expect(body.state?.currentPlayer).toBe('white');
  });

  it('rejects malformed move requests', async () => {
    await fetchJson('/api/games', { method: 'POST' });

    const { response, body } = await fetchJson('/api/games/current/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: '3', version: 1 }),
    });

    expect(response.status).toBe(400);
    expect(body.error).toBe('Malformed move request');
  });

  it('rejects illegal moves', async () => {
    await fetchJson('/api/games', { method: 'POST' });

    const { response, body } = await fetchJson('/api/games/current/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 0, col: 0, version: 1 }),
    });

    expect(response.status).toBe(422);
    expect(body.error).toBe('Illegal move');
  });

  it('rejects stale versions', async () => {
    await fetchJson('/api/games', { method: 'POST' });
    await fetchJson('/api/games/current/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: 3, version: 1 }),
    });

    const { response, body } = await fetchJson('/api/games/current/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: 2, version: 1 }),
    });

    expect(response.status).toBe(409);
    expect(body.error).toBe('Stale game version');
  });
});
