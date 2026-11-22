import type {
  BallEvent,
  BatterMatchStats,
  BowlerMatchStats,
  DeliveryType,
  DraftedPlayer,
  DuelRecord,
  IPLPlayer,
  ShotStyle,
  StatKey,
} from './game.ts';

export type RoomPhase =
  | 'LOBBY'
  | 'RETENTION'
  | 'AUCTION'
  | 'CARD_BATTLE'
  | 'MINI_MATCH'
  | 'POST_MATCH';

export interface RoomParticipant {
  clientId: string;
  name: string;
  franchiseId: string;
  isHost: boolean;
  isAi: boolean;
  connected: boolean;
  purse: number;
  squad: DraftedPlayer[];
  previousSquad: DraftedPlayer[];
  retentionConfirmed: boolean;
  rtmAvailable: boolean;
  wins: number;
  matchesPlayed: number;
  lastEarned: number;
}

export interface RoomAuctionLog {
  id: string;
  text: string;
  tone: 'bid' | 'sold' | 'unsold' | 'rtm' | 'info';
}

export interface RoomAuctionState {
  queue: IPLPlayer[];
  currentIndex: number;
  currentBid: number;
  highestBidderId: string | null; // clientId
  passedClientIds: string[];
  countdownMs: number;
  soldBanner: {
    playerName: string;
    winnerClientId: string | 'UNSOLD';
    winnerFranchiseId: string | 'UNSOLD';
    winnerName: string;
    price: number;
  } | null;
  rtmPrompt: {
    player: IPLPlayer;
    targetClientId: string; // franchise owner with RTM right
    winningClientId: string;
    winningFranchiseId: string;
    price: number;
  } | null;
  logs: RoomAuctionLog[];
}

export interface RoomMatchup {
  id: string;
  homeClientId: string;
  awayClientId: string;
  // Phase 2 Card Battle
  roundIdx: number;
  duels: DuelRecord[];
  activeDuelResult: DuelRecord | null;
  homeBonusRuns: number;
  awayBonusRuns: number;
  homeDuelsWon: number;
  awayDuelsWon: number;
  tossComplete: boolean;
  tossWinnerClientId: string | null;
  battingFirstClientId: string | null;
  // Phase 3 2-Over Mini Match
  inningsNum: 1 | 2;
  battingClientId: string;
  bowlingClientId: string;
  inningsBreak: boolean;
  innings1Runs: number;
  innings1Wickets: number;
  innings1Balls: number;
  runs: number;
  wickets: number;
  ballsBowled: number;
  batterStats: Record<string, BatterMatchStats>;
  bowlerStats: Record<string, BowlerMatchStats>;
  ballLog: BallEvent[];
  activeBatterId: string;
  over1BowlerId: string;
  over2BowlerId: string;
  needsNewBatter: boolean;
  pendingShot: ShotStyle | null;
  pendingDelivery: DeliveryType | null;
  matchComplete: boolean;
  winnerClientId: string | null;
  winMarginText: string;
  homeEarned: number;
  awayEarned: number;
}

export interface RoomState {
  roomCode: string;
  matchNumber: number;
  squadSize: 7 | 11;
  phase: RoomPhase;
  participants: RoomParticipant[];
  auction: RoomAuctionState | null;
  matchups: RoomMatchup[];
  announcement: string | null;
}

export type ClientMessage =
  | {
      type: 'room:create';
      clientId: string;
      playerName: string;
      franchiseId: string;
      squadSize: 7 | 11;
    }
  | {
      type: 'room:join';
      clientId: string;
      roomCode: string;
      playerName: string;
      franchiseId: string;
    }
  | {
      type: 'room:reconnect';
      clientId: string;
      roomCode: string;
    }
  | {
      type: 'room:change_franchise';
      franchiseId: string;
    }
  | {
      type: 'room:start_auction';
    }
  | {
      type: 'auction:confirm_retention';
      retainedIds: string[];
    }
  | {
      type: 'auction:bid';
      increment: 0.5 | 2.0;
    }
  | {
      type: 'auction:pass';
    }
  | {
      type: 'auction:rtm';
      accept: boolean;
    }
  | {
      type: 'auction:autofill';
    }
  | {
      type: 'battle:select_stat';
      matchupId: string;
      stat: StatKey;
    }
  | {
      type: 'battle:next_duel';
      matchupId: string;
    }
  | {
      type: 'battle:choose_toss';
      matchupId: string;
      batFirst: boolean;
    }
  | {
      type: 'battle:skip_to_match';
    }
  | {
      type: 'match:select_batter';
      matchupId: string;
      playerId: string;
    }
  | {
      type: 'match:select_bowler';
      matchupId: string;
      overIndex: 1 | 2;
      playerId: string;
    }
  | {
      type: 'match:submit_shot';
      matchupId: string;
      shot: ShotStyle;
    }
  | {
      type: 'match:submit_delivery';
      matchupId: string;
      delivery: DeliveryType;
    }
  | {
      type: 'match:start_innings_2';
      matchupId: string;
    }
  | {
      type: 'room:next_round';
    };

export type ServerMessage =
  | {
      type: 'room:state';
      room: RoomState;
    }
  | {
      type: 'room:error';
      message: string;
    }
  | {
      type: 'room:voice';
      text: string;
      priority?: 'high' | 'normal';
    };
