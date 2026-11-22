import React from 'react';
import { Flame } from 'lucide-react';
import { getFranchiseById, normalizeStatForBar, STAT_META } from '../data/iplData';
import { IPLPlayer, StatKey } from '../types/game';
import { PlayerPortrait, TeamCrest } from './TeamCrest';

interface PlayerCardProps {
  player: IPLPlayer & { boughtPrice?: number; inForm?: boolean; retained?: boolean };
  compact?: boolean;
  selectableStat?: boolean;
  activeStat?: StatKey | null;
  winningStat?: StatKey | null;
  isWinnerCard?: boolean;
  onSelectStat?: (stat: StatKey) => void;
  priceLabel?: string;
}

const STAT_ORDER: StatKey[] = ['runs', 'strikeRate', 'wickets', 'economy', 'matches'];

export const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  compact = false,
  selectableStat = false,
  activeStat = null,
  winningStat = null,
  isWinnerCard = false,
  onSelectStat,
  priceLabel,
}) => {
  const franchise = getFranchiseById(player.iplTeam);

  return (
    <div
      className={`relative rounded-2xl bg-slate-900/95 border transition-all duration-200 overflow-hidden ${
        player.inForm
          ? 'border-amber-400/80 inform-card-glow'
          : isWinnerCard
          ? 'border-emerald-400/80 shadow-[0_0_24px_rgba(16,185,129,0.2)]'
          : 'border-slate-700/80 shadow-xl'
      }`}
    >
      {/* Top Team Color Ribbon */}
      <div
        className="h-1.5 w-full"
        style={{
          background: `linear-gradient(90deg, ${franchise.primaryColor}, ${franchise.secondaryColor})`,
        }}
      />

      {!compact && (
        <div className="relative">
          <PlayerPortrait
            playerId={player.id}
            name={player.name}
            role={player.role}
            primaryColor={franchise.primaryColor}
            secondaryColor={franchise.secondaryColor}
            jerseyNumber={player.jerseyNumber}
            variant="stage"
          />
          <div className="absolute top-3 right-3 z-30">
            <TeamCrest franchise={franchise} size="xs" />
          </div>
        </div>
      )}

      <div className={compact ? 'p-4' : 'px-5 pb-5 pt-2'}>
        {/* Header Row: Portrait (compact) + Name + Unboxed Metadata */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {compact && (
              <PlayerPortrait
                playerId={player.id}
                name={player.name}
                role={player.role}
                primaryColor={franchise.primaryColor}
                secondaryColor={franchise.secondaryColor}
                jerseyNumber={player.jerseyNumber}
                variant="avatar"
              />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
                <span className="font-semibold text-slate-200">{player.iplTeam}</span>
                <span aria-hidden="true">·</span>
                <span>{player.role}</span>
                <span aria-hidden="true">·</span>
                <span>{player.nationality}</span>
              </div>
              <h3 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-white truncate mt-0.5">
                {player.name}
              </h3>
              <div className="text-xs text-slate-400 mt-0.5 truncate">
                {player.battingHand} · {player.bowlingStyle}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end shrink-0 gap-1.5">
            {compact && <TeamCrest franchise={franchise} size="xs" />}
            <div className="text-right">
              <div className="text-[11px] text-slate-400">
                {priceLabel ?? (player.boughtPrice !== undefined ? 'Bought' : 'Base')}
              </div>
              <div className="font-mono text-sm font-bold text-amber-400 tabular-nums">
                ₹{(player.boughtPrice ?? player.basePrice).toFixed(1)} Cr
              </div>
            </div>
          </div>
        </div>

        {/* IN-FORM Status Banner (only shown when player actually earned IN-FORM) */}
        {player.inForm && (
          <div className="mt-3 flex items-center justify-between px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/40 text-amber-300 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              IN-FORM (+15% Boost)
            </span>
            <span className="font-mono text-[11px] text-amber-200">MATCH ACTIVE</span>
          </div>
        )}

        {/* 5 IPL Stats with Visual Progress Bars */}
        <div className={`${compact ? 'mt-3.5 space-y-2' : 'mt-4 space-y-2.5'}`}>
          {STAT_ORDER.map((statKey) => {
            const meta = STAT_META[statKey];
            const val = player.stats[statKey];
            const pct = normalizeStatForBar(statKey, val);
            const isSelected = activeStat === statKey;
            const isWinHighlight = winningStat === statKey;

            const barColor =
              isWinHighlight && isWinnerCard
                ? 'bg-emerald-400'
                : isSelected
                ? 'bg-amber-400'
                : statKey === 'economy'
                ? 'bg-sky-400'
                : 'bg-blue-500';

            const rowClasses = selectableStat
              ? `w-full text-left px-3 py-2 rounded-xl border transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  isSelected
                    ? 'bg-amber-500/15 border-amber-400/70'
                    : 'bg-slate-800/55 border-slate-700/60 hover:bg-slate-800 hover:border-amber-400/50'
                }`
              : `px-2.5 py-1.5 rounded-lg ${
                  isSelected
                    ? 'bg-amber-500/15 ring-1 ring-amber-400/60'
                    : 'bg-slate-800/40'
                }`;

            const inner = (
              <>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-300 flex items-center gap-1.5">
                    {meta.label}
                    {!meta.higherIsBetter && (
                      <span className="text-[10px] text-sky-300/90 font-normal">(Lowest wins)</span>
                    )}
                  </span>
                  <span className="font-mono font-bold text-white tabular-nums">
                    {meta.format(val)}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-950/80 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </>
            );

            return selectableStat ? (
              <button
                key={statKey}
                type="button"
                onClick={() => onSelectStat?.(statKey)}
                className={rowClasses}
              >
                {inner}
              </button>
            ) : (
              <div key={statKey} className={rowClasses}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
