import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyMove, createInitialGameState, getScores } from '../src/game';
import type { GameState, Position } from '../src/game';
import worker, {
  deriveNotificationEvent,
  isTurnReminderDue,
  sendDueTurnReminders,
  sendNotificationEvent,
} from './index';

const API_ORIGIN = 'https://othello.test';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type StoredRow = Record<string, unknown>;
type TestEnv = {
  readonly DB: D1Database;
  readonly ENABLE_TEST_CONTROLS?: string;
  readonly VAPID_PUBLIC_KEY?: string;
  readonly VAPID_PRIVATE_KEY?: string;
  readonly VAPID_SUBJECT?: string;
};

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
    if (this.sql.includes('FROM push_notification_events')) {
      const [gameId, gameVersion, eventType, recipientPlayerColor] = this.params;
      const event = this.db.pushNotificationEvents.find(
        (notificationEvent) =>
          notificationEvent.game_id === gameId &&
          notificationEvent.game_version === gameVersion &&
          notificationEvent.event_type === eventType &&
          notificationEvent.recipient_player_color === recipientPlayerColor,
      );

      return event
        ? ({
            id: event.id,
            delivery_state: event.delivery_state,
            attempts: event.attempts,
          } as T)
        : null;
    }

    if (this.sql.includes('FROM push_subscriptions')) {
      const [gameId, playerColor, endpoint] = this.params;
      const subscription = this.db.pushSubscriptions.find(
        (pushSubscription) =>
          pushSubscription.game_id === gameId &&
          pushSubscription.player_color === playerColor &&
          pushSubscription.endpoint === endpoint,
      );

      return subscription
        ? ({
            id: subscription.id,
            endpoint: subscription.endpoint,
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          } as T)
        : null;
    }

    if (!this.sql.includes('SELECT')) {
      throw new Error(`Unsupported first() SQL: ${this.sql}`);
    }

    const lookup = String(this.params[0]);
    const row = this.sql.includes('WHERE id = ?')
      ? [...this.db.rowsByCode.values()].find((gameRow) => gameRow.id === lookup)
      : this.db.rowsByCode.get(lookup.toUpperCase());

    return row ? ({ ...row } as T) : null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    if (this.sql.includes('FROM games')) {
      const status = this.params[0];
      const limit = Number(this.params[1] ?? Number.MAX_SAFE_INTEGER);
      const results = [...this.db.rowsByCode.values()]
        .filter(
          (row) =>
            row.status === status &&
            row.black_joined === 1 &&
            row.white_joined === 1 &&
            typeof row.current_turn_started_at === 'string',
        )
        .sort((left, right) =>
          String(left.current_turn_started_at).localeCompare(
            String(right.current_turn_started_at),
          ),
        )
        .slice(0, limit)
        .map((row) => ({ ...row })) as T[];

      return {
        ...makeD1Result(0),
        results,
      };
    }

    if (this.sql.includes('FROM push_subscriptions')) {
      const gameId = this.params[0];
      const playerColor = this.params[1];
      const results = this.db.pushSubscriptions
        .filter(
          (subscription) =>
            subscription.game_id === gameId &&
            subscription.player_color === playerColor,
        )
        .map((subscription) => ({
          id: subscription.id,
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        })) as T[];

      return {
        ...makeD1Result(0),
        results,
      };
    }

    throw new Error(`Unsupported all() SQL: ${this.sql}`);
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes('INSERT INTO push_subscriptions')) {
      const [id, gameId, playerColor, endpoint, p256dh, auth, createdAt, updatedAt] =
        this.params;
      const existingIndex = this.db.pushSubscriptions.findIndex(
        (subscription) =>
          subscription.game_id === gameId &&
          subscription.player_color === playerColor &&
          subscription.endpoint === endpoint,
      );

      const row = {
        id,
        game_id: gameId,
        player_color: playerColor,
        endpoint,
        p256dh,
        auth,
        created_at: createdAt,
        updated_at: updatedAt,
      };

      if (existingIndex >= 0) {
        this.db.pushSubscriptions[existingIndex] = {
          ...this.db.pushSubscriptions[existingIndex],
          p256dh,
          auth,
          updated_at: updatedAt,
        };
      } else {
        this.db.pushSubscriptions.push(row);
      }

      return makeD1Result(1);
    }

    if (this.sql.includes('DELETE FROM push_subscriptions WHERE id = ?')) {
      const id = this.params[0];
      const before = this.db.pushSubscriptions.length;
      this.db.pushSubscriptions = this.db.pushSubscriptions.filter(
        (subscription) => subscription.id !== id,
      );
      return makeD1Result(before - this.db.pushSubscriptions.length);
    }

    if (this.sql.includes('DELETE FROM push_subscriptions')) {
      const [gameId, playerColor, endpoint] = this.params;
      const before = this.db.pushSubscriptions.length;
      this.db.pushSubscriptions = this.db.pushSubscriptions.filter(
        (subscription) =>
          subscription.game_id !== gameId ||
          subscription.player_color !== playerColor ||
          subscription.endpoint !== endpoint,
      );
      return makeD1Result(before - this.db.pushSubscriptions.length);
    }

    if (this.sql.includes('INSERT INTO push_notification_events')) {
      const [
        id,
        gameId,
        gameVersion,
        eventType,
        recipientPlayerColor,
        deliveryState,
        attempts,
        lastError,
        createdAt,
        updatedAt,
      ] = this.params;
      const exists = this.db.pushNotificationEvents.some(
        (event) =>
          event.game_id === gameId &&
          event.game_version === gameVersion &&
          event.event_type === eventType &&
          event.recipient_player_color === recipientPlayerColor,
      );

      if (exists) {
        throw new Error('UNIQUE constraint failed: push_notification_events');
      }

      this.db.pushNotificationEvents.push({
        id,
        game_id: gameId,
        game_version: gameVersion,
        event_type: eventType,
        recipient_player_color: recipientPlayerColor,
        delivery_state: deliveryState,
        attempts,
        last_error: lastError,
        created_at: createdAt,
        updated_at: updatedAt,
      });

      return makeD1Result(1);
    }

    if (this.sql.includes('UPDATE push_notification_events')) {
      const [deliveryState, attempts, lastError, updatedAt, id] = this.params;
      const event = this.db.pushNotificationEvents.find(
        (notificationEvent) => notificationEvent.id === id,
      );
      if (!event) {
        return makeD1Result(0);
      }

      event.delivery_state = deliveryState;
      event.attempts = attempts;
      event.last_error = lastError;
      event.updated_at = updatedAt;

      return makeD1Result(1);
    }

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
        blackDigest,
        whiteDigest,
        inviteDigest,
        whiteJoined,
        blackCreatedAt,
        inviteCreatedAt,
        inviteClaimedAt,
        whiteCreatedAt,
        rematchOfGameId,
        blackJoined,
        blackInviteDigest,
        blackInviteCreatedAt,
        blackInviteClaimedAt,
        lastMoveVersion,
        lastMovePlayer,
        lastMovePlacedIndex,
        lastMoveFlippedIndicesJson,
        blackPlayerName,
        whitePlayerName,
        endedReason,
        forfeitedBy,
        rematchGameId,
        rematchRequestedBy,
        rematchRequestedAt,
        currentTurnStartedAt,
        lastTurnReminderSentAt,
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
        black_player_token_digest: blackDigest,
        white_player_token_digest: whiteDigest,
        white_invite_token_digest: inviteDigest,
        white_joined: whiteJoined,
        black_player_created_at: blackCreatedAt,
        white_invite_created_at: inviteCreatedAt,
        white_invite_claimed_at: inviteClaimedAt,
        white_player_created_at: whiteCreatedAt,
        rematch_of_game_id: rematchOfGameId,
        black_joined: blackJoined,
        black_invite_token_digest: blackInviteDigest,
        black_invite_created_at: blackInviteCreatedAt,
        black_invite_claimed_at: blackInviteClaimedAt,
        last_move_version: lastMoveVersion,
        last_move_player: lastMovePlayer,
        last_move_placed_index: lastMovePlacedIndex,
        last_move_flipped_indices_json: lastMoveFlippedIndicesJson,
        black_player_name: blackPlayerName,
        white_player_name: whitePlayerName,
        ended_reason: endedReason,
        forfeited_by: forfeitedBy,
        rematch_game_id: rematchGameId,
        rematch_requested_by: rematchRequestedBy,
        rematch_requested_at: rematchRequestedAt,
        current_turn_started_at: currentTurnStartedAt,
        last_turn_reminder_sent_at: lastTurnReminderSentAt,
      });

      return makeD1Result(1);
    }

    if (this.sql.includes('white_player_token_digest') && this.sql.includes('white_joined = 0')) {
      const whiteDigest = this.params[0];
      const nextVersion = this.params[1];
      const joinCode = String(this.params[8]);
      const inviteDigest = this.params[9];
      const row = this.db.rowsByCode.get(joinCode);

      if (
        !row ||
        this.db.forceClaimRace ||
        row.white_joined !== 0 ||
        row.white_invite_token_digest !== inviteDigest
      ) {
        return makeD1Result(0);
      }

      this.db.rowsByCode.set(joinCode, {
        ...row,
        white_player_token_digest: whiteDigest,
        white_invite_token_digest: null,
        white_joined: 1,
        version: nextVersion,
        white_invite_claimed_at: this.params[2],
        white_player_created_at: this.params[3],
        white_player_name: this.params[4],
        current_turn_started_at: this.params[5],
        last_turn_reminder_sent_at: null,
        updated_at: this.params[6],
      });

      return makeD1Result(1);
    }

    if (this.sql.includes('black_player_token_digest') && this.sql.includes('black_joined = 0')) {
      const blackDigest = this.params[0];
      const nextVersion = this.params[1];
      const joinCode = String(this.params[8]);
      const inviteDigest = this.params[9];
      const row = this.db.rowsByCode.get(joinCode);

      if (
        !row ||
        row.black_joined !== 0 ||
        row.black_invite_token_digest !== inviteDigest
      ) {
        return makeD1Result(0);
      }

      this.db.rowsByCode.set(joinCode, {
        ...row,
        black_player_token_digest: blackDigest,
        black_invite_token_digest: null,
        black_joined: 1,
        version: nextVersion,
        black_invite_claimed_at: this.params[2],
        black_player_created_at: this.params[3],
        black_player_name: this.params[4],
        current_turn_started_at: this.params[5],
        last_turn_reminder_sent_at: null,
        updated_at: this.params[6],
      });

      return makeD1Result(1);
    }

    if (
      this.sql.includes('UPDATE games') &&
      (this.sql.includes('black_player_name') ||
        this.sql.includes('white_player_name')) &&
      !this.sql.includes('board_json')
    ) {
      const displayName = this.params[0];
      const updatedAt = this.params[1];
      const id = this.params[2];
      const joinCode = String(this.params[3]);
      const currentRow = this.db.rowsByCode.get(joinCode);
      if (!currentRow || currentRow.id !== id) {
        return makeD1Result(0);
      }

      this.db.rowsByCode.set(joinCode, {
        ...currentRow,
        ...(this.sql.includes('black_player_name')
          ? { black_player_name: displayName }
          : { white_player_name: displayName }),
        updated_at: updatedAt,
      });

      return makeD1Result(1);
    }

    if (this.sql.includes('UPDATE games') && this.sql.includes('rematch_game_id')) {
      const [
        rematchGameId,
        rematchRequestedBy,
        rematchRequestedAt,
        updatedAt,
        nextVersion,
        id,
        joinCode,
        expectedStatus,
        expectedVersion,
      ] = this.params;
      const row = this.db.rowsByCode.get(String(joinCode));
      if (
        !row ||
        row.id !== id ||
        row.status !== expectedStatus ||
        row.version !== expectedVersion ||
        row.rematch_game_id
      ) {
        return makeD1Result(0);
      }

      this.db.rowsByCode.set(String(joinCode), {
        ...row,
        rematch_game_id: rematchGameId,
        rematch_requested_by: rematchRequestedBy,
        rematch_requested_at: rematchRequestedAt,
        updated_at: updatedAt,
        version: nextVersion,
      });

      return makeD1Result(1);
    }

    if (
      this.sql.includes('UPDATE games') &&
      this.sql.includes('last_turn_reminder_sent_at = ?') &&
      this.sql.includes('current_turn_started_at = ?') &&
      this.sql.includes('updated_at = updated_at')
    ) {
      const [
        reminderSentAt,
        id,
        joinCode,
        expectedVersion,
        expectedStatus,
        expectedPlayer,
        expectedTurnStartedAt,
        previousReminder,
      ] = this.params;
      const row = this.db.rowsByCode.get(String(joinCode));

      if (
        !row ||
        row.id !== id ||
        row.version !== expectedVersion ||
        row.status !== expectedStatus ||
        row.current_player !== expectedPlayer ||
        row.current_turn_started_at !== expectedTurnStartedAt ||
        (row.last_turn_reminder_sent_at ?? null) !== (previousReminder ?? null)
      ) {
        return makeD1Result(0);
      }

      this.db.rowsByCode.set(String(joinCode), {
        ...row,
        last_turn_reminder_sent_at: reminderSentAt,
      });

      return makeD1Result(1);
    }

    if (
      this.sql.includes('UPDATE games') &&
      this.sql.includes('last_turn_reminder_sent_at = ?') &&
      this.sql.includes('current_turn_started_at = ?') &&
      this.sql.includes('last_turn_reminder_sent_at = ?')
    ) {
      const [
        previousReminder,
        id,
        joinCode,
        expectedVersion,
        expectedStatus,
        expectedPlayer,
        expectedTurnStartedAt,
        claimedReminder,
      ] = this.params;
      const row = this.db.rowsByCode.get(String(joinCode));

      if (
        !row ||
        row.id !== id ||
        row.version !== expectedVersion ||
        row.status !== expectedStatus ||
        row.current_player !== expectedPlayer ||
        row.current_turn_started_at !== expectedTurnStartedAt ||
        row.last_turn_reminder_sent_at !== claimedReminder
      ) {
        return makeD1Result(0);
      }

      this.db.rowsByCode.set(String(joinCode), {
        ...row,
        last_turn_reminder_sent_at: previousReminder,
      });

      return makeD1Result(1);
    }

    if (
      this.sql.includes('UPDATE games') &&
      this.sql.includes('last_turn_reminder_sent_at = ?') &&
      this.sql.includes('current_player = ?')
    ) {
      const [reminderSentAt, id, joinCode, expectedVersion, expectedStatus, expectedPlayer] =
        this.params;
      const row = this.db.rowsByCode.get(String(joinCode));

      if (
        !row ||
        row.id !== id ||
        row.version !== expectedVersion ||
        row.status !== expectedStatus ||
        row.current_player !== expectedPlayer
      ) {
        return makeD1Result(0);
      }

      this.db.rowsByCode.set(String(joinCode), {
        ...row,
        last_turn_reminder_sent_at: reminderSentAt,
      });

      return makeD1Result(1);
    }

    if (
      this.sql.includes('UPDATE games') &&
      this.sql.includes('ended_reason') &&
      this.sql.includes('white_invite_token_digest = NULL')
    ) {
      const [
        status,
        version,
        endedReason,
        updatedAt,
        id,
        joinCode,
        expectedStatus,
        expectedVersion,
      ] = this.params;
      const row = this.db.rowsByCode.get(String(joinCode));
      if (
        !row ||
        row.id !== id ||
        row.status !== expectedStatus ||
        row.version !== expectedVersion ||
        row.black_joined !== 1 ||
        row.white_joined !== 0
      ) {
        return makeD1Result(0);
      }

      this.db.rowsByCode.set(String(joinCode), {
        ...row,
        status,
        winner: null,
        version,
        ended_reason: endedReason,
        forfeited_by: null,
        white_invite_token_digest: null,
        black_invite_token_digest: null,
        last_move_version: null,
        last_move_player: null,
        last_move_placed_index: null,
        last_move_flipped_indices_json: null,
        current_turn_started_at: null,
        last_turn_reminder_sent_at: null,
        updated_at: updatedAt,
      });

      return makeD1Result(1);
    }

    if (this.sql.includes('UPDATE games') && this.sql.includes('ended_reason')) {
      const [
        status,
        winner,
        version,
        endedReason,
        forfeitedBy,
        updatedAt,
        id,
        joinCode,
        expectedStatus,
        expectedVersion,
      ] = this.params;
      const currentRow = this.db.rowsByCode.get(String(joinCode));

      if (
        !currentRow ||
        this.db.forceStaleUpdate ||
        currentRow.id !== id ||
        currentRow.status !== expectedStatus ||
        currentRow.version !== expectedVersion
      ) {
        return makeD1Result(0);
      }

      this.db.rowsByCode.set(String(joinCode), {
        ...currentRow,
        status,
        winner,
        version,
        ended_reason: endedReason,
        forfeited_by: forfeitedBy,
        last_move_version: null,
        last_move_player: null,
        last_move_placed_index: null,
        last_move_flipped_indices_json: null,
        current_turn_started_at: null,
        last_turn_reminder_sent_at: null,
        updated_at: updatedAt,
      });

      return makeD1Result(1);
    }

    if (this.sql.includes('UPDATE games')) {
      const id = this.params[14];
      const joinCode = String(this.params[15]);
      const expectedVersion = this.params[16];
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
        lastMoveVersion,
        lastMovePlayer,
        lastMovePlacedIndex,
        lastMoveFlippedIndicesJson,
        currentTurnStartedAt,
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
        last_move_version: lastMoveVersion,
        last_move_player: lastMovePlayer,
        last_move_placed_index: lastMovePlacedIndex,
        last_move_flipped_indices_json: lastMoveFlippedIndicesJson,
        current_turn_started_at: currentTurnStartedAt,
        last_turn_reminder_sent_at: null,
        updated_at: updatedAt,
      });

      return makeD1Result(1);
    }

    throw new Error(`Unsupported run() SQL: ${this.sql}`);
  }
}

class FakeD1Database {
  readonly rowsByCode = new Map<string, StoredRow>();
  pushSubscriptions: StoredRow[] = [];
  pushNotificationEvents: StoredRow[] = [];
  forceStaleUpdate = false;
  forceClaimRace = false;

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

function createEnv(db = new FakeD1Database(), testControlsEnabled = false): TestEnv {
  return {
    DB: db as unknown as D1Database,
    ENABLE_TEST_CONTROLS: testControlsEnabled ? 'true' : undefined,
  };
}

function createPushEnv(db = new FakeD1Database()): TestEnv {
  return {
    DB: db as unknown as D1Database,
    VAPID_PUBLIC_KEY: 'public-key',
    VAPID_PRIVATE_KEY: '{"kty":"EC","crv":"P-256","x":"x","y":"y","d":"d"}',
    VAPID_SUBJECT: 'mailto:test@example.com',
  };
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext;
}

function auth(token?: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  const response = await worker.fetch(workerRequest, env, createExecutionContext());
  const body = (await response.json()) as {
    readonly id?: string;
    readonly joinCode?: string;
    readonly version?: number;
    readonly playerColor?: string;
    readonly opponentJoined?: boolean;
    readonly playerName?: string | null;
    readonly opponentName?: string | null;
    readonly winner?: string | null;
    readonly endedReason?: string | null;
    readonly forfeitedBy?: string | null;
    readonly players?: {
      readonly black?: { readonly name?: string | null };
      readonly white?: { readonly name?: string | null };
    };
    readonly playerToken?: string;
    readonly invitation?: string;
    readonly games?: readonly {
      readonly joinCode?: string;
      readonly playerColor?: string;
      readonly playerName?: string | null;
      readonly opponentName?: string | null;
      readonly progress?: number;
    }[];
    readonly enabled?: boolean;
    readonly success?: boolean;
    readonly provider?: string;
    readonly httpStatus?: number | null;
    readonly permanentFailure?: boolean;
    readonly temporaryFailure?: boolean;
    readonly lastMove?: {
      readonly version?: number;
      readonly player?: string;
      readonly placedIndex?: number;
      readonly flippedIndices?: readonly number[];
    } | null;
    readonly error?: string;
    readonly black_player_token_digest?: string;
    readonly state?: {
      readonly currentPlayer?: string;
      readonly status?: string;
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
  let tokenByte = 1;

  return vi
    .spyOn(crypto, 'getRandomValues')
    .mockImplementation((array: ArrayBufferView | null) => {
      if (array instanceof Uint32Array) {
        for (let index = 0; index < array.length; index += 1) {
          array[index] = values[valueIndex] ?? 0;
          valueIndex += 1;
        }
        return array;
      }

      if (array instanceof Uint8Array) {
        for (let index = 0; index < array.length; index += 1) {
          array[index] = tokenByte % 255;
          tokenByte += 1;
        }
        return array;
      }

      throw new Error('Expected typed array');
    });
}

function splitInvitation(invitation: string) {
  const [joinCode, inviteToken] = invitation.split(':', 2);
  return { joinCode, inviteToken };
}

function finishGame(db: FakeD1Database, joinCode: string) {
  const row = db.rowsByCode.get(joinCode);
  if (!row) {
    throw new Error(`Missing game ${joinCode}`);
  }

  const board = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 'black'));
  db.rowsByCode.set(joinCode, {
    ...row,
    board_json: JSON.stringify(board),
    current_player: 'black',
    status: 'finished',
    winner: 'black',
    black_score: 64,
    white_score: 0,
    consecutive_passes: 0,
    updated_at: new Date().toISOString(),
  });
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function createValidPushMaterial() {
  const vapidKeys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey('jwk', vapidKeys.privateKey);
  const subscriptionKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair;
  const rawPublicKey = await crypto.subtle.exportKey(
    'raw',
    subscriptionKeys.publicKey,
  ) as ArrayBuffer;

  return {
    privateJwk: JSON.stringify(privateJwk),
    p256dh: base64Url(new Uint8Array(rawPublicKey)),
    auth: base64Url(new Uint8Array(16).fill(7)),
  };
}

async function createGame(
  env: ReturnType<typeof createEnv>,
  code = 'ABCDEF',
  displayName?: string,
) {
  mockJoinCodes([code]);
  return fetchJson(env, '/api/games', {
    method: 'POST',
    body:
      displayName === undefined
        ? undefined
        : JSON.stringify({ displayName }),
  });
}

async function joinWhite(
  env: ReturnType<typeof createEnv>,
  joinCode: string,
  inviteToken: string,
  displayName?: string,
) {
  return fetchJson(env, `/api/games/${joinCode}/join`, {
    method: 'POST',
    body: JSON.stringify(
      displayName === undefined ? { inviteToken } : { inviteToken, displayName },
    ),
  });
}

function findAutomaticPassScenario(): {
  readonly state: GameState;
  readonly move: Position;
} {
  const queue: GameState[] = [createInitialGameState()];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const state = queue.shift()!;
    const key = JSON.stringify({
      board: state.board,
      currentPlayer: state.currentPlayer,
      consecutivePasses: state.consecutivePasses,
    });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    for (const move of state.legalMoves) {
      const nextState = applyMove(state, move);
      if (!nextState) {
        continue;
      }
      if (
        nextState.status === 'playing' &&
        nextState.currentPlayer === state.currentPlayer
      ) {
        return { state, move };
      }
      queue.push(nextState);
    }
  }

  throw new Error('Unable to find automatic pass scenario');
}

describe('authenticated game API', () => {
  let db: FakeD1Database;
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    vi.restoreAllMocks();
    db = new FakeD1Database();
    env = createEnv(db);
  });

  it('assigns the creator to Black and returns credentials only on creation', async () => {
    const { response, body } = await createGame(env);

    expect(response.status).toBe(201);
    expect(body.joinCode).toBe('ABCDEF');
    expect(body.playerColor).toBe('black');
    expect(body.playerToken).toBeTruthy();
    expect(body.invitation).toContain('ABCDEF:');
    expect(body.opponentJoined).toBe(false);
    expect(body.black_player_token_digest).toBeUndefined();

    const read = await fetchJson(env, '/api/games/ABCDEF', {
      headers: auth(body.playerToken),
    });

    expect(read.response.status).toBe(200);
    expect(read.body.playerToken).toBeUndefined();
    expect(read.body.invitation).toBeUndefined();
    expect(read.body.playerColor).toBe('black');
  });

  it('claims White with an invitation and returns a different private token', async () => {
    const created = await createGame(env);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);

    const joined = await joinWhite(env, joinCode, inviteToken);

    expect(joined.response.status).toBe(200);
    expect(joined.body.playerColor).toBe('white');
    expect(joined.body.playerToken).toBeTruthy();
    expect(joined.body.playerToken).not.toBe(created.body.playerToken);
    expect(joined.body.invitation).toBeUndefined();
    expect(joined.body.opponentJoined).toBe(true);
  });

  it('stores display names for created and joined players', async () => {
    const created = await createGame(env, 'ABCDEF', '  Ada   Lovelace  ');
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    const joined = await joinWhite(env, joinCode, inviteToken, 'Grace Hopper');

    expect(created.response.status).toBe(201);
    expect(created.body.playerName).toBe('Ada Lovelace');
    expect(created.body.players?.black?.name).toBe('Ada Lovelace');
    expect(joined.response.status).toBe(200);
    expect(joined.body.playerName).toBe('Grace Hopper');
    expect(joined.body.opponentName).toBe('Ada Lovelace');

    const blackRead = await fetchJson(env, `/api/games/${joinCode}`, {
      headers: auth(created.body.playerToken),
    });
    expect(blackRead.body.opponentName).toBe('Grace Hopper');
    expect(blackRead.body.players?.white?.name).toBe('Grace Hopper');
  });

  it('rejects invalid display names without rejecting omitted names', async () => {
    const unnamed = await createGame(env);
    expect(unnamed.response.status).toBe(201);
    expect(unnamed.body.playerName).toBeNull();

    const invalidCreate = await fetchJson(env, '/api/games', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'x'.repeat(25) }),
    });
    expect(invalidCreate.response.status).toBe(400);

    const { joinCode, inviteToken } = splitInvitation(unnamed.body.invitation!);
    const invalidJoin = await joinWhite(env, joinCode, inviteToken, '   ');
    expect(invalidJoin.response.status).toBe(400);
  });

  it('updates only the authenticated player profile and saved-game metadata', async () => {
    const created = await createGame(env, 'ABCDEF', 'Black Player');
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    const white = await joinWhite(env, joinCode, inviteToken, 'White Player');

    const updated = await fetchJson(env, `/api/games/${joinCode}/player-profile`, {
      method: 'PATCH',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({ displayName: 'New Black' }),
    });
    expect(updated.response.status).toBe(200);
    expect(updated.body.playerName).toBe('New Black');
    expect(updated.body.opponentName).toBe('White Player');
    expect(updated.body.version).toBe(2);

    const whiteRead = await fetchJson(env, `/api/games/${joinCode}`, {
      headers: auth(white.body.playerToken),
    });
    expect(whiteRead.body.playerName).toBe('White Player');
    expect(whiteRead.body.opponentName).toBe('New Black');

    const saved = await fetchJson(env, '/api/games/saved', {
      method: 'POST',
      body: JSON.stringify({
        credentials: [
          { joinCode, playerToken: created.body.playerToken },
          { joinCode, playerToken: white.body.playerToken },
        ],
      }),
    });
    expect(saved.response.status).toBe(200);
    expect(saved.body.games).toHaveLength(1);
    expect(saved.body.games?.[0].playerName).toBe('New Black');
    expect(saved.body.games?.[0].opponentName).toBe('White Player');
    expect(saved.body.games?.[0].progress).toBe(0);

    expect(
      (await fetchJson(env, `/api/games/${joinCode}/player-profile`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName: 'No Auth' }),
      })).response.status,
    ).toBe(401);
    expect(
      (await fetchJson(env, `/api/games/${joinCode}/player-profile`, {
        method: 'PATCH',
        headers: auth(created.body.playerToken),
        body: JSON.stringify({ displayName: 'x'.repeat(25) }),
      })).response.status,
    ).toBe(400);
  });

  it('increments the resource version when White joins so Black polling sees it', async () => {
    const created = await createGame(env);
    const blackVersion = created.body.version;
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);

    await joinWhite(env, joinCode, inviteToken);
    const blackRead = await fetchJson(env, `/api/games/${joinCode}`, {
      headers: auth(created.body.playerToken),
    });

    expect(blackVersion).toBe(1);
    expect(blackRead.response.status).toBe(200);
    expect(blackRead.body.version).toBe(blackVersion! + 1);
    expect(blackRead.body.opponentJoined).toBe(true);
  });

  it('does not allow White to be claimed twice or concurrently', async () => {
    const created = await createGame(env);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);

    expect((await joinWhite(env, joinCode, inviteToken)).response.status).toBe(200);
    expect((await joinWhite(env, joinCode, inviteToken)).response.status).toBe(409);

    const second = await createGame(env, 'GHJKLM');
    const secondInvite = splitInvitation(second.body.invitation!);
    db.forceClaimRace = true;
    expect(
      (await joinWhite(env, secondInvite.joinCode, secondInvite.inviteToken)).response
        .status,
    ).toBe(409);
  });

  it('rejects invalid and malformed join requests', async () => {
    await createGame(env);

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/join', {
        method: 'POST',
        body: JSON.stringify({ inviteToken: 42 }),
      })).response.status,
    ).toBe(400);
    expect((await joinWhite(env, 'ABCDEF', 'wrong')).response.status).toBe(403);
    expect((await joinWhite(env, 'ZZZZZZ', 'wrong')).response.status).toBe(404);
  });

  it('requires valid player tokens for reads and rejects cross-game tokens', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const first = await fetchJson(env, '/api/games', { method: 'POST' });
    const second = await fetchJson(env, '/api/games', { method: 'POST' });

    expect((await fetchJson(env, '/api/games/ABCDEF')).response.status).toBe(401);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF', {
        headers: auth('invalid'),
      })).response.status,
    ).toBe(401);
    expect(
      (await fetchJson(env, '/api/games/GHJKLM', {
        headers: auth(first.body.playerToken),
      })).response.status,
    ).toBe(401);
    expect(
      (await fetchJson(env, '/api/games/GHJKLM', {
        headers: auth(second.body.playerToken),
      })).response.status,
    ).toBe(200);
  });

  it('enforces join and turn ownership for moves', async () => {
    const created = await createGame(env);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(created.body.playerToken),
        body: JSON.stringify({ row: 2, col: 3, expectedVersion: 1 }),
      })).response.status,
    ).toBe(403);

    const white = await joinWhite(env, joinCode, inviteToken);

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(white.body.playerToken),
        body: JSON.stringify({ row: 2, col: 3, expectedVersion: 1 }),
      })).response.status,
    ).toBe(403);

    const blackMove = await fetchJson(env, '/api/games/ABCDEF/moves', {
      method: 'POST',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({ row: 2, col: 3, expectedVersion: 2 }),
    });

    expect(blackMove.response.status).toBe(200);
    expect(blackMove.body.version).toBe(3);
    expect(blackMove.body.state?.currentPlayer).toBe('white');
    expect(blackMove.body.lastMove).toEqual({
      version: 3,
      player: 'black',
      placedIndex: 19,
      flippedIndices: [27],
    });

    const persistedRead = await fetchJson(env, '/api/games/ABCDEF', {
      headers: auth(created.body.playerToken),
    });
    expect(persistedRead.body.lastMove).toEqual(blackMove.body.lastMove);

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(created.body.playerToken),
        body: JSON.stringify({ row: 2, col: 2, expectedVersion: 3 }),
      })).response.status,
    ).toBe(403);

    const whiteMove = await fetchJson(env, '/api/games/ABCDEF/moves', {
      method: 'POST',
      headers: auth(white.body.playerToken),
      body: JSON.stringify({ row: 2, col: 2, expectedVersion: 3 }),
    });

    expect(whiteMove.response.status).toBe(200);
    expect(whiteMove.body.state?.currentPlayer).toBe('black');
    expect(whiteMove.body.lastMove?.player).toBe('white');
    expect(whiteMove.body.lastMove?.version).toBe(4);
  });

  it('preserves malformed, illegal, stale, and atomic stale move responses', async () => {
    const created = await createGame(env);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    const white = await joinWhite(env, joinCode, inviteToken);
    const validMove = await fetchJson(env, '/api/games/ABCDEF/moves', {
      method: 'POST',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({ row: 2, col: 3, expectedVersion: 2 }),
    });
    const previousLastMove = validMove.body.lastMove;

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(created.body.playerToken),
        body: JSON.stringify({ row: 2, col: '3', expectedVersion: 3 }),
      })).response.status,
    ).toBe(400);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(white.body.playerToken),
        body: JSON.stringify({ row: 0, col: 0, expectedVersion: 3 }),
      })).response.status,
    ).toBe(422);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(white.body.playerToken),
        body: JSON.stringify({ row: 2, col: 3, expectedVersion: 99 }),
      })).response.status,
    ).toBe(409);

    db.forceStaleUpdate = true;
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(white.body.playerToken),
        body: JSON.stringify({ row: 2, col: 2, expectedVersion: 3 }),
      })).response.status,
    ).toBe(409);

    const read = await fetchJson(env, '/api/games/ABCDEF', {
      headers: auth(created.body.playerToken),
    });
    expect(read.body.lastMove).toEqual(previousLastMove);
  });

  it('allows Black to forfeit a joined unfinished game and preserves board state', async () => {
    const created = await createGame(env);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    await joinWhite(env, joinCode, inviteToken);
    const before = { ...db.rowsByCode.get(joinCode)! };

    const forfeited = await fetchJson(env, `/api/games/${joinCode}/forfeit`, {
      method: 'POST',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({
        winner: 'black',
        board: Array.from({ length: 8 }, () => []),
      }),
    });

    expect(forfeited.response.status).toBe(200);
    expect(forfeited.body.version).toBe(3);
    expect(forfeited.body.winner).toBe('white');
    expect(forfeited.body.endedReason).toBe('forfeit');
    expect(forfeited.body.forfeitedBy).toBe('black');
    expect(forfeited.body.lastMove).toBeNull();
    const row = db.rowsByCode.get(joinCode)!;
    expect(row.board_json).toBe(before.board_json);
    expect(row.black_score).toBe(before.black_score);
    expect(row.white_score).toBe(before.white_score);
  });

  it('allows White to forfeit and lets either player rematch afterward', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const created = await fetchJson(env, '/api/games', { method: 'POST' });
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    const white = await joinWhite(env, joinCode, inviteToken);

    const forfeited = await fetchJson(env, `/api/games/${joinCode}/forfeit`, {
      method: 'POST',
      headers: auth(white.body.playerToken),
    });
    expect(forfeited.response.status).toBe(200);
    expect(forfeited.body.winner).toBe('black');
    expect(forfeited.body.forfeitedBy).toBe('white');

    const rematch = await fetchJson(env, `/api/games/${joinCode}/rematch`, {
      method: 'POST',
      headers: auth(created.body.playerToken),
    });
    expect(rematch.response.status).toBe(201);
    expect(rematch.body.joinCode).toBe('GHJKLM');
    expect(db.rowsByCode.get('GHJKLM')?.rematch_of_game_id).toBe(created.body.id);
  });

  it('rejects unauthenticated, non-player, waiting, completed, and duplicate forfeits', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const waiting = await fetchJson(env, '/api/games', { method: 'POST' });
    const other = await fetchJson(env, '/api/games', { method: 'POST' });

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/forfeit', { method: 'POST' }))
        .response.status,
    ).toBe(401);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/forfeit', {
        method: 'POST',
        headers: auth(other.body.playerToken),
      })).response.status,
    ).toBe(401);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/forfeit', {
        method: 'POST',
        headers: auth(waiting.body.playerToken),
      })).response.status,
    ).toBe(409);

    const { joinCode, inviteToken } = splitInvitation(waiting.body.invitation!);
    await joinWhite(env, joinCode, inviteToken);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/forfeit', {
        method: 'POST',
        headers: auth(waiting.body.playerToken),
      })).response.status,
    ).toBe(200);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/forfeit', {
        method: 'POST',
        headers: auth(waiting.body.playerToken),
      })).response.status,
    ).toBe(409);
  });

  it('lets the creator cancel a waiting game and invalidates the invitation', async () => {
    const created = await createGame(env);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    const before = { ...db.rowsByCode.get(joinCode)! };

    const cancelled = await fetchJson(env, `/api/games/${joinCode}/cancel`, {
      method: 'POST',
      headers: auth(created.body.playerToken),
    });

    expect(cancelled.response.status).toBe(200);
    expect(cancelled.body.version).toBe(2);
    expect(cancelled.body.winner).toBeNull();
    expect(cancelled.body.endedReason).toBe('cancelled');
    expect(cancelled.body.lastMove).toBeNull();
    expect(db.rowsByCode.get(joinCode)?.board_json).toBe(before.board_json);
    expect(db.rowsByCode.get(joinCode)?.white_invite_token_digest).toBeNull();
    expect(
      (await joinWhite(env, joinCode, inviteToken)).response.status,
    ).toBe(403);
    expect(
      (await fetchJson(env, `/api/games/${joinCode}/cancel`, {
        method: 'POST',
        headers: auth(created.body.playerToken),
      })).response.status,
    ).toBe(409);
  });

  it('rejects cancellation after a game is joined or by a non-creator', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const created = await fetchJson(env, '/api/games', { method: 'POST' });
    const other = await fetchJson(env, '/api/games', { method: 'POST' });

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/cancel', {
        method: 'POST',
        headers: auth(other.body.playerToken),
      })).response.status,
    ).toBe(401);

    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    const white = await joinWhite(env, joinCode, inviteToken);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/cancel', {
        method: 'POST',
        headers: auth(white.body.playerToken),
      })).response.status,
    ).toBe(403);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/cancel', {
        method: 'POST',
        headers: auth(created.body.playerToken),
      })).response.status,
    ).toBe(409);
  });

  it('keeps case-insensitive codes and isolated games', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const first = await fetchJson(env, '/api/games', { method: 'POST' });
    const second = await fetchJson(env, '/api/games', { method: 'POST' });

    expect(
      (await fetchJson(env, '/api/games/abcdef', {
        headers: auth(first.body.playerToken),
      })).response.status,
    ).toBe(200);
    expect(
      (await fetchJson(env, '/api/games/GHJKLM', {
        headers: auth(second.body.playerToken),
      })).body.id,
    ).toBe(second.body.id);
  });

  it('exposes test-control capability only when explicitly enabled', async () => {
    expect((await fetchJson(env, '/api/test-controls')).body.enabled).toBe(false);

    const enabledEnv = createEnv(db, true);
    expect((await fetchJson(enabledEnv, '/api/test-controls')).body.enabled).toBe(true);
  });

  it('rejects skip-to-end when disabled, unauthenticated, or not a player', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const created = await fetchJson(env, '/api/games', { method: 'POST' });
    const enabledEnv = createEnv(db, true);
    const other = await fetchJson(enabledEnv, '/api/games', { method: 'POST' });

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/test/skip-to-end', {
        method: 'POST',
        headers: auth(created.body.playerToken),
      })).response.status,
    ).toBe(404);
    expect(
      (await fetchJson(enabledEnv, '/api/games/ABCDEF/test/skip-to-end', {
        method: 'POST',
      })).response.status,
    ).toBe(401);
    expect(
      (await fetchJson(enabledEnv, '/api/games/ABCDEF/test/skip-to-end', {
        method: 'POST',
        headers: auth(other.body.playerToken),
      })).response.status,
    ).toBe(401);
  });

  it('skips an unfinished game to a deterministic valid ending', async () => {
    const enabledEnv = createEnv(db, true);
    const created = await createGame(enabledEnv);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    await joinWhite(enabledEnv, joinCode, inviteToken);

    const skipped = await fetchJson(enabledEnv, '/api/games/ABCDEF/test/skip-to-end', {
      method: 'POST',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({
        state: createInitialGameState(),
        board: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null)),
      }),
    });

    expect(skipped.response.status).toBe(200);
    expect(skipped.body.version).toBeGreaterThan(2);
    expect(skipped.body.state?.status).toBe('finished');
    expect(skipped.body.state?.board).toEqual(
      JSON.parse(String(db.rowsByCode.get('ABCDEF')?.board_json)),
    );
    expect(getScores(skipped.body.state?.board as ReturnType<typeof createInitialGameState>['board'])).toEqual({
      black: db.rowsByCode.get('ABCDEF')?.black_score,
      white: db.rowsByCode.get('ABCDEF')?.white_score,
    });
    expect(skipped.body.lastMove?.version).toBe(skipped.body.version);

    const repeatDb = new FakeD1Database();
    const repeatEnv = createEnv(repeatDb, true);
    const repeatCreated = await createGame(repeatEnv);
    const repeatInvite = splitInvitation(repeatCreated.body.invitation!);
    await joinWhite(repeatEnv, repeatInvite.joinCode, repeatInvite.inviteToken);
    const repeatSkipped = await fetchJson(
      repeatEnv,
      '/api/games/ABCDEF/test/skip-to-end',
      {
        method: 'POST',
        headers: auth(repeatCreated.body.playerToken),
      },
    );
    expect(repeatSkipped.body.state?.board).toEqual(skipped.body.state?.board);
  });

  it('rejects skip-to-end for completed games and allows rematch afterward', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const enabledEnv = createEnv(db, true);
    const created = await fetchJson(enabledEnv, '/api/games', { method: 'POST' });
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    await joinWhite(enabledEnv, joinCode, inviteToken);

    const skipped = await fetchJson(enabledEnv, '/api/games/ABCDEF/test/skip-to-end', {
      method: 'POST',
      headers: auth(created.body.playerToken),
    });
    expect(skipped.response.status).toBe(200);

    expect(
      (await fetchJson(enabledEnv, '/api/games/ABCDEF/test/skip-to-end', {
        method: 'POST',
        headers: auth(created.body.playerToken),
      })).response.status,
    ).toBe(409);

    const rematch = await fetchJson(enabledEnv, '/api/games/ABCDEF/rematch', {
      method: 'POST',
      headers: auth(created.body.playerToken),
    });
    expect(rematch.response.status).toBe(201);
    expect(rematch.body.state?.status).toBe('playing');
  });

  it('rejects rematches for unauthenticated, non-player, and unfinished requests', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const first = await fetchJson(env, '/api/games', { method: 'POST' });
    const second = await fetchJson(env, '/api/games', { method: 'POST' });

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/rematch', { method: 'POST' }))
        .response.status,
    ).toBe(401);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/rematch', {
        method: 'POST',
        headers: auth(second.body.playerToken),
      })).response.status,
    ).toBe(401);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/rematch', {
        method: 'POST',
        headers: auth(first.body.playerToken),
      })).response.status,
    ).toBe(409);
  });

  it('creates an immutable linked rematch with swapped colours from White', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const created = await fetchJson(env, '/api/games', { method: 'POST' });
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    const white = await joinWhite(env, joinCode, inviteToken);
    finishGame(db, joinCode);
    const original = { ...db.rowsByCode.get(joinCode)! };

    const rematch = await fetchJson(env, '/api/games/ABCDEF/rematch', {
      method: 'POST',
      headers: auth(white.body.playerToken),
    });

    expect(rematch.response.status).toBe(201);
    expect(rematch.body.joinCode).toBe('GHJKLM');
    expect(rematch.body.playerColor).toBe('black');
    expect(rematch.body.playerToken).toBeTruthy();
    expect(rematch.body.invitation).toContain('GHJKLM:');
    expect(rematch.body.state?.status).toBe('playing');
    expect(rematch.body.lastMove).toBeNull();
    expect(db.rowsByCode.get(joinCode)?.board_json).toBe(original.board_json);
    expect(db.rowsByCode.get(joinCode)?.status).toBe(original.status);
    expect(db.rowsByCode.get(joinCode)?.rematch_requested_by).toBe('white');
    expect(db.rowsByCode.get('GHJKLM')?.rematch_of_game_id).toBe(created.body.id);
  });

  it('creates an immutable linked rematch with swapped colours from Black', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const created = await fetchJson(env, '/api/games', { method: 'POST' });
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    await joinWhite(env, joinCode, inviteToken);
    finishGame(db, joinCode);
    const original = { ...db.rowsByCode.get(joinCode)! };

    const rematch = await fetchJson(env, '/api/games/ABCDEF/rematch', {
      method: 'POST',
      headers: auth(created.body.playerToken),
    });

    expect(rematch.response.status).toBe(201);
    expect(rematch.body.joinCode).toBe('GHJKLM');
    expect(rematch.body.playerColor).toBe('white');
    expect(rematch.body.opponentJoined).toBe(false);
    expect(rematch.body.invitation).toContain('GHJKLM:');
    expect(rematch.body.lastMove).toBeNull();
    expect(db.rowsByCode.get(joinCode)?.board_json).toBe(original.board_json);
    expect(db.rowsByCode.get(joinCode)?.status).toBe(original.status);
    expect(db.rowsByCode.get(joinCode)?.rematch_requested_by).toBe('black');
    expect(db.rowsByCode.get('GHJKLM')?.rematch_of_game_id).toBe(created.body.id);
    expect(db.rowsByCode.get('GHJKLM')?.black_joined).toBe(0);
    expect(db.rowsByCode.get('GHJKLM')?.white_joined).toBe(1);
  });

  it('requires push configuration for subscription creation', async () => {
    const created = await createGame(env);

    const response = await fetchJson(env, '/api/games/ABCDEF/push-subscriptions', {
      method: 'POST',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({
        endpoint: 'https://push.example/subscription',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      }),
    });

    expect(response.response.status).toBe(503);
  });

  it('validates and authenticates push subscriptions by game player', async () => {
    const pushEnv = createPushEnv(db);
    const created = await createGame(pushEnv);

    expect(
      (await fetchJson(pushEnv, '/api/games/ABCDEF/push-subscriptions', {
        method: 'POST',
        headers: auth(created.body.playerToken),
        body: JSON.stringify({
          endpoint: 'http://push.example/subscription',
          keys: { p256dh: 'p256dh', auth: 'auth' },
        }),
      })).response.status,
    ).toBe(400);

    expect(
      (await fetchJson(pushEnv, '/api/games/ABCDEF/push-subscriptions', {
        method: 'POST',
        headers: auth('wrong'),
        body: JSON.stringify({
          endpoint: 'https://push.example/subscription',
          keys: { p256dh: 'p256dh', auth: 'auth' },
        }),
      })).response.status,
    ).toBe(401);

    const subscribed = await fetchJson(pushEnv, '/api/games/ABCDEF/push-subscriptions', {
      method: 'POST',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({
        endpoint: 'https://push.example/subscription',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      }),
    });

    expect(subscribed.response.status).toBe(200);
    expect(db.pushSubscriptions).toHaveLength(1);
    expect(db.pushSubscriptions[0].game_id).toBe(created.body.id);
    expect(db.pushSubscriptions[0].player_color).toBe('black');
  });

  it('allows the same push endpoint to be associated with multiple games', async () => {
    const pushEnv = createPushEnv(db);
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const first = await fetchJson(pushEnv, '/api/games', { method: 'POST' });
    const second = await fetchJson(pushEnv, '/api/games', { method: 'POST' });
    const subscription = {
      endpoint: 'https://push.example/shared',
      keys: { p256dh: 'p256dh', auth: 'auth' },
    };

    expect(
      (await fetchJson(pushEnv, '/api/games/ABCDEF/push-subscriptions', {
        method: 'POST',
        headers: auth(first.body.playerToken),
        body: JSON.stringify(subscription),
      })).response.status,
    ).toBe(200);
    expect(
      (await fetchJson(pushEnv, '/api/games/GHJKLM/push-subscriptions', {
        method: 'POST',
        headers: auth(second.body.playerToken),
        body: JSON.stringify(subscription),
      })).response.status,
    ).toBe(200);

    expect(db.pushSubscriptions).toHaveLength(2);
  });

  it('accepts Apple Web Push subscription endpoints', async () => {
    const pushEnv = createPushEnv(db);
    const pushMaterial = await createValidPushMaterial();
    const created = await createGame(pushEnv);

    const subscribed = await fetchJson(pushEnv, '/api/games/ABCDEF/push-subscriptions', {
      method: 'POST',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({
        endpoint: 'https://web.push.apple.com/Q123',
        keys: { p256dh: pushMaterial.p256dh, auth: pushMaterial.auth },
      }),
    });

    expect(subscribed.response.status).toBe(200);
    expect(db.pushSubscriptions).toHaveLength(1);
    expect(db.pushSubscriptions[0].endpoint).toBe('https://web.push.apple.com/Q123');
  });

  it('sends an authenticated diagnostic push without recording a notification event', async () => {
    const pushMaterial = await createValidPushMaterial();
    const pushEnv = {
      ...createPushEnv(db),
      VAPID_PRIVATE_KEY: pushMaterial.privateJwk,
    };
    const created = await createGame(pushEnv);
    await fetchJson(pushEnv, '/api/games/ABCDEF/push-subscriptions', {
      method: 'POST',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({
        endpoint: 'https://web.push.apple.com/Q123',
        keys: { p256dh: pushMaterial.p256dh, auth: pushMaterial.auth },
      }),
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));

    const tested = await fetchJson(pushEnv, '/api/push/test', {
      method: 'POST',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({
        joinCode: 'ABCDEF',
        endpoint: 'https://web.push.apple.com/Q123',
      }),
    });

    expect(tested.response.status).toBe(200);
    expect(tested.body.success).toBe(true);
    expect(tested.body.provider).toBe('apple');
    expect(tested.body.httpStatus).toBe(201);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(db.pushNotificationEvents).toHaveLength(0);
  });

  it('rejects diagnostic push requests for unregistered endpoints', async () => {
    const pushEnv = createPushEnv(db);
    const created = await createGame(pushEnv);

    const tested = await fetchJson(pushEnv, '/api/push/test', {
      method: 'POST',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({
        joinCode: 'ABCDEF',
        endpoint: 'https://web.push.apple.com/missing',
      }),
    });

    expect(tested.response.status).toBe(404);
  });

  it('derives notification events without targeting the actor', async () => {
    await createGame(env);
    const game = Array.from(db.rowsByCode.values())[0]!;
    const previousGame = {
      id: String(game.id),
      joinCode: String(game.join_code),
      state: createInitialGameState(),
      version: 1,
      winner: null,
      blackScore: 2,
      whiteScore: 2,
      createdAt: String(game.created_at),
      updatedAt: String(game.updated_at),
      blackPlayerTokenDigest: String(game.black_player_token_digest),
      whitePlayerTokenDigest: null,
      whiteInviteTokenDigest: String(game.white_invite_token_digest),
      whiteJoined: false,
      rematchOfGameId: null,
      blackJoined: true,
      blackInviteTokenDigest: '',
      lastMove: null,
      blackPlayerName: null,
      whitePlayerName: null,
      endedReason: 'normal' as const,
      forfeitedBy: null,
      rematchGameId: null,
      rematchRequestedBy: null,
      rematchRequestedAt: null,
    };
    const updatedGame = { ...previousGame, version: 2, whiteJoined: true };

    const notification = deriveNotificationEvent({
      previousGame,
      updatedGame,
      actorPlayerColor: 'white',
      eventType: 'join',
    });

    expect(notification?.eventType).toBe('white_joined');
    expect(notification?.recipientPlayerColor).toBe('black');
  });

  it('derives a winner notification when the opponent forfeits', () => {
    const previousGame = {
      id: 'game-1',
      joinCode: 'ABCDEF',
      state: createInitialGameState(),
      version: 2,
      winner: null,
      blackScore: 2,
      whiteScore: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      blackPlayerTokenDigest: 'black',
      whitePlayerTokenDigest: 'white',
      whiteInviteTokenDigest: '',
      whiteJoined: true,
      rematchOfGameId: null,
      blackJoined: true,
      blackInviteTokenDigest: '',
      lastMove: null,
      blackPlayerName: 'Alex',
      whitePlayerName: 'Sam',
      endedReason: 'normal' as const,
      forfeitedBy: null,
      rematchGameId: null,
      rematchRequestedBy: null,
      rematchRequestedAt: null,
    };
    const updatedGame = {
      ...previousGame,
      version: 3,
      state: { ...previousGame.state, status: 'finished' as const },
      winner: 'white' as const,
      endedReason: 'forfeit' as const,
      forfeitedBy: 'black' as const,
    };

    const notification = deriveNotificationEvent({
      previousGame,
      updatedGame,
      actorPlayerColor: 'black',
      eventType: 'forfeit',
    });

    expect(notification).toEqual({
      eventType: 'game_finished',
      recipientPlayerColor: 'white',
      title: 'Othello game forfeited',
      body: 'Alex forfeited. You win the game.',
    });
  });

  it('generates a rematch request notification for the invited player', async () => {
    const pushEnv = createPushEnv(db);
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const created = await fetchJson(pushEnv, '/api/games', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Alex' }),
    });
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    await joinWhite(pushEnv, joinCode, inviteToken, 'Sam');
    finishGame(db, joinCode);
    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
      },
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    const response = await worker.fetch(
      request('/api/games/ABCDEF/rematch', {
        method: 'POST',
        headers: auth(created.body.playerToken),
        body: JSON.stringify({ displayName: 'Alex' }),
      }) as Parameters<typeof worker.fetch>[0],
      pushEnv,
      ctx,
    );
    await Promise.all(waitUntilPromises);

    const rematchEvents = db.pushNotificationEvents.filter(
      (event) => event.event_type === 'rematch_requested',
    );
    expect(response.status).toBe(201);
    expect(rematchEvents).toHaveLength(1);
    expect(rematchEvents[0].recipient_player_color).toBe('white');
  });

  it('calculates turn reminder intervals for the first day and later reminders', () => {
    const turnStartedAt = '2026-01-01T00:00:00.000Z';

    expect(
      isTurnReminderDue({
        turnStartedAt,
        lastReminderSentAt: null,
        now: new Date('2026-01-01T04:59:00.000Z'),
      }),
    ).toBe(false);
    expect(
      isTurnReminderDue({
        turnStartedAt,
        lastReminderSentAt: null,
        now: new Date('2026-01-01T05:00:00.000Z'),
      }),
    ).toBe(true);
    expect(
      isTurnReminderDue({
        turnStartedAt,
        lastReminderSentAt: '2026-01-01T05:00:00.000Z',
        now: new Date('2026-01-01T09:59:00.000Z'),
      }),
    ).toBe(false);
    expect(
      isTurnReminderDue({
        turnStartedAt,
        lastReminderSentAt: '2026-01-01T05:00:00.000Z',
        now: new Date('2026-01-01T10:00:00.000Z'),
      }),
    ).toBe(true);
    expect(
      isTurnReminderDue({
        turnStartedAt,
        lastReminderSentAt: '2026-01-01T20:00:00.000Z',
        now: new Date('2026-01-02T11:59:00.000Z'),
      }),
    ).toBe(false);
    expect(
      isTurnReminderDue({
        turnStartedAt,
        lastReminderSentAt: '2026-01-01T20:00:00.000Z',
        now: new Date('2026-01-02T12:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('does not acknowledge turns on GET and uses explicit turn-seen instead', async () => {
    const created = await createGame(env);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    await joinWhite(env, joinCode, inviteToken);
    const row = db.rowsByCode.get(joinCode)!;
    db.rowsByCode.set(joinCode, {
      ...row,
      current_turn_started_at: '2026-01-01T00:00:00.000Z',
      last_turn_reminder_sent_at: null,
    });

    await fetchJson(env, `/api/games/${joinCode}`, {
      headers: auth(created.body.playerToken),
    });
    expect(db.rowsByCode.get(joinCode)?.last_turn_reminder_sent_at).toBeNull();

    const seen = await fetchJson(env, `/api/games/${joinCode}/turn-seen`, {
      method: 'POST',
      headers: auth(created.body.playerToken),
    });

    expect(seen.response.status).toBe(200);
    expect(db.rowsByCode.get(joinCode)?.last_turn_reminder_sent_at).toEqual(
      expect.any(String),
    );
  });

  it('resets turn reminder timing when the second player joins', async () => {
    const created = await createGame(env);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    const beforeJoin = db.rowsByCode.get(joinCode)!;
    db.rowsByCode.set(joinCode, {
      ...beforeJoin,
      current_turn_started_at: '2026-01-01T00:00:00.000Z',
      last_turn_reminder_sent_at: '2026-01-01T05:00:00.000Z',
    });

    await joinWhite(env, joinCode, inviteToken);
    const afterJoin = db.rowsByCode.get(joinCode)!;

    expect(afterJoin.current_turn_started_at).not.toBe('2026-01-01T00:00:00.000Z');
    expect(afterJoin.last_turn_reminder_sent_at).toBeNull();
  });

  it('sends due turn reminders and suppresses duplicate scheduled runs', async () => {
    const pushMaterial = await createValidPushMaterial();
    const pushEnv = {
      ...createPushEnv(db),
      VAPID_PRIVATE_KEY: pushMaterial.privateJwk,
    };
    const created = await createGame(pushEnv);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    await joinWhite(pushEnv, joinCode, inviteToken);
    const row = db.rowsByCode.get(joinCode)!;
    db.rowsByCode.set(joinCode, {
      ...row,
      current_turn_started_at: '2026-01-01T00:00:00.000Z',
      last_turn_reminder_sent_at: null,
    });
    db.pushSubscriptions.push({
      id: 'sub-1',
      game_id: created.body.id,
      player_color: 'black',
      endpoint: 'https://push.example/reminder',
      p256dh: pushMaterial.p256dh,
      auth: pushMaterial.auth,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));

    await expect(
      sendDueTurnReminders(
        db as unknown as D1Database,
        pushEnv,
        new Date('2026-01-01T05:00:00.000Z'),
      ),
    ).resolves.toBe(1);
    await expect(
      sendDueTurnReminders(
        db as unknown as D1Database,
        pushEnv,
        new Date('2026-01-01T05:00:00.000Z'),
      ),
    ).resolves.toBe(0);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(db.rowsByCode.get(joinCode)?.last_turn_reminder_sent_at).toBe(
      '2026-01-01T05:00:00.000Z',
    );
  });

  it('keeps failed reminder delivery retryable without advancing the sent timestamp', async () => {
    const pushMaterial = await createValidPushMaterial();
    const pushEnv = {
      ...createPushEnv(db),
      VAPID_PRIVATE_KEY: pushMaterial.privateJwk,
    };
    const created = await createGame(pushEnv);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    await joinWhite(pushEnv, joinCode, inviteToken);
    const row = db.rowsByCode.get(joinCode)!;
    db.rowsByCode.set(joinCode, {
      ...row,
      current_turn_started_at: '2026-01-01T00:00:00.000Z',
      last_turn_reminder_sent_at: null,
    });
    db.pushSubscriptions.push({
      id: 'sub-1',
      game_id: created.body.id,
      player_color: 'black',
      endpoint: 'https://push.example/temporary-failure',
      p256dh: pushMaterial.p256dh,
      auth: pushMaterial.auth,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    await expect(
      sendDueTurnReminders(
        db as unknown as D1Database,
        pushEnv,
        new Date('2026-01-01T05:00:00.000Z'),
      ),
    ).resolves.toBe(0);
    expect(db.rowsByCode.get(joinCode)?.last_turn_reminder_sent_at).toBeNull();

    await expect(
      sendDueTurnReminders(
        db as unknown as D1Database,
        pushEnv,
        new Date('2026-01-01T05:01:00.000Z'),
      ),
    ).resolves.toBe(1);
    expect(db.rowsByCode.get(joinCode)?.last_turn_reminder_sent_at).toBe(
      '2026-01-01T05:01:00.000Z',
    );
  });

  it('retains turn start time when a move causes an automatic pass', async () => {
    const scenario = findAutomaticPassScenario();
    const created = await createGame(env);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    const joined = await joinWhite(env, joinCode, inviteToken);
    const scores = getScores(scenario.state.board);
    const row = db.rowsByCode.get(joinCode)!;
    const currentPlayerToken =
      scenario.state.currentPlayer === 'black'
        ? created.body.playerToken
        : joined.body.playerToken;
    db.rowsByCode.set(joinCode, {
      ...row,
      board_json: JSON.stringify(scenario.state.board),
      current_player: scenario.state.currentPlayer,
      status: scenario.state.status,
      winner: null,
      black_score: scores.black,
      white_score: scores.white,
      consecutive_passes: scenario.state.consecutivePasses,
      version: 7,
      current_turn_started_at: '2026-01-01T00:00:00.000Z',
      last_turn_reminder_sent_at: '2026-01-01T05:00:00.000Z',
    });

    const moved = await fetchJson(env, `/api/games/${joinCode}/moves`, {
      method: 'POST',
      headers: auth(currentPlayerToken),
      body: JSON.stringify({
        row: scenario.move.row,
        col: scenario.move.col,
        expectedVersion: 7,
      }),
    });

    expect(moved.response.status).toBe(200);
    expect(moved.body.state?.currentPlayer).toBe(scenario.state.currentPlayer);
    expect(db.rowsByCode.get(joinCode)?.current_turn_started_at).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(db.rowsByCode.get(joinCode)?.last_turn_reminder_sent_at).toBeNull();
  });

  it('does not send reminders after a move, game finish, forfeit, or cancellation', async () => {
    const pushMaterial = await createValidPushMaterial();
    const pushEnv = {
      ...createPushEnv(db),
      VAPID_PRIVATE_KEY: pushMaterial.privateJwk,
    };
    mockJoinCodes(['ABCDEF', 'GHJKLM', 'NPQRST', 'UVWXYZ']);
    const active = await fetchJson(pushEnv, '/api/games', { method: 'POST' });
    const activeInvite = splitInvitation(active.body.invitation!);
    await joinWhite(pushEnv, activeInvite.joinCode, activeInvite.inviteToken);
    const finished = await fetchJson(pushEnv, '/api/games', { method: 'POST' });
    const finishedInvite = splitInvitation(finished.body.invitation!);
    await joinWhite(pushEnv, finishedInvite.joinCode, finishedInvite.inviteToken);
    finishGame(db, finished.body.joinCode!);
    const forfeited = await fetchJson(pushEnv, '/api/games', { method: 'POST' });
    const forfeitedInvite = splitInvitation(forfeited.body.invitation!);
    await joinWhite(pushEnv, forfeitedInvite.joinCode, forfeitedInvite.inviteToken);
    const forfeitedRow = db.rowsByCode.get(forfeited.body.joinCode!)!;
    db.rowsByCode.set(forfeited.body.joinCode!, {
      ...forfeitedRow,
      current_turn_started_at: '2026-01-01T00:00:00.000Z',
    });
    await fetchJson(pushEnv, `/api/games/${forfeited.body.joinCode}/forfeit`, {
      method: 'POST',
      headers: auth(forfeited.body.playerToken),
    });
    const cancelled = await fetchJson(pushEnv, '/api/games', { method: 'POST' });
    const cancelledRow = db.rowsByCode.get(cancelled.body.joinCode!)!;
    db.rowsByCode.set(cancelled.body.joinCode!, {
      ...cancelledRow,
      current_turn_started_at: '2026-01-01T00:00:00.000Z',
    });
    await fetchJson(pushEnv, `/api/games/${cancelled.body.joinCode}/cancel`, {
      method: 'POST',
      headers: auth(cancelled.body.playerToken),
    });

    for (const game of [active.body, finished.body, forfeited.body, cancelled.body]) {
      db.pushSubscriptions.push({
        id: `sub-${game.joinCode}`,
        game_id: game.id,
        player_color: 'black',
        endpoint: `https://push.example/${game.joinCode}`,
        p256dh: pushMaterial.p256dh,
        auth: pushMaterial.auth,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });
    }

    const activeRow = db.rowsByCode.get(active.body.joinCode!)!;
    db.rowsByCode.set(active.body.joinCode!, {
      ...activeRow,
      current_turn_started_at: '2026-01-01T00:00:00.000Z',
      last_turn_reminder_sent_at: null,
    });
    await fetchJson(pushEnv, `/api/games/${active.body.joinCode}/moves`, {
      method: 'POST',
      headers: auth(active.body.playerToken),
      body: JSON.stringify({ row: 2, col: 3, expectedVersion: 2 }),
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));

    await expect(
      sendDueTurnReminders(
        db as unknown as D1Database,
        pushEnv,
        new Date('2026-01-01T06:00:00.000Z'),
      ),
    ).resolves.toBe(0);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('removes permanently stale subscriptions and records failed delivery state', async () => {
    const pushMaterial = await createValidPushMaterial();
    const pushEnv = {
      ...createPushEnv(db),
      VAPID_PRIVATE_KEY: pushMaterial.privateJwk,
    };
    const game = {
      id: 'game-1',
      joinCode: 'ABCDEF',
      state: createInitialGameState(),
      version: 2,
      winner: null,
      blackScore: 2,
      whiteScore: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      blackPlayerTokenDigest: 'black',
      whitePlayerTokenDigest: 'white',
      whiteInviteTokenDigest: '',
      whiteJoined: true,
      rematchOfGameId: null,
      blackJoined: true,
      blackInviteTokenDigest: '',
      lastMove: null,
      blackPlayerName: null,
      whitePlayerName: null,
      endedReason: 'normal' as const,
      forfeitedBy: null,
      rematchGameId: null,
      rematchRequestedBy: null,
      rematchRequestedAt: null,
    };
    db.pushSubscriptions.push({
      id: 'sub-1',
      game_id: game.id,
      player_color: 'black',
      endpoint: 'https://push.example/stale',
      p256dh: pushMaterial.p256dh,
      auth: pushMaterial.auth,
      created_at: game.createdAt,
      updated_at: game.updatedAt,
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 410 }));

    await sendNotificationEvent(db as unknown as D1Database, pushEnv, game, {
      eventType: 'white_joined',
      recipientPlayerColor: 'black',
      title: 'White joined',
      body: 'Ready',
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(db.pushSubscriptions).toHaveLength(0);
    expect(db.pushNotificationEvents[0].delivery_state).toBe('failed');
    expect(db.pushNotificationEvents[0].attempts).toBe(1);
  });

  it('suppresses already sent duplicate notification events', async () => {
    const pushEnv = createPushEnv(db);
    const game = {
      id: 'game-1',
      joinCode: 'ABCDEF',
      state: createInitialGameState(),
      version: 2,
      winner: null,
      blackScore: 2,
      whiteScore: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      blackPlayerTokenDigest: 'black',
      whitePlayerTokenDigest: 'white',
      whiteInviteTokenDigest: '',
      whiteJoined: true,
      rematchOfGameId: null,
      blackJoined: true,
      blackInviteTokenDigest: '',
      lastMove: null,
      blackPlayerName: null,
      whitePlayerName: null,
      endedReason: 'normal' as const,
      forfeitedBy: null,
      rematchGameId: null,
      rematchRequestedBy: null,
      rematchRequestedAt: null,
    };
    db.pushNotificationEvents.push({
      id: 'event-1',
      game_id: game.id,
      game_version: game.version,
      event_type: 'white_joined',
      recipient_player_color: 'black',
      delivery_state: 'sent',
      attempts: 1,
      last_error: null,
      created_at: game.createdAt,
      updated_at: game.updatedAt,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await sendNotificationEvent(db as unknown as D1Database, pushEnv, game, {
      eventType: 'white_joined',
      recipientPlayerColor: 'black',
      title: 'White joined',
      body: 'Ready',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.pushNotificationEvents).toHaveLength(1);
  });
});
