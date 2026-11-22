import React from 'react';
import { ArrowRight, Award, Coins, Flame, RotateCcw, Trophy } from 'lucide-react';
import { Franchise, MatchResult } from '../types/game';
import { GlobalRankingDashboard } from './GlobalRankingDashboard';
import { TeamCrest } from './TeamCrest';

interface Phase4SummaryProps {
  matchNumber: number;
  userFranchise: Franchise;
  aiFranchise: Franchise;
  result: MatchResult;
  updatedUserPurse: number;
  careerWins: number;
  careerMatches: number;
  currentUid: string;
  captainName: string;
  emailVerified: boolean;
  onNextRound: () => void;
  onResetCareer: () => void;
}

export const Phase4Summary: React.FC<Phase4SummaryProps> = ({
  matchNumber,
  userFranchise,
  aiFranchise,
  result,
  updatedUserPurse,
  careerWins,
  careerMatches,
  currentUid,
  captainName,
  emailVerified,
  onNextRound,
  onResetCareer,
}) => {
  const userWon = result.winner === 'USER';

  // Find Top Batter & Best Bowler across both teams
  const allBatters = [
    ...Object.values(result.userInnings.batterStats),
    ...Object.values(result.aiInnings.batterStats),
  ].filter((b) => b.balls > 0);
  allBatters.sort((a, b) => b.runs - a.runs || a.balls - b.balls);
  const topBatter = allBatters[0];

  const allBowlers = [
    ...Object.values(result.userInnings.bowlerStats),
    ...Object.values(result.aiInnings.bowlerStats),
  ].filter((bw) => bw.balls > 0);
  allBowlers.sort((a, b) => b.wickets - a.wickets || a.runsConceded - b.runsConceded);
  const bestBowler = allBowlers[0];

  return (
    <div className="space-y-6">
      {/* Match Result Hero Card */}
      <section
        className={`rounded-2xl border p-6 sm:p-8 ${
          userWon
            ? 'border-amber-400/60 bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/25'
            : 'border-slate-800 bg-slate-900/95'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
              <span>Match {matchNumber} Complete</span>
              <span aria-hidden="true">·</span>
              <span>Career Record: {careerWins}W – {careerMatches - careerWins}L</span>
            </div>
            <h1 className="font-display text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
              {userWon
                ? `${userFranchise.name} Victorious!`
                : `${aiFranchise.name} Take the Match`}
            </h1>
            <p className="text-base text-slate-300">{result.winMarginText}</p>
          </div>

          <div className="flex items-center gap-4 bg-slate-950/90 border border-slate-800 rounded-2xl p-4 shrink-0">
            <div className="text-center px-3">
              <TeamCrest franchise={userFranchise} size="sm" />
              <div className="font-mono text-2xl font-bold text-white tabular-nums mt-2">
                {result.userInnings.runs}/{result.userInnings.wickets}
              </div>
              <div className="text-[11px] text-slate-400">
                incl. +{result.userInnings.bonusRuns} bonus
              </div>
            </div>

            <div className="text-xs font-display font-bold text-slate-500">VS</div>

            <div className="text-center px-3">
              <TeamCrest franchise={aiFranchise} size="sm" />
              <div className="font-mono text-2xl font-bold text-white tabular-nums mt-2">
                {result.aiInnings.runs}/{result.aiInnings.wickets}
              </div>
              <div className="text-[11px] text-slate-400">
                incl. +{result.aiInnings.bonusRuns} bonus
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Prize Money Breakdown + Match Performers */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-slate-900/95 p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <Coins className="w-5 h-5 text-amber-400" />
              <h2 className="font-display text-2xl font-bold text-white">
                Prize Money Payout
              </h2>
            </div>
            <span className="font-mono text-sm font-semibold text-emerald-400 tabular-nums">
              +₹{result.totalEarned.toFixed(2)} Cr Earned
            </span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between py-2.5 px-4 rounded-xl bg-slate-950/75 border border-slate-800/80">
              <div>
                <div className="text-sm font-semibold text-white">
                  {userWon ? 'Match Winner Prize' : 'Match Participation Consolation'}
                </div>
                <div className="text-xs text-slate-400">
                  {userWon
                    ? 'Full championship payout added to auction purse'
                    : 'Consolation payout to rebuild your squad'}
                </div>
              </div>
              <span className="font-mono text-lg font-bold text-emerald-400 tabular-nums">
                +₹{result.matchPrize.toFixed(2)} Cr
              </span>
            </div>

            <div className="flex items-center justify-between py-2.5 px-4 rounded-xl bg-slate-950/75 border border-slate-800/80">
              <div>
                <div className="text-sm font-semibold text-white">
                  Card Battle Sweep Bonus
                </div>
                <div className="text-xs text-slate-400">
                  Won {result.userDuelsWon} card duels (requires 5+ in 7-card or 8+ in 11-card mode)
                </div>
              </div>
              <span
                className={`font-mono text-lg font-bold tabular-nums ${
                  result.sweepBonus > 0 ? 'text-amber-400' : 'text-slate-500'
                }`}
              >
                {result.sweepBonus > 0 ? `+₹${result.sweepBonus.toFixed(2)} Cr` : '₹0.00 Cr'}
              </span>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <div>
                <div className="text-sm font-semibold text-slate-200">
                  Carried-Over Purse for Match {matchNumber + 1}
                </div>
                <div className="text-xs text-slate-400">
                  Includes unspent purse + prize winnings (+₹80.00 Cr Season Auction Grant added on advance)
                </div>
              </div>
              <span className="font-mono text-2xl font-bold text-amber-400 tabular-nums">
                ₹{updatedUserPurse.toFixed(2)} Cr
              </span>
            </div>
          </div>
        </div>

        {/* Standout Performers */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/95 p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
              <Award className="w-5 h-5 text-sky-400" />
              <h2 className="font-display text-2xl font-bold text-white">Match Honours</h2>
            </div>

            {topBatter && (
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <span>Top Scorer</span>
                    {topBatter.inForm && <Flame className="w-3.5 h-3.5 text-amber-400" />}
                  </div>
                  <div className="font-display text-xl font-bold text-white mt-0.5">
                    {topBatter.name}
                  </div>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <div className="text-lg font-bold text-emerald-400">
                    {topBatter.runs} ({topBatter.balls})
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {topBatter.fours}x4 · {topBatter.sixes}x6
                  </div>
                </div>
              </div>
            )}

            {bestBowler && (
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <span>Best Bowler</span>
                    {bestBowler.inForm && <Flame className="w-3.5 h-3.5 text-amber-400" />}
                  </div>
                  <div className="font-display text-xl font-bold text-white mt-0.5">
                    {bestBowler.name}
                  </div>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <div className="text-lg font-bold text-sky-400">
                    {bestBowler.wickets}/{bestBowler.runsConceded}
                  </div>
                  <div className="text-[11px] text-slate-400">{bestBowler.balls} balls</div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={onNextRound}
              className="flex-1 py-3.5 px-5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display text-lg font-bold tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Trophy className="w-4 h-4" />
              <span>Next Match &amp; Auction</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onResetCareer}
              className="py-3.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>New Career</span>
            </button>
          </div>
        </div>
      </div>

      {/* Global Career Ranking Dashboard (Firestore Leaderboard) */}
      <GlobalRankingDashboard
        currentUid={currentUid}
        captainName={captainName}
        favoriteFranchiseId={userFranchise.id}
        careerWins={careerWins}
        careerMatches={careerMatches}
        currentPurse={updatedUserPurse}
        emailVerified={emailVerified}
      />
    </div>
  );
};
