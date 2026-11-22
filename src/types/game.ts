export type GamePhase =
  | 'FRANCHISE_SELECT'
  | 'AUCTION'
  | 'CARD_BATTLE'
  | 'MINI_MATCH'
  | 'POST_MATCH';

export type PlayerRole = 'Batter' | 'Bowler' | 'All-Rounder' | 'Wicketkeeper';

export type StatKey = 'runs' | 'strikeRate' | 'wickets' | 'economy' | 'matches';

export interface Franchise {
  id: string;
  shortName: string;
  name: string;
  city: string;
  primaryColor: string;
  secondaryColor: string;
  textOnPrimary: string;
  motto: string;
}

export interface IPLPlayer {
  id: string;
  name: string;
  iplTeam: string;
  role: PlayerRole;
  nationality: 'IND' | 'OS';
  basePrice: number; // in Crore (1.0 - 5.0)
  jerseyNumber: number;
  battingHand: 'RHB' | 'LHB';
  bowlingStyle: string;
  overallRating: number; // 75 - 97
  stats: {
    runs: number;
    strikeRate: number;
    wickets: number;
    economy: number;
    matches: number;
  };
}

export interface DraftedPlayer extends IPLPlayer {
  boughtPrice: number;
  inForm: boolean;
  retained?: boolean;
}

export interface DuelRecord {
  round: number;
  userPlayer: DraftedPlayer;
  aiPlayer: DraftedPlayer;
  chosenStat: StatKey;
  chooser: 'USER' | 'AI';
  userValue: number;
  aiValue: number;
  winner: 'USER' | 'AI' | 'DRAW';
}

export type ShotStyle = 'DEFEND' | 'BALANCED' | 'LOFTED';
export type DeliveryType = 'YORKER' | 'BOUNCER' | 'SLOWER' | 'SPIN';

export type BallOutcomeCode = '0' | '1' | '2' | '4' | '6' | 'W';

export interface BallEvent {
  id: string;
  innings: 1 | 2;
  overBall: string; // e.g. "0.1", "1.6"
  batterName: string;
  bowlerName: string;
  shotOrDelivery: string;
  outcome: BallOutcomeCode;
  runs: number;
  isWicket: boolean;
  commentary: string;
}

export interface BatterMatchStats {
  playerId: string;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  out: boolean;
  inForm: boolean;
}

export interface BowlerMatchStats {
  playerId: string;
  name: string;
  balls: number;
  runsConceded: number;
  wickets: number;
  inForm: boolean;
}

export interface InningsSummary {
  battingSide: 'USER' | 'AI';
  runs: number;
  wickets: number;
  ballsBowled: number;
  bonusRuns: number;
  batterStats: Record<string, BatterMatchStats>;
  bowlerStats: Record<string, BowlerMatchStats>;
  ballLog: BallEvent[];
}

export interface MatchResult {
  winner: 'USER' | 'AI';
  winMarginText: string;
  userInnings: InningsSummary;
  aiInnings: InningsSummary;
  userDuelsWon: number;
  aiDuelsWon: number;
  matchPrize: number;
  sweepBonus: number;
  totalEarned: number;
  superBallPlayed: boolean;
}
