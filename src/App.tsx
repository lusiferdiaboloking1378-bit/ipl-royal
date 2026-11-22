import React, { useEffect, useMemo, useState } from 'react';
import { LogOut, MailCheck, Volume2, VolumeX } from 'lucide-react';
import { AuthGate } from './components/AuthGate';
import { FriendsMultiplayer } from './components/FriendsMultiplayer';
import { Phase0Franchise } from './components/Phase0Franchise';
import { Phase1Auction } from './components/Phase1Auction';
import { Phase2CardBattle } from './components/Phase2CardBattle';
import { Phase3MiniMatch } from './components/Phase3MiniMatch';
import { Phase4Summary } from './components/Phase4Summary';
import { TeamCrest } from './components/TeamCrest';
import { getFranchiseById, IPL_FRANCHISES, IPL_PLAYERS_DB } from './data/iplData';
import {
  auth,
  loadUserProfile,
  logoutAccount,
  onAuthStateChanged,
  resendVerificationEmail,
  saveUserProfile,
  syncLeaderboardFromProfile,
  type User,
} from './firebase';
import { DraftedPlayer, GamePhase, IPLPlayer, MatchResult } from './types/game';
import { roundHalf } from './utils/engine';
import { soundFX } from './utils/sound';

const INITIAL_PURSE = 120.0;
const SEASON_GRANT = 80.0;

function buildShuffledPool(): IPLPlayer[] {
  const marquee = IPL_PLAYERS_DB.filter((p) => p.overallRating >= 91);
  const core = IPL_PLAYERS_DB.filter((p) => p.overallRating >= 86 && p.overallRating < 91);
  const value = IPL_PLAYERS_DB.filter((p) => p.overallRating < 86);

  const shuffle = <T,>(arr: T[]): T[] => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  return [...shuffle(marquee), ...shuffle(core), ...shuffle(value)];
}

function pickRandomAiFranchise(excludeIds: string[]): string {
  const candidates = IPL_FRANCHISES.filter((f) => !excludeIds.includes(f.id));
  const pool = candidates.length > 0 ? candidates : IPL_FRANCHISES.filter((f) => f.id !== excludeIds[0]);
  return pool[Math.floor(Math.random() * pool.length)].id;
}

const PHASE_STEPS: { id: GamePhase; label: string }[] = [
  { id: 'FRANCHISE_SELECT', label: '01. Franchise' },
  { id: 'AUCTION', label: '02. Auction' },
  { id: 'CARD_BATTLE', label: '03. Stat Battle' },
  { id: 'MINI_MATCH', label: '04. 2-Over Match' },
  { id: 'POST_MATCH', label: '05. Payout' },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  const initialInviteCode = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('room')?.toUpperCase() || '';
  }, []);

  const [friendsMode, setFriendsMode] = useState<boolean>(
    () => Boolean(initialInviteCode) || Boolean(typeof window !== 'undefined' && sessionStorage.getItem('ipl_showdown_room_code'))
  );
  const [phase, setPhase] = useState<GamePhase>('FRANCHISE_SELECT');
  const [selectedFranchiseId, setSelectedFranchiseId] = useState<string>('MI');
  const [aiFranchiseId, setAiFranchiseId] = useState<string>('CSK');
  const [squadSize, setSquadSize] = useState<7 | 11>(7);
  const [matchNumber, setMatchNumber] = useState<number>(1);
  const [muted, setMuted] = useState<boolean>(false);

  // Career stats & purses
  const [userPurse, setUserPurse] = useState<number>(INITIAL_PURSE);
  const [aiPurse, setAiPurse] = useState<number>(INITIAL_PURSE);
  const [careerWins, setCareerWins] = useState<number>(0);
  const [careerMatches, setCareerMatches] = useState<number>(0);

  // Round-specific squads & battle data
  const [auctionPool, setAuctionPool] = useState<IPLPlayer[]>(() => buildShuffledPool());
  const [previousUserSquad, setPreviousUserSquad] = useState<DraftedPlayer[]>([]);
  const [userSquad, setUserSquad] = useState<DraftedPlayer[]>([]);
  const [aiSquad, setAiSquad] = useState<DraftedPlayer[]>([]);

  const [userBonusRuns, setUserBonusRuns] = useState<number>(0);
  const [aiBonusRuns, setAiBonusRuns] = useState<number>(0);
  const [userDuelsWon, setUserDuelsWon] = useState<number>(0);
  const [aiDuelsWon, setAiDuelsWon] = useState<number>(0);
  const [battingFirst, setBattingFirst] = useState<'USER' | 'AI'>('USER');
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

  const userFranchise = useMemo(() => getFranchiseById(selectedFranchiseId), [selectedFranchiseId]);
  const aiFranchise = useMemo(() => getFranchiseById(aiFranchiseId), [aiFranchiseId]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        try {
          const profile = await loadUserProfile(nextUser);
          if (profile) {
            setSelectedFranchiseId(profile.favoriteFranchiseId);
            setCareerWins(profile.careerWins);
            setCareerMatches(profile.careerMatches);
            if (nextUser.emailVerified) {
              await syncLeaderboardFromProfile(nextUser, profile);
            }
          } else if (nextUser.emailVerified) {
            await saveUserProfile(nextUser, {
              favoriteFranchiseId: 'MI',
              careerWins: 0,
              careerMatches: 0,
              careerPurse: INITIAL_PURSE,
            });
          }
        } catch {
          // Profile read failure will not block gameplay
        }
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  const toggleMute = () => {
    const next = !muted;
    soundFX.muted = next;
    setMuted(next);
  };

  const handleSelectFranchise = (id: string) => {
    setSelectedFranchiseId(id);
    if (user?.emailVerified) {
      void saveUserProfile(user, {
        favoriteFranchiseId: id,
        careerWins,
        careerMatches,
        careerPurse: userPurse,
      }).catch(() => {});
    }
  };

  const handleStartCareer = () => {
    const rivalId = pickRandomAiFranchise([selectedFranchiseId]);
    setAiFranchiseId(rivalId);
    setMatchNumber(1);
    setUserPurse(INITIAL_PURSE);
    setAiPurse(INITIAL_PURSE);
    setPreviousUserSquad([]);
    setUserSquad([]);
    setAiSquad([]);
    setAuctionPool(buildShuffledPool());
    setMatchResult(null);
    setPhase('AUCTION');
  };

  const handleCompleteAuction = (res: {
    userSquad: DraftedPlayer[];
    aiSquad: DraftedPlayer[];
    userRemainingPurse: number;
    aiRemainingPurse: number;
  }) => {
    setUserSquad(res.userSquad);
    setAiSquad(res.aiSquad);
    setUserPurse(res.userRemainingPurse);
    setAiPurse(res.aiRemainingPurse);
    setPhase('CARD_BATTLE');
  };

  const handleStartCricketMatchNow = (res: {
    userSquad: DraftedPlayer[];
    aiSquad: DraftedPlayer[];
    userRemainingPurse: number;
    aiRemainingPurse: number;
  }) => {
    setUserSquad(res.userSquad);
    setAiSquad(res.aiSquad);
    setUserPurse(res.userRemainingPurse);
    setAiPurse(res.aiRemainingPurse);
    setUserBonusRuns(0);
    setAiBonusRuns(0);
    setUserDuelsWon(0);
    setAiDuelsWon(0);
    setBattingFirst(Math.random() < 0.5 ? 'USER' : 'AI');
    setPhase('MINI_MATCH');
  };

  const handleCompleteBattle = (res: {
    updatedUserSquad: DraftedPlayer[];
    updatedAiSquad: DraftedPlayer[];
    userBonusRuns: number;
    aiBonusRuns: number;
    userDuelsWon: number;
    aiDuelsWon: number;
    battingFirst: 'USER' | 'AI';
  }) => {
    setUserSquad(res.updatedUserSquad);
    setAiSquad(res.updatedAiSquad);
    setUserBonusRuns(res.userBonusRuns);
    setAiBonusRuns(res.aiBonusRuns);
    setUserDuelsWon(res.userDuelsWon);
    setAiDuelsWon(res.aiDuelsWon);
    setBattingFirst(res.battingFirst);
    setPhase('MINI_MATCH');
  };

  const handleMatchComplete = (res: MatchResult) => {
    const updatedPurse = roundHalf(userPurse + res.totalEarned);
    const nextMatches = careerMatches + 1;
    const nextWins = res.winner === 'USER' ? careerWins + 1 : careerWins;
    setUserPurse(updatedPurse);
    setCareerMatches(nextMatches);
    setCareerWins(nextWins);
    setMatchResult(res);
    setPhase('POST_MATCH');

    if (user?.emailVerified) {
      void saveUserProfile(user, {
        favoriteFranchiseId: selectedFranchiseId,
        careerWins: nextWins,
        careerMatches: nextMatches,
        careerPurse: updatedPurse,
      }).catch(() => {});
    }
  };

  const handleRecordMultiplayerMatch = (
    won: boolean,
    updatedPurse: number,
    franchiseId: string
  ) => {
    const nextMatches = careerMatches + 1;
    const nextWins = won ? careerWins + 1 : careerWins;
    setCareerMatches(nextMatches);
    setCareerWins(nextWins);

    if (user?.emailVerified) {
      void saveUserProfile(user, {
        favoriteFranchiseId: franchiseId || selectedFranchiseId,
        careerWins: nextWins,
        careerMatches: nextMatches,
        careerPurse: updatedPurse,
      }).catch(() => {});
    }
  };

  const handleNextRound = () => {
    const nextMatch = matchNumber + 1;
    const nextRival = pickRandomAiFranchise([selectedFranchiseId, aiFranchiseId]);
    const nextUserPurse = roundHalf(userPurse + SEASON_GRANT);
    const nextAiPurse = roundHalf(INITIAL_PURSE + (nextMatch - 1) * 4.5);

    setMatchNumber(nextMatch);
    setAiFranchiseId(nextRival);
    setUserPurse(nextUserPurse);
    setAiPurse(nextAiPurse);
    setPreviousUserSquad(userSquad);
    setUserSquad([]);
    setAiSquad([]);
    setAuctionPool(buildShuffledPool());
    setMatchResult(null);
    setPhase('AUCTION');
  };

  const handleResetCareer = () => {
    setPhase('FRANCHISE_SELECT');
    setMatchNumber(1);
    setUserPurse(INITIAL_PURSE);
    setAiPurse(INITIAL_PURSE);
    setPreviousUserSquad([]);
    setUserSquad([]);
    setAiSquad([]);
    setMatchResult(null);
  };

  const handleResendVerification = async () => {
    if (!user) return;
    try {
      await resendVerificationEmail(user);
      setVerifyNotice('Verification mail sent! Check your inbox and click "I\'ve Verified".');
    } catch {
      setVerifyNotice('Verification mail recently sent. Please check your inbox or spam folder.');
    }
  };

  const handleRefreshVerification = async () => {
    if (!user) return;
    await user.reload();
    if (auth.currentUser?.emailVerified) {
      setUser({ ...auth.currentUser } as User);
      setVerifyNotice(null);
      await saveUserProfile(auth.currentUser, {
        favoriteFranchiseId: selectedFranchiseId,
        careerWins,
        careerMatches,
        careerPurse: userPurse,
      }).catch(() => {});
    } else {
      setVerifyNotice('Email is not verified yet — open the verification link in your inbox first.');
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#080D1A] text-slate-200 flex items-center justify-center">
        <div className="text-sm font-semibold text-amber-400 animate-pulse">
          Loading IPL Auction &amp; Showdown...
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthGate inviteRoomCode={initialInviteCode} />;
  }

  const captainLabel = user.displayName || user.email?.split('@')[0] || 'Captain';

  return (
    <div className="min-h-screen bg-[#080D1A] text-slate-100 flex flex-col">
      {/* Strict 3-Zone Broadcast Top Bar */}
      <header className="border-b border-slate-800/90 bg-[#080D1A]/95 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <span className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-white whitespace-nowrap shrink-0">
            IPL Auction &amp; Showdown
          </span>

          {/* Zone 2: Clean single-line phase steps */}
          <nav
            aria-label="Career phases"
            className="hidden lg:flex items-center gap-6 text-xs font-semibold"
          >
            {PHASE_STEPS.map((step) => {
              const isActive = step.id === phase;
              return (
                <span
                  key={step.id}
                  className={`py-1 whitespace-nowrap shrink-0 transition-colors ${
                    isActive
                      ? 'text-amber-400 border-b-2 border-amber-400'
                      : 'text-slate-500'
                  }`}
                >
                  {step.label}
                </span>
              );
            })}
          </nav>

          {/* Zone 3: Captain Account & Mode Action */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              <span className="font-semibold text-white max-w-[130px] truncate">{captainLabel}</span>
              <button
                type="button"
                onClick={() => void logoutAccount()}
                title="Sign out"
                aria-label="Sign out"
                className="text-slate-400 hover:text-rose-300 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
            {friendsMode ? (
              <button
                type="button"
                onClick={() => {
                  sessionStorage.removeItem('ipl_showdown_room_code');
                  setFriendsMode(false);
                }}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Solo Mode
              </button>
            ) : phase === 'FRANCHISE_SELECT' ? (
              <button
                type="button"
                onClick={() => setFriendsMode(true)}
                className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Friends Room
              </button>
            ) : (
              <button
                type="button"
                onClick={handleResetCareer}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Reset Career
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Non-blocking Email Verification Banner for newly registered email users */}
      {!user.emailVerified && (
        <div className="border-b border-amber-500/30 bg-amber-500/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-100">
            <div className="flex items-center gap-2">
              <MailCheck className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Verify your email (<strong>{user.email}</strong>) to sync career stats across devices.
                {verifyNotice ? ` — ${verifyNotice}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResendVerification}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
              >
                Resend Mail
              </button>
              <button
                type="button"
                onClick={handleRefreshVerification}
                className="px-2.5 py-1 rounded bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold cursor-pointer"
              >
                I&apos;ve Verified
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Workspace Career Toolbar (visible during Phases 1-4 in Solo mode) */}
      {!friendsMode && phase !== 'FRANCHISE_SELECT' && (
        <div className="border-b border-slate-800/70 bg-slate-900/60">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-xs">
              <TeamCrest franchise={userFranchise} size="xs" />
              <span className="font-semibold text-white">{userFranchise.shortName}</span>
              <span className="text-slate-500" aria-hidden="true">vs</span>
              <TeamCrest franchise={aiFranchise} size="xs" />
              <span className="font-semibold text-slate-200">{aiFranchise.shortName}</span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="font-mono text-amber-400 font-semibold">Match {matchNumber}</span>
              <span className="text-slate-600 hidden sm:inline" aria-hidden="true">·</span>
              <span className="text-slate-400 hidden sm:inline font-mono tabular-nums">
                Record: {careerWins}W-{careerMatches - careerWins}L
              </span>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-xs font-mono text-slate-300 tabular-nums">
                Purse: <span className="text-amber-400 font-bold">₹{userPurse.toFixed(2)} Cr</span>
              </div>
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Stage */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {friendsMode ? (
          <FriendsMultiplayer
            initialRoomCode={initialInviteCode}
            initialFranchiseId={selectedFranchiseId}
            defaultPlayerName={captainLabel}
            currentUid={user.uid}
            emailVerified={user.emailVerified}
            careerWins={careerWins}
            careerMatches={careerMatches}
            onRecordCareerMatch={handleRecordMultiplayerMatch}
            squadSize={squadSize}
            onExitToSolo={() => setFriendsMode(false)}
          />
        ) : (
          <>
            {phase === 'FRANCHISE_SELECT' && (
              <Phase0Franchise
                selectedFranchiseId={selectedFranchiseId}
                onSelectFranchise={handleSelectFranchise}
                squadSize={squadSize}
                onChangeSquadSize={setSquadSize}
                onStartCareer={handleStartCareer}
                onOpenFriendsMode={() => setFriendsMode(true)}
                initialPurse={INITIAL_PURSE}
              />
            )}

        {phase === 'AUCTION' && (
          <Phase1Auction
            key={`auction-match-${matchNumber}`}
            matchNumber={matchNumber}
            userFranchise={userFranchise}
            aiFranchise={aiFranchise}
            initialUserPurse={userPurse}
            initialAiPurse={aiPurse}
            squadSize={squadSize}
            playerPool={auctionPool}
            previousUserSquad={previousUserSquad}
            onCompleteAuction={handleCompleteAuction}
            onStartCricketMatchNow={handleStartCricketMatchNow}
          />
        )}

        {phase === 'CARD_BATTLE' && (
          <Phase2CardBattle
            key={`battle-match-${matchNumber}`}
            matchNumber={matchNumber}
            userFranchise={userFranchise}
            aiFranchise={aiFranchise}
            userSquad={userSquad}
            aiSquad={aiSquad}
            onCompleteBattle={handleCompleteBattle}
          />
        )}

        {phase === 'MINI_MATCH' && (
          <Phase3MiniMatch
            key={`match-${matchNumber}`}
            matchNumber={matchNumber}
            userFranchise={userFranchise}
            aiFranchise={aiFranchise}
            userSquad={userSquad}
            aiSquad={aiSquad}
            userBonusRuns={userBonusRuns}
            aiBonusRuns={aiBonusRuns}
            userDuelsWon={userDuelsWon}
            aiDuelsWon={aiDuelsWon}
            battingFirst={battingFirst}
            onMatchComplete={handleMatchComplete}
          />
        )}

        {phase === 'POST_MATCH' && matchResult && (
          <Phase4Summary
            matchNumber={matchNumber}
            userFranchise={userFranchise}
            aiFranchise={aiFranchise}
            result={matchResult}
            updatedUserPurse={userPurse}
            careerWins={careerWins}
            careerMatches={careerMatches}
            currentUid={user.uid}
            captainName={captainLabel}
            emailVerified={user.emailVerified}
            onNextRound={handleNextRound}
            onResetCareer={handleResetCareer}
          />
        )}
          </>
        )}
      </main>
    </div>
  );
}
