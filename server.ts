import crypto from 'crypto';
import 'dotenv/config';
import { GoogleGenAI, Modality } from '@google/genai';
import type { LiveServerMessage } from '@google/genai';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { IPL_FRANCHISES, IPL_PLAYERS_DB } from './src/data/iplData.ts';
import { PLAYER_PHOTO_URLS } from './src/data/playerPhotos.ts';
import type {
  BatterMatchStats,
  BowlerMatchStats,
  DeliveryType,
  DraftedPlayer,
  DuelRecord,
  IPLPlayer,
  ShotStyle,
  StatKey,
} from './src/types/game.ts';
import type {
  ClientMessage,
  RoomMatchup,
  RoomParticipant,
  RoomState,
  ServerMessage,
} from './src/types/multiplayer.ts';
import {
  autoFillTeamSquad,
  chooseAiBestStat,
  chooseAiDelivery,
  chooseAiShot,
  compareDuelStat,
  getMaxAllowedBid,
  roundHalf,
  simulateBallOutcome,
  sortPoolIntoIplSets,
} from './src/utils/engine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INITIAL_PURSE = 120.0;
const SEASON_GRANT = 80.0;
const PORT = Number(process.env.PORT) || 3000;

const rawGeminiKey = (process.env.GEMINI_API_KEY || '').trim();
const geminiApiKey =
  rawGeminiKey && rawGeminiKey !== 'MY_GEMINI_API_KEY' ? rawGeminiKey : '';
const genaiClient = geminiApiKey
  ? new GoogleGenAI({
      apiKey: geminiApiKey,
      apiVersion: 'v1beta',
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    })
  : null;

type AuctioneerVoiceId = 'Kore' | 'Zephyr';

const VOICE_STYLE_PROMPTS: Record<AuctioneerVoiceId, string> = {
  Kore: 'Sweet, warm, clear, poised, and professional female Indian cricket auctioneer speaking smoothly with crisp diction and a pleasant smile',
  Zephyr:
    'Bright, sweet, melodic, clear, and articulate female sports presenter speaking gracefully and professionally',
};

const ttsWavCache = new Map<string, string>();
const ttsInFlight = new Map<string, { promise: Promise<TtsResult>; waiters: number }>();
const TTS_DISK_CACHE_DIR = path.resolve(__dirname, '.cache/tts');
const ttsRecentTimestamps: number[] = [];
let ttsCooldownUntil = 0;

interface TtsResult {
  audioBase64: string | null;
  status: 'ok' | 'unconfigured' | 'rate_limited' | 'error';
  retryAfterMs?: number;
}

function getCacheFilePath(cacheKey: string): string {
  const hash = crypto.createHash('sha1').update(cacheKey).digest('hex');
  return path.join(TTS_DISK_CACHE_DIR, `${hash}.wav.b64`);
}

function getCachedTts(key: string): string | undefined {
  const hit = ttsWavCache.get(key);
  if (hit) {
    ttsWavCache.delete(key);
    ttsWavCache.set(key, hit);
    return hit;
  }
  try {
    const filePath = getCacheFilePath(key);
    if (fs.existsSync(filePath)) {
      const diskHit = fs.readFileSync(filePath, 'utf8').trim();
      if (diskHit) {
        setCachedTts(key, diskHit, false);
        return diskHit;
      }
    }
  } catch {
    // ignore disk cache read errors
  }
  return undefined;
}

function setCachedTts(key: string, base64Wav: string, persist = true) {
  if (ttsWavCache.size >= 200) {
    const oldestKey = ttsWavCache.keys().next().value;
    if (oldestKey) ttsWavCache.delete(oldestKey);
  }
  ttsWavCache.set(key, base64Wav);
  if (persist) {
    try {
      fs.mkdirSync(TTS_DISK_CACHE_DIR, { recursive: true });
      fs.writeFileSync(getCacheFilePath(key), base64Wav, 'utf8');
    } catch {
      // ignore disk cache write errors
    }
  }
}

function parseRetryDelayMs(errMsg: string): number {
  const secMatch = errMsg.match(/retryDelay["']?\s*:\s*["']?(\d+)s/i);
  if (secMatch) {
    const secs = Number(secMatch[1]);
    if (Number.isFinite(secs) && secs > 0) {
      return Math.min(3_600_000, Math.max(30_000, secs * 1000));
    }
  }
  if (/PerDay/i.test(errMsg)) {
    return 3_600_000;
  }
  return 60_000;
}

let liveTtsCooldownUntil = 0;

const liveQueueByVoice = new Map<AuctioneerVoiceId, Promise<unknown>>();

interface LiveTurnResolver {
  chunks: Buffer[];
  resolve: (res: TtsResult) => void;
  timer: NodeJS.Timeout;
  cacheKey: string;
}

interface PooledLiveSession {
  session: { close: () => void; sendClientContent: (p: unknown) => void };
  turnsUsed: number;
  activeTurn: LiveTurnResolver | null;
  idleTimer: NodeJS.Timeout | null;
}

const pooledLiveSessions = new Map<AuctioneerVoiceId, PooledLiveSession>();

function wrapPcm24kToWav(pcmBuffer: Buffer): Buffer {
  const numChannels = 1;
  const sampleRate = 24000;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

function closePooledLiveSession(voiceName: AuctioneerVoiceId) {
  const entry = pooledLiveSessions.get(voiceName);
  if (!entry) return;
  pooledLiveSessions.delete(voiceName);
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  if (entry.activeTurn) {
    const turn = entry.activeTurn;
    entry.activeTurn = null;
    clearTimeout(turn.timer);
    if (turn.chunks.length > 0) {
      const wav = wrapPcm24kToWav(Buffer.concat(turn.chunks)).toString('base64');
      setCachedTts(turn.cacheKey, wav);
      turn.resolve({ audioBase64: wav, status: 'ok' });
    } else {
      turn.resolve({ audioBase64: null, status: 'error' });
    }
  }
  try {
    entry.session.close();
  } catch {
    // ignore close errors
  }
}

async function getOrCreatePooledLiveSession(
  voiceName: AuctioneerVoiceId
): Promise<PooledLiveSession | null> {
  if (!genaiClient) return null;
  const existing = pooledLiveSessions.get(voiceName);
  if (existing && existing.turnsUsed < 8) {
    if (existing.idleTimer) clearTimeout(existing.idleTimer);
    return existing;
  }
  if (existing) {
    closePooledLiveSession(voiceName);
  }

  const speakerInstruction =
    voiceName === 'Zephyr'
      ? 'You are Meera, a bright, sweet, crystal-clear, poised female IPL cricket auctioneer. Speak ONLY the exact text given by the user, verbatim, clearly and naturally with warm broadcast diction. Never add extra words or long pauses.'
      : 'You are Ananya, a warm, sweet, clear, poised female Indian IPL cricket auctioneer. Speak ONLY the exact text given by the user, verbatim, clearly and naturally with warm broadcast diction. Never add extra words or long pauses.';

  let entryRef: PooledLiveSession | null = null;

  const session = await Promise.race([
    genaiClient.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
        systemInstruction: speakerInstruction,
      },
      callbacks: {
      onmessage: (message: LiveServerMessage) => {
        if (!entryRef || !entryRef.activeTurn) return;
        const turn = entryRef.activeTurn;
        const parts = message.serverContent?.modelTurn?.parts ?? [];
        for (const part of parts) {
          if (part.inlineData?.data) {
            turn.chunks.push(Buffer.from(part.inlineData.data, 'base64'));
          }
        }
        if (message.serverContent?.turnComplete) {
          entryRef.activeTurn = null;
          clearTimeout(turn.timer);
          if (turn.chunks.length > 0) {
            const wav = wrapPcm24kToWav(Buffer.concat(turn.chunks)).toString('base64');
            setCachedTts(turn.cacheKey, wav);
            turn.resolve({ audioBase64: wav, status: 'ok' });
          } else {
            turn.resolve({ audioBase64: null, status: 'error' });
          }
        }
      },
      onerror: (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
          liveTtsCooldownUntil = Date.now() + 300_000;
        }
        closePooledLiveSession(voiceName);
      },
        onclose: () => {
          closePooledLiveSession(voiceName);
        },
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Gemini Live connect timeout')), 5000)
    ),
  ]);

  entryRef = {
    session: session as unknown as {
      close: () => void;
      sendClientContent: (p: unknown) => void;
    },
    turnsUsed: 0,
    activeTurn: null,
    idleTimer: null,
  };
  pooledLiveSessions.set(voiceName, entryRef);
  return entryRef;
}

async function synthesizeViaLiveSession(
  text: string,
  voiceName: AuctioneerVoiceId,
  hasActiveWaiters: () => boolean
): Promise<TtsResult> {
  if (!genaiClient) return { audioBase64: null, status: 'unconfigured' };
  const now = Date.now();
  if (now < liveTtsCooldownUntil) {
    return {
      audioBase64: null,
      status: 'rate_limited',
      retryAfterMs: liveTtsCooldownUntil - now,
    };
  }

  const prevTask = liveQueueByVoice.get(voiceName) ?? Promise.resolve();
  const runTask = prevTask.then(async (): Promise<TtsResult> => {
    const cacheKey = `${voiceName}:${text}`;
    const cached = getCachedTts(cacheKey);
    if (cached) return { audioBase64: cached, status: 'ok' };

    if (!hasActiveWaiters()) {
      return { audioBase64: null, status: 'error' };
    }

    try {
      const entry = await getOrCreatePooledLiveSession(voiceName);
      if (!entry || !hasActiveWaiters()) return { audioBase64: null, status: 'error' };

      return await new Promise<TtsResult>((resolve) => {
        const timer = setTimeout(() => {
          if (entry.activeTurn) {
            const turn = entry.activeTurn;
            entry.activeTurn = null;
            if (turn.chunks.length > 0) {
              const wav = wrapPcm24kToWav(Buffer.concat(turn.chunks)).toString('base64');
              setCachedTts(turn.cacheKey, wav);
              resolve({ audioBase64: wav, status: 'ok' });
              return;
            }
          }
          closePooledLiveSession(voiceName);
          resolve({ audioBase64: null, status: 'error' });
        }, 5500);

        entry.activeTurn = { chunks: [], resolve, timer, cacheKey };
        entry.turnsUsed += 1;
        entry.idleTimer = setTimeout(() => closePooledLiveSession(voiceName), 45_000);

        entry.session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text }] }],
          turnComplete: true,
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      closePooledLiveSession(voiceName);
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
        liveTtsCooldownUntil = Date.now() + 300_000;
        return { audioBase64: null, status: 'rate_limited', retryAfterMs: 300_000 };
      }
      return { audioBase64: null, status: 'error' };
    }
  });

  liveQueueByVoice.set(voiceName, runTask.catch(() => null));
  return runTask;
}

async function synthesizeAuctioneerSpeech(
  rawText: string,
  voiceName: AuctioneerVoiceId = 'Kore',
  signal?: AbortSignal
): Promise<TtsResult> {
  if (!genaiClient) return { audioBase64: null, status: 'unconfigured' };
  const text = rawText.trim().slice(0, 280);
  if (!text) return { audioBase64: null, status: 'error' };

  const cacheKey = `${voiceName}:${text}`;
  const cached = getCachedTts(cacheKey);
  if (cached) return { audioBase64: cached, status: 'ok' };

  if (signal?.aborted) {
    return { audioBase64: null, status: 'error' };
  }

  let entry = ttsInFlight.get(cacheKey);
  if (!entry) {
    const record = {
      waiters: 0,
      promise: Promise.resolve<TtsResult>({ audioBase64: null, status: 'error' }),
    };

    record.promise = (async () => {
      try {
        // Use pooled Gemini Live native audio voice (gemini-3.8-live) directly for consistent ~2-3.5s female studio audio
        return await synthesizeViaLiveSession(text, voiceName, () => record.waiters > 0);
      } finally {
        ttsInFlight.delete(cacheKey);
      }
    })();

    entry = record;
    ttsInFlight.set(cacheKey, entry);
  }

  entry.waiters += 1;
  const onAbort = () => {
    if (entry && entry.waiters > 0) {
      entry.waiters -= 1;
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    return await entry.promise;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!signal?.aborted && entry.waiters > 0) {
      entry.waiters -= 1;
    }
  }
}

interface ConnectedClient {
  ws: WebSocket;
  clientId: string;
  roomCode: string | null;
}

const rooms = new Map<string, RoomState>();
const roomTimers = new Map<string, NodeJS.Timeout>();
const clients = new Map<WebSocket, ConnectedClient>();

function generateRoomCode(): string {
  const prefixes = ['IPL', 'CSK', 'RCB', 'KKR', 'SRH', 'MUM', 'DEL', 'GTN'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const num = Math.floor(10 + Math.random() * 89);
  const code = `${prefix}${num}`;
  return rooms.has(code) ? generateRoomCode() : code;
}

function sendToClient(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastRoom(room: RoomState, extra?: ServerMessage) {
  for (const [, client] of clients) {
    if (client.roomCode === room.roomCode) {
      sendToClient(client.ws, { type: 'room:state', room });
      if (extra) {
        sendToClient(client.ws, extra);
      }
    }
  }
}

function broadcastVoice(room: RoomState, text: string, priority: 'high' | 'normal' = 'normal') {
  for (const [, client] of clients) {
    if (client.roomCode === room.roomCode) {
      sendToClient(client.ws, { type: 'room:voice', text, priority });
    }
  }
}

function getFranchiseName(id: string): string {
  return IPL_FRANCHISES.find((f) => f.id === id)?.name || id;
}

function addAuctionLog(
  room: RoomState,
  text: string,
  tone: 'bid' | 'sold' | 'unsold' | 'rtm' | 'info'
) {
  if (!room.auction) return;
  room.auction.logs.unshift({
    id: `${Date.now()}-${Math.random()}`,
    text,
    tone,
  });
  if (room.auction.logs.length > 25) {
    room.auction.logs.length = 25;
  }
}

function startAuctionTimer(roomCode: string) {
  stopAuctionTimer(roomCode);
  const timer = setInterval(() => {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'AUCTION' || !room.auction) {
      stopAuctionTimer(roomCode);
      return;
    }

    const auc = room.auction;
    if (auc.soldBanner || auc.rtmPrompt) return;

    const currentPlayer = auc.queue[auc.currentIndex];
    if (!currentPlayer) return;

    auc.countdownMs = Math.max(0, auc.countdownMs - 200);

    if (!auc.highestBidderId) {
      if (auc.countdownMs === 10000) {
        broadcastVoice(room, 'Going once!');
      } else if (auc.countdownMs === 5000) {
        broadcastVoice(room, 'Going twice!');
      } else if (auc.countdownMs === 2000) {
        broadcastVoice(room, 'Going thrice!');
      }
    } else {
      if (auc.countdownMs === 4400) {
        broadcastVoice(room, 'Going once!');
      } else if (auc.countdownMs === 2600) {
        broadcastVoice(room, 'Going twice!');
      } else if (auc.countdownMs === 1200) {
        broadcastVoice(room, 'Going thrice!');
      }
    }

    if (auc.countdownMs === 0) {
      resolveCurrentLot(room);
    } else {
      broadcastRoom(room);
    }
  }, 200);

  roomTimers.set(roomCode, timer);
}

function stopAuctionTimer(roomCode: string) {
  const existing = roomTimers.get(roomCode);
  if (existing) {
    clearInterval(existing);
    roomTimers.delete(roomCode);
  }
}

function startNextLotOrFinishAuction(room: RoomState) {
  if (!room.auction) return;
  const humans = room.participants.filter((p) => !p.isAi);
  const allFull = humans.every((p) => p.squad.length >= room.squadSize);

  if (allFull) {
    transitionRoomToCardBattle(room);
    return;
  }

  const auc = room.auction;
  if (auc.currentIndex + 1 < auc.queue.length) {
    auc.currentIndex += 1;
  } else {
    // Accelerated clearance round for unsold players
    const draftedIds = new Set<string>();
    humans.forEach((p) => p.squad.forEach((sp) => draftedIds.add(sp.id)));
    const remaining = sortPoolIntoIplSets(
      IPL_PLAYERS_DB.filter((p) => !draftedIds.has(p.id)).map((p) => ({
        ...p,
        basePrice: 1.0,
      }))
    );
    if (remaining.length === 0) {
      transitionRoomToCardBattle(room);
      return;
    }
    auc.queue = remaining;
    auc.currentIndex = 0;
    addAuctionLog(room, 'Accelerated Clearance Round: Remaining players at ₹1.00 Cr base.', 'info');
  }

  const nextPlayer = auc.queue[auc.currentIndex];
  auc.currentBid = nextPlayer.basePrice;
  auc.highestBidderId = null;
  auc.passedClientIds = [];
  auc.countdownMs = 15000;
  auc.soldBanner = null;
  auc.rtmPrompt = null;

  broadcastRoom(room);
  broadcastVoice(
    room,
    `Next up, ${nextPlayer.name}. Base ${nextPlayer.basePrice} crore.`
  );
}

function commitLotSale(
  room: RoomState,
  player: IPLPlayer,
  winnerClientId: string | 'UNSOLD',
  price: number
) {
  if (!room.auction) return;
  const auc = room.auction;

  if (winnerClientId === 'UNSOLD') {
    auc.soldBanner = {
      playerName: player.name,
      winnerClientId: 'UNSOLD',
      winnerFranchiseId: 'UNSOLD',
      winnerName: 'UNSOLD',
      price: 0,
    };
    addAuctionLog(room, `${player.name} — UNSOLD`, 'unsold');
    broadcastRoom(room);
    broadcastVoice(room, `${player.name}, unsold!`, 'high');
  } else {
    const winner = room.participants.find((p) => p.clientId === winnerClientId);
    if (winner) {
      winner.squad.push({ ...player, boughtPrice: price, inForm: false });
      winner.purse = roundHalf(Math.max(0, winner.purse - price));
      auc.soldBanner = {
        playerName: player.name,
        winnerClientId: winner.clientId,
        winnerFranchiseId: winner.franchiseId,
        winnerName: winner.name,
        price,
      };
      addAuctionLog(
        room,
        `SOLD! ${player.name} to ${winner.name} (${winner.franchiseId}) for ₹${price.toFixed(2)} Cr`,
        'sold'
      );
      broadcastRoom(room);
      broadcastVoice(
        room,
        `Sold! ${player.name} to ${winner.franchiseId}, ${price} crore!`,
        'high'
      );
    }
  }

  setTimeout(() => {
    const r = rooms.get(room.roomCode);
    if (r && r.phase === 'AUCTION') {
      startNextLotOrFinishAuction(r);
    }
  }, 2400);
}

function resolveCurrentLot(room: RoomState) {
  if (!room.auction) return;
  const auc = room.auction;
  const player = auc.queue[auc.currentIndex];
  if (!player || auc.soldBanner || auc.rtmPrompt) return;

  if (!auc.highestBidderId) {
    commitLotSale(room, player, 'UNSOLD', 0);
    return;
  }

  // Check if a different friend in the room owns this player's IPL franchise & has RTM available
  const rtmCandidate = room.participants.find(
    (p) =>
      !p.isAi &&
      p.clientId !== auc.highestBidderId &&
      p.rtmAvailable &&
      p.franchiseId === player.iplTeam &&
      p.squad.length < room.squadSize &&
      auc.currentBid <= getMaxAllowedBid(p.purse, p.squad.length, room.squadSize)
  );

  if (rtmCandidate) {
    auc.rtmPrompt = {
      player,
      targetClientId: rtmCandidate.clientId,
      winningClientId: auc.highestBidderId,
      winningFranchiseId:
        room.participants.find((p) => p.clientId === auc.highestBidderId)?.franchiseId || '',
      price: auc.currentBid,
    };
    broadcastRoom(room);
    broadcastVoice(
      room,
      `Right to match available for ${getFranchiseName(rtmCandidate.franchiseId)}!`,
      'high'
    );
    return;
  }

  commitLotSale(room, player, auc.highestBidderId, auc.currentBid);
}

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

function pickBestBatters(squad: DraftedPlayer[]): DraftedPlayer[] {
  return [...squad].sort((a, b) => b.stats.strikeRate - a.stats.strikeRate);
}

function pickBestBowlers(squad: DraftedPlayer[]): DraftedPlayer[] {
  return [...squad].sort((a, b) => a.stats.economy - b.stats.economy);
}

function transitionRoomToCardBattle(room: RoomState) {
  stopAuctionTimer(room.roomCode);
  room.auction = null;
  room.phase = 'CARD_BATTLE';

  // Remove any previous AI filler
  room.participants = room.participants.filter((p) => !p.isAi);

  // If odd number of friends, add 1 AI Rival Bot with auto-drafted squad
  const humans = [...room.participants];
  if (humans.length % 2 === 1) {
    const takenFranchises = new Set(humans.map((h) => h.franchiseId));
    const aiFranchise =
      IPL_FRANCHISES.find((f) => !takenFranchises.has(f.id)) || IPL_FRANCHISES[0];
    const draftedIds = new Set<string>();
    humans.forEach((h) => h.squad.forEach((p) => draftedIds.add(p.id)));
    const pool = IPL_PLAYERS_DB.filter((p) => !draftedIds.has(p.id));
    const aiFill = autoFillTeamSquad([], INITIAL_PURSE, room.squadSize, pool, false);
    room.participants.push({
      clientId: 'AI_BOT',
      name: `${aiFranchise.shortName} AI Bot`,
      franchiseId: aiFranchise.id,
      isHost: false,
      isAi: true,
      connected: true,
      purse: aiFill.remainingPurse,
      squad: aiFill.squad,
      previousSquad: [],
      retentionConfirmed: true,
      rtmAvailable: false,
      wins: 0,
      matchesPlayed: 0,
      lastEarned: 0,
    });
  }

  // Pair participants into 1v1 matchups
  const matchups: RoomMatchup[] = [];
  for (let i = 0; i < room.participants.length; i += 2) {
    const home = room.participants[i];
    const away = room.participants[i + 1];
    matchups.push({
      id: `matchup-${i / 2 + 1}`,
      homeClientId: home.clientId,
      awayClientId: away.clientId,
      roundIdx: 0,
      duels: [],
      activeDuelResult: null,
      homeBonusRuns: 0,
      awayBonusRuns: 0,
      homeDuelsWon: 0,
      awayDuelsWon: 0,
      tossComplete: false,
      tossWinnerClientId: null,
      battingFirstClientId: null,
      inningsNum: 1,
      battingClientId: home.clientId,
      bowlingClientId: away.clientId,
      inningsBreak: false,
      innings1Runs: 0,
      innings1Wickets: 0,
      innings1Balls: 0,
      runs: 0,
      wickets: 0,
      ballsBowled: 0,
      batterStats: {},
      bowlerStats: {},
      ballLog: [],
      activeBatterId: '',
      over1BowlerId: '',
      over2BowlerId: '',
      needsNewBatter: false,
      pendingShot: null,
      pendingDelivery: null,
      matchComplete: false,
      winnerClientId: null,
      winMarginText: '',
      homeEarned: 0,
      awayEarned: 0,
    });
  }

  room.matchups = matchups;
  broadcastRoom(room);
  broadcastVoice(room, 'Auction complete! Moving to the Card Stat Battle.', 'high');
}

function startMiniMatchForMatchup(room: RoomState, matchup: RoomMatchup, battingFirstId: string) {
  const home = room.participants.find((p) => p.clientId === matchup.homeClientId)!;
  const away = room.participants.find((p) => p.clientId === matchup.awayClientId)!;

  matchup.tossComplete = true;
  matchup.battingFirstClientId = battingFirstId;
  matchup.inningsNum = 1;
  matchup.battingClientId = battingFirstId;
  matchup.bowlingClientId = battingFirstId === home.clientId ? away.clientId : home.clientId;
  matchup.inningsBreak = false;

  const battingSide = matchup.battingClientId === home.clientId ? home : away;
  const bowlingSide = matchup.bowlingClientId === home.clientId ? home : away;
  const startBonus =
    matchup.battingClientId === home.clientId ? matchup.homeBonusRuns : matchup.awayBonusRuns;

  matchup.runs = startBonus;
  matchup.wickets = 0;
  matchup.ballsBowled = 0;
  matchup.batterStats = initBatterStats(battingSide.squad);
  matchup.bowlerStats = initBowlerStats(bowlingSide.squad);
  matchup.ballLog = [];
  matchup.activeBatterId = pickBestBatters(battingSide.squad)[0]?.id || '';
  const bowlers = pickBestBowlers(bowlingSide.squad);
  matchup.over1BowlerId = bowlers[0]?.id || '';
  matchup.over2BowlerId = bowlers[1]?.id || bowlers[0]?.id || '';
  matchup.needsNewBatter = false;
  matchup.pendingShot = null;
  matchup.pendingDelivery = null;

  // Check if all matchups have finished Toss -> move room phase to MINI_MATCH
  if (room.matchups.every((m) => m.tossComplete)) {
    room.phase = 'MINI_MATCH';
  }

  broadcastRoom(room);
  maybeTriggerAiMatchAction(room, matchup);
}

function maybeTriggerAiCardBattle(room: RoomState, matchup: RoomMatchup) {
  const away = room.participants.find((p) => p.clientId === matchup.awayClientId);
  if (!away || !away.isAi) return;

  const chooserId =
    matchup.roundIdx % 2 === 0 ? matchup.homeClientId : matchup.awayClientId;

  if (!matchup.activeDuelResult && chooserId === away.clientId) {
    setTimeout(() => {
      const r = rooms.get(room.roomCode);
      if (!r || r.phase !== 'CARD_BATTLE') return;
      const m = r.matchups.find((x) => x.id === matchup.id);
      if (!m || m.activeDuelResult) return;
      const aiCard = away.squad[m.roundIdx];
      if (!aiCard) return;
      const stat = chooseAiBestStat(aiCard, r.matchNumber);
      applyDuelStat(r, m, away.clientId, stat);
    }, 650);
  }
}

function applyDuelStat(
  room: RoomState,
  matchup: RoomMatchup,
  chooserClientId: string,
  stat: StatKey
) {
  if (matchup.activeDuelResult) return;
  const home = room.participants.find((p) => p.clientId === matchup.homeClientId);
  const away = room.participants.find((p) => p.clientId === matchup.awayClientId);
  if (!home || !away) return;

  const homeCard = home.squad[matchup.roundIdx];
  const awayCard = away.squad[matchup.roundIdx];
  if (!homeCard || !awayCard) return;

  const comp = compareDuelStat(stat, homeCard, awayCard);
  if (comp.winner === 'USER') {
    homeCard.inForm = true;
    matchup.homeBonusRuns += 2;
    matchup.homeDuelsWon += 1;
  } else if (comp.winner === 'AI') {
    awayCard.inForm = true;
    matchup.awayBonusRuns += 2;
    matchup.awayDuelsWon += 1;
  } else {
    matchup.homeBonusRuns += 1;
    matchup.awayBonusRuns += 1;
  }

  const record: DuelRecord = {
    round: matchup.roundIdx + 1,
    userPlayer: homeCard,
    aiPlayer: awayCard,
    chosenStat: stat,
    chooser: chooserClientId === home.clientId ? 'USER' : 'AI',
    userValue: comp.userValue,
    aiValue: comp.aiValue,
    winner: comp.winner,
  };

  matchup.activeDuelResult = record;
  matchup.duels.push(record);
  broadcastRoom(room);
}

function maybeTriggerAiMatchAction(room: RoomState, matchup: RoomMatchup) {
  if (matchup.matchComplete || matchup.inningsBreak) return;
  const batting = room.participants.find((p) => p.clientId === matchup.battingClientId);
  const bowling = room.participants.find((p) => p.clientId === matchup.bowlingClientId);
  if (!batting || !bowling) return;

  const target = matchup.inningsNum === 2 ? matchup.innings1Runs + 1 : null;
  const ballsLeft = 12 - matchup.ballsBowled;

  if (batting.isAi && !matchup.pendingShot) {
    matchup.pendingShot = chooseAiShot(
      ballsLeft,
      target !== null ? target - matchup.runs : null
    );
  }
  if (bowling.isAi && !matchup.pendingDelivery) {
    const activeBatter =
      batting.squad.find((p) => p.id === matchup.activeBatterId) || batting.squad[0];
    matchup.pendingDelivery = chooseAiDelivery(activeBatter, ballsLeft);
  }

  if (matchup.pendingShot && matchup.pendingDelivery) {
    resolveMatchBall(room, matchup);
  }
}

function resolveMatchBall(room: RoomState, matchup: RoomMatchup) {
  if (!matchup.pendingShot || !matchup.pendingDelivery || matchup.inningsBreak || matchup.matchComplete) {
    return;
  }

  const home = room.participants.find((p) => p.clientId === matchup.homeClientId)!;
  const away = room.participants.find((p) => p.clientId === matchup.awayClientId)!;
  const battingSide = matchup.battingClientId === home.clientId ? home : away;
  const bowlingSide = matchup.bowlingClientId === home.clientId ? home : away;

  const batter =
    battingSide.squad.find((p) => p.id === matchup.activeBatterId) || battingSide.squad[0];
  const currentOver = matchup.ballsBowled < 6 ? 1 : 2;
  const bowlerId = currentOver === 1 ? matchup.over1BowlerId : matchup.over2BowlerId;
  const bowler = bowlingSide.squad.find((p) => p.id === bowlerId) || bowlingSide.squad[0];

  const nextBallNum = matchup.ballsBowled + 1;
  const overBall = `${Math.floor(matchup.ballsBowled / 6)}.${(matchup.ballsBowled % 6) + 1}`;

  const sim = simulateBallOutcome({
    batter,
    bowler,
    shot: matchup.pendingShot,
    delivery: matchup.pendingDelivery,
    overBall,
  });

  matchup.runs += sim.runs;
  if (sim.isWicket) matchup.wickets += 1;
  matchup.ballsBowled = nextBallNum;

  const bStat = matchup.batterStats[batter.id];
  if (bStat) {
    bStat.runs += sim.runs;
    bStat.balls += 1;
    if (sim.outcome === '4') bStat.fours += 1;
    if (sim.outcome === '6') bStat.sixes += 1;
    if (sim.isWicket) bStat.out = true;
  }

  const bwStat = matchup.bowlerStats[bowler.id];
  if (bwStat) {
    bwStat.balls += 1;
    bwStat.runsConceded += sim.runs;
    if (sim.isWicket) bwStat.wickets += 1;
  }

  matchup.ballLog.unshift({
    id: `${matchup.inningsNum}-${nextBallNum}-${Math.random()}`,
    innings: matchup.inningsNum,
    overBall,
    batterName: batter.name,
    bowlerName: bowler.name,
    shotOrDelivery: `${matchup.pendingShot} vs ${matchup.pendingDelivery}`,
    outcome: sim.outcome,
    runs: sim.runs,
    isWicket: sim.isWicket,
    commentary: sim.commentary,
  });

  matchup.pendingShot = null;
  matchup.pendingDelivery = null;

  const maxWickets = room.squadSize - 1;
  const allOut = matchup.wickets >= maxWickets;
  const oversComplete = nextBallNum >= 12;
  const target = matchup.inningsNum === 2 ? matchup.innings1Runs + 1 : null;
  const chased = target !== null && matchup.runs >= target;

  if (matchup.inningsNum === 1 && (allOut || oversComplete)) {
    matchup.innings1Runs = matchup.runs;
    matchup.innings1Wickets = matchup.wickets;
    matchup.innings1Balls = nextBallNum;
    matchup.inningsBreak = true;
    broadcastRoom(room);
    return;
  }

  if (matchup.inningsNum === 2 && (chased || allOut || oversComplete)) {
    // Decide winner (handle exact tie cleanly via duel bonus / home advantage tiebreaker)
    let winnerId: string;
    let margin = '';
    if (matchup.runs > matchup.innings1Runs) {
      winnerId = matchup.battingClientId;
      margin = `Won by ${maxWickets - matchup.wickets} wicket${maxWickets - matchup.wickets === 1 ? '' : 's'}`;
    } else if (matchup.runs < matchup.innings1Runs) {
      winnerId = matchup.bowlingClientId;
      margin = `Won by ${matchup.innings1Runs - matchup.runs} run${matchup.innings1Runs - matchup.runs === 1 ? '' : 's'}`;
    } else {
      winnerId =
        matchup.homeDuelsWon >= matchup.awayDuelsWon ? home.clientId : away.clientId;
      margin = 'Match Tied — Decided on Card Duel Count!';
    }

    matchup.matchComplete = true;
    matchup.winnerClientId = winnerId;
    matchup.winMarginText = margin;

    const sweepThreshold = room.squadSize >= 11 ? 8 : 5;
    const homeWon = winnerId === home.clientId;
    const homeSweep = matchup.homeDuelsWon >= sweepThreshold ? 3.0 : 0;
    const awaySweep = matchup.awayDuelsWon >= sweepThreshold ? 3.0 : 0;

    matchup.homeEarned = (homeWon ? 12.0 : 4.0) + homeSweep;
    matchup.awayEarned = (!homeWon ? 12.0 : 4.0) + awaySweep;

    home.purse = roundHalf(home.purse + matchup.homeEarned);
    away.purse = roundHalf(away.purse + matchup.awayEarned);
    home.matchesPlayed += 1;
    away.matchesPlayed += 1;
    home.lastEarned = matchup.homeEarned;
    away.lastEarned = matchup.awayEarned;
    if (homeWon) home.wins += 1;
    else away.wins += 1;

    if (room.matchups.every((m) => m.matchComplete)) {
      room.phase = 'POST_MATCH';
    }
    broadcastRoom(room);
    return;
  }

  if (sim.isWicket && !allOut) {
    const nextBatter = pickBestBatters(battingSide.squad).find(
      (p) => !matchup.batterStats[p.id]?.out
    );
    if (nextBatter) {
      matchup.activeBatterId = nextBatter.id;
      if (!battingSide.isAi) {
        matchup.needsNewBatter = true;
      }
    }
  }

  broadcastRoom(room);
  maybeTriggerAiMatchAction(room, matchup);
}

function handleMessage(ws: WebSocket, raw: string) {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    return;
  }

  const clientInfo = clients.get(ws);
  if (!clientInfo) return;

  if (msg.type === 'room:create') {
    const roomCode = generateRoomCode();
    clientInfo.clientId = msg.clientId;
    clientInfo.roomCode = roomCode;

    const newRoom: RoomState = {
      roomCode,
      matchNumber: 1,
      squadSize: msg.squadSize,
      phase: 'LOBBY',
      participants: [
        {
          clientId: msg.clientId,
          name: msg.playerName.trim() || 'Host',
          franchiseId: msg.franchiseId,
          isHost: true,
          isAi: false,
          connected: true,
          purse: INITIAL_PURSE,
          squad: [],
          previousSquad: [],
          retentionConfirmed: true,
          rtmAvailable: true,
          wins: 0,
          matchesPlayed: 0,
          lastEarned: 0,
        },
      ],
      auction: null,
      matchups: [],
      announcement: null,
    };

    rooms.set(roomCode, newRoom);
    sendToClient(ws, { type: 'room:state', room: newRoom });
    return;
  }

  if (msg.type === 'room:join') {
    const code = msg.roomCode.trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      sendToClient(ws, { type: 'room:error', message: `Room ${code} not found.` });
      return;
    }

    clientInfo.clientId = msg.clientId;
    clientInfo.roomCode = code;

    const existing = room.participants.find((p) => p.clientId === msg.clientId);
    if (existing) {
      existing.connected = true;
      broadcastRoom(room);
      return;
    }

    if (room.phase !== 'LOBBY') {
      sendToClient(ws, {
        type: 'room:error',
        message: 'This room has already started the auction.',
      });
      return;
    }

    if (room.participants.length >= 10) {
      sendToClient(ws, { type: 'room:error', message: 'Room is full (max 10 franchises).' });
      return;
    }

    const takenFranchises = new Set(room.participants.map((p) => p.franchiseId));
    let chosenFranchise = msg.franchiseId;
    if (takenFranchises.has(chosenFranchise)) {
      const avail = IPL_FRANCHISES.find((f) => !takenFranchises.has(f.id));
      if (avail) chosenFranchise = avail.id;
    }

    room.participants.push({
      clientId: msg.clientId,
      name: msg.playerName.trim() || `Player ${room.participants.length + 1}`,
      franchiseId: chosenFranchise,
      isHost: false,
      isAi: false,
      connected: true,
      purse: INITIAL_PURSE,
      squad: [],
      previousSquad: [],
      retentionConfirmed: true,
      rtmAvailable: true,
      wins: 0,
      matchesPlayed: 0,
      lastEarned: 0,
    });

    broadcastRoom(room);
    return;
  }

  if (msg.type === 'room:reconnect') {
    const room = rooms.get(msg.roomCode.toUpperCase());
    if (!room) return;
    const p = room.participants.find((x) => x.clientId === msg.clientId);
    if (!p) return;
    clientInfo.clientId = msg.clientId;
    clientInfo.roomCode = room.roomCode;
    p.connected = true;
    broadcastRoom(room);
    return;
  }

  if (!clientInfo.roomCode) return;
  const room = rooms.get(clientInfo.roomCode);
  if (!room) return;
  const sender = room.participants.find((p) => p.clientId === clientInfo.clientId);
  if (!sender) return;

  if (msg.type === 'room:change_franchise' && room.phase === 'LOBBY') {
    const taken = room.participants.some(
      (p) => p.clientId !== sender.clientId && p.franchiseId === msg.franchiseId
    );
    if (taken) {
      sendToClient(ws, { type: 'room:error', message: 'Franchise already taken by a friend.' });
      return;
    }
    sender.franchiseId = msg.franchiseId;
    broadcastRoom(room);
    return;
  }

  if (msg.type === 'room:start_auction' && room.phase === 'LOBBY' && sender.isHost) {
    if (room.participants.length < 2) {
      sendToClient(ws, {
        type: 'room:error',
        message: 'Wait for at least 1 friend to join before starting!',
      });
      return;
    }

    const queue = sortPoolIntoIplSets(IPL_PLAYERS_DB);
    const first = queue[0];
    room.phase = 'AUCTION';
    room.auction = {
      queue,
      currentIndex: 0,
      currentBid: first.basePrice,
      highestBidderId: null,
      passedClientIds: [],
      countdownMs: 15000,
      soldBanner: null,
      rtmPrompt: null,
      logs: [],
    };

    broadcastRoom(room);
    broadcastVoice(
      room,
      `Welcome to the IPL Mega Auction! First up, ${first.name}. Base ${first.basePrice} crore.`,
      'high'
    );
    startAuctionTimer(room.roomCode);
    return;
  }

  if (msg.type === 'auction:confirm_retention' && room.phase === 'RETENTION') {
    const kept = sender.previousSquad
      .filter((p) => msg.retainedIds.slice(0, 3).includes(p.id))
      .map((p) => ({ ...p, inForm: false, retained: true }));
    sender.squad = kept;
    sender.retentionConfirmed = true;

    const humans = room.participants.filter((p) => !p.isAi);
    if (humans.every((h) => h.retentionConfirmed)) {
      const retainedIds = new Set<string>();
      humans.forEach((h) => h.squad.forEach((p) => retainedIds.add(p.id)));
      const queue = sortPoolIntoIplSets(IPL_PLAYERS_DB.filter((p) => !retainedIds.has(p.id)));
      const first = queue[0];
      room.phase = 'AUCTION';
      room.auction = {
        queue,
        currentIndex: 0,
        currentBid: first.basePrice,
        highestBidderId: null,
        passedClientIds: [],
        countdownMs: 15000,
        soldBanner: null,
        rtmPrompt: null,
        logs: [],
      };
      broadcastRoom(room);
      broadcastVoice(
        room,
        `Match ${room.matchNumber} auction begins! Next up, ${first.name}. Base ${first.basePrice} crore.`,
        'high'
      );
      startAuctionTimer(room.roomCode);
    } else {
      broadcastRoom(room);
    }
    return;
  }

  if (msg.type === 'auction:bid' && room.phase === 'AUCTION' && room.auction) {
    const auc = room.auction;
    const player = auc.queue[auc.currentIndex];
    if (!player || auc.soldBanner || auc.rtmPrompt) return;
    if (auc.highestBidderId === sender.clientId) return;
    if (auc.passedClientIds.includes(sender.clientId)) return;
    if (sender.squad.length >= room.squadSize) return;

    const maxAllowed = getMaxAllowedBid(sender.purse, sender.squad.length, room.squadSize);
    const nextBid =
      auc.highestBidderId === null
        ? Math.min(player.basePrice, maxAllowed >= 1.0 ? maxAllowed : player.basePrice)
        : roundHalf(auc.currentBid + msg.increment);

    if (nextBid > maxAllowed || nextBid < 1.0) return;

    auc.currentBid = nextBid;
    auc.highestBidderId = sender.clientId;
    auc.countdownMs = 8000;
    addAuctionLog(
      room,
      `${sender.name} (${sender.franchiseId}) bids ₹${nextBid.toFixed(2)} Cr`,
      'bid'
    );
    broadcastRoom(room);
    broadcastVoice(
      room,
      `${sender.franchiseId}, ${nextBid} crore!`,
      'high'
    );
    return;
  }

  if (msg.type === 'auction:pass' && room.phase === 'AUCTION' && room.auction) {
    const auc = room.auction;
    if (auc.soldBanner || auc.rtmPrompt) return;
    if (!auc.passedClientIds.includes(sender.clientId)) {
      auc.passedClientIds.push(sender.clientId);
    }

    const activeHumans = room.participants.filter(
      (p) => !p.isAi && p.squad.length < room.squadSize
    );
    const everyonePassed = activeHumans.every(
      (p) => p.clientId === auc.highestBidderId || auc.passedClientIds.includes(p.clientId)
    );

    if (everyonePassed) {
      resolveCurrentLot(room);
    } else {
      broadcastRoom(room);
    }
    return;
  }

  if (msg.type === 'auction:rtm' && room.phase === 'AUCTION' && room.auction?.rtmPrompt) {
    const prompt = room.auction.rtmPrompt;
    if (prompt.targetClientId !== sender.clientId) return;

    if (msg.accept) {
      sender.rtmAvailable = false;
      addAuctionLog(
        room,
        `RTM USED! ${sender.name} (${sender.franchiseId}) matched ₹${prompt.price.toFixed(2)} Cr for ${prompt.player.name}!`,
        'rtm'
      );
      commitLotSale(room, prompt.player, sender.clientId, prompt.price);
    } else {
      addAuctionLog(room, `${sender.name} declined RTM.`, 'info');
      commitLotSale(room, prompt.player, prompt.winningClientId, prompt.price);
    }
    return;
  }

  if (msg.type === 'auction:autofill' && room.phase === 'AUCTION' && sender.isHost) {
    const draftedIds = new Set<string>();
    room.participants.forEach((p) => p.squad.forEach((sp) => draftedIds.add(sp.id)));
    let remainingPool = IPL_PLAYERS_DB.filter((p) => !draftedIds.has(p.id));

    room.participants
      .filter((p) => !p.isAi)
      .forEach((p) => {
        if (p.squad.length < room.squadSize) {
          const fill = autoFillTeamSquad(p.squad, p.purse, room.squadSize, remainingPool, true);
          p.squad = fill.squad;
          p.purse = fill.remainingPurse;
          const used = new Set(fill.usedIds);
          remainingPool = remainingPool.filter((x) => !used.has(x.id));
        }
      });

    transitionRoomToCardBattle(room);
    return;
  }

  // Phase 2 Card Battle handlers
  if (room.phase === 'CARD_BATTLE' && msg.type === 'battle:skip_to_match' && sender.isHost) {
    room.matchups.forEach((m) => {
      if (!m.tossComplete) {
        const battingFirstId = Math.random() < 0.5 ? m.homeClientId : m.awayClientId;
        startMiniMatchForMatchup(room, m, battingFirstId);
      }
    });
    broadcastVoice(room, 'Auction complete! Starting the 2-Over Cricket Match now!', 'high');
    return;
  }

  if (room.phase === 'CARD_BATTLE' && 'matchupId' in msg) {
    const matchup = room.matchups.find((m) => m.id === msg.matchupId);
    if (!matchup) return;

    if (msg.type === 'battle:select_stat') {
      const chooserId =
        matchup.roundIdx % 2 === 0 ? matchup.homeClientId : matchup.awayClientId;
      if (sender.clientId !== chooserId) return;
      applyDuelStat(room, matchup, sender.clientId, msg.stat);
      return;
    }

    if (msg.type === 'battle:next_duel') {
      if (!matchup.activeDuelResult) return;
      if (
        sender.clientId !== matchup.homeClientId &&
        sender.clientId !== matchup.awayClientId
      ) {
        return;
      }

      if (matchup.roundIdx + 1 < room.squadSize) {
        matchup.roundIdx += 1;
        matchup.activeDuelResult = null;
        broadcastRoom(room);
        maybeTriggerAiCardBattle(room, matchup);
      } else {
        const winnerId =
          matchup.homeDuelsWon > matchup.awayDuelsWon
            ? matchup.homeClientId
            : matchup.awayDuelsWon > matchup.homeDuelsWon
            ? matchup.awayClientId
            : Math.random() < 0.5
            ? matchup.homeClientId
            : matchup.awayClientId;
        matchup.tossWinnerClientId = winnerId;

        const winnerObj = room.participants.find((p) => p.clientId === winnerId);
        if (winnerObj?.isAi) {
          const aiBatsFirst = Math.random() < 0.5;
          startMiniMatchForMatchup(
            room,
            matchup,
            aiBatsFirst ? winnerObj.clientId : matchup.homeClientId
          );
        } else {
          broadcastRoom(room);
        }
      }
      return;
    }

    if (msg.type === 'battle:choose_toss') {
      if (sender.clientId !== matchup.tossWinnerClientId || matchup.tossComplete) return;
      const otherId =
        sender.clientId === matchup.homeClientId ? matchup.awayClientId : matchup.homeClientId;
      startMiniMatchForMatchup(room, matchup, msg.batFirst ? sender.clientId : otherId);
      return;
    }
  }

  // Phase 3 Mini Match handlers
  if (room.phase === 'MINI_MATCH' && 'matchupId' in msg) {
    const matchup = room.matchups.find((m) => m.id === msg.matchupId);
    if (!matchup || matchup.matchComplete) return;

    if (msg.type === 'match:start_innings_2' && matchup.inningsBreak) {
      if (
        sender.clientId !== matchup.homeClientId &&
        sender.clientId !== matchup.awayClientId
      ) {
        return;
      }

      const nextBatId = matchup.bowlingClientId;
      const nextBowlId = matchup.battingClientId;
      matchup.inningsNum = 2;
      matchup.battingClientId = nextBatId;
      matchup.bowlingClientId = nextBowlId;
      matchup.inningsBreak = false;

      const batSide = room.participants.find((p) => p.clientId === nextBatId)!;
      const bowlSide = room.participants.find((p) => p.clientId === nextBowlId)!;
      const bonus =
        nextBatId === matchup.homeClientId ? matchup.homeBonusRuns : matchup.awayBonusRuns;

      matchup.runs = bonus;
      matchup.wickets = 0;
      matchup.ballsBowled = 0;
      matchup.batterStats = initBatterStats(batSide.squad);
      matchup.bowlerStats = initBowlerStats(bowlSide.squad);
      matchup.ballLog = [];
      matchup.activeBatterId = pickBestBatters(batSide.squad)[0]?.id || '';
      const bowlers = pickBestBowlers(bowlSide.squad);
      matchup.over1BowlerId = bowlers[0]?.id || '';
      matchup.over2BowlerId = bowlers[1]?.id || bowlers[0]?.id || '';
      matchup.needsNewBatter = false;
      matchup.pendingShot = null;
      matchup.pendingDelivery = null;

      broadcastRoom(room);
      maybeTriggerAiMatchAction(room, matchup);
      return;
    }

    if (msg.type === 'match:select_batter' && sender.clientId === matchup.battingClientId) {
      if (!matchup.batterStats[msg.playerId]?.out) {
        matchup.activeBatterId = msg.playerId;
        matchup.needsNewBatter = false;
        broadcastRoom(room);
      }
      return;
    }

    if (msg.type === 'match:select_bowler' && sender.clientId === matchup.bowlingClientId) {
      if (msg.overIndex === 1) {
        matchup.over1BowlerId = msg.playerId;
      } else if (msg.playerId !== matchup.over1BowlerId) {
        matchup.over2BowlerId = msg.playerId;
      }
      broadcastRoom(room);
      return;
    }

    if (msg.type === 'match:submit_shot' && sender.clientId === matchup.battingClientId) {
      if (matchup.needsNewBatter || matchup.inningsBreak) return;
      matchup.pendingShot = msg.shot;
      maybeTriggerAiMatchAction(room, matchup);
      if (matchup.pendingShot && matchup.pendingDelivery) {
        resolveMatchBall(room, matchup);
      } else {
        broadcastRoom(room);
      }
      return;
    }

    if (msg.type === 'match:submit_delivery' && sender.clientId === matchup.bowlingClientId) {
      if (matchup.inningsBreak) return;
      matchup.pendingDelivery = msg.delivery;
      maybeTriggerAiMatchAction(room, matchup);
      if (matchup.pendingShot && matchup.pendingDelivery) {
        resolveMatchBall(room, matchup);
      } else {
        broadcastRoom(room);
      }
      return;
    }
  }

  // Phase 4 Next Round Progression
  if (msg.type === 'room:next_round' && room.phase === 'POST_MATCH' && sender.isHost) {
    room.matchNumber += 1;
    room.participants = room.participants.filter((p) => !p.isAi);
    room.participants.forEach((p) => {
      p.previousSquad = [...p.squad];
      p.squad = [];
      p.purse = roundHalf(p.purse + SEASON_GRANT);
      p.retentionConfirmed = p.previousSquad.length === 0;
      p.rtmAvailable = true;
      p.lastEarned = 0;
    });
    room.matchups = [];
    room.phase = 'RETENTION';
    broadcastRoom(room);
  }
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);

  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      activeRooms: rooms.size,
      ttsAvailable:
        Boolean(genaiClient) &&
        (Date.now() >= ttsCooldownUntil || Date.now() >= liveTtsCooldownUntil),
    });
  });

  app.post('/api/tts', async (req, res) => {
    const body = (req.body || {}) as { text?: unknown; voiceName?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'Missing text for speech synthesis.' });
      return;
    }

    if (!genaiClient) {
      res.json({ audioBase64: null, fallback: true, retryAfterMs: 1_800_000 });
      return;
    }

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const voiceName: AuctioneerVoiceId = body.voiceName === 'Zephyr' ? 'Zephyr' : 'Kore';
    const result = await synthesizeAuctioneerSpeech(text, voiceName, abortController.signal);
    if (abortController.signal.aborted || res.writableEnded) {
      return;
    }
    if (result.status === 'rate_limited') {
      res.json({
        audioBase64: null,
        fallback: true,
        retryAfterMs: result.retryAfterMs ?? 60_000,
      });
      return;
    }
    if (!result.audioBase64) {
      res.json({ audioBase64: null, fallback: true, retryAfterMs: 60_000 });
      return;
    }

    res.json({
      audioBase64: result.audioBase64,
      mimeType: 'audio/wav',
      voiceName,
      fallback: false,
    });
  });

  const playerPhotoCache = new Map<string, { buffer: Buffer; contentType: string }>();
  const playerPhotoInFlight = new Map<string, Promise<{ buffer: Buffer; contentType: string } | null>>();

  app.get('/api/player-photo/:id', async (req, res) => {
    const id = req.params.id.replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    const remoteUrl = PLAYER_PHOTO_URLS[id];
    if (!remoteUrl) {
      res.status(404).end();
      return;
    }

    const cached = playerPhotoCache.get(id);
    if (cached) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cached.buffer);
      return;
    }

    let task = playerPhotoInFlight.get(id);
    if (!task) {
      task = (async () => {
        try {
          const upstream = await fetch(remoteUrl, {
            headers: {
              'User-Agent': 'IPLAuctionShowdownApp/1.0 (https://localhost; dev@example.com)',
            },
          });
          if (!upstream.ok) return null;
          const contentType = upstream.headers.get('content-type') || 'image/jpeg';
          const buffer = Buffer.from(await upstream.arrayBuffer());
          if (buffer.length > 0) {
            playerPhotoCache.set(id, { buffer, contentType });
            return { buffer, contentType };
          }
          return null;
        } catch {
          return null;
        } finally {
          playerPhotoInFlight.delete(id);
        }
      })();
      playerPhotoInFlight.set(id, task);
    }

    const photo = await task;
    if (!photo) {
      res.status(404).end();
      return;
    }

    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(photo.buffer);
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', (ws) => {
    clients.set(ws, { ws, clientId: '', roomCode: null });

    ws.on('message', (data) => {
      handleMessage(ws, data.toString());
    });

    ws.on('close', () => {
      const info = clients.get(ws);
      if (info && info.roomCode) {
        const room = rooms.get(info.roomCode);
        if (room) {
          const p = room.participants.find((x) => x.clientId === info.clientId);
          if (p) {
            p.connected = false;
            broadcastRoom(room);
          }
        }
      }
      clients.delete(ws);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`IPL Auction & Showdown server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
