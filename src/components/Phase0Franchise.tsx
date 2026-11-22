import React from 'react';
import { ArrowRight, Coins, Shield, Swords, Trophy, Users } from 'lucide-react';
import stadiumNightHeroImg from '../assets/images/stadium_night_hero_1795258895840.jpg';
import { IPL_FRANCHISES } from '../data/iplData';
import { Franchise } from '../types/game';
import { TeamCrest } from './TeamCrest';

interface Phase0FranchiseProps {
  selectedFranchiseId: string;
  onSelectFranchise: (id: string) => void;
  squadSize: 7 | 11;
  onChangeSquadSize: (size: 7 | 11) => void;
  onStartCareer: () => void;
  onOpenFriendsMode: () => void;
  initialPurse: number;
}

export const Phase0Franchise: React.FC<Phase0FranchiseProps> = ({
  selectedFranchiseId,
  onSelectFranchise,
  squadSize,
  onChangeSquadSize,
  onStartCareer,
  onOpenFriendsMode,
  initialPurse,
}) => {
  const selectedFranchise: Franchise =
    IPL_FRANCHISES.find((f) => f.id === selectedFranchiseId) || IPL_FRANCHISES[0];

  return (
    <div className="space-y-8">
      {/* Stadium Hero Banner */}
      <section className="relative rounded-2xl overflow-hidden border border-slate-800 bg-slate-900">
        <div className="relative h-64 sm:h-72 w-full bg-gradient-to-br from-slate-900 via-blue-950 to-slate-950">
          <img
            src={stadiumNightHeroImg}
            alt="Illuminated IPL cricket stadium under night floodlights"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover opacity-55"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#080D1A] via-[#080D1A]/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#080D1A]/95 via-[#080D1A]/65 to-transparent" />

          <div className="absolute inset-0 flex flex-col justify-end p-6 sm:p-8 max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-medium text-amber-400 mb-2">
              <span>Season Career</span>
              <span aria-hidden="true">·</span>
              <span>Match 1</span>
              <span aria-hidden="true">·</span>
              <span>4-Phase Championship Loop</span>
            </div>
            <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-[1.05] text-balance">
              Build Your Franchise. Dominate the Card Battle. Win the 2-Over Showdown.
            </h1>
            <p className="text-sm sm:text-base text-slate-300 mt-3 max-w-2xl leading-relaxed">
              Draft real IPL superstars within your ₹{initialPurse.toFixed(2)} Crore auction purse,
              outsmart a rival franchise in head-to-head stat duels to unlock In-Form boosts, and
              captain every ball of a 2-over floodlit clash.
            </p>
          </div>
        </div>

        {/* 4-Phase Career Loop Overview Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 border-t border-slate-800 bg-slate-900/90">
          <div className="p-4 flex items-start gap-3">
            <Coins className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-white">01. Live Player Auction</div>
              <p className="text-xs text-slate-400 mt-0.5">
                Bid against AI rivals for 48 IPL stars with a ₹{initialPurse.toFixed(2)} Cr purse.
              </p>
            </div>
          </div>
          <div className="p-4 flex items-start gap-3">
            <Swords className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-white">02. Stat Card Battle</div>
              <p className="text-xs text-slate-400 mt-0.5">
                Win 1v1 stat duels for +2 Bonus Runs, Toss control &amp; +15% In-Form boosts.
              </p>
            </div>
          </div>
          <div className="p-4 flex items-start gap-3">
            <Shield className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-white">03. 2-Over Mini-Match</div>
              <p className="text-xs text-slate-400 mt-0.5">
                Pick batters, shot styles, bowlers &amp; deliveries across 12 live balls.
              </p>
            </div>
          </div>
          <div className="p-4 flex items-start gap-3">
            <Trophy className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-white">04. Prize &amp; Retentions</div>
              <p className="text-xs text-slate-400 mt-0.5">
                Earn up to +₹15 Cr prize money and retain 3 stars into Round 2.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Franchise Selection Grid + Match Config */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-2xl font-bold text-white tracking-tight">
                Select Your IPL Franchise
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                Choose 1 of the 10 authentic franchises. A rival AI franchise will be drawn for Match 1.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {IPL_FRANCHISES.map((team) => {
              const isSelected = team.id === selectedFranchiseId;
              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => onSelectFranchise(team.id)}
                  className={`group relative text-left p-4 rounded-xl border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800/95 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.16)]'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-600 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <TeamCrest franchise={team} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-lg font-bold text-white truncate">
                          {team.name}
                        </span>
                        {isSelected && (
                          <span className="text-[11px] font-semibold text-amber-400 shrink-0">
                            Selected
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                        <span>{team.city}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{team.motto}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Match Setup & Launch Console */}
        <aside className="lg:col-span-4 rounded-2xl border border-slate-800 bg-slate-900/95 p-6 space-y-6">
          <div className="flex items-center gap-3.5 pb-5 border-b border-slate-800">
            <TeamCrest franchise={selectedFranchise} size="lg" />
            <div className="min-w-0">
              <div className="text-xs text-slate-400">Your Franchise</div>
              <h3 className="font-display text-2xl font-bold text-white truncate">
                {selectedFranchise.name}
              </h3>
              <div className="text-xs text-slate-400 mt-0.5">
                {selectedFranchise.city} · {selectedFranchise.shortName}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b border-slate-800/80">
              <span className="text-sm text-slate-400">Opening Purse</span>
              <span className="font-mono text-lg font-bold text-amber-400 tabular-nums">
                ₹{initialPurse.toFixed(2)} Cr
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-800/80">
              <span className="text-sm text-slate-400">Career Stage</span>
              <span className="font-mono text-sm font-semibold text-white">Match 1 · Qualifier</span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-300 font-medium flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-slate-400" />
                  Squad Size
                </span>
                <span className="text-xs text-slate-400">{squadSize} card duels</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800">
                <button
                  type="button"
                  onClick={() => onChangeSquadSize(7)}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    squadSize === 7
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  7 Players (Fast)
                </button>
                <button
                  type="button"
                  onClick={() => onChangeSquadSize(11)}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    squadSize === 11
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  11 Players (XI)
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={onStartCareer}
              className="w-full py-3.5 px-5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display text-lg font-bold tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-lg shadow-amber-500/15"
            >
              <span>Enter Solo Auction Room</span>
              <ArrowRight className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={onOpenFriendsMode}
              className="w-full py-3 px-5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-200 font-display text-base font-bold tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Users className="w-4 h-4 text-blue-300" />
              <span>Play with Friends Group (Online Room)</span>
            </button>
          </div>
        </aside>
      </section>
    </div>
  );
};
