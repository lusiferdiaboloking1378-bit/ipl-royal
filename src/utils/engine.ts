import { normalizeStatForBar, STAT_META } from '../data/iplData.ts';
import type {
  BallOutcomeCode,
  DeliveryType,
  DraftedPlayer,
  IPLPlayer,
  ShotStyle,
  StatKey,
} from '../types/game.ts';

export function roundHalf(val: number): number {
  return Math.round(val * 2) / 2;
}

export function getAuctionSetLabel(player: IPLPlayer): string {
  if (player.overallRating >= 92) return 'Set 1 · Marquee Stars';
  if (player.role === 'Batter') return 'Set 2 · Capped Batters';
  if (player.role === 'All-Rounder') return 'Set 3 · All-Rounders';
  if (player.role === 'Wicketkeeper') return 'Set 4 · Wicketkeepers';
  return 'Set 5 · Fast & Spin Bowlers';
}

export function sortPoolIntoIplSets(pool: IPLPlayer[]): IPLPlayer[] {
  const shuffle = <T,>(arr: T[]): T[] => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const marquee = shuffle(pool.filter((p) => p.overallRating >= 92));
  const batters = shuffle(pool.filter((p) => p.overallRating < 92 && p.role === 'Batter'));
  const allRounders = shuffle(pool.filter((p) => p.overallRating < 92 && p.role === 'All-Rounder'));
  const keepers = shuffle(pool.filter((p) => p.overallRating < 92 && p.role === 'Wicketkeeper'));
  const bowlers = shuffle(pool.filter((p) => p.overallRating < 92 && p.role === 'Bowler'));

  return [...marquee, ...batters, ...allRounders, ...keepers, ...bowlers];
}

export function getMaxAllowedBid(purse: number, currentSquadSize: number, targetSquadSize: number): number {
  const slotsLeftAfterThis = Math.max(0, targetSquadSize - currentSquadSize - 1);
  const reserved = slotsLeftAfterThis * 1.0;
  return Math.max(0, roundHalf(purse - reserved));
}

export function getAiTargetBid(
  player: IPLPlayer,
  aiPurse: number,
  aiSquad: DraftedPlayer[],
  targetSquadSize: number,
  matchNumber: number
): number {
  const slotsLeft = targetSquadSize - aiSquad.length;
  if (slotsLeft <= 0) return 0;

  const maxAllowed = getMaxAllowedBid(aiPurse, aiSquad.length, targetSquadSize);
  if (maxAllowed < player.basePrice) return 0;

  // Role balance bonus
  const roleCount = aiSquad.filter((p) => p.role === player.role).length;
  const roleBonus = roleCount === 0 ? 2.5 : roleCount >= 3 ? -2.0 : 0.5;

  // Difficulty multiplier scales in Round 2+
  const difficultyBoost = matchNumber === 1 ? 0.96 : matchNumber === 2 ? 1.06 : 1.15;

  // Realistic IPL Mega Auction curve (₹3 Cr – ₹25+ Cr depending on rating & purse)
  const ratingPremium = Math.max(0, (player.overallRating - 80) * 1.15);
  const avgBudgetPerSlot = aiPurse / slotsLeft;

  let target = (player.basePrice + ratingPremium + roleBonus) * difficultyBoost;
  const slotCap = Math.min(maxAllowed, avgBudgetPerSlot * 1.75 + 4.0);
  target = Math.min(target, slotCap, maxAllowed);

  const jitter = ((player.jerseyNumber % 3) - 1) * 1.0;
  const finalTarget = roundHalf(Math.max(player.basePrice, Math.min(maxAllowed, target + jitter)));

  return finalTarget >= player.basePrice ? finalTarget : 0;
}

export function autoFillTeamSquad(
  currentSquad: DraftedPlayer[],
  purse: number,
  targetSquadSize: number,
  availablePool: IPLPlayer[],
  preferValue: boolean
): { squad: DraftedPlayer[]; remainingPurse: number; usedIds: string[] } {
  const squad = [...currentSquad];
  let budget = roundHalf(purse);
  const pool = [...availablePool];
  const usedIds: string[] = [];

  // Sort pool either balanced (preferValue = true for quick fill) or by rating
  pool.sort((a, b) => {
    if (preferValue) {
      const valA = a.overallRating / Math.max(1, a.basePrice);
      const valB = b.overallRating / Math.max(1, b.basePrice);
      return valB - valA;
    }
    return b.overallRating - a.overallRating;
  });

  while (squad.length < targetSquadSize && pool.length > 0) {
    const slotsLeftAfterThis = targetSquadSize - squad.length - 1;
    const maxSpend = roundHalf(budget - slotsLeftAfterThis * 1.0);

    // Ensure at least 1 bowler & 1 batter if possible
    const hasBowler = squad.some((p) => p.role === 'Bowler' || p.role === 'All-Rounder');
    const hasBatter = squad.some((p) => p.role === 'Batter' || p.role === 'Wicketkeeper');

    let candidateIdx = pool.findIndex((p) => {
      if (p.basePrice > maxSpend) return false;
      if (!hasBowler && squad.length >= targetSquadSize - 2) {
        return p.role === 'Bowler' || p.role === 'All-Rounder';
      }
      if (!hasBatter && squad.length >= targetSquadSize - 2) {
        return p.role === 'Batter' || p.role === 'Wicketkeeper';
      }
      return true;
    });

    if (candidateIdx === -1) {
      candidateIdx = pool.findIndex((p) => p.basePrice <= maxSpend);
    }

    // Emergency clearance fallback so squad always completes
    if (candidateIdx === -1) {
      candidateIdx = pool.length - 1;
    }

    const picked = pool.splice(candidateIdx, 1)[0];
    const price = Math.min(picked.basePrice, Math.max(1.0, maxSpend));
    const finalPrice = roundHalf(Math.max(1.0, Math.min(budget, price)));

    squad.push({
      ...picked,
      boughtPrice: finalPrice,
      inForm: false,
    });
    usedIds.push(picked.id);
    budget = roundHalf(Math.max(0, budget - finalPrice));
  }

  return { squad, remainingPurse: budget, usedIds };
}

export function chooseAiBestStat(aiCard: DraftedPlayer, matchNumber: number): StatKey {
  const keys: StatKey[] = ['runs', 'strikeRate', 'wickets', 'economy', 'matches'];
  const scored = keys.map((k) => ({
    key: k,
    score: normalizeStatForBar(k, aiCard.stats[k]),
  }));
  scored.sort((a, b) => b.score - a.score);

  // In Round 1, AI picks between top 2 stats occasionally; Round 2+ picks strictly strongest
  if (matchNumber === 1 && scored.length > 1 && scored[0].score - scored[1].score < 8 && Math.random() < 0.35) {
    return scored[1].key;
  }
  return scored[0].key;
}

export function compareDuelStat(
  stat: StatKey,
  userCard: DraftedPlayer,
  aiCard: DraftedPlayer
): { userValue: number; aiValue: number; winner: 'USER' | 'AI' | 'DRAW' } {
  const userValue = userCard.stats[stat];
  const aiValue = aiCard.stats[stat];

  if (userValue === aiValue) {
    return { userValue, aiValue, winner: 'DRAW' };
  }

  const higherWins = STAT_META[stat].higherIsBetter;
  const userWins = higherWins ? userValue > aiValue : userValue < aiValue;
  return {
    userValue,
    aiValue,
    winner: userWins ? 'USER' : 'AI',
  };
}

export function chooseAiShot(ballsRemaining: number, runsNeeded: number | null): ShotStyle {
  if (runsNeeded !== null) {
    const rpb = runsNeeded / Math.max(1, ballsRemaining);
    if (rpb > 2.0) return 'LOFTED';
    if (rpb < 1.0) return 'DEFEND';
    return Math.random() < 0.45 ? 'LOFTED' : 'BALANCED';
  }
  // 1st innings aggression
  const r = Math.random();
  if (ballsRemaining <= 4) return r < 0.65 ? 'LOFTED' : 'BALANCED';
  return r < 0.3 ? 'LOFTED' : r < 0.85 ? 'BALANCED' : 'DEFEND';
}

export function chooseAiDelivery(batter: DraftedPlayer, ballsRemaining: number): DeliveryType {
  const isPowerHitter = batter.stats.strikeRate >= 148;
  const r = Math.random();
  if (ballsRemaining <= 3) {
    return r < 0.48 ? 'YORKER' : r < 0.78 ? 'SLOWER' : 'BOUNCER';
  }
  if (isPowerHitter) {
    return r < 0.35 ? 'SLOWER' : r < 0.68 ? 'YORKER' : r < 0.85 ? 'SPIN' : 'BOUNCER';
  }
  const options: DeliveryType[] = ['YORKER', 'BOUNCER', 'SLOWER', 'SPIN'];
  return options[Math.floor(r * options.length)];
}

export function simulateBallOutcome(params: {
  batter: DraftedPlayer;
  bowler: DraftedPlayer;
  shot: ShotStyle;
  delivery: DeliveryType;
  overBall: string;
}): {
  outcome: BallOutcomeCode;
  runs: number;
  isWicket: boolean;
  commentary: string;
} {
  const { batter, bowler, shot, delivery, overBall } = params;

  // Base batter rating (around 0.8 to 1.25)
  const srFactor = Math.max(0.78, Math.min(1.32, batter.stats.strikeRate / 138));
  const batterRoleBoost =
    batter.role === 'Batter' || batter.role === 'Wicketkeeper'
      ? 1.08
      : batter.role === 'All-Rounder'
      ? 1.03
      : 0.72;
  const batterFormBoost = batter.inForm ? 1.15 : 1.0;
  const batPower = srFactor * batterRoleBoost * batterFormBoost;

  // Base bowler control rating (lower economy = stronger)
  const econFactor = Math.max(0.75, Math.min(1.3, 8.4 / Math.max(6.2, bowler.stats.economy)));
  const bowlerRoleBoost =
    bowler.role === 'Bowler' ? 1.12 : bowler.role === 'All-Rounder' ? 1.0 : 0.78;
  const bowlerFormBoost = bowler.inForm ? 1.15 : 1.0;
  const bowlControl = econFactor * bowlerRoleBoost * bowlerFormBoost;

  // Relative advantage (-0.4 to +0.4 approx)
  const edge = Math.max(-0.45, Math.min(0.45, batPower - bowlControl));

  // Base probability weights: [0, 1, 2, 4, 6, W]
  let w0 = 24;
  let w1 = 26;
  let w2 = 12;
  let w4 = 16;
  let w6 = 10;
  let wW = 12;

  if (shot === 'DEFEND') {
    w0 = 32;
    w1 = 36;
    w2 = 16;
    w4 = 11;
    w6 = 2;
    wW = 3;
  } else if (shot === 'BALANCED') {
    w0 = 22;
    w1 = 28;
    w2 = 14;
    w4 = 19;
    w6 = 9;
    wW = 8;
  } else if (shot === 'LOFTED') {
    w0 = 14;
    w1 = 12;
    w2 = 8;
    w4 = 24;
    w6 = 24;
    wW = 18;
  }

  // Delivery matchup modifiers
  if (delivery === 'YORKER') {
    w0 += 6;
    w1 += 4;
    w6 = Math.max(1, w6 - 6);
    wW += 3;
    if (shot === 'LOFTED') {
      wW += 4;
      w4 -= 4;
    }
  } else if (delivery === 'BOUNCER') {
    w0 += 4;
    wW += 4;
    if (shot === 'LOFTED') {
      w6 += 4;
      wW += 3;
    }
  } else if (delivery === 'SLOWER') {
    w1 += 3;
    if (shot === 'LOFTED') {
      wW += 6;
      w6 -= 4;
    } else if (shot === 'DEFEND') {
      w4 += 2;
    }
  } else if (delivery === 'SPIN') {
    w1 += 5;
    w2 += 2;
    if (shot === 'BALANCED') w4 += 2;
    if (shot === 'LOFTED') wW += 3;
  }

  // Apply batter vs bowler edge
  w4 = Math.max(3, w4 + edge * 18);
  w6 = Math.max(1, w6 + edge * 16);
  wW = Math.max(2, wW - edge * 14);
  w0 = Math.max(6, w0 - edge * 10);

  const total = w0 + w1 + w2 + w4 + w6 + wW;
  let roll = Math.random() * total;

  let outcome: BallOutcomeCode = '1';
  if ((roll -= w0) < 0) outcome = '0';
  else if ((roll -= w1) < 0) outcome = '1';
  else if ((roll -= w2) < 0) outcome = '2';
  else if ((roll -= w4) < 0) outcome = '4';
  else if ((roll -= w6) < 0) outcome = '6';
  else outcome = 'W';

  const runs = outcome === 'W' ? 0 : Number(outcome);
  const isWicket = outcome === 'W';

  const commentary = buildCommentary(overBall, batter.name, bowler.name, shot, delivery, outcome);
  return { outcome, runs, isWicket, commentary };
}

function buildCommentary(
  overBall: string,
  batter: string,
  bowler: string,
  shot: ShotStyle,
  delivery: DeliveryType,
  outcome: BallOutcomeCode
): string {
  const delName =
    delivery === 'YORKER'
      ? 'crushing yorker'
      : delivery === 'BOUNCER'
      ? 'sharp bouncer'
      : delivery === 'SLOWER'
      ? 'disguised slower ball'
      : 'tossed-up spinner';

  const bLast = batter.split(' ').slice(-1)[0];
  const bwLast = bowler.split(' ').slice(-1)[0];

  switch (outcome) {
    case '6':
      return `${overBall} · ${bwLast} to ${bLast} — SIX! Launched into the upper tier off a ${delName}!`;
    case '4':
      return `${overBall} · ${bwLast} to ${bLast} — FOUR! Pierces the gap cleanly against the ${delName}.`;
    case '2':
      return `${overBall} · ${bwLast} to ${bLast} — 2 runs! Sharp running between the wickets.`;
    case '1':
      return `${overBall} · ${bwLast} to ${bLast} — 1 run, tucked away to rotate the strike.`;
    case '0':
      return `${overBall} · ${bwLast} to ${bLast} — Dot ball! Tight ${delName} beats the ${shot.toLowerCase()} stroke.`;
    case 'W':
      return `${overBall} · ${bwLast} to ${bLast} — WICKET! ${delName.charAt(0).toUpperCase() + delName.slice(1)} sends ${bLast} back to the dugout!`;
  }
}
