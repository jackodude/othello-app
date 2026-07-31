import { describe, expect, it } from 'vitest';

import {
  shouldShowCancelAction,
  shouldShowInvitationPanel,
  shouldShowForfeitAction,
  shouldShowJoinControls,
  shouldShowLegalMoves,
  shouldShowRematchButton,
  shouldShowSkipToEndButton,
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

  it('shows rematch only for authenticated finished games', () => {
    expect(shouldShowRematchButton(true, 'finished')).toBe(true);
    expect(shouldShowRematchButton(false, 'finished')).toBe(false);
    expect(shouldShowRematchButton(true, 'playing')).toBe(false);
  });

  it('shows skip-to-end only for authenticated unfinished games when enabled', () => {
    expect(
      shouldShowSkipToEndButton({
        testControlsEnabled: true,
        isAuthenticated: true,
        gameStatus: 'playing',
      }),
    ).toBe(true);
    expect(
      shouldShowSkipToEndButton({
        testControlsEnabled: false,
        isAuthenticated: true,
        gameStatus: 'playing',
      }),
    ).toBe(false);
    expect(
      shouldShowSkipToEndButton({
        testControlsEnabled: true,
        isAuthenticated: true,
        gameStatus: 'finished',
      }),
    ).toBe(false);
  });

  it('shows forfeit only for authenticated joined unfinished games without terminal actions', () => {
    expect(
      shouldShowForfeitAction({
        isAuthenticated: true,
        opponentJoined: true,
        gameStatus: 'playing',
        isTerminalActionInFlight: false,
      }),
    ).toBe(true);
    expect(
      shouldShowForfeitAction({
        isAuthenticated: true,
        opponentJoined: false,
        gameStatus: 'playing',
        isTerminalActionInFlight: false,
      }),
    ).toBe(false);
    expect(
      shouldShowForfeitAction({
        isAuthenticated: true,
        opponentJoined: true,
        gameStatus: 'finished',
        isTerminalActionInFlight: false,
      }),
    ).toBe(false);
    expect(
      shouldShowForfeitAction({
        isAuthenticated: true,
        opponentJoined: true,
        gameStatus: 'playing',
        isTerminalActionInFlight: true,
      }),
    ).toBe(false);
  });

  it('shows cancel only to Black before an opponent joins', () => {
    expect(
      shouldShowCancelAction({
        isAuthenticated: true,
        playerColor: 'black',
        opponentJoined: false,
        gameStatus: 'playing',
        isTerminalActionInFlight: false,
      }),
    ).toBe(true);
    expect(
      shouldShowCancelAction({
        isAuthenticated: true,
        playerColor: 'white',
        opponentJoined: false,
        gameStatus: 'playing',
        isTerminalActionInFlight: false,
      }),
    ).toBe(false);
    expect(
      shouldShowCancelAction({
        isAuthenticated: true,
        playerColor: 'black',
        opponentJoined: true,
        gameStatus: 'playing',
        isTerminalActionInFlight: false,
      }),
    ).toBe(false);
  });
});
