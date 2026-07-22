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
