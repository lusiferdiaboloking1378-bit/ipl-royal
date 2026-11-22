import React, { useEffect, useState } from 'react';
import { getPlayerPhotoSrc } from '../data/playerPhotos';
import { Franchise, PlayerRole } from '../types/game';

interface TeamCrestProps {
  franchise: Franchise;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

export const TeamCrest: React.FC<TeamCrestProps> = ({ franchise, size = 'md' }) => {
  const dims =
    size === 'xs'
      ? 'w-7 h-7 text-[10px]'
      : size === 'sm'
      ? 'w-9 h-9 text-xs'
      : size === 'lg'
      ? 'w-14 h-14 text-base'
      : 'w-11 h-11 text-sm';

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 rounded-lg font-display font-extrabold tracking-tight shadow-md select-none ${dims}`}
      style={{
        background: `linear-gradient(135deg, ${franchise.primaryColor} 0%, ${franchise.secondaryColor} 100%)`,
        color: franchise.textOnPrimary,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.22) inset, 0 4px 12px rgba(0,0,0,0.4)`,
      }}
      aria-label={franchise.name}
    >
      <svg
        viewBox="0 0 40 40"
        className="absolute inset-0 w-full h-full opacity-20 pointer-events-none"
        aria-hidden="true"
      >
        <path
          d="M20 3 L35 9 V20 C35 28.5 28 34.5 20 37 C12 34.5 5 28.5 5 20 V9 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
      <span className="relative z-10 leading-none">{franchise.shortName}</span>
    </div>
  );
};

interface PlayerSilhouetteProps {
  role: PlayerRole;
  primaryColor: string;
  secondaryColor: string;
  jerseyNumber: number;
  className?: string;
}

export const PlayerSilhouette: React.FC<PlayerSilhouetteProps> = ({
  role,
  primaryColor,
  secondaryColor,
  jerseyNumber,
  className = 'w-14 h-14 rounded-xl',
}) => {
  return (
    <div
      className={`relative overflow-hidden shrink-0 flex items-end justify-center border border-white/15 ${className}`}
      style={{
        background: `radial-gradient(circle at 30% 20%, ${primaryColor}55, ${secondaryColor}99 70%, #0b1220 100%)`,
      }}
    >
      <svg viewBox="0 0 64 64" className="w-[85%] h-[85%] text-slate-100/90 drop-shadow" aria-hidden="true">
        <circle cx="32" cy="18" r="8.5" fill="currentColor" opacity="0.92" />
        {(role === 'Batter' || role === 'Wicketkeeper') && (
          <path d="M24 16 Q32 10 40 16" stroke={primaryColor} strokeWidth="2.5" fill="none" />
        )}
        <path
          d="M15 58 C15 41 21 31 32 31 C43 31 49 41 49 58 Z"
          fill={primaryColor}
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="1.2"
        />
        <path d="M26 31 L32 37 L38 31" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.7" />
      </svg>
      <span className="absolute bottom-1 right-1.5 font-mono text-[10px] font-bold text-white/90 drop-shadow tabular-nums">
        #{jerseyNumber}
      </span>
    </div>
  );
};

interface PlayerPortraitProps {
  playerId: string;
  name: string;
  role: PlayerRole;
  primaryColor: string;
  secondaryColor: string;
  jerseyNumber: number;
  variant?: 'stage' | 'avatar' | 'chip';
}

export const PlayerPortrait: React.FC<PlayerPortraitProps> = ({
  playerId,
  name,
  role,
  primaryColor,
  secondaryColor,
  jerseyNumber,
  variant = 'avatar',
}) => {
  const src = getPlayerPhotoSrc(playerId);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [playerId]);

  const showPhoto = Boolean(src) && !imgFailed;

  if (variant === 'stage') {
    return (
      <div
        className="relative w-full h-44 sm:h-48 overflow-hidden select-none"
        style={{
          background: `radial-gradient(circle at 50% 25%, ${primaryColor}55, ${secondaryColor}90 60%, #090f1d 100%)`,
        }}
      >
        {/* Subtle broadcast spotlight grid lines */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        {/* Large Jersey Number Watermark */}
        <span className="absolute top-3 left-4 font-display text-5xl font-black text-white/15 tracking-tighter pointer-events-none tabular-nums">
          #{jerseyNumber}
        </span>

        {showPhoto ? (
          <img
            src={src!}
            alt={`${name} portrait`}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="relative z-10 w-full h-full object-cover object-top"
          />
        ) : (
          <div className="relative z-10 w-full h-full flex items-end justify-center pt-4">
            <svg viewBox="0 0 120 120" className="w-36 h-36 text-slate-100/90 drop-shadow-xl" aria-hidden="true">
              <circle cx="60" cy="34" r="16" fill="currentColor" opacity="0.92" />
              {(role === 'Batter' || role === 'Wicketkeeper') && (
                <path d="M44 30 Q60 18 76 30" stroke={primaryColor} strokeWidth="4.5" fill="none" />
              )}
              <path
                d="M24 118 C24 80 37 58 60 58 C83 58 96 80 96 118 Z"
                fill={primaryColor}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="2"
              />
              <path d="M48 58 L60 72 L72 58" fill="none" stroke="#fff" strokeWidth="2.5" opacity="0.75" />
            </svg>
          </div>
        )}

        {/* Bottom stadium fade */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent z-20 pointer-events-none" />
      </div>
    );
  }

  const sizeClasses =
    variant === 'chip'
      ? 'w-9 h-9 rounded-lg'
      : 'w-14 h-14 rounded-xl';

  if (!showPhoto) {
    return (
      <PlayerSilhouette
        role={role}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        jerseyNumber={jerseyNumber}
        className={sizeClasses}
      />
    );
  }

  return (
    <div
      className={`relative overflow-hidden shrink-0 border border-white/20 shadow-md ${sizeClasses}`}
      style={{
        background: `radial-gradient(circle at 50% 25%, ${primaryColor}40, #0b1220 100%)`,
      }}
    >
      <img
        src={src!}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className="w-full h-full object-cover object-top"
      />
      {variant === 'avatar' && (
        <span className="absolute bottom-0.5 right-1 font-mono text-[9px] font-bold text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] tabular-nums">
          #{jerseyNumber}
        </span>
      )}
    </div>
  );
};
