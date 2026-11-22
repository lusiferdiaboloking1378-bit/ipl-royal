import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  FastForward,
  Gavel,
  Hand,
  Mic,
  MicOff,
  ShieldAlert,
  SkipForward,
  Sparkles,
  UserCheck,
  Zap,
} from 'lucide-react';
import auctionGavelDeskImg from '../assets/images/auction_gavel_desk_1795258896064.jpg';
import { getFranchiseById, IPL_FRANCHISES } from '../data/iplData';
import { getPlayerPhotoSrc } from '../data/playerPhotos';
import { DraftedPlayer, Franchise, IPLPlayer } from '../types/game';
import { auctioneerVoice, StudioFemaleVoiceId } from '../utils/auctioneerVoice';
import {
  autoFillTeamSquad,
  getAiTargetBid,
  getAuctionSetLabel,
  getMaxAllowedBid,
  roundHalf,
  sortPoolIntoIplSets,
} from '../utils/engine';
import { soundFX } from '../utils/sound';
import { PlayerCard } from './PlayerCard';
import { PlayerPortrait, TeamCrest } from './TeamCrest';

interface Phase1AuctionProps {
  matchNumber: number;
  userFranchise: Franchise;
  aiFranchise: Franchise;
  initialUserPurse: number;
  initialAiPurse: number;
  squadSize: 7 | 11;
  playerPool: IPLPlayer[];
  previousUserSquad: DraftedPlayer[];
  onCompleteAuction: (result: {
    userSquad: DraftedPlayer[];
    aiSquad: DraftedPlayer[];
    userRemainingPurse: number;
    aiRemainingPurse: number;
  }) => void;
  onStartCricketMatchNow?: (result: {
    userSquad: DraftedPlayer[];
    aiSquad: DraftedPlayer[];
    userRemainingPurse: number;
    aiRemainingPurse: number;
  }) => void;
}

interface AuctionLogItem {
  id: string;
  text: string;
  tone: 'user' | 'ai' | 'table' | 'neutral';
}

interface TableRivalState {
  franchise: Franchise;
  purse: number;
  buys: number;
}

export const Phase1Auction: React.FC<Phase1AuctionProps> = ({
  matchNumber,
  userFranchise,
  aiFranchise,
  initialUserPurse,
  initialAiPurse,
  squadSize,
  playerPool,
  previousUserSquad,
  onCompleteAuction,
  onStartCricketMatchNow,
}) => {
  // Retention step for Round 2+
  const needsRetention = matchNumber > 1 && previousUserSquad.length > 0;
  const [retentionDone, setRetentionDone] = useState(!needsRetention);
  const [retainedIds, setRetainedIds] = useState<string[]>(() =>
    needsRetention
      ? [...previousUserSquad]
          .sort((a, b) => b.overallRating - a.overallRating)
          .slice(0, Math.min(3, previousUserSquad.length))
          .map((p) => p.id)
      : []
  );

  // Pick 3 additional IPL franchises to sit at the live auction table
  const initialTableRivals = useMemo<TableRivalState[]>(() => {
    const others = IPL_FRANCHISES.filter(
      (f) => f.id !== userFranchise.id && f.id !== aiFranchise.id
    );
    return others.slice(0, 3).map((f) => ({
      franchise: f,
      purse: 120.0,
      buys: 0,
    }));
  }, [userFranchise.id, aiFranchise.id]);

  const [tableRivals, setTableRivals] = useState<TableRivalState[]>(initialTableRivals);

  // Squads & Purses
  const [userSquad, setUserSquad] = useState<DraftedPlayer[]>([]);
  const [aiSquad, setAiSquad] = useState<DraftedPlayer[]>([]);
  const [userPurse, setUserPurse] = useState<number>(initialUserPurse);
  const [aiPurse, setAiPurse] = useState<number>(initialAiPurse);

  // Queue ordered into real IPL Auction Sets
  const [queue, setQueue] = useState<IPLPlayer[]>(() => sortPoolIntoIplSets(playerPool));
  const [currentIndex, setCurrentIndex] = useState(0);

  // Live Bidding State
  const [currentBid, setCurrentBid] = useState<number>(0);
  const [highestBidderId, setHighestBidderId] = useState<string | null>(null);
  const [userPassedLot, setUserPassedLot] = useState<boolean>(false);
  const [countdownMs, setCountdownMs] = useState<number>(15000);
  const [soldBanner, setSoldBanner] = useState<{
    playerName: string;
    winnerId: string | 'UNSOLD';
    price: number;
  } | null>(null);

  // Right To Match (RTM) Card State
  const [rtmAvailable, setRtmAvailable] = useState<boolean>(true);
  const [rtmPrompt, setRtmPrompt] = useState<{
    player: IPLPlayer;
    winningFranchiseId: string;
    price: number;
  } | null>(null);

  // Right Drawer Tab & Logs
  const [drawerTab, setDrawerTab] = useState<'YOUR_SQUAD' | 'RIVAL_SQUAD' | 'LOG'>('YOUR_SQUAD');
  const [logs, setLogs] = useState<AuctionLogItem[]>([]);

  // Female AI Auctioneer Voice state
  const [voiceEnabled, setVoiceEnabled] = useState(() => auctioneerVoice.isEnabled());
  const [selectedVoice, setSelectedVoice] = useState<StudioFemaleVoiceId>(() =>
    auctioneerVoice.getSelectedVoiceId()
  );
  const [speechRate, setSpeechRate] = useState<number>(() => auctioneerVoice.getSpeechRate());
  const voiceOptions = auctioneerVoice.getVoiceOptions();

  const soldTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const unsub = auctioneerVoice.subscribe(() => {
      setVoiceEnabled(auctioneerVoice.isEnabled());
      setSelectedVoice(auctioneerVoice.getSelectedVoiceId());
      setSpeechRate(auctioneerVoice.getSpeechRate());
    });
    return () => {
      unsub();
      if (soldTimerRef.current !== null) {
        window.clearTimeout(soldTimerRef.current);
        soldTimerRef.current = null;
      }
      auctioneerVoice.stop();
    };
  }, []);

  useEffect(() => {
    if (retentionDone) {
      auctioneerVoice.prewarmCommonCalls();
    }
  }, [retentionDone]);

  const currentPlayer = queue[currentIndex] || null;
  const nextOnDeck = queue[currentIndex + 1] || null;
  const auctionComplete =
    retentionDone && userSquad.length >= squadSize && aiSquad.length >= squadSize;

  // Refs for clean async timers without stale closures
  const stateRef = useRef({
    userSquad,
    aiSquad,
    userPurse,
    aiPurse,
    tableRivals,
    currentBid,
    highestBidderId,
    userPassedLot,
    soldBanner,
    rtmPrompt,
    rtmAvailable,
    currentPlayer,
    queue,
    currentIndex,
    auctionComplete,
    retentionDone,
  });
  stateRef.current = {
    userSquad,
    aiSquad,
    userPurse,
    aiPurse,
    tableRivals,
    currentBid,
    highestBidderId,
    userPassedLot,
    soldBanner,
    rtmPrompt,
    rtmAvailable,
    currentPlayer,
    queue,
    currentIndex,
    auctionComplete,
    retentionDone,
  };

  const addLog = (text: string, tone: AuctionLogItem['tone']) => {
    setLogs((prev) => [{ id: `${Date.now()}-${Math.random()}`, text, tone }, ...prev.slice(0, 14)]);
  };

  // Reset lot when currentIndex changes
  useEffect(() => {
    if (!retentionDone || auctionComplete || !currentPlayer) return;
    setCurrentBid(currentPlayer.basePrice);
    setHighestBidderId(null);
    setUserPassedLot(false);
    setSoldBanner(null);
    setRtmPrompt(null);
    setCountdownMs(15000);
    auctioneerVoice.speak(
      `Next up, ${currentPlayer.name}. Base ${currentPlayer.basePrice} crore.`
    );
    if (nextOnDeck) {
      auctioneerVoice.prewarmPhrase(
        `Next up, ${nextOnDeck.name}. ${nextOnDeck.role}. Base price ${nextOnDeck.basePrice} crore.`
      );
      const nextPhoto = getPlayerPhotoSrc(nextOnDeck.id);
      if (nextPhoto) {
        const img = new Image();
        img.src = nextPhoto;
      }
    }
  }, [currentIndex, retentionDone, auctionComplete, currentPlayer?.id, nextOnDeck?.id]);

  // Auto-complete AI Rival squad if User fills first
  useEffect(() => {
    if (!retentionDone) return;
    if (userSquad.length >= squadSize && aiSquad.length < squadSize) {
      const draftedIds = new Set([...userSquad.map((p) => p.id), ...aiSquad.map((p) => p.id)]);
      const remainingPool = queue.filter((p) => !draftedIds.has(p.id));
      const filled = autoFillTeamSquad(aiSquad, aiPurse, squadSize, remainingPool, false);
      setAiSquad(filled.squad);
      setAiPurse(filled.remainingPurse);
      addLog(
        `${aiFranchise.shortName} signed remaining ${squadSize - aiSquad.length} players in accelerated round.`,
        'ai'
      );
    }
  }, [userSquad.length, aiSquad.length, retentionDone, squadSize]);

  const maxUserBid = useMemo(
    () => getMaxAllowedBid(userPurse, userSquad.length, squadSize),
    [userPurse, userSquad.length, squadSize]
  );

  const effectiveRequiredBid = useMemo(() => {
    if (!currentPlayer) return 0;
    const rawNext = highestBidderId === null ? currentPlayer.basePrice : roundHalf(currentBid + 0.5);
    const remainingPoolCount = queue.length - currentIndex;
    const userNeeds = squadSize - userSquad.length;
    if (remainingPoolCount <= userNeeds + 3 && rawNext > maxUserBid && maxUserBid >= 1.0) {
      return maxUserBid;
    }
    return rawNext;
  }, [currentPlayer, highestBidderId, currentBid, queue.length, currentIndex, squadSize, userSquad.length, maxUserBid]);

  const canUserBid =
    retentionDone &&
    !auctionComplete &&
    !soldBanner &&
    !rtmPrompt &&
    !userPassedLot &&
    userSquad.length < squadSize &&
    highestBidderId !== userFranchise.id &&
    effectiveRequiredBid <= maxUserBid &&
    effectiveRequiredBid >= 1.0;

  const canUserJumpBid =
    retentionDone &&
    !auctionComplete &&
    !soldBanner &&
    !rtmPrompt &&
    !userPassedLot &&
    highestBidderId !== null &&
    highestBidderId !== userFranchise.id &&
    userSquad.length < squadSize &&
    roundHalf(currentBid + 2.0) <= maxUserBid;

  const advanceLot = () => {
    const s = stateRef.current;
    if (s.currentIndex + 1 < s.queue.length) {
      setCurrentIndex((i) => i + 1);
    } else {
      // Accelerated Clearance Round for any unsold players
      const drafted = new Set([...s.userSquad.map((p) => p.id), ...s.aiSquad.map((p) => p.id)]);
      const unsold = sortPoolIntoIplSets(
        playerPool.filter((p) => !drafted.has(p.id)).map((p) => ({ ...p, basePrice: 1.0 }))
      );
      if (unsold.length > 0) {
        setQueue(unsold);
        setCurrentIndex(0);
        addLog('Accelerated Round: Unsold players return at ₹1.00 Cr base price.', 'neutral');
      }
    }
  };

  const commitSale = (player: IPLPlayer, winnerId: string | 'UNSOLD', price: number) => {
    const s = stateRef.current;
    if (s.soldBanner) return;

    if (winnerId === userFranchise.id) {
      soundFX.playSold();
      setUserSquad((prev) => [...prev, { ...player, boughtPrice: price, inForm: false }]);
      setUserPurse((prev) => roundHalf(Math.max(0, prev - price)));
      addLog(`SOLD! ${player.name} to ${userFranchise.shortName} for ₹${price.toFixed(2)} Cr`, 'user');
      auctioneerVoice.speak(
        `Sold! ${player.name} to ${userFranchise.shortName}, ${price} crore!`,
        'high'
      );
    } else if (winnerId === aiFranchise.id) {
      soundFX.playSold();
      setAiSquad((prev) => [...prev, { ...player, boughtPrice: price, inForm: false }]);
      setAiPurse((prev) => roundHalf(Math.max(0, prev - price)));
      addLog(`SOLD! ${player.name} to ${aiFranchise.shortName} for ₹${price.toFixed(2)} Cr`, 'ai');
      auctioneerVoice.speak(
        `Sold! ${player.name} to ${aiFranchise.shortName}, ${price} crore!`,
        'high'
      );
    } else if (winnerId !== 'UNSOLD') {
      soundFX.playSold();
      setTableRivals((prev) =>
        prev.map((tr) =>
          tr.franchise.id === winnerId
            ? { ...tr, purse: roundHalf(Math.max(0, tr.purse - price)), buys: tr.buys + 1 }
            : tr
        )
      );
      addLog(`SOLD! ${player.name} to ${winnerId} for ₹${price.toFixed(2)} Cr`, 'table');
      auctioneerVoice.speak(
        `Sold! ${player.name} to ${getFranchiseById(winnerId).shortName}, ${price} crore!`,
        'high'
      );
    } else {
      addLog(`${player.name} — UNSOLD`, 'neutral');
      auctioneerVoice.speak(`${player.name}, unsold!`, 'high');
    }

    setSoldBanner({ playerName: player.name, winnerId, price });
    setRtmPrompt(null);

    const saleStartedAt = Date.now();
    const waitSaleVoiceThenAdvance = () => {
      const elapsed = Date.now() - saleStartedAt;
      if ((elapsed >= 2200 && !auctioneerVoice.isBusy()) || elapsed >= 4500) {
        soldTimerRef.current = null;
        advanceLot();
        return;
      }
      soldTimerRef.current = window.setTimeout(waitSaleVoiceThenAdvance, 150);
    };
    soldTimerRef.current = window.setTimeout(waitSaleVoiceThenAdvance, 2200);
  };

  const triggerHammerClose = () => {
    const s = stateRef.current;
    if (!s.currentPlayer || s.soldBanner || s.rtmPrompt || s.auctionComplete) return;

    if (!s.highestBidderId) {
      commitSale(s.currentPlayer, 'UNSOLD', 0);
      return;
    }

    // Check Right To Match (RTM) eligibility!
    const eligibleRtm =
      s.rtmAvailable &&
      s.highestBidderId !== userFranchise.id &&
      s.currentPlayer.iplTeam === userFranchise.id &&
      s.userSquad.length < squadSize &&
      s.currentBid <= getMaxAllowedBid(s.userPurse, s.userSquad.length, squadSize);

    if (eligibleRtm) {
      setRtmPrompt({
        player: s.currentPlayer,
        winningFranchiseId: s.highestBidderId,
        price: s.currentBid,
      });
      auctioneerVoice.speak(
        `Right to match available for ${userFranchise.name}!`,
        'high'
      );
      return;
    }

    commitSale(s.currentPlayer, s.highestBidderId, s.currentBid);
  };

  // Live Gavel Countdown Ticker
  useEffect(() => {
    if (!retentionDone || auctionComplete || soldBanner || rtmPrompt || !currentPlayer) return;

    const interval = window.setInterval(() => {
      setCountdownMs((prev) => {
        if (prev <= 0) return 0;
        const hasBid = Boolean(stateRef.current.highestBidderId);
        // Pause post-bid gavel countdown briefly while the auctioneer is actively announcing a bid/call
        if (hasBid && auctioneerVoice.isBusy()) {
          return prev;
        }
        const next = Math.max(0, prev - 100);
        if (!hasBid) {
          if (next === 10000) {
            soundFX.playGavelTick();
            auctioneerVoice.speak('Going once!');
          } else if (next === 5000) {
            soundFX.playGavelTick();
            auctioneerVoice.speak('Going twice!');
          } else if (next === 2000) {
            soundFX.playGavelTick();
            auctioneerVoice.speak('Going thrice!');
          }
        } else {
          if (next === 5200) {
            soundFX.playGavelTick();
            auctioneerVoice.speak('Going once!');
          } else if (next === 3000) {
            soundFX.playGavelTick();
            auctioneerVoice.speak('Going twice!');
          } else if (next === 1400) {
            soundFX.playGavelTick();
            auctioneerVoice.speak('Going thrice!');
          }
        }
        return next;
      });
    }, 100);

    return () => window.clearInterval(interval);
  }, [retentionDone, auctionComplete, soldBanner, rtmPrompt, currentPlayer?.id, highestBidderId, currentBid]);

  useEffect(() => {
    if (countdownMs === 0 && retentionDone && !auctionComplete && !soldBanner && !rtmPrompt && currentPlayer) {
      triggerHammerClose();
    }
  }, [countdownMs, retentionDone, auctionComplete, soldBanner, rtmPrompt, currentPlayer?.id]);

  // Multi-Franchise AI Bidding Reactor (Match Rival + 3 Table Rivals)
  // Waits for the auctioneer to finish speaking clearly plus a natural broadcast beat before raising paddles.
  useEffect(() => {
    if (!retentionDone || auctionComplete || soldBanner || rtmPrompt || !currentPlayer) return;

    const startedAt = Date.now();
    const isOpening = highestBidderId === null;
    const minElapsedMs = isOpening ? 2000 : userPassedLot ? 1400 : 2200;
    const postVoiceGapMs = isOpening
      ? 900
      : userPassedLot
      ? 750
      : 1200 + Math.floor(Math.random() * 650);
    let voiceIdleSince: number | null = auctioneerVoice.isBusy() ? null : Date.now();
    let timerId: number | null = null;
    let cancelled = false;

    const evaluateAiBid = () => {
      if (cancelled) return;
      const now = Date.now();
      const elapsed = now - startedAt;

      if (auctioneerVoice.isBusy()) {
        voiceIdleSince = null;
      } else if (voiceIdleSince === null) {
        voiceIdleSince = now;
      }

      const idleDuration = voiceIdleSince !== null ? now - voiceIdleSince : 0;
      const ready =
        (elapsed >= minElapsedMs && idleDuration >= postVoiceGapMs) || elapsed >= 7500;

      if (!ready) {
        timerId = window.setTimeout(evaluateAiBid, 120);
        return;
      }

      const s = stateRef.current;
      if (!s.currentPlayer || s.soldBanner || s.rtmPrompt || s.auctionComplete) return;

      const nextPrice =
        s.highestBidderId === null ? s.currentPlayer.basePrice : roundHalf(s.currentBid + 0.5);

      // Build list of AI bidders willing to raise paddle right now
      const candidates: { id: string; target: number; isMatchRival: boolean }[] = [];

      // 1. Match Rival (aiFranchise)
      if (s.highestBidderId !== aiFranchise.id && s.aiSquad.length < squadSize) {
        const aiTarget = getAiTargetBid(
          s.currentPlayer,
          s.aiPurse,
          s.aiSquad,
          squadSize,
          matchNumber
        );
        const aiMax = getMaxAllowedBid(s.aiPurse, s.aiSquad.length, squadSize);
        if (aiTarget >= nextPrice && nextPrice <= aiMax) {
          candidates.push({ id: aiFranchise.id, target: aiTarget, isMatchRival: true });
        }
      }

      // 2. Other IPL Table Franchises (keep reserve players so User + Match Rival never starve!)
      const remainingLots = s.queue.length - s.currentIndex;
      const neededByCore =
        (squadSize - s.userSquad.length) + (squadSize - s.aiSquad.length);
      const totalTableBuys = s.tableRivals.reduce((acc, tr) => acc + tr.buys, 0);

      if (remainingLots > neededByCore + 4 && totalTableBuys < 10) {
        s.tableRivals.forEach((tr) => {
          if (s.highestBidderId === tr.franchise.id || tr.buys >= 4) return;
          const homeBias = s.currentPlayer!.iplTeam === tr.franchise.id ? 3.5 : 0;
          const maxForTable = Math.min(
            tr.purse - 4.0,
            s.currentPlayer!.basePrice +
              Math.max(0, (s.currentPlayer!.overallRating - 81) * 1.1) +
              homeBias
          );
          if (maxForTable >= nextPrice) {
            candidates.push({ id: tr.franchise.id, target: maxForTable, isMatchRival: false });
          }
        });
      }

      if (candidates.length > 0) {
        // Prefer Match Rival slightly when they need players, else pick an active table bidder
        candidates.sort((a, b) => b.target - a.target);
        const picked =
          candidates.length > 1 && Math.random() < 0.45 ? candidates[1] : candidates[0];

        soundFX.playPaddle();
        setCurrentBid(nextPrice);
        setHighestBidderId(picked.id);
        setCountdownMs(8000);
        addLog(
          `${picked.id} raises paddle for ${s.currentPlayer.name} — ₹${nextPrice.toFixed(2)} Cr`,
          picked.isMatchRival ? 'ai' : 'table'
        );
        auctioneerVoice.speak(
          `${getFranchiseById(picked.id).shortName}, ${nextPrice} crore!`,
          'high'
        );
      } else if (s.userPassedLot && s.highestBidderId !== null) {
        // User already passed and no AI wants to outbid -> Hammer down cleanly!
        triggerHammerClose();
      }
    };

    timerId = window.setTimeout(evaluateAiBid, 250);

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    retentionDone,
    auctionComplete,
    soldBanner,
    rtmPrompt,
    currentPlayer?.id,
    highestBidderId,
    currentBid,
    userPassedLot,
  ]);

  const handleUserRaise = (increment: 0.5 | 2.0) => {
    if (!currentPlayer || soldBanner || rtmPrompt || auctionComplete) return;
    const bidVal =
      highestBidderId === null
        ? effectiveRequiredBid
        : increment === 2.0
        ? roundHalf(currentBid + 2.0)
        : effectiveRequiredBid;

    if (bidVal > maxUserBid || bidVal < 1.0) return;

    soundFX.playPaddle();
    setUserPassedLot(false);
    setCurrentBid(bidVal);
    setHighestBidderId(userFranchise.id);
    setCountdownMs(8000);
    addLog(
      `${userFranchise.shortName} raises paddle — ₹${bidVal.toFixed(2)} Cr`,
      'user'
    );
    auctioneerVoice.speak(`${userFranchise.shortName}, ${bidVal} crore!`, 'high');
  };

  const handlePassLot = () => {
    if (!currentPlayer || soldBanner || rtmPrompt || auctionComplete) return;
    setUserPassedLot(true);
    if (highestBidderId !== null && highestBidderId !== userFranchise.id) {
      // Let AI settle smoothly without cutting off the current callout
      setCountdownMs((c) => Math.min(c, 2600));
    } else if (highestBidderId === null) {
      // Check if any AI wants at base price, else unsold smoothly
      setCountdownMs((c) => Math.min(c, 2600));
    }
  };

  const handleUseRtm = (accept: boolean) => {
    if (!rtmPrompt) return;
    if (accept) {
      setRtmAvailable(false);
      addLog(
        `RTM USED! ${userFranchise.shortName} matched ₹${rtmPrompt.price.toFixed(2)} Cr for ${rtmPrompt.player.name}!`,
        'user'
      );
      commitSale(rtmPrompt.player, userFranchise.id, rtmPrompt.price);
    } else {
      addLog(
        `${userFranchise.shortName} declined RTM for ${rtmPrompt.player.name}.`,
        'neutral'
      );
      commitSale(rtmPrompt.player, rtmPrompt.winningFranchiseId, rtmPrompt.price);
    }
  };

  const handleAutoFillRemaining = () => {
    const draftedIds = new Set([...userSquad.map((p) => p.id), ...aiSquad.map((p) => p.id)]);
    const remainingPool = queue.filter((p) => !draftedIds.has(p.id));

    const userResult = autoFillTeamSquad(userSquad, userPurse, squadSize, remainingPool, true);
    const userUsed = new Set(userResult.usedIds);
    const poolForAi = remainingPool.filter((p) => !userUsed.has(p.id));
    const aiResult = autoFillTeamSquad(aiSquad, aiPurse, squadSize, poolForAi, false);

    soundFX.playSold();
    setUserSquad(userResult.squad);
    setUserPurse(userResult.remainingPurse);
    setAiSquad(aiResult.squad);
    setAiPurse(aiResult.remainingPurse);
    setSoldBanner(null);
    setRtmPrompt(null);
    addLog('Remaining squad slots auto-completed within auction purse.', 'neutral');
  };

  const toggleRetain = (id: string) => {
    setRetainedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  };

  const handleConfirmRetention = () => {
    const retainedPlayers = previousUserSquad
      .filter((p) => retainedIds.includes(p.id))
      .map((p) => ({ ...p, inForm: false, retained: true }));
    const retainedSet = new Set(retainedPlayers.map((p) => p.id));
    setUserSquad(retainedPlayers);
    setQueue(sortPoolIntoIplSets(playerPool.filter((p) => !retainedSet.has(p.id))));
    setCurrentIndex(0);
    setRetentionDone(true);
    if (retainedPlayers.length > 0) {
      addLog(
        `Retained ${retainedPlayers.map((p) => p.name).join(', ')} ahead of the auction.`,
        'user'
      );
    }
  };

  // RETENTION DESK VIEW (Match 2+)
  if (!retentionDone) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="text-xs font-medium text-amber-400">
              Match {matchNumber} · Pre-Auction Retention Desk
            </div>
            <h2 className="font-display text-3xl font-bold text-white mt-1">
              Retain Up to 3 Core Players
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Keep up to 3 players from last match at ₹0 extra cost, then enter the auction room
              with ₹{initialUserPurse.toFixed(2)} Cr to bid on new superstars.
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-slate-400">Retained</div>
            <div className="font-mono text-2xl font-bold text-amber-400 tabular-nums">
              {retainedIds.length} / 3
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {previousUserSquad.map((player) => {
            const selected = retainedIds.includes(player.id);
            return (
              <button
                key={player.id}
                type="button"
                onClick={() => toggleRetain(player.id)}
                className={`text-left p-4 rounded-xl border transition-all cursor-pointer ${
                  selected
                    ? 'bg-amber-500/12 border-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.18)]'
                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <PlayerPortrait
                      playerId={player.id}
                      name={player.name}
                      role={player.role}
                      primaryColor={getFranchiseById(player.iplTeam).primaryColor}
                      secondaryColor={getFranchiseById(player.iplTeam).secondaryColor}
                      jerseyNumber={player.jerseyNumber}
                      variant="avatar"
                    />
                    <div className="min-w-0">
                      <div className="text-xs text-slate-400">
                        {player.iplTeam} · {player.role}
                      </div>
                      <div className="font-display text-xl font-bold text-white mt-0.5 truncate">
                        {player.name}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-md flex items-center justify-center border shrink-0 ${
                      selected
                        ? 'bg-amber-400 border-amber-400 text-slate-950'
                        : 'border-slate-700 text-transparent'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-mono text-slate-300 tabular-nums">
                  <div>Runs: {player.stats.runs}</div>
                  <div>SR: {player.stats.strikeRate}</div>
                  <div>Wkts: {player.stats.wickets}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-800">
          <span className="text-xs text-slate-400">
            {squadSize - retainedIds.length} open squad slots will be drafted in the live auction.
          </span>
          <button
            type="button"
            onClick={handleConfirmRetention}
            className="w-full sm:w-auto py-3 px-6 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display text-lg font-bold tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <span>Enter Live Auction</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  const hammerStatusText =
    highestBidderId === null
      ? countdownMs <= 2000
        ? 'Going Thrice!'
        : countdownMs <= 5000
        ? 'Going Twice!'
        : countdownMs <= 10000
        ? 'Going Once...'
        : 'Opening Floor (15s)'
      : countdownMs <= 1400
      ? 'Going Thrice!'
      : countdownMs <= 3000
      ? 'Going Twice!'
      : countdownMs <= 5200
      ? 'Going Once...'
      : 'Bidding Active';

  const highestBidderFranchise = highestBidderId ? getFranchiseById(highestBidderId) : null;

  return (
    <div className="space-y-5">
      {/* Live Auction Room Franchise Tables Strip */}
      <section aria-label="Franchise auction tables" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* User Table */}
        <div
          className={`rounded-xl border p-3 transition-all ${
            highestBidderId === userFranchise.id
              ? 'bg-amber-500/15 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.2)]'
              : 'bg-slate-900/95 border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <TeamCrest franchise={userFranchise} size="xs" />
              <div className="min-w-0">
                <div className="font-display text-base font-bold text-white truncate">
                  {userFranchise.shortName} (You)
                </div>
                <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                  {userSquad.length}/{squadSize} players
                </div>
              </div>
            </div>
            {highestBidderId === userFranchise.id && (
              <Hand className="w-4 h-4 text-amber-400 shrink-0" />
            )}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400">Purse</span>
            <span className="font-mono font-bold text-amber-400 tabular-nums">
              ₹{userPurse.toFixed(2)} Cr
            </span>
          </div>
        </div>

        {/* Match Rival Table */}
        <div
          className={`rounded-xl border p-3 transition-all ${
            highestBidderId === aiFranchise.id
              ? 'bg-sky-500/15 border-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.2)]'
              : 'bg-slate-900/95 border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <TeamCrest franchise={aiFranchise} size="xs" />
              <div className="min-w-0">
                <div className="font-display text-base font-bold text-white truncate">
                  {aiFranchise.shortName} (Rival)
                </div>
                <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                  {aiSquad.length}/{squadSize} players
                </div>
              </div>
            </div>
            {highestBidderId === aiFranchise.id && (
              <Hand className="w-4 h-4 text-sky-400 shrink-0" />
            )}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400">Purse</span>
            <span className="font-mono font-bold text-sky-400 tabular-nums">
              ₹{aiPurse.toFixed(2)} Cr
            </span>
          </div>
        </div>

        {/* 3 Other Table Franchises */}
        {tableRivals.map((tr) => {
          const isLeading = highestBidderId === tr.franchise.id;
          return (
            <div
              key={tr.franchise.id}
              className={`rounded-xl border p-3 transition-all ${
                isLeading
                  ? 'bg-emerald-500/15 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                  : 'bg-slate-900/80 border-slate-800/90'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <TeamCrest franchise={tr.franchise} size="xs" />
                  <div className="min-w-0">
                    <div className="font-display text-base font-bold text-slate-200 truncate">
                      {tr.franchise.shortName}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {tr.buys} signed
                    </div>
                  </div>
                </div>
                {isLeading && <Hand className="w-4 h-4 text-emerald-400 shrink-0" />}
              </div>
              <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-slate-500">Purse</span>
                <span className="font-mono font-semibold text-slate-300 tabular-nums">
                  ₹{tr.purse.toFixed(2)} Cr
                </span>
              </div>
            </div>
          );
        })}
      </section>

      {/* Main Auction Stage or Completion Screen */}
      {auctionComplete ? (
        <div className="rounded-2xl border border-emerald-500/40 bg-slate-900/95 p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/15 text-emerald-400 mx-auto">
            <UserCheck className="w-6 h-6" />
          </div>
          <h2 className="font-display text-3xl font-bold text-white">
            Auction Complete — {squadSize}-Player Squads Locked!
          </h2>
          <p className="text-sm text-slate-300 max-w-xl mx-auto">
            {userFranchise.name} finished with ₹{userPurse.toFixed(2)} Cr unspent. Jump straight
            into the floodlit 2-Over Cricket Match against {aiFranchise.name}, or play the{' '}
            {squadSize}-Round Card Stat Battle first for bonus runs and In-Form boosts!
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            {onStartCricketMatchNow && (
              <button
                type="button"
                onClick={() =>
                  onStartCricketMatchNow({
                    userSquad,
                    aiSquad,
                    userRemainingPurse: userPurse,
                    aiRemainingPurse: aiPurse,
                  })
                }
                className="inline-flex items-center gap-2 py-3.5 px-7 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display text-lg font-bold tracking-wide transition-colors cursor-pointer"
              >
                <span>Play 2-Over Cricket Match Now</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                onCompleteAuction({
                  userSquad,
                  aiSquad,
                  userRemainingPurse: userPurse,
                  aiRemainingPurse: aiPurse,
                })
              }
              className={`inline-flex items-center gap-2 py-3.5 px-6 rounded-xl font-display text-base font-bold tracking-wide transition-colors cursor-pointer ${
                onStartCricketMatchNow
                  ? 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100'
                  : 'bg-amber-400 hover:bg-amber-300 text-slate-950 text-lg px-7'
              }`}
            >
              <span>
                {onStartCricketMatchNow
                  ? 'Play Card Stat Battle First (+Bonus)'
                  : 'Proceed to Card Stat Battle'}
              </span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left: Set Header + Active Player Card */}
          <div className="lg:col-span-4 space-y-3">
            {currentPlayer && (
              <>
                <div className="flex items-center justify-between px-1 text-xs">
                  <span className="font-semibold text-amber-400">
                    {getAuctionSetLabel(currentPlayer)}
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    Lot #{currentIndex + 1} of {queue.length}
                  </span>
                </div>
                <PlayerCard player={currentPlayer} priceLabel="Base Price" />
                {nextOnDeck && (
                  <div className="px-3.5 py-2 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-2.5 text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <PlayerPortrait
                        playerId={nextOnDeck.id}
                        name={nextOnDeck.name}
                        role={nextOnDeck.role}
                        primaryColor={getFranchiseById(nextOnDeck.iplTeam).primaryColor}
                        secondaryColor={getFranchiseById(nextOnDeck.iplTeam).secondaryColor}
                        jerseyNumber={nextOnDeck.jerseyNumber}
                        variant="chip"
                      />
                      <div className="min-w-0">
                        <div className="text-[10px] text-slate-400">Next on Block</div>
                        <div className="font-semibold text-slate-200 truncate">
                          {nextOnDeck.name} ({nextOnDeck.role})
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-amber-400 shrink-0 tabular-nums">
                      ₹{nextOnDeck.basePrice.toFixed(1)}Cr
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Center: Live Auctioneer Hammer & Paddle Console */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/95 overflow-hidden">
            {/* Auctioneer Studio Header */}
            <div className="relative h-28 bg-gradient-to-br from-slate-800 to-slate-950">
              <img
                src={auctionGavelDeskImg}
                alt="Auctioneer podium gavel"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover opacity-50"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/55 to-transparent" />
              <div className="absolute top-3 left-4 right-4 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => auctioneerVoice.setEnabled(!voiceEnabled)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1.5 border cursor-pointer ${
                    voiceEnabled
                      ? 'bg-amber-400/20 border-amber-400/50 text-amber-300'
                      : 'bg-slate-900/85 border-slate-700 text-slate-400'
                  }`}
                >
                  {voiceEnabled ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                  <span>{voiceEnabled ? 'Girl AI Voice On' : 'Voice Off'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => auctioneerVoice.testVoice()}
                  className="px-2 py-1 rounded-lg bg-slate-900/80 border border-slate-700 text-[11px] text-slate-200 hover:border-amber-400 cursor-pointer"
                >
                  Test Voice
                </button>
              </div>
              <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                  <Gavel className="w-4 h-4" />
                  <span>{hammerStatusText}</span>
                </div>
                <div className="text-xs font-mono text-slate-200 tabular-nums">
                  {soldBanner ? 'HAMMER DOWN' : `${(countdownMs / 1000).toFixed(1)}s`}
                </div>
              </div>
              {/* Countdown Progress Bar */}
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-950">
                <div
                  className={`h-full transition-all duration-100 ${
                    countdownMs <= 2000
                      ? 'bg-rose-500'
                      : countdownMs <= 5000
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                  }`}
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(100, (countdownMs / (highestBidderId === null ? 15000 : 8000)) * 100)
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div className="p-5 space-y-4">
              {voiceEnabled && (
                <div className="space-y-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <label htmlFor="solo-voice-select" className="text-slate-400 shrink-0">
                      Auctioneer Voice:
                    </label>
                    <select
                      id="solo-voice-select"
                      value={selectedVoice}
                      onChange={(e) => {
                        auctioneerVoice.setVoiceId(e.target.value as StudioFemaleVoiceId);
                        auctioneerVoice.testVoice();
                      }}
                      className="flex-1 max-w-[240px] px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 truncate cursor-pointer"
                    >
                      {voiceOptions.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <label htmlFor="solo-voice-rate" className="text-slate-400 shrink-0">
                        Voice Speed:
                      </label>
                      <span className="font-mono text-[11px] font-semibold text-amber-400 tabular-nums">
                        {speechRate.toFixed(2)}×
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-1 justify-end min-w-[190px]">
                      <input
                        id="solo-voice-rate"
                        type="range"
                        min={0.65}
                        max={1.15}
                        step={0.05}
                        value={speechRate}
                        onChange={(e) => auctioneerVoice.setSpeechRate(parseFloat(e.target.value))}
                        className="w-24 sm:w-28 accent-amber-400 cursor-pointer"
                        aria-label="Commentator speech synthesis speed"
                      />
                      <div className="flex items-center gap-1">
                        {[
                          { label: 'Slow', rate: 0.75 },
                          { label: 'Clear', rate: 0.85 },
                          { label: 'Normal', rate: 0.95 },
                        ].map((preset) => {
                          const active = Math.abs(speechRate - preset.rate) < 0.03;
                          return (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() => auctioneerVoice.setSpeechRate(preset.rate)}
                              className={`px-2 py-0.5 rounded-md border text-[11px] font-medium cursor-pointer transition-colors ${
                                active
                                  ? 'bg-amber-400/20 border-amber-400/60 text-amber-300'
                                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {/* Current Bid & Leading Franchise */}
              <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-slate-400">
                    {highestBidderId === null ? 'Base Price' : 'Current Highest Bid'}
                  </div>
                  <div className="font-mono text-3xl sm:text-4xl font-bold text-white tabular-nums mt-0.5">
                    ₹{currentBid.toFixed(2)} <span className="text-lg text-amber-400">Cr</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-1 tabular-nums">
                    Your Max Bid: ₹{maxUserBid.toFixed(2)} Cr
                  </div>
                </div>

                <div className="text-right">
                  {highestBidderFranchise ? (
                    <div className="flex flex-col items-end gap-1.5">
                      <TeamCrest franchise={highestBidderFranchise} size="sm" />
                      <span className="text-xs font-semibold text-white">
                        {highestBidderFranchise.shortName} Leading
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500 font-medium">Awaiting Opening Bid</span>
                  )}
                </div>
              </div>

              {/* Right To Match (RTM) Decision Overlay */}
              {rtmPrompt && (
                <div className="rounded-xl border border-amber-400 bg-amber-500/15 p-4 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-100 leading-relaxed">
                      <strong className="text-white text-sm block mb-0.5">
                        Right To Match (RTM) Available!
                      </strong>
                      {rtmPrompt.winningFranchiseId} won {rtmPrompt.player.name} ({userFranchise.shortName}{' '}
                      Home Star) for ₹{rtmPrompt.price.toFixed(2)} Cr. Match this bid to bring him
                      back?
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => handleUseRtm(true)}
                      className="py-2.5 px-3 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold cursor-pointer"
                    >
                      Use RTM (₹{rtmPrompt.price.toFixed(2)} Cr)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUseRtm(false)}
                      className="py-2.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                    >
                      Decline RTM
                    </button>
                  </div>
                </div>
              )}

              {/* Sold Banner */}
              {soldBanner && (
                <div
                  className={`rounded-xl p-3 text-center text-sm font-bold border ${
                    soldBanner.winnerId === userFranchise.id
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : soldBanner.winnerId === 'UNSOLD'
                      ? 'bg-slate-800 border-slate-700 text-slate-300'
                      : 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                  }`}
                >
                  {soldBanner.winnerId === 'UNSOLD'
                    ? `${soldBanner.playerName} — UNSOLD`
                    : `SOLD! ${soldBanner.playerName} to ${soldBanner.winnerId} for ₹${soldBanner.price.toFixed(2)} Cr`}
                </div>
              )}

              {/* Paddle Raise Controls */}
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={!canUserBid}
                    onClick={() => handleUserRaise(0.5)}
                    className="py-3.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-display text-lg font-bold tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Hand className="w-4 h-4" />
                    <span>
                      {highestBidderId === userFranchise.id
                        ? 'Paddle Up (Leading)'
                        : highestBidderId === null
                        ? `Open ₹${effectiveRequiredBid.toFixed(1)} Cr`
                        : `Raise +₹50L (₹${effectiveRequiredBid.toFixed(1)}Cr)`}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={!canUserJumpBid}
                    onClick={() => handleUserRaise(2.0)}
                    className="py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-display text-lg font-bold tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Zap className="w-4 h-4" />
                    <span>Jump +₹2.0 Cr</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={Boolean(soldBanner) || Boolean(rtmPrompt)}
                    onClick={handlePassLot}
                    className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    <span>{userPassedLot ? 'Withdrawn' : 'Withdraw / Pass'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAutoFillRemaining}
                    className="py-2.5 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-sky-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <FastForward className="w-3.5 h-3.5" />
                    <span>Auto-Fill Squad</span>
                  </button>
                </div>
              </div>

              {/* RTM Status Line */}
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                <span>Right To Match (RTM) Card</span>
                <span className={rtmAvailable ? 'text-amber-400 font-semibold' : 'text-slate-500'}>
                  {rtmAvailable ? `1 Available (${userFranchise.shortName} Stars)` : 'Used'}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Squads & Live Auction Ticker */}
          <div className="lg:col-span-3 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3.5">
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setDrawerTab('YOUR_SQUAD')}
                className={`py-1.5 px-2 rounded-lg transition-colors cursor-pointer ${
                  drawerTab === 'YOUR_SQUAD' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                Yours ({userSquad.length})
              </button>
              <button
                type="button"
                onClick={() => setDrawerTab('RIVAL_SQUAD')}
                className={`py-1.5 px-2 rounded-lg transition-colors cursor-pointer ${
                  drawerTab === 'RIVAL_SQUAD' ? 'bg-sky-400 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                Rival ({aiSquad.length})
              </button>
              <button
                type="button"
                onClick={() => setDrawerTab('LOG')}
                className={`py-1.5 px-2 rounded-lg transition-colors cursor-pointer ${
                  drawerTab === 'LOG' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Ledger
              </button>
            </div>

            {drawerTab === 'LOG' ? (
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {logs.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    Auction hammer log will appear here.
                  </div>
                ) : (
                  logs.map((item) => (
                    <div
                      key={item.id}
                      className={`text-xs leading-snug px-3 py-2 rounded-lg bg-slate-950/75 border border-slate-800/70 ${
                        item.tone === 'user'
                          ? 'text-emerald-300'
                          : item.tone === 'ai'
                          ? 'text-sky-300'
                          : item.tone === 'table'
                          ? 'text-amber-200'
                          : 'text-slate-400'
                      }`}
                    >
                      {item.text}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {(drawerTab === 'YOUR_SQUAD' ? userSquad : aiSquad).length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                    No players signed yet.
                  </div>
                ) : (
                  (drawerTab === 'YOUR_SQUAD' ? userSquad : aiSquad).map((p, idx) => {
                    const pTeam = getFranchiseById(p.iplTeam);
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-slate-950/80 border border-slate-800/80"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <PlayerPortrait
                            playerId={p.id}
                            name={p.name}
                            role={p.role}
                            primaryColor={pTeam.primaryColor}
                            secondaryColor={pTeam.secondaryColor}
                            jerseyNumber={p.jerseyNumber}
                            variant="chip"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                              <span className="font-mono text-slate-500">{idx + 1}.</span>
                              <span className="truncate">{p.name}</span>
                              {p.retained && (
                                <Sparkles className="w-3 h-3 text-amber-400 shrink-0" aria-label="Retained" />
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {p.role} · {p.iplTeam}
                            </div>
                          </div>
                        </div>
                        <span className="font-mono text-xs font-bold text-amber-400 shrink-0 tabular-nums">
                          {p.retained ? 'Retained' : `₹${p.boughtPrice.toFixed(1)}Cr`}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
