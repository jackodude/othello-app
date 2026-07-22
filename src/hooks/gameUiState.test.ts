import { describe, expect, it } from 'vitest';

import {
  shouldShowInvitationPanel,
  shouldShowJoinControls,
  shouldShowLegalMoves,
} from './gameUiState';

const legalMoveBase = {
  isAuthenticated: true,
  opponentJoined: true,
  gameStatus: 'playing' as const,
  isYourTurn: true,
  isSubmittingMove: false,
  isLoading: false,
};

describe('game UI state', () => {
  it('shows legal moves on the authenticated player turn', () => {
    expect(shouldShowLegalMoves(legalMoveBase)).toBe(true);
  });

  it('hides legal moves on the opponent turn', () => {
    expect(
      shouldShowLegalMoves({ ...legalMoveBase, isYourTurn: false }),
    ).toBe(false);
  });

  it('hides legal moves before White joins', () => {
    expect(
      shouldShowLegalMoves({ ...legalMoveBase, opponentJoined: false }),
    ).toBe(false);
  });

  it('shows invitation only to Black while waiting', () => {
    expect(
      shouldShowInvitationPanel({
        playerColor: 'black',
        opponentJoined: false,
        invitation: 'ABCDEF:token',
      }),
    ).toBe(true);
  });

  it('hides invitation after White joins and for White', () => {
    expect(
      shouldShowInvitationPanel({
        playerColor: 'black',
        opponentJoined: true,
        invitation: 'ABCDEF:token',
      }),
    ).toBe(false);
    expect(
      shouldShowInvitationPanel({
        playerColor: 'white',
        opponentJoined: true,
        invitation: null,
      }),
    ).toBe(false);
  });

  it('hides join controls for an authenticated active game until switching', () => {
    expect(shouldShowJoinControls(true, false)).toBe(false);
    expect(shouldShowJoinControls(true, true)).toBe(true);
  });
});
