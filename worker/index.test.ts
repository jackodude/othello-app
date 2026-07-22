import { beforeEach, describe, expect, it } from 'vitest';

import worker from './index';

const API_ORIGIN = 'https://othello.test';

type StoredRow = Record<string, unknown>;

class FakeD1PreparedStatement {
  private params: unknown[] = [];
  private readonly sql: string;
  private readonly db: FakeD1Database;

  constructor(sql: string, db: FakeD1Database) {
    this.sql = sql;
    this.db = db;
  }

  bind(...params: unknown[]): D1PreparedStatement {
    this.params = params;
    return this as unknown as D1PreparedStatement;
  }

  async first<T = unknown>(): Promise<T | null> {
    if (!this.sql.includes('SELECT')) {
      throw new Error(`Unsupported first() SQL: ${this.sql}`);
    }

    return this.db.currentRow ? ({ ...this.db.currentRow } as T) : null;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes('INSERT OR REPLACE')) {
      const [
        singletonKey,
        id,
        boardJson,
        currentPlayer,
        status,
        winner,
        blackScore,
        whiteScore,
        version,
        consecutivePasses,
        createdAt,
        updatedAt,
      ] = this.params;

      this.db.currentRow = {
        singleton_key: singletonKey,
        id,
        board_json: boardJson,
        current_player: currentPlayer,
        status,
        winner,
        black_score: blackScore,
        white_score: whiteScore,
        version,
        consecutive_passes: consecutivePasses,
        created_at: createdAt,
        updated_at: updatedAt,
      };

      return makeD1Result(1);
    }

    if (this.sql.includes('UPDATE current_game')) {
      const expectedVersion = this.params[10];

      if (
        !this.db.currentRow ||
        this.db.forceStaleUpdate ||
        this.db.currentRow.version !== expectedVersion
      ) {
        return makeD1Result(0);
      }

      const [
        boardJson,
        currentPlayer,
        status,
        winner,
        blackScore,
        whiteScore,
        version,
        consecutivePasses,
        updatedAt,
      ] = this.params;

      this.db.currentRow = {
        ...this.db.currentRow,
        board_json: boardJson,
        current_player: currentPlayer,
        status,
        winner,
        black_score: blackScore,
        white_score: whiteScore,
        version,
        consecutive_passes: consecutivePasses,
        updated_at: updatedAt,
      };

      return makeD1Result(1);
    }

    throw new Error(`Unsupported run() SQL: ${this.sql}`);
  }
}

class FakeD1Database {
  currentRow: StoredRow | null = null;
  forceStaleUpdate = false;

  prepare(sql: string): D1PreparedStatement {
    return new FakeD1PreparedStatement(sql, this) as unknown as D1PreparedStatement;
  }
}

function makeD1Result(changes: number): D1Result {
  return {
    success: true,
    meta: {
      changes,
      duration: 0,
      last_row_id: 0,
      changed_db: true,
      size_after: 0,
      rows_read: 0,
      rows_written: changes,
    },
    results: [],
  };
}

function createEnv(db = new FakeD1Database()) {
  return { DB: db as unknown as D1Database };
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`${API_ORIGIN}${path}`, init);
}

async function fetchJson(
  env: ReturnType<typeof createEnv>,
  path: string,
  init?: RequestInit,
) {
  const workerRequest = request(path, init) as Parameters<typeof worker.fetch>[0];
  const response = await worker.fetch(workerRequest, env);
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
  let db: FakeD1Database;
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    db = new FakeD1Database();
    env = createEnv(db);
  });

  it('returns 404 when there is no current game', async () => {
    const { response, body } = await fetchJson(env, '/api/games/current');

    expect(response.status).toBe(404);
    expect(body.error).toBe('No current game');
  });

  it('creates a game', async () => {
    const { response, body } = await fetchJson(env, '/api/games', {
      method: 'POST',
    });

    expect(response.status).toBe(201);
    expect(body.id).toBeTruthy();
    expect(body).toMatchObject({
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
    expect(db.currentRow?.black_score).toBe(2);
    expect(db.currentRow?.white_score).toBe(2);
    expect(db.currentRow?.winner).toBeNull();
  });

  it('retrieves a persisted game', async () => {
    const created = await fetchJson(env, '/api/games', { method: 'POST' });

    const { response, body } = await fetchJson(env, '/api/games/current');

    expect(response.status).toBe(200);
    expect(body.id).toBe(created.body.id);
    expect(body.version).toBe(1);
    expect(body.state?.board?.[3][3]).toBe('white');
  });

  it('persists across separate Worker requests', async () => {
    await fetchJson(env, '/api/games', { method: 'POST' });

    const firstRead = await fetchJson(env, '/api/games/current');
    const secondRead = await fetchJson(env, '/api/games/current');

    expect(firstRead.body.id).toBe(secondRead.body.id);
    expect(secondRead.body.version).toBe(1);
  });

  it('applies and persists a legal move through the engine', async () => {
    await fetchJson(env, '/api/games', { method: 'POST' });

    const { response, body } = await fetchJson(env, '/api/games/current/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: 3, version: 1 }),
    });

    expect(response.status).toBe(200);
    expect(body.version).toBe(2);
    expect(body.state?.board?.[2][3]).toBe('black');
    expect(body.state?.board?.[3][3]).toBe('black');
    expect(body.state?.currentPlayer).toBe('white');
    expect(db.currentRow?.version).toBe(2);
    expect(db.currentRow?.black_score).toBe(4);
    expect(db.currentRow?.white_score).toBe(1);
  });

  it('rejects illegal moves', async () => {
    await fetchJson(env, '/api/games', { method: 'POST' });

    const { response, body } = await fetchJson(env, '/api/games/current/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 0, col: 0, version: 1 }),
    });

    expect(response.status).toBe(422);
    expect(body.error).toBe('Illegal move');
    expect(db.currentRow?.version).toBe(1);
  });

  it('rejects stale versions before applying a move', async () => {
    await fetchJson(env, '/api/games', { method: 'POST' });
    await fetchJson(env, '/api/games/current/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: 3, version: 1 }),
    });

    const { response, body } = await fetchJson(env, '/api/games/current/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: 2, version: 1 }),
    });

    expect(response.status).toBe(409);
    expect(body.error).toBe('Stale game version');
  });

  it('rejects stale versions when the atomic update loses the race', async () => {
    await fetchJson(env, '/api/games', { method: 'POST' });
    db.forceStaleUpdate = true;

    const { response, body } = await fetchJson(env, '/api/games/current/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: 3, expectedVersion: 1 }),
    });

    expect(response.status).toBe(409);
    expect(body.error).toBe('Stale game version');
  });

  it('rejects malformed move requests', async () => {
    await fetchJson(env, '/api/games', { method: 'POST' });

    const { response, body } = await fetchJson(env, '/api/games/current/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: '3', version: 1 }),
    });

    expect(response.status).toBe(400);
    expect(body.error).toBe('Malformed move request');
  });

  it('replaces the persisted game through POST /api/games', async () => {
    const first = await fetchJson(env, '/api/games', { method: 'POST' });
    await fetchJson(env, '/api/games/current/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: 3, version: 1 }),
    });

    const second = await fetchJson(env, '/api/games', { method: 'POST' });

    expect(second.response.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(second.body.version).toBe(1);
    expect(second.body.state?.board?.[2][3]).toBeNull();
    expect(db.currentRow?.version).toBe(1);
  });
});
