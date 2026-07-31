import type { GameStatus, Player } from '../game';

interface LegalMoveVisibilityInput {
  readonly isAuthenticated: boolean;
  readonly opponentJoined: boolean;
  readonly gameStatus: GameStatus;
  readonly isYourTurn: boolean;
  readonly isSubmittingMove: boolean;
  readonly isLoading: boolean;
}

interface InvitationPanelInput {
  readonly playerColor: Player | null;
  readonly opponentJoined: boolean;
  readonly invitation: string | null;
}

export function shouldShowLegalMoves({
  isAuthenticated,
  opponentJoined,
  gameStatus,
  isYourTurn,
  isSubmittingMove,
  isLoading,
}: LegalMoveVisibilityInput): boolean {
  return (
    isAuthenticated &&
    opponentJoined &&
    gameStatus === 'playing' &&
    isYourTurn &&
    !isSubmittingMove &&
    !isLoading
  );
}

export function shouldShowInvitationPanel({
  playerColor,
  opponentJoined,
  invitation,
}: InvitationPanelInput): boolean {
  return playerColor === 'black' && !opponentJoined && Boolean(invitation);
}

export function shouldShowJoinControls(
  hasSelectedGame: boolean,
  isSwitchingGame: boolean,
): boolean {
  return !hasSelectedGame || isSwitchingGame;
}

export function shouldShowRematchButton(
  isAuthenticated: boolean,
  gameStatus: GameStatus,
): boolean {
  return isAuthenticated && gameStatus === 'finished';
}

export function shouldShowSkipToEndButton({
  testControlsEnabled,
  isAuthenticated,
  gameStatus,
}: {
  readonly testControlsEnabled: boolean;
  readonly isAuthenticated: boolean;
  readonly gameStatus: GameStatus;
}): boolean {
  return testControlsEnabled && isAuthenticated && gameStatus === 'playing';
}

export function shouldShowForfeitAction({
  isAuthenticated,
  opponentJoined,
  gameStatus,
  isTerminalActionInFlight,
}: {
  readonly isAuthenticated: boolean;
  readonly opponentJoined: boolean;
  readonly gameStatus: GameStatus;
  readonly isTerminalActionInFlight: boolean;
}): boolean {
  return (
    isAuthenticated &&
    opponentJoined &&
    gameStatus === 'playing' &&
    !isTerminalActionInFlight
  );
}

export function shouldShowCancelAction({
  isAuthenticated,
  playerColor,
  opponentJoined,
  gameStatus,
  isTerminalActionInFlight,
}: {
  readonly isAuthenticated: boolean;
  readonly playerColor: Player | null;
  readonly opponentJoined: boolean;
  readonly gameStatus: GameStatus;
  readonly isTerminalActionInFlight: boolean;
}): boolean {
  return (
    isAuthenticated &&
    playerColor === 'black' &&
    !opponentJoined &&
    gameStatus === 'playing' &&
    !isTerminalActionInFlight
  );
}
