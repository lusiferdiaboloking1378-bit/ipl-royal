import React, { useEffect, useState } from 'react';
import { ArrowRight, Flame, ShieldCheck, Swords, Trophy } from 'lucide-react';
import { STAT_META } from '../data/iplData';
import { DraftedPlayer, DuelRecord, Franchise, StatKey } from '../types/game';
import { chooseAiBestStat, compareDuelStat } from '../utils/engine';
import { soundFX } from '../utils/sound';
import { PlayerCard } from './PlayerCard';
import { TeamCrest } from './TeamCrest';

interface Phase2CardBattleProps {
  matchNumber: number;
  userFranchise: Franchise;
  aiFranchise: Franchise;
  userSquad: DraftedPlayer[];
  aiSquad: DraftedPlayer[];
  onCompleteBattle: (result: {
    updatedUserSquad: DraftedPlayer[];
    updatedAiSquad: DraftedPlayer[];
    userBonusRuns: number;
    aiBonusRuns: number;
    userDuelsWon: number;
    aiDuelsWon: number;
    battingFirst: 'USER' | 'AI';
  }) => void;
}

export const Phase2CardBattle: React.FC<Phase2CardBattleProps> = ({
  matchNumber,
  userFranchise,
  aiFranchise,
  userSquad,
  aiSquad,
  onCompleteBattle,
}) => {
  const totalRounds = userSquad.length;
  const [roundIdx, setRoundIdx] = useState(0);
  const [uSquad, setUSquad] = useState<DraftedPlayer[]>(userSquad);
  const [aSquad, setASquad] = useState<DraftedPlayer[]>(aiSquad);
  const [duels, setDuels] = useState<DuelRecord[]>([]);
  const [activeDuelResult, setActiveDuelResult] = useState<DuelRecord | null>(null);
  const [aiPicking, setAiPicking] = useState(false);

  // Toss state after all rounds complete
  const [tossPhase, setTossPhase] = useState(false);
  const [tossWinner, setTossWinner] = useState<'USER' | 'AI'>('USER');
  const [aiTossChoice, setAiTossChoice] = useState<'USER' | 'AI' | null>(null);

  const chooser: 'USER' | 'AI' = roundIdx % 2 === 0 ? 'USER' : 'AI';
  const activeUserCard = uSquad[roundIdx];
  const activeAiCard = aSquad[roundIdx];

  const userBonusRuns = duels.reduce(
    (sum, d) => sum + (d.winner === 'USER' ? 2 : d.winner === 'DRAW' ? 1 : 0),
    0
  );
  const aiBonusRuns = duels.reduce(
    (sum, d) => sum + (d.winner === 'AI' ? 2 : d.winner === 'DRAW' ? 1 : 0),
    0
  );
  const userDuelsWon = duels.filter((d) => d.winner === 'USER').length;
  const aiDuelsWon = duels.filter((d) => d.winner === 'AI').length;

  const resolveStatChoice = (stat: StatKey, pickedBy: 'USER' | 'AI') => {
    if (!activeUserCard || !activeAiCard || activeDuelResult) return;

    const comparison = compareDuelStat(stat, activeUserCard, activeAiCard);
    const updatedUser = uSquad.map((p, i) =>
      i === roundIdx && comparison.winner === 'USER' ? { ...p, inForm: true } : p
    );
    const updatedAi = aSquad.map((p, i) =>
      i === roundIdx && comparison.winner === 'AI' ? { ...p, inForm: true } : p
    );

    if (comparison.winner === 'USER') soundFX.playDuelWin();
    else if (comparison.winner === 'AI') soundFX.playDuelLoss();
    else soundFX.playBid();

    const record: DuelRecord = {
      round: roundIdx + 1,
      userPlayer: updatedUser[roundIdx],
      aiPlayer: updatedAi[roundIdx],
      chosenStat: stat,
      chooser: pickedBy,
      userValue: comparison.userValue,
      aiValue: comparison.aiValue,
      winner: comparison.winner,
    };

    setUSquad(updatedUser);
    setASquad(updatedAi);
    setActiveDuelResult(record);
    setDuels((prev) => [...prev, record]);
    setAiPicking(false);
  };

  // Trigger AI stat pick automatically on AI turns
  useEffect(() => {
    if (tossPhase || activeDuelResult || chooser !== 'AI' || !activeAiCard) return;
    setAiPicking(true);
    const timer = window.setTimeout(() => {
      const bestStat = chooseAiBestStat(activeAiCard, matchNumber);
      resolveStatChoice(bestStat, 'AI');
    }, 680);
    return () => window.clearTimeout(timer);
  }, [roundIdx, chooser, tossPhase, activeDuelResult]);

  const handleNextRound = () => {
    if (roundIdx + 1 < totalRounds) {
      setActiveDuelResult(null);
      setRoundIdx((prev) => prev + 1);
    } else {
      // Determine Toss Winner
      const winner: 'USER' | 'AI' =
        userDuelsWon > aiDuelsWon
          ? 'USER'
          : aiDuelsWon > userDuelsWon
          ? 'AI'
          : Math.random() < 0.5
          ? 'USER'
          : 'AI';
      setTossWinner(winner);
      if (winner === 'AI') {
        // AI elects to bat or bowl
        const aiBatsFirst = Math.random() < 0.5;
        setAiTossChoice(aiBatsFirst ? 'AI' : 'USER');
      }
      setTossPhase(true);
    }
  };

  if (tossPhase) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-6 sm:p-8 max-w-3xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-400/15 text-amber-400 mx-auto">
            <Trophy className="w-7 h-7" />
          </div>

          <div>
            <div className="text-xs font-semibold text-amber-400">
              Card Battle Complete · {totalRounds} Duels Played
            </div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold text-white mt-1">
              {tossWinner === 'USER'
                ? `${userFranchise.name} Win the Toss!`
                : `${aiFranchise.name} Win the Toss!`}
            </h2>
            <p className="text-sm text-slate-300 mt-2">
              {userDuelsWon === aiDuelsWon
                ? `Duels finished level (${userDuelsWon}–${aiDuelsWon}), decided by the official match coin flip.`
                : `Majority duel victory (${userDuelsWon}–${aiDuelsWon}) awards Toss priority for the 2-Over Mini-Match.`}
            </p>
          </div>

          {/* Bonus Summary Strip */}
          <div className="grid grid-cols-2 gap-4 text-left">
            <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-4">
              <div className="flex items-center gap-2.5">
                <TeamCrest franchise={userFranchise} size="xs" />
                <span className="font-display text-lg font-bold text-white">
                  {userFranchise.shortName}
                </span>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-xs text-slate-400">Starting Score</span>
                <span className="font-mono text-xl font-bold text-emerald-400 tabular-nums">
                  +{userBonusRuns} Runs
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xs text-slate-400">In-Form Players</span>
                <span className="font-mono text-sm font-semibold text-amber-400 tabular-nums">
                  {uSquad.filter((p) => p.inForm).length} Boosted
                </span>
              </div>
            </div>

            <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-4">
              <div className="flex items-center gap-2.5">
                <TeamCrest franchise={aiFranchise} size="xs" />
                <span className="font-display text-lg font-bold text-white">
                  {aiFranchise.shortName}
                </span>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-xs text-slate-400">Starting Score</span>
                <span className="font-mono text-xl font-bold text-sky-400 tabular-nums">
                  +{aiBonusRuns} Runs
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xs text-slate-400">In-Form Players</span>
                <span className="font-mono text-sm font-semibold text-amber-400 tabular-nums">
                  {aSquad.filter((p) => p.inForm).length} Boosted
                </span>
              </div>
            </div>
          </div>

          {/* Toss Choice */}
          {tossWinner === 'USER' ? (
            <div className="space-y-3 pt-2">
              <div className="text-sm font-medium text-slate-200">
                Choose your Innings Order for the 2-Over Match:
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() =>
                    onCompleteBattle({
                      updatedUserSquad: uSquad,
                      updatedAiSquad: aSquad,
                      userBonusRuns,
                      aiBonusRuns,
                      userDuelsWon,
                      aiDuelsWon,
                      battingFirst: 'USER',
                    })
                  }
                  className="py-3.5 px-5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display text-lg font-bold tracking-wide transition-colors cursor-pointer"
                >
                  Bat First (Set Target)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onCompleteBattle({
                      updatedUserSquad: uSquad,
                      updatedAiSquad: aSquad,
                      userBonusRuns,
                      aiBonusRuns,
                      userDuelsWon,
                      aiDuelsWon,
                      battingFirst: 'AI',
                    })
                  }
                  className="py-3.5 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-display text-lg font-bold tracking-wide transition-colors cursor-pointer"
                >
                  Bowl First (Chase Target)
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sm text-sky-200">
                {aiFranchise.name} elected to{' '}
                <strong className="text-white">
                  {aiTossChoice === 'AI' ? 'Bat First' : 'Bowl First'}
                </strong>
                .
              </div>
              <button
                type="button"
                onClick={() =>
                  onCompleteBattle({
                    updatedUserSquad: uSquad,
                    updatedAiSquad: aSquad,
                    userBonusRuns,
                    aiBonusRuns,
                    userDuelsWon,
                    aiDuelsWon,
                    battingFirst: aiTossChoice || 'AI',
                  })
                }
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 py-3.5 px-8 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display text-lg font-bold tracking-wide transition-colors cursor-pointer"
              >
                <span>Start 2-Over Mini-Match</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Battle Scorebug Header */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <TeamCrest franchise={userFranchise} size="sm" />
          <div>
            <div className="text-xs text-slate-400">{userFranchise.name}</div>
            <div className="font-mono text-lg font-bold text-white tabular-nums">
              {userDuelsWon} Duels · <span className="text-emerald-400">+{userBonusRuns} Runs</span>
            </div>
          </div>
        </div>

        <div className="text-center">
          <div className="text-xs font-medium text-amber-400 flex items-center justify-center gap-1.5">
            <Swords className="w-3.5 h-3.5" />
            <span>
              Duel {roundIdx + 1} of {totalRounds}
            </span>
          </div>
          <div className="font-display text-xl font-bold text-white mt-0.5">
            {activeDuelResult
              ? activeDuelResult.winner === 'USER'
                ? `${userFranchise.shortName} Wins Duel!`
                : activeDuelResult.winner === 'AI'
                ? `${aiFranchise.shortName} Wins Duel!`
                : 'Duel Tied!'
              : chooser === 'USER'
              ? 'Your Turn — Click a Stat on Your Card'
              : `${aiFranchise.shortName} Selecting Stat...`}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-slate-400">{aiFranchise.name}</div>
            <div className="font-mono text-lg font-bold text-white tabular-nums">
              {aiDuelsWon} Duels · <span className="text-sky-400">+{aiBonusRuns} Runs</span>
            </div>
          </div>
          <TeamCrest franchise={aiFranchise} size="sm" />
        </div>
      </div>

      {/* Duel Outcome Banner */}
      {activeDuelResult && (
        <div
          className={`rounded-xl border p-4 flex flex-col sm:flex-row items-center justify-between gap-4 ${
            activeDuelResult.winner === 'USER'
              ? 'bg-emerald-500/12 border-emerald-500/40'
              : activeDuelResult.winner === 'AI'
              ? 'bg-rose-500/12 border-rose-500/40'
              : 'bg-slate-800/80 border-slate-700'
          }`}
        >
          <div className="flex items-center gap-3">
            {activeDuelResult.winner === 'USER' ? (
              <Flame className="w-5 h-5 text-amber-400 shrink-0" />
            ) : (
              <ShieldCheck className="w-5 h-5 text-sky-400 shrink-0" />
            )}
            <div className="text-sm text-slate-100">
              <span className="font-semibold">
                {STAT_META[activeDuelResult.chosenStat].label}:
              </span>{' '}
              <span className="font-mono font-bold text-white tabular-nums">
                {STAT_META[activeDuelResult.chosenStat].format(activeDuelResult.userValue)}
              </span>{' '}
              vs{' '}
              <span className="font-mono font-bold text-white tabular-nums">
                {STAT_META[activeDuelResult.chosenStat].format(activeDuelResult.aiValue)}
              </span>
              <span className="text-slate-300 ml-2">
                {activeDuelResult.winner === 'USER'
                  ? `— ${activeDuelResult.userPlayer.name} earns IN-FORM (+15% Boost) & +2 Bonus Runs!`
                  : activeDuelResult.winner === 'AI'
                  ? `— ${activeDuelResult.aiPlayer.name} earns IN-FORM (+15% Boost) & +2 Bonus Runs!`
                  : '— Draw! +1 Bonus Run awarded to each side.'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleNextRound}
            className="shrink-0 py-2.5 px-5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display text-base font-bold tracking-wide inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>{roundIdx + 1 < totalRounds ? 'Next Duel' : 'Proceed to Toss'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Center 1v1 Card Battle Stage */}
      <div className="grid grid-cols-1 lg:grid-cols-11 gap-5 items-center">
        <div className="lg:col-span-5">
          <div className="text-xs font-semibold text-slate-400 mb-2 flex items-center justify-between">
            <span>{userFranchise.name} Card</span>
            {chooser === 'USER' && !activeDuelResult && (
              <span className="text-amber-400">Select stat below</span>
            )}
          </div>
          {activeUserCard && (
            <PlayerCard
              player={activeUserCard}
              selectableStat={chooser === 'USER' && !activeDuelResult && !aiPicking}
              activeStat={activeDuelResult?.chosenStat ?? null}
              winningStat={activeDuelResult?.winner === 'USER' ? activeDuelResult.chosenStat : null}
              isWinnerCard={activeDuelResult?.winner === 'USER'}
              onSelectStat={(stat) => resolveStatChoice(stat, 'USER')}
            />
          )}
        </div>

        <div className="lg:col-span-1 flex flex-col items-center justify-center py-2">
          <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center font-display text-xl font-extrabold text-amber-400 shadow-lg">
            VS
          </div>
          {aiPicking && (
            <span className="text-[11px] text-sky-400 mt-2 text-center">AI thinking...</span>
          )}
        </div>

        <div className="lg:col-span-5">
          <div className="text-xs font-semibold text-slate-400 mb-2 flex items-center justify-between">
            <span>{aiFranchise.name} Card</span>
            {chooser === 'AI' && !activeDuelResult && (
              <span className="text-sky-400">AI choosing stat</span>
            )}
          </div>
          {activeAiCard && (
            <PlayerCard
              player={activeAiCard}
              activeStat={activeDuelResult?.chosenStat ?? null}
              winningStat={activeDuelResult?.winner === 'AI' ? activeDuelResult.chosenStat : null}
              isWinnerCard={activeDuelResult?.winner === 'AI'}
            />
          )}
        </div>
      </div>

      {/* Round Progress Tracker */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/75 p-4">
        <div className="text-xs text-slate-400 mb-2.5">Matchup Sequence ({totalRounds} Duels)</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {uSquad.map((p, idx) => {
            const done = duels[idx];
            const isCurrent = idx === roundIdx;
            return (
              <div
                key={p.id}
                className={`px-2.5 py-2 rounded-lg border text-xs ${
                  done
                    ? done.winner === 'USER'
                      ? 'bg-emerald-500/12 border-emerald-500/40 text-emerald-200'
                      : done.winner === 'AI'
                      ? 'bg-rose-500/12 border-rose-500/40 text-rose-200'
                      : 'bg-slate-800 border-slate-600 text-slate-200'
                    : isCurrent
                    ? 'bg-amber-500/12 border-amber-400/70 text-amber-200'
                    : 'bg-slate-950/60 border-slate-800 text-slate-500'
                }`}
              >
                <div className="font-mono text-[10px] opacity-80">
                  Duel {idx + 1} · {idx % 2 === 0 ? 'You' : 'AI'}
                </div>
                <div className="font-semibold truncate mt-0.5">{p.name.split(' ').slice(-1)[0]}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
