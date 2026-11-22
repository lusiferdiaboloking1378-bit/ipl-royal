import React, { useMemo, useState } from 'react';
import { ArrowRight, Flame, Shield, Target, Zap } from 'lucide-react';
import cricketPitchArenaImg from '../assets/images/cricket_pitch_arena_1795258897143.jpg';
import {
  BallEvent,
  BatterMatchStats,
  BowlerMatchStats,
  DeliveryType,
  DraftedPlayer,
  Franchise,
  InningsSummary,
  MatchResult,
  ShotStyle,
} from '../types/game';
import { chooseAiDelivery, chooseAiShot, simulateBallOutcome } from '../utils/engine';
import { soundFX } from '../utils/sound';
import { TeamCrest } from './TeamCrest';

interface Phase3MiniMatchProps {
  matchNumber: number;
  userFranchise: Franchise;
  aiFranchise: Franchise;
  userSquad: DraftedPlayer[];
  aiSquad: DraftedPlayer[];
  userBonusRuns: number;
  aiBonusRuns: number;
  userDuelsWon: number;
  aiDuelsWon: number;
  battingFirst: 'USER' | 'AI';
  onMatchComplete: (result: MatchResult) => void;
}

const MAX_BALLS = 12;

function initBatterStats(squad: DraftedPlayer[]): Record<string, BatterMatchStats> {
  const map: Record<string, BatterMatchStats> = {};
  squad.forEach((p) => {
    map[p.id] = {
      playerId: p.id,
      name: p.name,
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      out: false,
      inForm: p.inForm,
    };
  });
  return map;
}

function initBowlerStats(squad: DraftedPlayer[]): Record<string, BowlerMatchStats> {
  const map: Record<string, BowlerMatchStats> = {};
  squad.forEach((p) => {
    map[p.id] = {
      playerId: p.id,
      name: p.name,
      balls: 0,
      runsConceded: 0,
      wickets: 0,
      inForm: p.inForm,
    };
  });
  return map;
}

function pickBestBattingOrder(squad: DraftedPlayer[]): DraftedPlayer[] {
  return [...squad].sort((a, b) => {
    const scoreA =
      a.stats.strikeRate +
      (a.inForm ? 20 : 0) +
      (a.role === 'Batter' || a.role === 'Wicketkeeper' ? 12 : a.role === 'All-Rounder' ? 6 : -18);
    const scoreB =
      b.stats.strikeRate +
      (b.inForm ? 20 : 0) +
      (b.role === 'Batter' || b.role === 'Wicketkeeper' ? 12 : b.role === 'All-Rounder' ? 6 : -18);
    return scoreB - scoreA;
  });
}

function pickBestBowlers(squad: DraftedPlayer[]): DraftedPlayer[] {
  return [...squad].sort((a, b) => {
    const scoreA =
      (11 - a.stats.economy) * 10 +
      (a.inForm ? 16 : 0) +
      (a.role === 'Bowler' ? 20 : a.role === 'All-Rounder' ? 10 : -20);
    const scoreB =
      (11 - b.stats.economy) * 10 +
      (b.inForm ? 16 : 0) +
      (b.role === 'Bowler' ? 20 : b.role === 'All-Rounder' ? 10 : -20);
    return scoreB - scoreA;
  });
}

export const Phase3MiniMatch: React.FC<Phase3MiniMatchProps> = ({
  matchNumber,
  userFranchise,
  aiFranchise,
  userSquad,
  aiSquad,
  userBonusRuns,
  aiBonusRuns,
  userDuelsWon,
  aiDuelsWon,
  battingFirst,
  onMatchComplete,
}) => {
  const maxWickets = userSquad.length - 1;

  const userBatOrder = useMemo(() => pickBestBattingOrder(userSquad), [userSquad]);
  const aiBatOrder = useMemo(() => pickBestBattingOrder(aiSquad), [aiSquad]);
  const userBowlOrder = useMemo(() => pickBestBowlers(userSquad), [userSquad]);
  const aiBowlOrder = useMemo(() => pickBestBowlers(aiSquad), [aiSquad]);

  const [inningsNum, setInningsNum] = useState<1 | 2>(1);
  const [battingSide, setBattingSide] = useState<'USER' | 'AI'>(battingFirst);
  const [inningsBreak, setInningsBreak] = useState(false);

  const [innings1Summary, setInnings1Summary] = useState<InningsSummary | null>(null);

  // Active innings state
  const startingBonus = battingSide === 'USER' ? userBonusRuns : aiBonusRuns;
  const [runs, setRuns] = useState<number>(startingBonus);
  const [wickets, setWickets] = useState<number>(0);
  const [ballsBowled, setBallsBowled] = useState<number>(0);
  const [batterStats, setBatterStats] = useState<Record<string, BatterMatchStats>>(() =>
    initBatterStats(battingFirst === 'USER' ? userSquad : aiSquad)
  );
  const [bowlerStats, setBowlerStats] = useState<Record<string, BowlerMatchStats>>(() =>
    initBowlerStats(battingFirst === 'USER' ? aiSquad : userSquad)
  );
  const [ballLog, setBallLog] = useState<BallEvent[]>([]);

  // Active player selections
  const [userBatterId, setUserBatterId] = useState<string>(userBatOrder[0]?.id || '');
  const [userOver1BowlerId, setUserOver1BowlerId] = useState<string>(userBowlOrder[0]?.id || '');
  const [userOver2BowlerId, setUserOver2BowlerId] = useState<string>(
    userBowlOrder[1]?.id || userBowlOrder[0]?.id || ''
  );
  const [needsNewUserBatter, setNeedsNewUserBatter] = useState<boolean>(false);

  // Super Ball tiebreaker state
  const [superBallMode, setSuperBallMode] = useState(false);
  const [superBallMessage, setSuperBallMessage] = useState<string | null>(null);

  const isUserBatting = battingSide === 'USER';
  const currentOverIndex = ballsBowled < 6 ? 1 : 2;
  const targetScore = inningsNum === 2 && innings1Summary ? innings1Summary.runs + 1 : null;

  // Determine active batter & bowler objects
  const activeBatter: DraftedPlayer = useMemo(() => {
    if (isUserBatting) {
      return userSquad.find((p) => p.id === userBatterId) || userBatOrder[0];
    }
    // AI picks next available not-out batter in its order
    const nextAi = aiBatOrder.find((p) => !batterStats[p.id]?.out);
    return nextAi || aiBatOrder[0];
  }, [isUserBatting, userSquad, userBatterId, userBatOrder, aiBatOrder, batterStats]);

  const activeBowler: DraftedPlayer = useMemo(() => {
    if (!isUserBatting) {
      const id = currentOverIndex === 1 ? userOver1BowlerId : userOver2BowlerId;
      return userSquad.find((p) => p.id === id) || userBowlOrder[0];
    }
    // AI uses its #1 bowler for Over 1 and #2 bowler for Over 2
    return currentOverIndex === 1 ? aiBowlOrder[0] : aiBowlOrder[1] || aiBowlOrder[0];
  }, [
    isUserBatting,
    currentOverIndex,
    userOver1BowlerId,
    userOver2BowlerId,
    userSquad,
    userBowlOrder,
    aiBowlOrder,
  ]);

  const notOutUserBatters = useMemo(
    () => userBatOrder.filter((p) => !batterStats[p.id]?.out),
    [userBatOrder, batterStats]
  );

  const oversString = `${Math.floor(ballsBowled / 6)}.${ballsBowled % 6}`;
  const ballsRemaining = MAX_BALLS - ballsBowled;

  const finishMatch = (finalInnings2: InningsSummary, viaSuperBall = false, superWinner?: 'USER' | 'AI') => {
    if (!innings1Summary) return;
    const uInn = innings1Summary.battingSide === 'USER' ? innings1Summary : finalInnings2;
    const aInn = innings1Summary.battingSide === 'AI' ? innings1Summary : finalInnings2;

    let winner: 'USER' | 'AI';
    let margin = '';
    if (viaSuperBall && superWinner) {
      winner = superWinner;
      margin = `${
        superWinner === 'USER' ? userFranchise.shortName : aiFranchise.shortName
      } won via Super Ball Tiebreaker`;
    } else if (uInn.runs > aInn.runs) {
      winner = 'USER';
      margin =
        finalInnings2.battingSide === 'USER'
          ? `Won by ${maxWickets - uInn.wickets} wicket${maxWickets - uInn.wickets === 1 ? '' : 's'}`
          : `Won by ${uInn.runs - aInn.runs} run${uInn.runs - aInn.runs === 1 ? '' : 's'}`;
    } else {
      winner = 'AI';
      margin =
        finalInnings2.battingSide === 'AI'
          ? `Lost by ${maxWickets - aInn.wickets} wicket${maxWickets - aInn.wickets === 1 ? '' : 's'}`
          : `Lost by ${aInn.runs - uInn.runs} run${aInn.runs - uInn.runs === 1 ? '' : 's'}`;
    }

    const sweepThreshold = userSquad.length >= 11 ? 8 : 5;
    const matchPrize = winner === 'USER' ? 12.0 : 4.0;
    const sweepBonus = userDuelsWon >= sweepThreshold ? 3.0 : 0;

    onMatchComplete({
      winner,
      winMarginText: margin,
      userInnings: uInn,
      aiInnings: aInn,
      userDuelsWon,
      aiDuelsWon,
      matchPrize,
      sweepBonus,
      totalEarned: matchPrize + sweepBonus,
      superBallPlayed: viaSuperBall,
    });
  };

  const handlePlayBall = (choice: ShotStyle | DeliveryType) => {
    if (inningsBreak || needsNewUserBatter) return;

    const nextBallNum = ballsBowled + 1;
    const overBallStr = `${Math.floor(ballsBowled / 6)}.${(ballsBowled % 6) + 1}`;

    const shot: ShotStyle = isUserBatting
      ? (choice as ShotStyle)
      : chooseAiShot(ballsRemaining, targetScore !== null ? targetScore - runs : null);
    const delivery: DeliveryType = isUserBatting
      ? chooseAiDelivery(activeBatter, ballsRemaining)
      : (choice as DeliveryType);

    const sim = simulateBallOutcome({
      batter: activeBatter,
      bowler: activeBowler,
      shot,
      delivery,
      overBall: overBallStr,
    });

    if (sim.isWicket) soundFX.playWicket();
    else soundFX.playBatHit(sim.outcome === '4' || sim.outcome === '6', sim.outcome === '6');

    const newRuns = runs + sim.runs;
    const newWickets = wickets + (sim.isWicket ? 1 : 0);

    const updatedBatters = {
      ...batterStats,
      [activeBatter.id]: {
        ...batterStats[activeBatter.id],
        runs: batterStats[activeBatter.id].runs + sim.runs,
        balls: batterStats[activeBatter.id].balls + 1,
        fours: batterStats[activeBatter.id].fours + (sim.outcome === '4' ? 1 : 0),
        sixes: batterStats[activeBatter.id].sixes + (sim.outcome === '6' ? 1 : 0),
        out: sim.isWicket ? true : batterStats[activeBatter.id].out,
      },
    };

    const updatedBowlers = {
      ...bowlerStats,
      [activeBowler.id]: {
        ...bowlerStats[activeBowler.id],
        balls: bowlerStats[activeBowler.id].balls + 1,
        runsConceded: bowlerStats[activeBowler.id].runsConceded + sim.runs,
        wickets: bowlerStats[activeBowler.id].wickets + (sim.isWicket ? 1 : 0),
      },
    };

    const newEvent: BallEvent = {
      id: `${inningsNum}-${nextBallNum}-${Math.random()}`,
      innings: inningsNum,
      overBall: overBallStr,
      batterName: activeBatter.name,
      bowlerName: activeBowler.name,
      shotOrDelivery: isUserBatting ? shot : delivery,
      outcome: sim.outcome,
      runs: sim.runs,
      isWicket: sim.isWicket,
      commentary: sim.commentary,
    };

    const updatedLog = [newEvent, ...ballLog];

    setRuns(newRuns);
    setWickets(newWickets);
    setBallsBowled(nextBallNum);
    setBatterStats(updatedBatters);
    setBowlerStats(updatedBowlers);
    setBallLog(updatedLog);

    const chasedDown = targetScore !== null && newRuns >= targetScore;
    const allOut = newWickets >= maxWickets;
    const oversComplete = nextBallNum >= MAX_BALLS;

    if (inningsNum === 1 && (allOut || oversComplete)) {
      const summary: InningsSummary = {
        battingSide,
        runs: newRuns,
        wickets: newWickets,
        ballsBowled: nextBallNum,
        bonusRuns: startingBonus,
        batterStats: updatedBatters,
        bowlerStats: updatedBowlers,
        ballLog: updatedLog,
      };
      setInnings1Summary(summary);
      setInningsBreak(true);
      return;
    }

    if (inningsNum === 2 && (chasedDown || allOut || oversComplete)) {
      const summary2: InningsSummary = {
        battingSide,
        runs: newRuns,
        wickets: newWickets,
        ballsBowled: nextBallNum,
        bonusRuns: startingBonus,
        batterStats: updatedBatters,
        bowlerStats: updatedBowlers,
        ballLog: updatedLog,
      };
      if (innings1Summary && newRuns === innings1Summary.runs) {
        // Exact tie — trigger Super Ball Tiebreaker
        setInnings1Summary((prev) => prev);
        setSuperBallMode(true);
        setSuperBallMessage('SCORES LEVEL! Play the 1-Ball Super Tiebreaker to decide the winner!');
      } else {
        finishMatch(summary2);
      }
      return;
    }

    // If user lost a wicket and match continues, let user pick next batter
    if (isUserBatting && sim.isWicket && !allOut) {
      const nextAvailable = userBatOrder.find((p) => !updatedBatters[p.id]?.out);
      if (nextAvailable) {
        setUserBatterId(nextAvailable.id);
      }
      setNeedsNewUserBatter(true);
    }
  };

  const handleStartSecondInnings = () => {
    const nextSide: 'USER' | 'AI' = battingSide === 'USER' ? 'AI' : 'USER';
    const nextBonus = nextSide === 'USER' ? userBonusRuns : aiBonusRuns;
    setInningsNum(2);
    setBattingSide(nextSide);
    setRuns(nextBonus);
    setWickets(0);
    setBallsBowled(0);
    setBatterStats(initBatterStats(nextSide === 'USER' ? userSquad : aiSquad));
    setBowlerStats(initBowlerStats(nextSide === 'USER' ? aiSquad : userSquad));
    setBallLog([]);
    setNeedsNewUserBatter(false);
    setInningsBreak(false);

    // Check rare edge case where bonus runs alone beat 1st innings target
    if (innings1Summary && nextBonus >= innings1Summary.runs + 1) {
      const instantSummary: InningsSummary = {
        battingSide: nextSide,
        runs: nextBonus,
        wickets: 0,
        ballsBowled: 0,
        bonusRuns: nextBonus,
        batterStats: initBatterStats(nextSide === 'USER' ? userSquad : aiSquad),
        bowlerStats: initBowlerStats(nextSide === 'USER' ? aiSquad : userSquad),
        ballLog: [],
      };
      finishMatch(instantSummary);
    }
  };

  const handleSuperBall = (choice: ShotStyle | DeliveryType) => {
    if (!innings1Summary) return;
    const shot: ShotStyle = isUserBatting ? (choice as ShotStyle) : chooseAiShot(1, 1);
    const delivery: DeliveryType = isUserBatting
      ? chooseAiDelivery(activeBatter, 1)
      : (choice as DeliveryType);

    const sim = simulateBallOutcome({
      batter: activeBatter,
      bowler: activeBowler,
      shot,
      delivery,
      overBall: 'SB',
    });

    // In Super Ball: batting side wins if they score >= 2 runs (or 4/6); bowling side wins on 0, 1, or W!
    const battingWinsSuper = !sim.isWicket && sim.runs >= 2;
    const superWinner: 'USER' | 'AI' = battingWinsSuper
      ? battingSide
      : battingSide === 'USER'
      ? 'AI'
      : 'USER';

    if (superWinner === 'USER') soundFX.playDuelWin();
    else soundFX.playWicket();

    const summary2: InningsSummary = {
      battingSide,
      runs: runs + (battingWinsSuper ? sim.runs : 0),
      wickets,
      ballsBowled: MAX_BALLS,
      bonusRuns: startingBonus,
      batterStats,
      bowlerStats,
      ballLog,
    };
    finishMatch(summary2, true, superWinner);
  };

  const battingFranchise = battingSide === 'USER' ? userFranchise : aiFranchise;
  const bowlingFranchise = battingSide === 'USER' ? aiFranchise : userFranchise;

  return (
    <div className="space-y-6">
      {/* Live Stadium Broadcast Scorebug */}
      <section className="relative rounded-2xl overflow-hidden border border-slate-800 bg-slate-900">
        <div className="relative h-44 sm:h-48 bg-gradient-to-br from-emerald-950 via-slate-900 to-slate-950">
          <img
            src={cricketPitchArenaImg}
            alt="Illuminated cricket pitch arena under stadium floodlights"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover opacity-45"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#080D1A] via-[#080D1A]/75 to-[#080D1A]/35" />

          <div className="absolute inset-0 p-5 sm:p-6 flex flex-col justify-between">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
                <span>Match {matchNumber}</span>
                <span aria-hidden="true">·</span>
                <span>{inningsNum === 1 ? '1st Innings' : '2nd Innings Chase'}</span>
                <span aria-hidden="true">·</span>
                <span>2-Over Mini-Match</span>
              </div>
              <div className="text-xs font-mono text-slate-300 tabular-nums">
                Card Bonus: +{startingBonus} Runs Included
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <TeamCrest franchise={battingFranchise} size="md" />
                <div>
                  <div className="text-xs text-slate-300 font-medium">
                    {battingFranchise.name} ({isUserBatting ? 'You Batting' : 'AI Batting'})
                  </div>
                  <div className="flex items-baseline gap-3 mt-0.5">
                    <span className="font-mono text-4xl sm:text-5xl font-bold text-white tabular-nums">
                      {runs}/{wickets}
                    </span>
                    <span className="font-mono text-base sm:text-lg text-amber-400 tabular-nums">
                      ({oversString} / 2.0 ov)
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-5 bg-slate-950/85 border border-slate-800 rounded-xl px-4 py-2.5">
                {targetScore !== null ? (
                  <>
                    <div>
                      <div className="text-[11px] text-slate-400">Target</div>
                      <div className="font-mono text-lg font-bold text-amber-400 tabular-nums">
                        {targetScore}
                      </div>
                    </div>
                    <div className="h-7 w-px bg-slate-800" />
                    <div>
                      <div className="text-[11px] text-slate-400">Need</div>
                      <div className="font-mono text-lg font-bold text-white tabular-nums">
                        {Math.max(0, targetScore - runs)} off {ballsRemaining}b
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="text-[11px] text-slate-400">Balls Left</div>
                      <div className="font-mono text-lg font-bold text-white tabular-nums">
                        {ballsRemaining}
                      </div>
                    </div>
                    <div className="h-7 w-px bg-slate-800" />
                    <div>
                      <div className="text-[11px] text-slate-400">Bowling</div>
                      <div className="text-sm font-semibold text-sky-300">
                        {bowlingFranchise.shortName}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 12-Ball Timeline Strip */}
        <div className="px-5 py-3 bg-slate-950/90 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400 mr-1">Over Tracker:</span>
            {Array.from({ length: MAX_BALLS }).map((_, idx) => {
              const chronLog = [...ballLog].reverse();
              const ev = chronLog[idx];
              const isOverSep = idx === 6;
              return (
                <React.Fragment key={idx}>
                  {isOverSep && <span className="text-slate-600 font-mono mx-0.5">|</span>}
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center font-mono text-xs font-bold border tabular-nums ${
                      !ev
                        ? 'border-slate-800 bg-slate-900 text-slate-600'
                        : ev.outcome === 'W'
                        ? 'border-rose-500 bg-rose-500/20 text-rose-300'
                        : ev.outcome === '6'
                        ? 'border-amber-400 bg-amber-400 text-slate-950'
                        : ev.outcome === '4'
                        ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                        : 'border-slate-700 bg-slate-800 text-slate-200'
                    }`}
                  >
                    {ev ? ev.outcome : '·'}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </section>

      {/* Innings Break Screen */}
      {inningsBreak && innings1Summary ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-8 text-center space-y-5">
          <div className="text-xs font-semibold text-amber-400">Innings Break</div>
          <h2 className="font-display text-3xl sm:text-4xl font-extrabold text-white">
            {battingFranchise.name} Posted {innings1Summary.runs}/{innings1Summary.wickets}
          </h2>
          <p className="text-sm text-slate-300 max-w-lg mx-auto">
            {bowlingFranchise.name} need{' '}
            <strong className="text-amber-400 font-mono">{innings1Summary.runs + 1}</strong> runs in
            12 balls (starting with{' '}
            <strong className="text-white font-mono">
              +{battingSide === 'USER' ? aiBonusRuns : userBonusRuns}
            </strong>{' '}
            card duel bonus runs).
          </p>
          <button
            type="button"
            onClick={handleStartSecondInnings}
            className="inline-flex items-center gap-2 py-3.5 px-7 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display text-lg font-bold tracking-wide transition-colors cursor-pointer"
          >
            <span>Start 2nd Innings</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left & Center: Active Matchup & Interactive Console */}
          <div className="lg:col-span-7 space-y-5">
            {/* Active Batter vs Bowler Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div
                className={`rounded-xl border p-4 bg-slate-900/95 ${
                  activeBatter.inForm ? 'border-amber-400/70' : 'border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>On Strike · {battingFranchise.shortName}</span>
                  {activeBatter.inForm && (
                    <span className="text-amber-400 font-semibold inline-flex items-center gap-1">
                      <Flame className="w-3 h-3" /> In-Form +15%
                    </span>
                  )}
                </div>
                <div className="font-display text-2xl font-bold text-white">
                  {activeBatter.name}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {activeBatter.role} · SR {activeBatter.stats.strikeRate.toFixed(1)}
                </div>
                <div className="mt-3 font-mono text-sm text-emerald-400 font-bold tabular-nums">
                  Match: {batterStats[activeBatter.id]?.runs ?? 0} (
                  {batterStats[activeBatter.id]?.balls ?? 0})
                </div>
              </div>

              <div
                className={`rounded-xl border p-4 bg-slate-900/95 ${
                  activeBowler.inForm ? 'border-amber-400/70' : 'border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>Bowling Over {currentOverIndex} · {bowlingFranchise.shortName}</span>
                  {activeBowler.inForm && (
                    <span className="text-amber-400 font-semibold inline-flex items-center gap-1">
                      <Flame className="w-3 h-3" /> In-Form +15%
                    </span>
                  )}
                </div>
                <div className="font-display text-2xl font-bold text-white">
                  {activeBowler.name}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {activeBowler.role} · Econ {activeBowler.stats.economy.toFixed(2)}
                </div>
                <div className="mt-3 font-mono text-sm text-sky-400 font-bold tabular-nums">
                  Figures: {bowlerStats[activeBowler.id]?.wickets ?? 0}-
                  {bowlerStats[activeBowler.id]?.runsConceded ?? 0} (
                  {bowlerStats[activeBowler.id]?.balls ?? 0}b)
                </div>
              </div>
            </div>

            {/* Super Ball Alert */}
            {superBallMode && superBallMessage && (
              <div className="rounded-xl border border-amber-400 bg-amber-500/15 p-4 text-sm text-amber-200 font-semibold">
                {superBallMessage} Batting team needs 2+ runs to win; bowling team wins on 0, 1, or Wicket!
              </div>
            )}

            {/* Squad Selector for User Batter or Bowler */}
            {isUserBatting && (ballsBowled === 0 || needsNewUserBatter) && !superBallMode && (
              <div className="rounded-xl border border-amber-400/40 bg-slate-900/95 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-white">
                    {needsNewUserBatter ? 'Wicket Fell! Select Next Batter:' : 'Select Opening Batter:'}
                  </div>
                  {needsNewUserBatter && (
                    <button
                      type="button"
                      onClick={() => setNeedsNewUserBatter(false)}
                      className="text-xs text-amber-400 font-semibold hover:underline cursor-pointer"
                    >
                      Confirm {activeBatter.name}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {notOutUserBatters.map((p) => {
                    const selected = p.id === activeBatter.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setUserBatterId(p.id);
                          setNeedsNewUserBatter(false);
                        }}
                        className={`p-2.5 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
                          selected
                            ? 'bg-amber-400/15 border-amber-400 text-white'
                            : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <div className="font-semibold truncate flex items-center gap-1">
                          <span className="truncate">{p.name}</span>
                          {p.inForm && <Flame className="w-3 h-3 text-amber-400 shrink-0" />}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5 tabular-nums">
                          SR {p.stats.strikeRate.toFixed(1)} · {p.role}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {!isUserBatting && (ballsBowled === 0 || ballsBowled === 6) && !superBallMode && (
              <div className="rounded-xl border border-sky-500/40 bg-slate-900/95 p-4 space-y-3">
                <div className="text-sm font-semibold text-white">
                  Select Bowler for Over {currentOverIndex} (Max 1 over per bowler):
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {userBowlOrder.map((p) => {
                    const alreadyBowledOver1 = currentOverIndex === 2 && p.id === userOver1BowlerId;
                    const selected =
                      (currentOverIndex === 1 ? userOver1BowlerId : userOver2BowlerId) === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={alreadyBowledOver1}
                        onClick={() => {
                          if (currentOverIndex === 1) {
                            setUserOver1BowlerId(p.id);
                            if (userOver2BowlerId === p.id) {
                              const alt = userBowlOrder.find((x) => x.id !== p.id);
                              if (alt) setUserOver2BowlerId(alt.id);
                            }
                          } else {
                            setUserOver2BowlerId(p.id);
                          }
                        }}
                        className={`p-2.5 rounded-lg border text-left text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          selected
                            ? 'bg-sky-500/15 border-sky-400 text-white'
                            : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <div className="font-semibold truncate flex items-center gap-1">
                          <span className="truncate">{p.name}</span>
                          {p.inForm && <Flame className="w-3 h-3 text-amber-400 shrink-0" />}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5 tabular-nums">
                          Econ {p.stats.economy.toFixed(2)} · {p.role}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tactical Shot / Delivery Controls */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-5 space-y-4">
              {isUserBatting ? (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-xl font-bold text-white">
                      {superBallMode ? 'Super Ball — Choose Your Shot' : 'Choose Your Shot Style'}
                    </h3>
                    <span className="text-xs text-slate-400">Ball {ballsBowled + 1} of 12</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      disabled={needsNewUserBatter}
                      onClick={() =>
                        superBallMode ? handleSuperBall('DEFEND') : handlePlayBall('DEFEND')
                      }
                      className="p-4 rounded-xl border border-slate-700 bg-slate-950/80 hover:border-emerald-400 hover:bg-emerald-500/10 text-left transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                        <Shield className="w-4 h-4" />
                        <span>Defend</span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        Safe stroke. Low wicket risk, steady 1s &amp; 2s.
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={needsNewUserBatter}
                      onClick={() =>
                        superBallMode ? handleSuperBall('BALANCED') : handlePlayBall('BALANCED')
                      }
                      className="p-4 rounded-xl border border-slate-700 bg-slate-950/80 hover:border-sky-400 hover:bg-sky-500/10 text-left transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2 text-sky-400 font-semibold text-sm">
                        <Target className="w-4 h-4" />
                        <span>Balanced</span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        Gap placement for 4s with controlled risk.
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={needsNewUserBatter}
                      onClick={() =>
                        superBallMode ? handleSuperBall('LOFTED') : handlePlayBall('LOFTED')
                      }
                      className="p-4 rounded-xl border border-amber-400/50 bg-amber-500/10 hover:bg-amber-500/20 text-left transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                        <Zap className="w-4 h-4" />
                        <span>Lofted Shot</span>
                      </div>
                      <div className="text-xs text-slate-300 mt-1">
                        High risk, maximum 4 &amp; 6 boundary power!
                      </div>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-xl font-bold text-white">
                      {superBallMode
                        ? 'Super Ball — Choose Your Delivery'
                        : 'Choose Your Delivery Type'}
                    </h3>
                    <span className="text-xs text-slate-400">Ball {ballsBowled + 1} of 12</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {(
                      [
                        { id: 'YORKER', title: 'Yorker', desc: 'Blocks sixes, bowls stumps' },
                        { id: 'BOUNCER', title: 'Bouncer', desc: 'Pace & wicket threat' },
                        { id: 'SLOWER', title: 'Slower Ball', desc: 'Traps lofted hitters' },
                        { id: 'SPIN', title: 'Spin', desc: 'Flight & tight economy' },
                      ] as const
                    ).map((del) => (
                      <button
                        key={del.id}
                        type="button"
                        onClick={() =>
                          superBallMode ? handleSuperBall(del.id) : handlePlayBall(del.id)
                        }
                        className="p-3.5 rounded-xl border border-slate-700 bg-slate-950/80 hover:border-sky-400 hover:bg-sky-500/10 text-left transition-colors cursor-pointer"
                      >
                        <div className="font-semibold text-sm text-sky-300">{del.title}</div>
                        <div className="text-[11px] text-slate-400 mt-1 leading-snug">{del.desc}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right Column: Live Commentary & Mini Scorecard */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/95 p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-display text-xl font-bold text-white">Live Commentary</h3>
              <span className="text-xs text-slate-400 font-mono tabular-nums">
                {ballLog.length} deliveries
              </span>
            </div>

            {ballLog.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl">
                Players are ready in the middle. Select your first{' '}
                {isUserBatting ? 'shot' : 'delivery'} to bowl Ball 0.1!
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                {ballLog.map((ev, idx) => (
                  <div
                    key={ev.id}
                    className={`p-3 rounded-xl border text-xs leading-relaxed ${
                      idx === 0
                        ? 'bg-slate-800/90 border-slate-700 text-white'
                        : 'bg-slate-950/60 border-slate-800/80 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono font-bold text-amber-400">
                        {ev.outcome === 'W'
                          ? 'WICKET'
                          : ev.outcome === '6'
                          ? 'SIX (6)'
                          : ev.outcome === '4'
                          ? 'FOUR (4)'
                          : `${ev.runs} RUN${ev.runs === 1 ? '' : 'S'}`}
                      </span>
                      <span className="text-[11px] text-slate-500 uppercase tracking-wide">
                        {ev.shotOrDelivery}
                      </span>
                    </div>
                    <p>{ev.commentary}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
