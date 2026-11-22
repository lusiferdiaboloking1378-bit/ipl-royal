import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  FastForward,
  Flame,
  Gavel,
  Hand,
  Link2,
  Mic,
  MicOff,
  Shield,
  ShieldAlert,
  SkipForward,
  Swords,
  Target,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import auctionGavelDeskImg from '../assets/images/auction_gavel_desk_1795258896064.jpg';
import { getFranchiseById, IPL_FRANCHISES, STAT_META } from '../data/iplData';
import { getPlayerPhotoSrc } from '../data/playerPhotos';
import { DeliveryType, ShotStyle, StatKey } from '../types/game';
import { ClientMessage, RoomState, ServerMessage } from '../types/multiplayer';
import { auctioneerVoice, StudioFemaleVoiceId } from '../utils/auctioneerVoice';
import { getAuctionSetLabel, getMaxAllowedBid, roundHalf } from '../utils/engine';
import { soundFX } from '../utils/sound';
import { GlobalRankingDashboard } from './GlobalRankingDashboard';
import { PlayerCard } from './PlayerCard';
import { PlayerPortrait, TeamCrest } from './TeamCrest';

interface FriendsMultiplayerProps {
  initialRoomCode?: string;
  initialFranchiseId: string;
  defaultPlayerName?: string;
  currentUid?: string;
  emailVerified?: boolean;
  careerWins?: number;
  careerMatches?: number;
  onRecordCareerMatch?: (won: boolean, updatedPurse: number, franchiseId: string) => void;
  squadSize: 7 | 11;
  onExitToSolo: () => void;
}

function getOrCreateClientId(): string {
  const key = 'ipl_showdown_client_id';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = `c_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

export const FriendsMultiplayer: React.FC<FriendsMultiplayerProps> = ({
  initialRoomCode = '',
  initialFranchiseId,
  defaultPlayerName = '',
  currentUid = '',
  emailVerified = false,
  careerWins = 0,
  careerMatches = 0,
  onRecordCareerMatch,
  squadSize: defaultSquadSize,
  onExitToSolo,
}) => {
  const clientId = useMemo(() => getOrCreateClientId(), []);
  const wsRef = useRef<WebSocket | null>(null);
  const recordedMatchKeyRef = useRef<string | null>(null);

  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pre-room form state
  const [playerName, setPlayerName] = useState(defaultPlayerName);
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoomCode.toUpperCase());
  const [selectedFranchiseId, setSelectedFranchiseId] = useState(initialFranchiseId);
  const [squadSize, setSquadSize] = useState<7 | 11>(defaultSquadSize);
  const [copiedType, setCopiedType] = useState<'code' | 'link' | null>(null);

  useEffect(() => {
    if (!playerName && defaultPlayerName) {
      setPlayerName(defaultPlayerName);
    }
  }, [defaultPlayerName]);

  // Voice state
  const [voiceEnabled, setVoiceEnabled] = useState(() => auctioneerVoice.isEnabled());
  const [selectedVoice, setSelectedVoice] = useState<StudioFemaleVoiceId>(() =>
    auctioneerVoice.getSelectedVoiceId()
  );
  const [speechRate, setSpeechRate] = useState<number>(() => auctioneerVoice.getSpeechRate());
  const voiceOptions = auctioneerVoice.getVoiceOptions();

  // Retention selection state
  const [retainedIds, setRetainedIds] = useState<string[]>([]);

  // Auction right drawer tab
  const [drawerTab, setDrawerTab] = useState<'SQUAD' | 'TABLES' | 'LOG'>('SQUAD');

  useEffect(() => {
    const unsub = auctioneerVoice.subscribe(() => {
      setVoiceEnabled(auctioneerVoice.isEnabled());
      setSelectedVoice(auctioneerVoice.getSelectedVoiceId());
      setSpeechRate(auctioneerVoice.getSpeechRate());
    });
    return () => {
      unsub();
      auctioneerVoice.stop();
    };
  }, []);

  useEffect(() => {
    if (room?.phase === 'AUCTION') {
      auctioneerVoice.prewarmCommonCalls();
    }
  }, [room?.phase]);

  const currentAuctionNext =
    room?.phase === 'AUCTION' && room.auction
      ? room.auction.queue[room.auction.currentIndex + 1]
      : null;

  useEffect(() => {
    if (currentAuctionNext) {
      const nextPhoto = getPlayerPhotoSrc(currentAuctionNext.id);
      if (nextPhoto) {
        const img = new Image();
        img.src = nextPhoto;
      }
    }
  }, [currentAuctionNext?.id]);

  // Connect WebSocket
  useEffect(() => {
    let closedByUser = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setErrorMsg(null);
        const savedRoom = sessionStorage.getItem('ipl_showdown_room_code');
        if (savedRoom) {
          ws.send(
            JSON.stringify({
              type: 'room:reconnect',
              clientId,
              roomCode: savedRoom,
            } satisfies ClientMessage)
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerMessage;
          if (msg.type === 'room:state') {
            setRoom(msg.room);
            sessionStorage.setItem('ipl_showdown_room_code', msg.room.roomCode);
          } else if (msg.type === 'room:error') {
            setErrorMsg(msg.message);
          } else if (msg.type === 'room:voice') {
            auctioneerVoice.speak(msg.text, msg.priority ?? 'normal');
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!closedByUser) {
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      };
    };

    connect();

    return () => {
      closedByUser = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [clientId]);

  const sendMsg = (msg: ClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  };

  const me = useMemo(
    () => room?.participants.find((p) => p.clientId === clientId) || null,
    [room, clientId]
  );

  // Pre-fill retention selection when entering RETENTION phase
  useEffect(() => {
    if (room?.phase === 'RETENTION' && me && me.previousSquad.length > 0 && !me.retentionConfirmed) {
      const top3 = [...me.previousSquad]
        .sort((a, b) => b.overallRating - a.overallRating)
        .slice(0, Math.min(3, me.previousSquad.length))
        .map((p) => p.id);
      setRetainedIds(top3);
    }
  }, [room?.phase, room?.matchNumber]);

  const myMatchup = useMemo(() => {
    if (!room) return null;
    return (
      room.matchups.find((m) => m.homeClientId === clientId || m.awayClientId === clientId) || null
    );
  }, [room, clientId]);

  useEffect(() => {
    if (!room || room.phase !== 'POST_MATCH' || !me || !onRecordCareerMatch) return;
    const key = `${room.roomCode}:${room.matchNumber}`;
    if (recordedMatchKeyRef.current === key) return;
    recordedMatchKeyRef.current = key;
    const won = myMatchup?.winnerClientId === clientId;
    onRecordCareerMatch(won, me.purse, me.franchiseId);
  }, [room?.phase, room?.roomCode, room?.matchNumber, me?.purse, me?.franchiseId, myMatchup?.winnerClientId]);

  const handleCreateRoom = () => {
    setErrorMsg(null);
    sendMsg({
      type: 'room:create',
      clientId,
      playerName: playerName.trim() || 'Host Captain',
      franchiseId: selectedFranchiseId,
      squadSize,
    });
  };

  const handleJoinRoom = () => {
    if (!roomCodeInput.trim()) {
      setErrorMsg('Enter a valid Room Code to join.');
      return;
    }
    setErrorMsg(null);
    sendMsg({
      type: 'room:join',
      clientId,
      roomCode: roomCodeInput.trim().toUpperCase(),
      playerName: playerName.trim() || 'Guest Captain',
      franchiseId: selectedFranchiseId,
    });
  };

  const handleLeaveRoom = () => {
    sessionStorage.removeItem('ipl_showdown_room_code');
    setRoom(null);
    auctioneerVoice.stop();
    onExitToSolo();
  };

  const copyInvite = (mode: 'code' | 'link') => {
    if (!room) return;
    const text =
      mode === 'code'
        ? room.roomCode
        : `${window.location.origin}${window.location.pathname}?room=${room.roomCode}`;
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedType(mode);
    window.setTimeout(() => setCopiedType(null), 1800);
  };

  // =========================================================================
  // 1. CREATE / JOIN ROOM SCREEN
  // =========================================================================
  if (!room) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
            <div>
              <div className="text-xs font-semibold text-amber-400">
                Friends Group Multiplayer · Up to 10 Players
              </div>
              <h2 className="font-display text-3xl font-extrabold text-white mt-1">
                Host or Join a Live IPL Auction Room
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Bid live against your friends with ₹120.00 Cr purses, RTM cards, and a live female
                AI auctioneer calling every bid.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLeaveRoom}
              className="self-start px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer shrink-0"
            >
              Back to Solo Career
            </button>
          </div>

          {initialRoomCode && (
            <div className="p-3.5 rounded-xl bg-amber-500/12 border border-amber-400/50 text-xs text-amber-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Link2 className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Squad Invite Link Ready — Room{' '}
                  <strong className="font-mono text-amber-300">{initialRoomCode}</strong> is
                  pre-filled below. Pick your franchise and click{' '}
                  <strong>Join Friends Room</strong>!
                </span>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-sm text-rose-200">
              {errorMsg}
            </div>
          )}

          {/* Player Name & Franchise Picker */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label htmlFor="friend-name" className="text-xs font-semibold text-slate-300 block">
                Your Captain Name
              </label>
              <input
                id="friend-name"
                type="text"
                maxLength={20}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="e.g. Aarav, Rohan, Priya..."
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="friend-franchise" className="text-xs font-semibold text-slate-300 block">
                Choose Your IPL Franchise
              </label>
              <select
                id="friend-franchise"
                value={selectedFranchiseId}
                onChange={(e) => setSelectedFranchiseId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-400"
              >
                {IPL_FRANCHISES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.shortName} — {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Two Action Cards: Create vs Join */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
            {/* Create Room */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="font-display text-xl font-bold text-white">Create Friends Room</div>
                <p className="text-xs text-slate-400">
                  Start a new private room and share the invite link with your friends group.
                </p>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-slate-900 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setSquadSize(7)}
                    className={`py-2 px-3 rounded-md text-xs font-semibold cursor-pointer ${
                      squadSize === 7 ? 'bg-amber-400 text-slate-950' : 'text-slate-400'
                    }`}
                  >
                    7 Players (Fast)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSquadSize(11)}
                    className={`py-2 px-3 rounded-md text-xs font-semibold cursor-pointer ${
                      squadSize === 11 ? 'bg-amber-400 text-slate-950' : 'text-slate-400'
                    }`}
                  >
                    11 Players (XI)
                  </button>
                </div>
              </div>
              <button
                type="button"
                disabled={!connected}
                onClick={handleCreateRoom}
                className="w-full py-3 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-display text-lg font-bold tracking-wide transition-colors cursor-pointer"
              >
                {connected ? 'Create Room (₹120 Cr Purse)' : 'Connecting to Server...'}
              </button>
            </div>

            {/* Join Room */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="font-display text-xl font-bold text-white">Join with Room Code</div>
                <p className="text-xs text-slate-400">
                  Enter the 5-character code shared by your room host.
                </p>
                <input
                  type="text"
                  maxLength={8}
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                  placeholder="e.g. IPL42"
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-700 font-mono text-base font-bold tracking-widest text-amber-400 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 uppercase"
                />
              </div>
              <button
                type="button"
                disabled={!connected}
                onClick={handleJoinRoom}
                className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-display text-lg font-bold tracking-wide transition-colors cursor-pointer"
              >
                Join Friends Room
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 2. FRIENDS ROOM LOBBY
  // =========================================================================
  if (room.phase === 'LOBBY') {
    const takenFranchises = new Set(room.participants.map((p) => p.franchiseId));

    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-6 sm:p-8 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-800">
            <div>
              <div className="text-xs font-semibold text-amber-400">
                Friends Lobby · {room.squadSize}-Player Squads · ₹120.00 Cr Purse
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-extrabold text-white mt-1 flex items-center gap-3">
                <span>Room {room.roomCode}</span>
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Share this room code or invite link with your friends. Host can start once 2+
                friends join.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => copyInvite('code')}
                className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5 text-amber-400" />
                <span>{copiedType === 'code' ? 'Code Copied!' : `Copy ${room.roomCode}`}</span>
              </button>
              <button
                type="button"
                onClick={() => copyInvite('link')}
                className="px-3.5 py-2.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-xs font-semibold text-blue-300 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>{copiedType === 'link' ? 'Invite Link Copied!' : 'Copy Invite Link'}</span>
              </button>
              <button
                type="button"
                onClick={handleLeaveRoom}
                className="px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
              >
                Leave
              </button>
            </div>
          </div>

          {/* Visible Squad Invite Link Bar */}
          <div className="rounded-xl border border-blue-500/35 bg-blue-950/25 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-blue-300 flex items-center gap-1.5 mb-1">
                <Link2 className="w-3.5 h-3.5" />
                <span>Shareable Squad Join Link (Friends Sign In &amp; Join Directly)</span>
              </div>
              <div className="font-mono text-xs text-slate-200 truncate select-all bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2">
                {`${window.location.origin}${window.location.pathname}?room=${room.roomCode}`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => copyInvite('link')}
              className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copiedType === 'link' ? 'Copied Squad Link!' : 'Copy Squad Link'}</span>
            </button>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200">
              {errorMsg}
            </div>
          )}

          {/* Connected Friends List */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-xl font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-400" />
                <span>Franchises in Room ({room.participants.length}/10)</span>
              </h3>
              <button
                type="button"
                onClick={() => auctioneerVoice.testVoice()}
                className="text-xs text-amber-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>Test Female Auctioneer Voice</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {room.participants.map((p) => {
                const f = getFranchiseById(p.franchiseId);
                return (
                  <div
                    key={p.clientId}
                    className={`p-4 rounded-xl border flex items-center justify-between gap-3 ${
                      p.clientId === clientId
                        ? 'bg-amber-500/10 border-amber-400/70'
                        : 'bg-slate-950/70 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <TeamCrest franchise={f} size="sm" />
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-white truncate">
                          {p.name} {p.clientId === clientId && '(You)'}
                        </div>
                        <div className="text-xs text-slate-400 truncate">
                          {f.shortName} · {p.isHost ? 'Host' : 'Player'} ·{' '}
                          {p.connected ? 'Online' : 'Reconnecting'}
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-xs font-bold text-amber-400 tabular-nums shrink-0">
                      ₹{p.purse.toFixed(0)}Cr
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Switch Franchise */}
          {me && (
            <div className="pt-4 border-t border-slate-800 space-y-2.5">
              <div className="text-xs font-semibold text-slate-300">Switch Your Franchise</div>
              <div className="flex flex-wrap gap-2">
                {IPL_FRANCHISES.map((f) => {
                  const isMine = me.franchiseId === f.id;
                  const isTaken = takenFranchises.has(f.id) && !isMine;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      disabled={isTaken}
                      onClick={() => sendMsg({ type: 'room:change_franchise', franchiseId: f.id })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                        isMine
                          ? 'bg-amber-400 text-slate-950 border-amber-400'
                          : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      {f.shortName}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Start Action */}
          <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-400">
              {me?.isHost
                ? room.participants.length < 2
                  ? 'Invite at least 1 friend using the room code or link above to start.'
                  : 'All friends ready! Click Start Friends Auction to enter the auction hall.'
                : 'Waiting for the Room Host to start the auction...'}
            </div>
            {me?.isHost && (
              <button
                type="button"
                disabled={room.participants.length < 2}
                onClick={() => sendMsg({ type: 'room:start_auction' })}
                className="w-full sm:w-auto py-3.5 px-7 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-display text-lg font-bold tracking-wide inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <span>Start Friends Auction</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 3. RETENTION DESK (ROUND 2+)
  // =========================================================================
  if (room.phase === 'RETENTION' && me) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div>
            <div className="text-xs font-semibold text-amber-400">
              Match {room.matchNumber} · Friends Retention Desk
            </div>
            <h2 className="font-display text-3xl font-bold text-white mt-1">
              Retain Up to 3 Star Players
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Keep up to 3 core players at ₹0 extra cost before entering Match {room.matchNumber}{' '}
              Auction with ₹{me.purse.toFixed(2)} Cr.
            </p>
          </div>
          <div className="font-mono text-2xl font-bold text-amber-400 tabular-nums">
            {retainedIds.length} / 3
          </div>
        </div>

        {me.retentionConfirmed ? (
          <div className="py-10 text-center space-y-2">
            <div className="text-lg font-semibold text-emerald-400">Retentions Locked!</div>
            <p className="text-sm text-slate-400">
              Waiting for other friends in Room {room.roomCode} to confirm their retentions...
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {me.previousSquad.map((p) => {
                const selected = retainedIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setRetainedIds((prev) =>
                        prev.includes(p.id)
                          ? prev.filter((x) => x !== p.id)
                          : prev.length < 3
                          ? [...prev, p.id]
                          : prev
                      )
                    }
                    className={`text-left p-4 rounded-xl border cursor-pointer ${
                      selected
                        ? 'bg-amber-500/12 border-amber-400'
                        : 'bg-slate-950/70 border-slate-800 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <PlayerPortrait
                          playerId={p.id}
                          name={p.name}
                          role={p.role}
                          primaryColor={getFranchiseById(p.iplTeam).primaryColor}
                          secondaryColor={getFranchiseById(p.iplTeam).secondaryColor}
                          jerseyNumber={p.jerseyNumber}
                          variant="avatar"
                        />
                        <div className="min-w-0">
                          <div className="text-xs text-slate-400">
                            {p.iplTeam} · {p.role}
                          </div>
                          <div className="font-display text-xl font-bold text-white truncate">{p.name}</div>
                        </div>
                      </div>
                      <Check
                        className={`w-5 h-5 shrink-0 ${selected ? 'text-amber-400' : 'text-slate-700'}`}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => sendMsg({ type: 'auction:confirm_retention', retainedIds })}
              className="py-3 px-6 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display text-lg font-bold cursor-pointer"
            >
              Confirm Retentions
            </button>
          </>
        )}
      </div>
    );
  }

  // =========================================================================
  // 4. LIVE FRIENDS AUCTION
  // =========================================================================
  if (room.phase === 'AUCTION' && room.auction && me) {
    const auc = room.auction;
    const currentPlayer = auc.queue[auc.currentIndex];
    const nextOnDeck = auc.queue[auc.currentIndex + 1];
    const maxMyBid = getMaxAllowedBid(me.purse, me.squad.length, room.squadSize);
    const nextMinBid =
      auc.highestBidderId === null ? currentPlayer?.basePrice || 1 : roundHalf(auc.currentBid + 0.5);
    const hasPassed = auc.passedClientIds.includes(clientId);

    const canRaise50L =
      !auc.soldBanner &&
      !auc.rtmPrompt &&
      !hasPassed &&
      me.squad.length < room.squadSize &&
      auc.highestBidderId !== clientId &&
      nextMinBid <= maxMyBid;

    const canJump2Cr =
      !auc.soldBanner &&
      !auc.rtmPrompt &&
      !hasPassed &&
      me.squad.length < room.squadSize &&
      auc.highestBidderId !== null &&
      auc.highestBidderId !== clientId &&
      roundHalf(auc.currentBid + 2.0) <= maxMyBid;

    const leader = room.participants.find((p) => p.clientId === auc.highestBidderId);
    const leaderFranchise = leader ? getFranchiseById(leader.franchiseId) : null;

    return (
      <div className="space-y-5">
        {/* Friends Franchise Tables Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {room.participants
            .filter((p) => !p.isAi)
            .map((p) => {
              const f = getFranchiseById(p.franchiseId);
              const isLeading = auc.highestBidderId === p.clientId;
              return (
                <div
                  key={p.clientId}
                  className={`rounded-xl border p-3 transition-all ${
                    isLeading
                      ? 'bg-amber-500/15 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.2)]'
                      : p.clientId === clientId
                      ? 'bg-slate-900 border-slate-700'
                      : 'bg-slate-900/80 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <TeamCrest franchise={f} size="xs" />
                      <div className="min-w-0">
                        <div className="font-display text-base font-bold text-white truncate">
                          {f.shortName} · {p.name}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                          {p.squad.length}/{room.squadSize} players
                        </div>
                      </div>
                    </div>
                    {isLeading && <Hand className="w-4 h-4 text-amber-400 shrink-0" />}
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                    <span className="text-slate-400">Purse</span>
                    <span className="font-mono font-bold text-amber-400 tabular-nums">
                      ₹{p.purse.toFixed(2)} Cr
                    </span>
                  </div>
                </div>
              );
            })}
        </div>

        {/* Main 3-Column Auction Floor */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left: Current Player Card */}
          <div className="lg:col-span-4 space-y-3">
            {currentPlayer && (
              <>
                <div className="flex items-center justify-between px-1 text-xs">
                  <span className="font-semibold text-amber-400">
                    {getAuctionSetLabel(currentPlayer)}
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    Lot #{auc.currentIndex + 1} / {auc.queue.length}
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
                        <div className="text-[10px] text-slate-400">On Deck</div>
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

          {/* Center: Live Gavel & Female Voice Control */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/95 overflow-hidden">
            <div className="relative h-28 bg-gradient-to-br from-slate-800 to-slate-950">
              <img
                src={auctionGavelDeskImg}
                alt="IPL auctioneer podium"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover opacity-50"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/55 to-transparent" />
              <div className="absolute top-3 right-3 left-3 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-200">
                  Room {room.roomCode} · Live Sync
                </span>
                <button
                  type="button"
                  onClick={() => auctioneerVoice.setEnabled(!voiceEnabled)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1.5 border cursor-pointer ${
                    voiceEnabled
                      ? 'bg-amber-400/20 border-amber-400/50 text-amber-300'
                      : 'bg-slate-900/80 border-slate-700 text-slate-400'
                  }`}
                >
                  {voiceEnabled ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                  <span>{voiceEnabled ? 'Girl AI Voice On' : 'Voice Off'}</span>
                </button>
              </div>
              <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                  <Gavel className="w-4 h-4" />
                  <span>
                    {auc.highestBidderId === null
                      ? auc.countdownMs <= 2000
                        ? 'Going Thrice!'
                        : auc.countdownMs <= 5000
                        ? 'Going Twice!'
                        : auc.countdownMs <= 10000
                        ? 'Going Once...'
                        : 'Opening Floor (15s)'
                      : auc.countdownMs <= 1200
                      ? 'Going Thrice!'
                      : auc.countdownMs <= 2600
                      ? 'Going Twice!'
                      : auc.countdownMs <= 4400
                      ? 'Going Once...'
                      : 'Bidding Active'}
                  </span>
                </div>
                <span className="font-mono text-xs text-slate-200 tabular-nums">
                  {auc.soldBanner ? 'HAMMER DOWN' : `${(auc.countdownMs / 1000).toFixed(1)}s`}
                </span>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-950">
                <div
                  className={`h-full transition-all duration-100 ${
                    auc.countdownMs <= 2000
                      ? 'bg-rose-500'
                      : auc.countdownMs <= 5000
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                  }`}
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(
                        100,
                        (auc.countdownMs / (auc.highestBidderId === null ? 15000 : 8000)) * 100
                      )
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Female AI Voice Selector & Speech Rate */}
              {voiceEnabled && (
                <div className="space-y-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <label htmlFor="friends-voice-select" className="text-slate-400 shrink-0">
                      Auctioneer Voice:
                    </label>
                    <div className="flex items-center gap-1.5 flex-1 justify-end">
                      <select
                        id="friends-voice-select"
                        value={selectedVoice}
                        onChange={(e) => {
                          auctioneerVoice.setVoiceId(e.target.value as StudioFemaleVoiceId);
                          auctioneerVoice.testVoice();
                        }}
                        className="flex-1 max-w-[220px] px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 truncate cursor-pointer"
                      >
                        {voiceOptions.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => auctioneerVoice.testVoice()}
                        className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-amber-400 text-[11px] text-slate-200 shrink-0 cursor-pointer"
                      >
                        Test
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <label htmlFor="friends-voice-rate" className="text-slate-400 shrink-0">
                        Voice Speed:
                      </label>
                      <span className="font-mono text-[11px] font-semibold text-amber-400 tabular-nums">
                        {speechRate.toFixed(2)}×
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-1 justify-end min-w-[190px]">
                      <input
                        id="friends-voice-rate"
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

              {/* Current Bid */}
              <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-slate-400">
                    {auc.highestBidderId === null ? 'Base Price' : 'Current Highest Bid'}
                  </div>
                  <div className="font-mono text-3xl sm:text-4xl font-bold text-white tabular-nums mt-0.5">
                    ₹{auc.currentBid.toFixed(2)} <span className="text-lg text-amber-400">Cr</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-1 tabular-nums">
                    Your Max Bid: ₹{maxMyBid.toFixed(2)} Cr
                  </div>
                </div>
                <div className="text-right">
                  {leader && leaderFranchise ? (
                    <div className="flex flex-col items-end gap-1">
                      <TeamCrest franchise={leaderFranchise} size="sm" />
                      <span className="text-xs font-semibold text-white">
                        {leader.name} ({leaderFranchise.shortName})
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">Awaiting First Bid</span>
                  )}
                </div>
              </div>

              {/* RTM Prompt */}
              {auc.rtmPrompt && (
                <div className="rounded-xl border border-amber-400 bg-amber-500/15 p-4 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-100">
                      <strong className="text-white block mb-0.5">
                        Right To Match (RTM) Triggered!
                      </strong>
                      {auc.rtmPrompt.targetClientId === clientId
                        ? `${auc.rtmPrompt.winningFranchiseId} won ${auc.rtmPrompt.player.name} for ₹${auc.rtmPrompt.price.toFixed(2)} Cr. Use your RTM Card?`
                        : `Waiting for ${
                            room.participants.find(
                              (p) => p.clientId === auc.rtmPrompt?.targetClientId
                            )?.name
                          } to decide RTM...`}
                    </div>
                  </div>
                  {auc.rtmPrompt.targetClientId === clientId && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => sendMsg({ type: 'auction:rtm', accept: true })}
                        className="py-2 px-3 rounded-lg bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer"
                      >
                        Use RTM (₹{auc.rtmPrompt.price.toFixed(2)} Cr)
                      </button>
                      <button
                        type="button"
                        onClick={() => sendMsg({ type: 'auction:rtm', accept: false })}
                        className="py-2 px-3 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold cursor-pointer"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Sold Banner */}
              {auc.soldBanner && (
                <div className="rounded-xl p-3 text-center text-sm font-bold border bg-emerald-500/15 border-emerald-500/40 text-emerald-300">
                  {auc.soldBanner.winnerClientId === 'UNSOLD'
                    ? `${auc.soldBanner.playerName} — UNSOLD`
                    : `SOLD! ${auc.soldBanner.playerName} to ${auc.soldBanner.winnerName} (${auc.soldBanner.winnerFranchiseId}) for ₹${auc.soldBanner.price.toFixed(2)} Cr`}
                </div>
              )}

              {/* Paddle Buttons */}
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={!canRaise50L}
                    onClick={() => sendMsg({ type: 'auction:bid', increment: 0.5 })}
                    className="py-3.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-display text-lg font-bold tracking-wide flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Hand className="w-4 h-4" />
                    <span>
                      {auc.highestBidderId === clientId
                        ? 'Leading Bid'
                        : auc.highestBidderId === null
                        ? `Open ₹${nextMinBid.toFixed(1)} Cr`
                        : `Raise +₹50L (₹${nextMinBid.toFixed(1)}Cr)`}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={!canJump2Cr}
                    onClick={() => sendMsg({ type: 'auction:bid', increment: 2.0 })}
                    className="py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-display text-lg font-bold tracking-wide flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Zap className="w-4 h-4" />
                    <span>Jump +₹2.0 Cr</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={hasPassed || Boolean(auc.soldBanner)}
                    onClick={() => sendMsg({ type: 'auction:pass' })}
                    className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    <span>{hasPassed ? 'Passed Lot' : 'Withdraw / Pass'}</span>
                  </button>
                  {me.isHost ? (
                    <button
                      type="button"
                      onClick={() => sendMsg({ type: 'auction:autofill' })}
                      className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-300 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <FastForward className="w-3.5 h-3.5" />
                      <span>Host Auto-Fill All</span>
                    </button>
                  ) : (
                    <div className="py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-800 text-center text-[11px] text-slate-400">
                      RTM: {me.rtmAvailable ? '1 Left' : 'Used'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Squad & Live Hammer Ledger */}
          <div className="lg:col-span-3 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3.5">
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setDrawerTab('SQUAD')}
                className={`py-1.5 px-2 rounded-lg cursor-pointer ${
                  drawerTab === 'SQUAD' ? 'bg-amber-400 text-slate-950' : 'text-slate-400'
                }`}
              >
                Yours ({me.squad.length})
              </button>
              <button
                type="button"
                onClick={() => setDrawerTab('TABLES')}
                className={`py-1.5 px-2 rounded-lg cursor-pointer ${
                  drawerTab === 'TABLES' ? 'bg-sky-400 text-slate-950' : 'text-slate-400'
                }`}
              >
                Friends
              </button>
              <button
                type="button"
                onClick={() => setDrawerTab('LOG')}
                className={`py-1.5 px-2 rounded-lg cursor-pointer ${
                  drawerTab === 'LOG' ? 'bg-slate-700 text-white' : 'text-slate-400'
                }`}
              >
                Ledger
              </button>
            </div>

            {drawerTab === 'SQUAD' && (
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {me.squad.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                    Raise your paddle to draft players!
                  </div>
                ) : (
                  me.squad.map((p, idx) => {
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
                            <div className="text-xs font-semibold text-white truncate">
                              {idx + 1}. {p.name}
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

            {drawerTab === 'TABLES' && (
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {room.participants.map((p) => (
                  <div
                    key={p.clientId}
                    className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-white">
                        {p.name} ({p.franchiseId})
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {p.squad.length}/{room.squadSize} drafted
                      </div>
                    </div>
                    <span className="font-mono font-bold text-amber-400">
                      ₹{p.purse.toFixed(1)}Cr
                    </span>
                  </div>
                ))}
              </div>
            )}

            {drawerTab === 'LOG' && (
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {auc.logs.map((l) => (
                  <div
                    key={l.id}
                    className="px-3 py-2 rounded-lg bg-slate-950/75 border border-slate-800/80 text-xs text-slate-200"
                  >
                    {l.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 5. FRIENDS CARD STAT BATTLE
  // =========================================================================
  if (room.phase === 'CARD_BATTLE' && myMatchup && me) {
    const home = room.participants.find((p) => p.clientId === myMatchup.homeClientId)!;
    const away = room.participants.find((p) => p.clientId === myMatchup.awayClientId)!;
    const iAmHome = home.clientId === clientId;
    const opponent = iAmHome ? away : home;

    const myFranchise = getFranchiseById(me.franchiseId);
    const oppFranchise = getFranchiseById(opponent.franchiseId);

    // Toss Decision screen
    if (myMatchup.tossWinnerClientId && !myMatchup.tossComplete) {
      const iWonToss = myMatchup.tossWinnerClientId === clientId;
      return (
        <div className="max-w-2xl mx-auto rounded-2xl border border-slate-800 bg-slate-900/95 p-8 text-center space-y-5">
          <Trophy className="w-10 h-10 text-amber-400 mx-auto" />
          <h2 className="font-display text-3xl font-extrabold text-white">
            {iWonToss ? 'You Won the Toss!' : `${opponent.name} Won the Toss!`}
          </h2>
          <p className="text-sm text-slate-300">
            Card Battle Bonus: {me.name} +{iAmHome ? myMatchup.homeBonusRuns : myMatchup.awayBonusRuns}{' '}
            Runs · {opponent.name} +{iAmHome ? myMatchup.awayBonusRuns : myMatchup.homeBonusRuns} Runs
          </p>
          {iWonToss ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() =>
                  sendMsg({ type: 'battle:choose_toss', matchupId: myMatchup.id, batFirst: true })
                }
                className="py-3.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display text-lg font-bold cursor-pointer"
              >
                Bat First
              </button>
              <button
                type="button"
                onClick={() =>
                  sendMsg({ type: 'battle:choose_toss', matchupId: myMatchup.id, batFirst: false })
                }
                className="py-3.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-display text-lg font-bold cursor-pointer"
              >
                Bowl First
              </button>
            </div>
          ) : (
            <div className="text-xs text-sky-300">
              Waiting for {opponent.name} to choose Bat or Bowl...
            </div>
          )}
        </div>
      );
    }

    // Waiting if our matchup already completed toss while another friend pair finishes
    if (myMatchup.tossComplete) {
      return (
        <div className="max-w-xl mx-auto rounded-2xl border border-slate-800 bg-slate-900/95 p-8 text-center space-y-3">
          <div className="font-display text-2xl font-bold text-white">
            Your Matchup is Ready!
          </div>
          <p className="text-sm text-slate-400">
            Waiting for other friends in Room {room.roomCode} to finish their Card Battle...
          </p>
        </div>
      );
    }

    const chooserId =
      myMatchup.roundIdx % 2 === 0 ? myMatchup.homeClientId : myMatchup.awayClientId;
    const isMyTurnToPick = chooserId === clientId && !myMatchup.activeDuelResult;
    const myCard = me.squad[myMatchup.roundIdx];
    const oppCard = opponent.squad[myMatchup.roundIdx];
    const duelRes = myMatchup.activeDuelResult;
    const iWonDuel =
      duelRes &&
      ((iAmHome && duelRes.winner === 'USER') || (!iAmHome && duelRes.winner === 'AI'));

    return (
      <div className="space-y-6">
        {me.isHost && (
          <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/25 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-emerald-100">
              <strong className="text-white">Auction Complete:</strong> Play the Card Stat Battle
              for +Bonus Runs, or jump the entire squad straight into the 2-Over Cricket Match now.
            </div>
            <button
              type="button"
              onClick={() => sendMsg({ type: 'battle:skip_to_match' })}
              className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0 transition-colors"
            >
              <FastForward className="w-3.5 h-3.5" />
              <span>Play 2-Over Cricket Match Now</span>
            </button>
          </div>
        )}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <TeamCrest franchise={myFranchise} size="sm" />
            <div>
              <div className="text-xs text-slate-400">{me.name} (You)</div>
              <div className="font-mono text-lg font-bold text-emerald-400 tabular-nums">
                {iAmHome ? myMatchup.homeDuelsWon : myMatchup.awayDuelsWon} Duels · +
                {iAmHome ? myMatchup.homeBonusRuns : myMatchup.awayBonusRuns} Runs
              </div>
            </div>
          </div>

          <div className="text-center">
            <div className="text-xs text-amber-400 font-semibold flex items-center justify-center gap-1.5">
              <Swords className="w-3.5 h-3.5" />
              <span>
                Duel {myMatchup.roundIdx + 1} of {room.squadSize}
              </span>
            </div>
            <div className="font-display text-xl font-bold text-white mt-0.5">
              {duelRes
                ? iWonDuel
                  ? 'You Won This Duel!'
                  : duelRes.winner === 'DRAW'
                  ? 'Exact Draw!'
                  : `${opponent.name} Won Duel!`
                : isMyTurnToPick
                ? 'Your Turn — Click a Stat on Your Card'
                : `Waiting for ${opponent.name} to Pick Stat...`}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-slate-400">{opponent.name}</div>
              <div className="font-mono text-lg font-bold text-sky-400 tabular-nums">
                {iAmHome ? myMatchup.awayDuelsWon : myMatchup.homeDuelsWon} Duels · +
                {iAmHome ? myMatchup.awayBonusRuns : myMatchup.homeBonusRuns} Runs
              </div>
            </div>
            <TeamCrest franchise={oppFranchise} size="sm" />
          </div>
        </div>

        {duelRes && (
          <div className="rounded-xl border border-amber-400/40 bg-slate-900 p-4 flex items-center justify-between gap-4">
            <div className="text-sm text-slate-200">
              <strong>{STAT_META[duelRes.chosenStat].label}:</strong>{' '}
              <span className="font-mono text-white">
                {STAT_META[duelRes.chosenStat].format(iAmHome ? duelRes.userValue : duelRes.aiValue)}
              </span>{' '}
              vs{' '}
              <span className="font-mono text-white">
                {STAT_META[duelRes.chosenStat].format(iAmHome ? duelRes.aiValue : duelRes.userValue)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => sendMsg({ type: 'battle:next_duel', matchupId: myMatchup.id })}
              className="py-2 px-5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display text-base font-bold cursor-pointer"
            >
              {myMatchup.roundIdx + 1 < room.squadSize ? 'Next Duel' : 'Proceed to Toss'}
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-11 gap-5 items-center">
          <div className="lg:col-span-5">
            {myCard && (
              <PlayerCard
                player={myCard}
                selectableStat={isMyTurnToPick}
                activeStat={duelRes?.chosenStat ?? null}
                isWinnerCard={Boolean(iWonDuel)}
                onSelectStat={(stat: StatKey) =>
                  sendMsg({ type: 'battle:select_stat', matchupId: myMatchup.id, stat })
                }
              />
            )}
          </div>
          <div className="lg:col-span-1 flex justify-center">
            <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center font-display text-xl font-bold text-amber-400">
              VS
            </div>
          </div>
          <div className="lg:col-span-5">
            {oppCard && (
              <PlayerCard
                player={oppCard}
                activeStat={duelRes?.chosenStat ?? null}
                isWinnerCard={Boolean(duelRes && !iWonDuel && duelRes.winner !== 'DRAW')}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 6. FRIENDS 2-OVER MINI MATCH
  // =========================================================================
  if (room.phase === 'MINI_MATCH' && myMatchup && me) {
    if (myMatchup.matchComplete) {
      return (
        <div className="max-w-xl mx-auto rounded-2xl border border-slate-800 bg-slate-900/95 p-8 text-center space-y-3">
          <Trophy className="w-10 h-10 text-amber-400 mx-auto" />
          <div className="font-display text-3xl font-bold text-white">
            {myMatchup.winnerClientId === clientId ? 'You Won Your Match!' : 'Match Completed'}
          </div>
          <p className="text-sm text-slate-400">
            {myMatchup.winMarginText}. Waiting for other friends in the room to finish...
          </p>
        </div>
      );
    }

    const battingPlayer = room.participants.find((p) => p.clientId === myMatchup.battingClientId)!;
    const bowlingPlayer = room.participants.find((p) => p.clientId === myMatchup.bowlingClientId)!;
    const isMeBatting = battingPlayer.clientId === clientId;
    const isMeBowling = bowlingPlayer.clientId === clientId;
    const batFranchise = getFranchiseById(battingPlayer.franchiseId);

    const activeBatter =
      battingPlayer.squad.find((p) => p.id === myMatchup.activeBatterId) || battingPlayer.squad[0];
    const currentOver = myMatchup.ballsBowled < 6 ? 1 : 2;
    const activeBowlerId = currentOver === 1 ? myMatchup.over1BowlerId : myMatchup.over2BowlerId;
    const activeBowler =
      bowlingPlayer.squad.find((p) => p.id === activeBowlerId) || bowlingPlayer.squad[0];
    const target = myMatchup.inningsNum === 2 ? myMatchup.innings1Runs + 1 : null;

    return (
      <div className="space-y-6">
        {/* Live Match Scorebug */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <TeamCrest franchise={batFranchise} size="md" />
            <div>
              <div className="text-xs text-slate-400">
                {battingPlayer.name} ({batFranchise.shortName}) · Innings {myMatchup.inningsNum}
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-4xl font-bold text-white tabular-nums">
                  {myMatchup.runs}/{myMatchup.wickets}
                </span>
                <span className="font-mono text-base text-amber-400 tabular-nums">
                  ({Math.floor(myMatchup.ballsBowled / 6)}.{myMatchup.ballsBowled % 6} / 2.0 ov)
                </span>
              </div>
            </div>
          </div>

          <div className="text-right">
            {target !== null ? (
              <div>
                <div className="text-xs text-slate-400">Target {target}</div>
                <div className="font-mono text-lg font-bold text-amber-400 tabular-nums">
                  Need {Math.max(0, target - myMatchup.runs)} off {12 - myMatchup.ballsBowled}b
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400">
                Bowling: <strong className="text-white">{bowlingPlayer.name}</strong>
              </div>
            )}
          </div>
        </div>

        {myMatchup.inningsBreak ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-8 text-center space-y-4">
            <h3 className="font-display text-3xl font-bold text-white">
              Innings Break · {battingPlayer.name} Posted {myMatchup.innings1Runs}/
              {myMatchup.innings1Wickets}
            </h3>
            <button
              type="button"
              onClick={() => sendMsg({ type: 'match:start_innings_2', matchupId: myMatchup.id })}
              className="py-3 px-6 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display text-lg font-bold cursor-pointer"
            >
              Start 2nd Innings Chase
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-4">
              {/* Batter & Bowler cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/95">
                  <div className="text-xs text-slate-400 flex items-center justify-between">
                    <span>Batter</span>
                    {activeBatter.inForm && <Flame className="w-3.5 h-3.5 text-amber-400" />}
                  </div>
                  <div className="font-display text-xl font-bold text-white mt-0.5">
                    {activeBatter.name}
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    SR {activeBatter.stats.strikeRate.toFixed(1)}
                  </div>
                </div>
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/95">
                  <div className="text-xs text-slate-400 flex items-center justify-between">
                    <span>Bowler (Over {currentOver})</span>
                    {activeBowler.inForm && <Flame className="w-3.5 h-3.5 text-amber-400" />}
                  </div>
                  <div className="font-display text-xl font-bold text-white mt-0.5">
                    {activeBowler.name}
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    Econ {activeBowler.stats.economy.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Next Batter Picker */}
              {isMeBatting && (myMatchup.ballsBowled === 0 || myMatchup.needsNewBatter) && (
                <div className="p-4 rounded-xl border border-amber-400/40 bg-slate-900 space-y-2">
                  <div className="text-xs font-semibold text-amber-300">
                    Select Active Batter:
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {battingPlayer.squad
                      .filter((p) => !myMatchup.batterStats[p.id]?.out)
                      .map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            sendMsg({
                              type: 'match:select_batter',
                              matchupId: myMatchup.id,
                              playerId: p.id,
                            })
                          }
                          className={`p-2 rounded-lg border text-left text-xs cursor-pointer ${
                            p.id === activeBatter.id
                              ? 'border-amber-400 bg-amber-500/15 text-white'
                              : 'border-slate-800 bg-slate-950 text-slate-300'
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Bowler Picker at start of over */}
              {isMeBowling && (myMatchup.ballsBowled === 0 || myMatchup.ballsBowled === 6) && (
                <div className="p-4 rounded-xl border border-sky-400/40 bg-slate-900 space-y-2">
                  <div className="text-xs font-semibold text-sky-300">
                    Select Bowler for Over {currentOver}:
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {bowlingPlayer.squad.map((p) => {
                      const disabled = currentOver === 2 && p.id === myMatchup.over1BowlerId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            sendMsg({
                              type: 'match:select_bowler',
                              matchupId: myMatchup.id,
                              overIndex: currentOver as 1 | 2,
                              playerId: p.id,
                            })
                          }
                          className={`p-2 rounded-lg border text-left text-xs cursor-pointer disabled:opacity-40 ${
                            p.id === activeBowler.id
                              ? 'border-sky-400 bg-sky-500/15 text-white'
                              : 'border-slate-800 bg-slate-950 text-slate-300'
                          }`}
                        >
                          {p.name} ({p.stats.economy.toFixed(1)})
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Live Action Panel */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-5 space-y-4">
                {isMeBatting ? (
                  myMatchup.pendingShot ? (
                    <div className="py-4 text-center text-sm text-amber-300 font-semibold">
                      Shot locked ({myMatchup.pendingShot})! Waiting for {bowlingPlayer.name}'s
                      delivery...
                    </div>
                  ) : (
                    <>
                      <div className="text-sm font-semibold text-white">Choose Your Shot:</div>
                      <div className="grid grid-cols-3 gap-3">
                        {(
                          [
                            { id: 'DEFEND', label: 'Defend', icon: Shield },
                            { id: 'BALANCED', label: 'Balanced', icon: Target },
                            { id: 'LOFTED', label: 'Lofted', icon: Zap },
                          ] as const
                        ).map((s) => {
                          const Icon = s.icon;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() =>
                                sendMsg({
                                  type: 'match:submit_shot',
                                  matchupId: myMatchup.id,
                                  shot: s.id as ShotStyle,
                                })
                              }
                              className="p-3.5 rounded-xl border border-slate-700 bg-slate-950 hover:border-amber-400 text-left cursor-pointer"
                            >
                              <div className="flex items-center gap-1.5 font-semibold text-sm text-white">
                                <Icon className="w-4 h-4 text-amber-400" />
                                <span>{s.label}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )
                ) : myMatchup.pendingDelivery ? (
                  <div className="py-4 text-center text-sm text-sky-300 font-semibold">
                    Delivery locked ({myMatchup.pendingDelivery})! Waiting for {battingPlayer.name}'s
                    shot...
                  </div>
                ) : (
                  <>
                    <div className="text-sm font-semibold text-white">Choose Delivery Type:</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {(['YORKER', 'BOUNCER', 'SLOWER', 'SPIN'] as DeliveryType[]).map((del) => (
                        <button
                          key={del}
                          type="button"
                          onClick={() =>
                            sendMsg({
                              type: 'match:submit_delivery',
                              matchupId: myMatchup.id,
                              delivery: del,
                            })
                          }
                          className="p-3.5 rounded-xl border border-slate-700 bg-slate-950 hover:border-sky-400 text-center text-xs font-bold text-sky-300 cursor-pointer"
                        >
                          {del}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Commentary */}
            <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/95 p-5 space-y-3">
              <div className="font-display text-xl font-bold text-white pb-2 border-b border-slate-800">
                Live Ball-by-Ball Commentary
              </div>
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {myMatchup.ballLog.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    Waiting for Ball 0.1...
                  </div>
                ) : (
                  myMatchup.ballLog.map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-200"
                    >
                      <div className="font-mono font-bold text-amber-400 mb-0.5">
                        {ev.outcome === 'W' ? 'WICKET' : `${ev.runs} RUN(S)`}
                      </div>
                      {ev.commentary}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // 7. POST-MATCH LEADERBOARD & NEXT ROUND
  // =========================================================================
  if (room.phase === 'POST_MATCH' && me) {
    const sorted = [...room.participants]
      .filter((p) => !p.isAi)
      .sort((a, b) => b.wins - a.wins || b.purse - a.purse);

    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
            <div>
              <div className="text-xs font-semibold text-amber-400">
                Room {room.roomCode} · Match {room.matchNumber} Complete
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-extrabold text-white mt-1">
                Friends Group Leaderboard
              </h2>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">Your Prize Earned</div>
              <div className="font-mono text-2xl font-bold text-emerald-400 tabular-nums">
                +₹{me.lastEarned.toFixed(2)} Cr
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {sorted.map((p, idx) => {
              const f = getFranchiseById(p.franchiseId);
              return (
                <div
                  key={p.clientId}
                  className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${
                    p.clientId === clientId
                      ? 'bg-amber-500/10 border-amber-400/60'
                      : 'bg-slate-950/75 border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <span className="font-mono text-lg font-bold text-slate-400 w-6">
                      #{idx + 1}
                    </span>
                    <TeamCrest franchise={f} size="sm" />
                    <div>
                      <div className="font-display text-xl font-bold text-white">
                        {p.name} · {f.shortName}
                      </div>
                      <div className="text-xs text-slate-400 font-mono tabular-nums">
                        {p.wins} Wins / {p.matchesPlayed} Matches · Last +₹{p.lastEarned.toFixed(0)}Cr
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Updated Purse</div>
                    <div className="font-mono text-xl font-bold text-amber-400 tabular-nums">
                      ₹{p.purse.toFixed(2)} Cr
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <button
              type="button"
              onClick={handleLeaveRoom}
              className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
            >
              Exit Friends Room
            </button>

            {me.isHost ? (
              <button
                type="button"
                onClick={() => sendMsg({ type: 'room:next_round' })}
                className="w-full sm:w-auto py-3.5 px-7 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display text-lg font-bold tracking-wide inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Next Match &amp; Retentions (+₹80 Cr Grant)</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            ) : (
              <span className="text-xs text-slate-400">
                Waiting for Host to advance to Match {room.matchNumber + 1}...
              </span>
            )}
          </div>
        </div>

        {currentUid && (
          <GlobalRankingDashboard
            currentUid={currentUid}
            captainName={defaultPlayerName || me.name}
            favoriteFranchiseId={me.franchiseId}
            careerWins={careerWins}
            careerMatches={careerMatches}
            currentPurse={me.purse}
            emailVerified={emailVerified}
          />
        )}
      </div>
    );
  }

  return null;
};
