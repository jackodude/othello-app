import { beforeEach, describe, expect, it, vi } from 'vitest';

import worker from './index';

const API_ORIGIN = 'https://othello.test';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

    const code = String(this.params[0]);
    const row = this.db.rowsByCode.get(code);

    return row ? ({ ...row } as T) : null;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes('INSERT INTO games')) {
      const [
        id,
        joinCode,
        boardJson,
        currentPlayer,
        status,
        winner,
        blackScore,
        whiteScore,
        consecutivePasses,
        version,
        createdAt,
        updatedAt,
      ] = this.params;
      const code = String(joinCode);

      if (this.db.rowsByCode.has(code)) {
        throw new Error('UNIQUE constraint failed: games.join_code');
      }

      this.db.rowsByCode.set(code, {
        id,
        join_code: joinCode,
        board_json: boardJson,
        current_player: currentPlayer,
        status,
        winner,
        black_score: blackScore,
        white_score: whiteScore,
        consecutive_passes: consecutivePasses,
        version,
        created_at: createdAt,
        updated_at: updatedAt,
      });

      return makeD1Result(1);
    }

    if (this.sql.includes('UPDATE games')) {
      const id = this.params[9];
      const joinCode = String(this.params[10]);
      const expectedVersion = this.params[11];
      const currentRow = this.db.rowsByCode.get(joinCode);

      if (
        !currentRow ||
        this.db.forceStaleUpdate ||
        currentRow.id !== id ||
        currentRow.version !== expectedVersion
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
        consecutivePasses,
        version,
        updatedAt,
      ] = this.params;

      this.db.rowsByCode.set(joinCode, {
        ...currentRow,
        board_json: boardJson,
        current_player: currentPlayer,
        status,
        winner,
        black_score: blackScore,
        white_score: whiteScore,
        consecutive_passes: consecutivePasses,
        version,
        updated_at: updatedAt,
      });

      return makeD1Result(1);
    }

    throw new Error(`Unsupported run() SQL: ${this.sql}`);
  }
}

class FakeD1Database {
  readonly rowsByCode = new Map<string, StoredRow>();
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
    readonly joinCode?: string;
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

function mockJoinCodes(codes: readonly string[]) {
  const values = codes.join('').split('').map((character) => {
    const index = CODE_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new Error(`Invalid mocked code character: ${character}`);
    }
    return index;
  });

  let valueIndex = 0;

  return vi
    .spyOn(crypto, 'getRandomValues')
    .mockImplementation((array: ArrayBufferView | null) => {
      if (!(array instanceof Uint32Array)) {
        throw new Error('Expected Uint32Array');
      }

      for (let index = 0; index < array.length; index += 1) {
        array[index] = values[valueIndex] ?? 0;
        valueIndex += 1;
      }

      return array;
    });
}

describe('game API', () => {
  let db: FakeD1Database;
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    vi.restoreAllMocks();
    db = new FakeD1Database();
    env = createEnv(db);
  });

  it('creates two separate games with unique join codes', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);

    const first = await fetchJson(env, '/api/games', { method: 'POST' });
    const second = await fetchJson(env, '/api/games', { method: 'POST' });

    expect(first.response.status).toBe(201);
    expect(second.response.status).toBe(201);
    expect(first.body.joinCode).toBe('ABCDEF');
    expect(second.body.joinCode).toBe('GHJKLM');
    expect(first.body.id).not.toBe(second.body.id);
    expect(db.rowsByCode.size).toBe(2);
  });

  it('loads a game by join code', async () => {
    mockJoinCodes(['ABCDEF']);
    const created = await fetchJson(env, '/api/games', { method: 'POST' });

    const { response, body } = await fetchJson(
      env,
      `/api/games/${created.body.joinCode}`,
    );

    expect(response.status).toBe(200);
    expect(body.id).toBe(created.body.id);
    expect(body.joinCode).toBe('ABCDEF');
    expect(body.version).toBe(1);
  });

  it('looks up join codes case-insensitively', async () => {
    mockJoinCodes(['ABCDEF']);
    await fetchJson(env, '/api/games', { method: 'POST' });

    const { response, body } = await fetchJson(env, '/api/games/abcdef');

    expect(response.status).toBe(200);
    expect(body.joinCode).toBe('ABCDEF');
  });

  it('returns 404 for an unknown code', async () => {
    const { response, body } = await fetchJson(env, '/api/games/ZZZZZZ');

    expect(response.status).toBe(404);
    expect(body.error).toBe('Game not found');
  });

  it('applies a move in one game without affecting another', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const first = await fetchJson(env, '/api/games', { method: 'POST' });
    const second = await fetchJson(env, '/api/games', { method: 'POST' });

    const moved = await fetchJson(env, `/api/games/${first.body.joinCode}/moves`, {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: 3, expectedVersion: 1 }),
    });
    const untouched = await fetchJson(env, `/api/games/${second.body.joinCode}`);

    expect(moved.response.status).toBe(200);
    expect(moved.body.version).toBe(2);
    expect(moved.body.state?.board?.[2][3]).toBe('black');
    expect(untouched.body.version).toBe(1);
    expect(untouched.body.state?.board?.[2][3]).toBeNull();
  });

  it('rejects illegal moves', async () => {
    mockJoinCodes(['ABCDEF']);
    await fetchJson(env, '/api/games', { method: 'POST' });

    const { response, body } = await fetchJson(env, '/api/games/ABCDEF/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 0, col: 0, expectedVersion: 1 }),
    });

    expect(response.status).toBe(422);
    expect(body.error).toBe('Illegal move');
    expect(db.rowsByCode.get('ABCDEF')?.version).toBe(1);
  });

  it('rejects malformed move requests', async () => {
    mockJoinCodes(['ABCDEF']);
    await fetchJson(env, '/api/games', { method: 'POST' });

    const { response, body } = await fetchJson(env, '/api/games/ABCDEF/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: '3', expectedVersion: 1 }),
    });

    expect(response.status).toBe(400);
    expect(body.error).toBe('Malformed move request');
  });

  it('rejects stale versions', async () => {
    mockJoinCodes(['ABCDEF']);
    await fetchJson(env, '/api/games', { method: 'POST' });
    await fetchJson(env, '/api/games/ABCDEF/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: 3, expectedVersion: 1 }),
    });

    const { response, body } = await fetchJson(env, '/api/games/ABCDEF/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: 2, expectedVersion: 1 }),
    });

    expect(response.status).toBe(409);
    expect(body.error).toBe('Stale game version');
  });

  it('rejects stale versions when the atomic update loses the race', async () => {
    mockJoinCodes(['ABCDEF']);
    await fetchJson(env, '/api/games', { method: 'POST' });
    db.forceStaleUpdate = true;

    const { response, body } = await fetchJson(env, '/api/games/ABCDEF/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: 3, expectedVersion: 1 }),
    });

    expect(response.status).toBe(409);
    expect(body.error).toBe('Stale game version');
  });

  it('retries join-code collisions safely', async () => {
    mockJoinCodes(['ABCDEF', 'ABCDEF', 'GHJKLM']);

    const first = await fetchJson(env, '/api/games', { method: 'POST' });
    const second = await fetchJson(env, '/api/games', { method: 'POST' });

    expect(first.response.status).toBe(201);
    expect(second.response.status).toBe(201);
    expect(first.body.joinCode).toBe('ABCDEF');
    expect(second.body.joinCode).toBe('GHJKLM');
    expect(db.rowsByCode.size).toBe(2);
  });

  it('persists across separate requests', async () => {
    mockJoinCodes(['ABCDEF']);
    await fetchJson(env, '/api/games', { method: 'POST' });

    const firstRead = await fetchJson(env, '/api/games/ABCDEF');
    const secondRead = await fetchJson(env, '/api/games/ABCDEF');

    expect(firstRead.body.id).toBe(secondRead.body.id);
    expect(secondRead.body.version).toBe(1);
  });

  it('retires the old singleton current endpoints', async () => {
    const read = await fetchJson(env, '/api/games/current');
    const move = await fetchJson(env, '/api/games/current/moves', {
      method: 'POST',
      body: JSON.stringify({ row: 2, col: 3, expectedVersion: 1 }),
    });

    expect(read.response.status).toBe(404);
    expect(move.response.status).toBe(404);
  });
});
