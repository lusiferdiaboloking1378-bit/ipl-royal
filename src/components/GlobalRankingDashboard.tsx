import React, { useEffect, useMemo, useState } from 'react';
import { Crown, Globe, Medal, ShieldCheck, Trophy } from 'lucide-react';
import { getFranchiseById } from '../data/iplData';
import {
  fetchUserGlobalRankStats,
  subscribeGlobalLeaderboard,
  type LeaderboardEntry,
} from '../firebase';
import { TeamCrest } from './TeamCrest';

interface GlobalRankingDashboardProps {
  currentUid: string;
  captainName: string;
  favoriteFranchiseId: string;
  careerWins: number;
  careerMatches: number;
  currentPurse: number;
  emailVerified: boolean;
}

export const GlobalRankingDashboard: React.FC<GlobalRankingDashboardProps> = ({
  currentUid,
  captainName,
  favoriteFranchiseId,
  careerWins,
  careerMatches,
  currentPurse,
  emailVerified,
}) => {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rankStats, setRankStats] = useState<{ rank: number; totalPlayers: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErrorMsg(null);
    const unsubscribe = subscribeGlobalLeaderboard(
      (rows) => {
        setEntries(rows);
        setLoading(false);
      },
      () => {
        setErrorMsg('Unable to load live global rankings right now.');
        setLoading(false);
      },
      25
    );

    return () => {
      unsubscribe();
    };
  }, [currentUid]);

  useEffect(() => {
    let active = true;
    fetchUserGlobalRankStats(careerWins)
      .then((stats) => {
        if (active) setRankStats(stats);
      })
      .catch(() => {
        // Fallback computed from top snapshot below
      });
    return () => {
      active = false;
    };
  }, [careerWins, entries.length]);

  const userIndexInTop = useMemo(
    () => entries.findIndex((e) => e.uid === currentUid),
    [entries, currentUid]
  );

  const displayRank = useMemo(() => {
    if (rankStats) return rankStats.rank;
    if (userIndexInTop >= 0) return userIndexInTop + 1;
    const higherInSnapshot = entries.filter((e) => e.careerWins > careerWins).length;
    return higherInSnapshot + 1;
  }, [rankStats, userIndexInTop, entries, careerWins]);

  const totalRankedPlayers = useMemo(() => {
    if (rankStats) return Math.max(rankStats.totalPlayers, entries.length, 1);
    return Math.max(entries.length, 1);
  }, [rankStats, entries.length]);

  const winRate = careerMatches > 0 ? Math.round((careerWins / careerMatches) * 100) : 0;
  const userFranchise = useMemo(
    () => getFranchiseById(favoriteFranchiseId),
    [favoriteFranchiseId]
  );

  return (
    <section
      aria-label="Global Career Ranking Dashboard"
      className="rounded-2xl border border-slate-800 bg-slate-900/95 p-6 space-y-5"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-400/40 flex items-center justify-center shrink-0">
            <Globe className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold text-white tracking-tight">
              Global Career Ranking
            </h2>
            <p className="text-xs text-slate-400">
              Live Firestore standings ranked by accumulated career wins across all captains
            </p>
          </div>
        </div>

        <div className="text-left sm:text-right">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
            Your Global Standing
          </div>
          <div className="font-mono text-xl font-extrabold text-amber-400 tabular-nums">
            Rank #{displayRank}{' '}
            <span className="text-xs font-normal text-slate-400">
              of {totalRankedPlayers}
            </span>
          </div>
        </div>
      </div>

      {/* 4-Metric Personal Ranking Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <Crown className="w-3.5 h-3.5 text-amber-400" />
            <span>Global Rank</span>
          </div>
          <div className="font-mono text-2xl font-extrabold text-amber-400 tabular-nums mt-1">
            #{displayRank}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {displayRank === 1
              ? 'World #1 Captain'
              : displayRank <= 3
              ? 'Top 3 Podium'
              : `Top ${Math.max(1, Math.round((displayRank / totalRankedPlayers) * 100))}% globally`}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-emerald-400" />
            <span>Career Wins</span>
          </div>
          <div className="font-mono text-2xl font-extrabold text-emerald-400 tabular-nums mt-1">
            {careerWins}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {careerMatches} total matches played
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <Medal className="w-3.5 h-3.5 text-sky-400" />
            <span>Win Rate</span>
          </div>
          <div className="font-mono text-2xl font-extrabold text-sky-400 tabular-nums mt-1">
            {winRate}%
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {careerWins}W – {Math.max(0, careerMatches - careerWins)}L record
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-2">
          <div>
            <div className="text-xs text-slate-400">Franchise &amp; Purse</div>
            <div className="font-mono text-xl font-extrabold text-white tabular-nums mt-1">
              ₹{currentPurse.toFixed(1)}Cr
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[120px]">
              {userFranchise.shortName} · {captainName}
            </div>
          </div>
          <TeamCrest franchise={userFranchise} size="sm" />
        </div>
      </div>

      {!emailVerified && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-400/40 text-xs text-amber-100 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            Verify your email address in the top bar to publish your career wins onto the live Global
            Leaderboard.
          </span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200">
          {errorMsg}
        </div>
      )}

      {/* Top Players Leaderboard Table */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400 px-1">
          <span>Top Captains Leaderboard</span>
          <span className="font-mono tabular-nums">Showing Top {entries.length}</span>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-slate-400 border border-slate-800 rounded-xl bg-slate-950/60">
            Syncing live global standings from Firestore...
          </div>
        ) : entries.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl bg-slate-950/60">
            No ranked captains recorded yet. Complete and verify your account to claim Rank #1!
          </div>
        ) : (
          <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
            {entries.map((entry, idx) => {
              const rank = idx + 1;
              const isMe = entry.uid === currentUid;
              const f = getFranchiseById(entry.favoriteFranchiseId);
              const entryWinRate =
                entry.careerMatches > 0
                  ? Math.round((entry.careerWins / entry.careerMatches) * 100)
                  : 0;

              return (
                <div
                  key={entry.uid}
                  className={`px-4 py-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                    isMe
                      ? 'bg-amber-500/12 border-amber-400/70'
                      : 'bg-slate-950/75 border-slate-800/90'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 text-center font-mono text-sm font-extrabold tabular-nums shrink-0 ${
                        rank === 1
                          ? 'text-amber-400'
                          : rank === 2
                          ? 'text-slate-200'
                          : rank === 3
                          ? 'text-amber-600'
                          : 'text-slate-500'
                      }`}
                    >
                      #{rank}
                    </div>
                    <TeamCrest franchise={f} size="xs" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">
                        {entry.displayName}{' '}
                        {isMe && <span className="text-xs text-amber-400 font-bold">(You)</span>}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                        {f.shortName} · {entry.careerMatches} Matches · {entryWinRate}% Win Rate
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="font-mono text-base font-extrabold text-emerald-400 tabular-nums">
                      {entry.careerWins} {entry.careerWins === 1 ? 'Win' : 'Wins'}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                      ₹{entry.careerPurse.toFixed(1)} Cr
                    </div>
                  </div>
                </div>
              );
            })}

            {userIndexInTop === -1 && emailVerified && (
              <div className="pt-2 border-t border-slate-800">
                <div className="px-4 py-3 rounded-xl border bg-amber-500/12 border-amber-400/70 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 text-center font-mono text-sm font-extrabold text-amber-400 tabular-nums shrink-0">
                      #{displayRank}
                    </div>
                    <TeamCrest franchise={userFranchise} size="xs" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">
                        {captainName} <span className="text-xs text-amber-400 font-bold">(You)</span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                        {userFranchise.shortName} · {careerMatches} Matches · {winRate}% Win Rate
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-base font-extrabold text-emerald-400 tabular-nums">
                      {careerWins} {careerWins === 1 ? 'Win' : 'Wins'}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                      ₹{currentPurse.toFixed(1)} Cr
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
