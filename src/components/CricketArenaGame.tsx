import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  FastForward,
  Gamepad2,
  Shield,
  Target,
  Zap,
} from 'lucide-react';
import { BallEvent, DeliveryType, DraftedPlayer, Franchise, ShotStyle } from '../types/game';
import {
  CameraPreset3D,
  Cricket3DController,
  CricketerVisual,
  FlightVisual3D,
  mountCricketStadium3D,
} from '../utils/cricket3dScene';
import { soundFX } from '../utils/sound';
import { PlayerPortrait } from './TeamCrest';

export type ShotDirection = 'OFF' | 'STRAIGHT' | 'LEG';
export type TimingGrade = 'PERFECT' | 'GOOD' | 'EARLY_LATE';

interface CricketArenaGameProps {
  battingFranchise: Franchise;
  bowlingFranchise: Franchise;
  batterName: string;
  bowlerName: string;
  batterPlayer?: DraftedPlayer;
  bowlerPlayer?: DraftedPlayer;
  isUserBatting: boolean;
  isUserBowling: boolean;
  disabled?: boolean;
  waitingText?: string | null;
  latestBall: BallEvent | null;
  superBallMode?: boolean;
  ballNumber: number;
  animateBeforeCommit?: boolean;
  onPlayShot: (
    shot: ShotStyle,
    direction: ShotDirection,
    timing: TimingGrade,
    timingBonus: number
  ) => void;
  onPlayDelivery: (delivery: DeliveryType, direction: ShotDirection) => void;
}

type AnimStage = 'IDLE' | 'RUNUP' | 'DELIVERY' | 'FLIGHT';

interface PendingAction {
  kind: 'SHOT' | 'DELIVERY';
  shot?: ShotStyle;
  delivery?: DeliveryType;
  direction: ShotDirection;
  timing: TimingGrade;
  timingBonus: number;
}

function evaluateTiming(meterPos: number): { grade: TimingGrade; bonus: number; label: string } {
  const distFromCenter = Math.abs(meterPos - 0.5);
  if (distFromCenter <= 0.11) {
    return { grade: 'PERFECT', bonus: 0.12, label: 'PERFECT TIMING' };
  }
  if (distFromCenter <= 0.27) {
    return { grade: 'GOOD', bonus: 0.04, label: 'GOOD TIMING' };
  }
  return { grade: 'EARLY_LATE', bonus: -0.07, label: meterPos < 0.5 ? 'EARLY SWING' : 'LATE SWING' };
}

function parseShotAndDelivery(raw: string): { shot: ShotStyle; delivery: DeliveryType } {
  const upper = raw.toUpperCase();
  let shot: ShotStyle = 'BALANCED';
  if (upper.includes('DEFEND')) shot = 'DEFEND';
  else if (upper.includes('LOFTED')) shot = 'LOFTED';

  let delivery: DeliveryType = 'YORKER';
  if (upper.includes('BOUNCER')) delivery = 'BOUNCER';
  else if (upper.includes('SLOWER')) delivery = 'SLOWER';
  else if (upper.includes('SPIN')) delivery = 'SPIN';

  return { shot, delivery };
}

function toCricketerVisual(player: DraftedPlayer | undefined, fallbackName: string, isBowler: boolean): CricketerVisual {
  if (player) {
    return {
      id: player.id,
      name: player.name,
      jerseyNumber: player.jerseyNumber,
      role: player.role,
      battingHand: player.battingHand,
    };
  }
  const slug = fallbackName.toLowerCase().replace(/[^a-z0-9]/g, '') || (isBowler ? 'bowler' : 'batter');
  return {
    id: slug,
    name: fallbackName,
    jerseyNumber: isBowler ? 93 : 18,
    role: isBowler ? 'Bowler' : 'Batter',
    battingHand: 'RHB',
  };
}

export const CricketArenaGame: React.FC<CricketArenaGameProps> = ({
  battingFranchise,
  bowlingFranchise,
  batterName,
  bowlerName,
  batterPlayer,
  bowlerPlayer,
  isUserBatting,
  isUserBowling,
  disabled = false,
  waitingText = null,
  latestBall,
  superBallMode = false,
  ballNumber,
  animateBeforeCommit = true,
  onPlayShot,
  onPlayDelivery,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const threeCtrlRef = useRef<Cricket3DController | null>(null);
  const meterCursorRef = useRef<HTMLDivElement | null>(null);
  const meterLabelRef = useRef<HTMLSpanElement | null>(null);

  const [direction, setDirection] = useState<ShotDirection>('STRAIGHT');
  const [selectedDelivery, setSelectedDelivery] = useState<DeliveryType>('YORKER');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset3D>('TV');
  const [fastMode, setFastMode] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [timingFeedback, setTimingFeedback] = useState<string | null>(null);
  const [flightOutcomeBanner, setFlightOutcomeBanner] = useState<{
    label: string;
    outcome: BallEvent['outcome'];
  } | null>(null);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const batterVis = toCricketerVisual(batterPlayer, batterName, false);
  const bowlerVis = toCricketerVisual(bowlerPlayer, bowlerName, true);

  const animRef = useRef<{
    stage: AnimStage;
    stageStart: number;
    pending: PendingAction | null;
    flight: FlightVisual3D;
    lastResolvedId: string | null;
    meterVal: number;
  }>({
    stage: 'IDLE',
    stageStart: performance.now(),
    pending: null,
    flight: {
      outcome: '1',
      direction: 'STRAIGHT',
      delivery: 'YORKER',
      shot: 'BALANCED',
      label: '',
    },
    lastResolvedId: latestBall?.id ?? null,
    meterVal: 0.5,
  });

  const callbacksRef = useRef({ onPlayShot, onPlayDelivery });
  callbacksRef.current = { onPlayShot, onPlayDelivery };

  const propsRef = useRef({
    battingFranchise,
    bowlingFranchise,
    batter: batterVis,
    bowler: bowlerVis,
    direction,
    selectedDelivery,
    cameraPreset,
    isUserBatting,
    isUserBowling,
    fastMode,
    reducedMotion,
    waitingText,
    animateBeforeCommit,
  });
  propsRef.current = {
    battingFranchise,
    bowlingFranchise,
    batter: batterVis,
    bowler: bowlerVis,
    direction,
    selectedDelivery,
    cameraPreset,
    isUserBatting,
    isUserBowling,
    fastMode,
    reducedMotion,
    waitingText,
    animateBeforeCommit,
  };

  // Trigger 3D delivery / ball flight when a new ball arrives
  useEffect(() => {
    if (!latestBall) return;
    if (animRef.current.lastResolvedId === latestBall.id) return;
    animRef.current.lastResolvedId = latestBall.id;

    const parsed = parseShotAndDelivery(latestBall.shotOrDelivery);
    const outcomeLabel =
      latestBall.outcome === 'W'
        ? 'WICKET!'
        : latestBall.outcome === '6'
        ? 'MAXIMUM 6!'
        : latestBall.outcome === '4'
        ? 'CRACKING 4!'
        : latestBall.outcome === '0'
        ? 'DOT BALL'
        : `${latestBall.runs} RUN${latestBall.runs === 1 ? '' : 'S'}`;

    animRef.current.flight = {
      outcome: latestBall.outcome,
      direction: propsRef.current.direction,
      delivery: parsed.delivery,
      shot: parsed.shot,
      label: outcomeLabel,
    };
    setFlightOutcomeBanner({ label: outcomeLabel, outcome: latestBall.outcome });

    if (!animateBeforeCommit) {
      if (latestBall.isWicket) soundFX.playWicket();
      else soundFX.playBatHit(latestBall.outcome === '4' || latestBall.outcome === '6', latestBall.outcome === '6');
      animRef.current.stage = fastMode || reducedMotion ? 'FLIGHT' : 'RUNUP';
      animRef.current.stageStart = performance.now();
      setIsAnimating(true);
    } else {
      animRef.current.stage = 'FLIGHT';
      animRef.current.stageStart = performance.now();
      setIsAnimating(true);
    }
  }, [latestBall, animateBeforeCommit, fastMode, reducedMotion]);

  // Mount Three.js 3D Stadium once and drive animation state + timing meter
  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    const p0 = propsRef.current;
    const ctrl = mountCricketStadium3D(mountEl, {
      stage: animRef.current.stage,
      stageElapsed: 0,
      runupDur: 480,
      deliveryDur: 380,
      flightDur: 1050,
      direction: p0.direction,
      selectedDelivery: p0.selectedDelivery,
      isUserBatting: p0.isUserBatting,
      waitingText: p0.waitingText,
      cameraPreset: p0.cameraPreset,
      flight: animRef.current.flight,
      battingFranchise: p0.battingFranchise,
      bowlingFranchise: p0.bowlingFranchise,
      batter: p0.batter,
      bowler: p0.bowler,
    });
    threeCtrlRef.current = ctrl;

    let rafId = 0;
    const tick = (now: number) => {
      const state = animRef.current;
      const p = propsRef.current;

      if (state.stage === 'IDLE' && !p.waitingText) {
        const osc = 0.5 + 0.48 * Math.sin(now * 0.0046);
        state.meterVal = osc;
        if (meterCursorRef.current) {
          meterCursorRef.current.style.left = `calc(${osc * 100}% - 3px)`;
        }
        if (meterLabelRef.current) {
          const dist = Math.abs(osc - 0.5);
          const nextLabel = dist <= 0.11 ? 'SWEET SPOT' : dist <= 0.27 ? 'GOOD' : 'TIMING...';
          if (meterLabelRef.current.textContent !== nextLabel) {
            meterLabelRef.current.textContent = nextLabel;
          }
        }
      }

      const elapsed = now - state.stageStart;
      const runupDur = p.fastMode || p.reducedMotion ? 110 : 480;
      const deliveryDur = p.fastMode || p.reducedMotion ? 110 : 380;
      const flightDur = p.fastMode || p.reducedMotion ? 360 : 1050;

      if (state.stage === 'RUNUP' && elapsed >= runupDur) {
        state.stage = 'DELIVERY';
        state.stageStart = now;
      } else if (state.stage === 'DELIVERY' && elapsed >= deliveryDur) {
        if (state.pending && p.animateBeforeCommit) {
          const act = state.pending;
          state.pending = null;
          if (act.kind === 'SHOT' && act.shot) {
            callbacksRef.current.onPlayShot(act.shot, act.direction, act.timing, act.timingBonus);
          } else if (act.kind === 'DELIVERY' && act.delivery) {
            callbacksRef.current.onPlayDelivery(act.delivery, act.direction);
          }
          state.stage = 'FLIGHT';
          state.stageStart = now;
        } else {
          state.stage = 'FLIGHT';
          state.stageStart = now;
        }
      } else if (state.stage === 'FLIGHT' && elapsed >= flightDur) {
        state.stage = 'IDLE';
        state.stageStart = now;
        setIsAnimating(false);
        setTimingFeedback(null);
        setFlightOutcomeBanner(null);
      }

      ctrl.updateState({
        stage: state.stage,
        stageElapsed: now - state.stageStart,
        runupDur,
        deliveryDur,
        flightDur,
        direction: p.direction,
        selectedDelivery: p.selectedDelivery,
        isUserBatting: p.isUserBatting,
        waitingText: p.waitingText,
        cameraPreset: p.cameraPreset,
        flight: state.flight,
        battingFranchise: p.battingFranchise,
        bowlingFranchise: p.bowlingFranchise,
        batter: p.batter,
        bowler: p.bowler,
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      ctrl.dispose();
      threeCtrlRef.current = null;
    };
  }, []);

  const triggerShot = useCallback(
    (shot: ShotStyle) => {
      if (disabled || isAnimating || !isUserBatting || waitingText) return;
      const meterPos = animRef.current.meterVal;
      const timing = evaluateTiming(meterPos);
      setTimingFeedback(timing.label);

      if (!animateBeforeCommit) {
        onPlayShot(shot, direction, timing.grade, timing.bonus);
        return;
      }

      animRef.current.pending = {
        kind: 'SHOT',
        shot,
        direction,
        timing: timing.grade,
        timingBonus: timing.bonus,
      };
      animRef.current.stage = 'RUNUP';
      animRef.current.stageStart = performance.now();
      setIsAnimating(true);
    },
    [disabled, isAnimating, isUserBatting, waitingText, animateBeforeCommit, direction, onPlayShot]
  );

  const triggerDelivery = useCallback(
    (del: DeliveryType) => {
      if (disabled || isAnimating || !isUserBowling || waitingText) return;
      setSelectedDelivery(del);

      if (!animateBeforeCommit) {
        onPlayDelivery(del, direction);
        return;
      }

      animRef.current.pending = {
        kind: 'DELIVERY',
        delivery: del,
        direction,
        timing: 'GOOD',
        timingBonus: 0,
      };
      animRef.current.stage = 'RUNUP';
      animRef.current.stageStart = performance.now();
      setIsAnimating(true);
    },
    [disabled, isAnimating, isUserBowling, waitingText, animateBeforeCommit, direction, onPlayDelivery]
  );

  // Keyboard Arcade Controls (Arrow keys / A,W,D for Aim, 1/2/3/4 & Space for Shot/Bowl)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        setDirection('OFF');
      } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        setDirection('STRAIGHT');
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        setDirection('LEG');
      } else if (isUserBatting) {
        if (e.key === '1') triggerShot('DEFEND');
        else if (e.key === '2') triggerShot('BALANCED');
        else if (e.key === '3' || e.key === ' ') {
          e.preventDefault();
          triggerShot('LOFTED');
        }
      } else if (isUserBowling) {
        if (e.key === '1') triggerDelivery('YORKER');
        else if (e.key === '2') triggerDelivery('BOUNCER');
        else if (e.key === '3') triggerDelivery('SLOWER');
        else if (e.key === '4') triggerDelivery('SPIN');
        else if (e.key === ' ') {
          e.preventDefault();
          triggerDelivery(selectedDelivery);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isUserBatting, isUserBowling, selectedDelivery, triggerShot, triggerDelivery]);

  const controlsLocked = disabled || isAnimating || Boolean(waitingText);

  return (
    <div className="space-y-4">
      {/* Live 3D Three.js Cricket Stadium & Character Viewport */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden shadow-xl">
        <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 font-semibold text-white">
            <Gamepad2 className="w-4 h-4 text-amber-400" />
            <span>
              {superBallMode
                ? '3D Super Ball Arena'
                : `3D Live Stadium · Ball ${Math.min(12, ballNumber)}/12`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {timingFeedback && (
              <span className="font-mono font-bold text-emerald-400">{timingFeedback}</span>
            )}

            {/* 3D Camera Angle Switcher */}
            <div className="inline-flex rounded-lg bg-slate-950 border border-slate-800 p-0.5">
              {(
                [
                  { id: 'TV', label: 'TV Cam' },
                  { id: 'BOTH_FACES', label: 'Both Faces' },
                  { id: 'BOWLER', label: 'Bowler Cam' },
                ] as const
              ).map((cam) => (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => setCameraPreset(cam.id)}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap ${
                    cameraPreset === cam.id
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Camera className="w-3 h-3" />
                  <span>{cam.label}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setFastMode((v) => !v)}
              className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap ${
                fastMode
                  ? 'bg-amber-400 text-slate-950 border-amber-400'
                  : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-slate-500'
              }`}
            >
              <FastForward className="w-3 h-3" />
              <span>{fastMode ? 'Fast Anim On' : 'Fast Anim'}</span>
            </button>
          </div>
        </div>

        {/* Dedicated Three.js WebGL Mount (Zero backdrop-blur overlays) */}
        <div className="relative bg-[#091326] aspect-[800/420] min-h-[260px] w-full">
          <div
            ref={mountRef}
            className="w-full h-full"
            aria-label="3D cricket stadium with articulated batter and bowler wearing auctioned player faces"
          />

          {/* Top Outcome Callout Banner */}
          {flightOutcomeBanner && (
            <div className="absolute inset-x-0 top-3 flex justify-center pointer-events-none px-4">
              <div
                className={`px-5 py-1.5 rounded-lg border-2 bg-[#080D1A]/95 font-display text-lg font-bold tracking-wide shadow-lg ${
                  flightOutcomeBanner.outcome === 'W'
                    ? 'border-rose-500 text-rose-400'
                    : flightOutcomeBanner.outcome === '6'
                    ? 'border-amber-400 text-amber-300'
                    : flightOutcomeBanner.outcome === '4'
                    ? 'border-emerald-400 text-emerald-300'
                    : 'border-sky-400 text-sky-300'
                }`}
              >
                {flightOutcomeBanner.label}
              </div>
            </div>
          )}

          {/* Waiting Text Banner */}
          {waitingText && !flightOutcomeBanner && (
            <div className="absolute inset-x-0 top-3 flex justify-center pointer-events-none px-4">
              <div className="px-4 py-1.5 rounded-lg bg-[#080D1A]/95 border border-amber-400/50 text-xs font-semibold text-amber-300">
                {waitingText}
              </div>
            </div>
          )}

          {/* Bottom Corner Auctioned Player Badges (Solid dark fill, no backdrop-blur) */}
          <div className="absolute inset-x-3 bottom-2.5 flex items-center justify-between gap-2 pointer-events-none">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#080D1A]/90 border border-slate-700/80 max-w-[46%]">
              <PlayerPortrait
                playerId={batterVis.id}
                name={batterVis.name}
                role={batterVis.role}
                primaryColor={battingFranchise.primaryColor}
                secondaryColor={battingFranchise.secondaryColor}
                jerseyNumber={batterVis.jerseyNumber}
                variant="chip"
              />
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase text-amber-400">
                  BAT · {batterVis.battingHand}
                </div>
                <div className="text-xs font-semibold text-white truncate">
                  {batterVis.name} #{batterVis.jerseyNumber}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#080D1A]/90 border border-slate-700/80 max-w-[46%]">
              <div className="min-w-0 text-right">
                <div className="text-[10px] font-mono uppercase text-sky-400">
                  BOWL · {bowlingFranchise.shortName}
                </div>
                <div className="text-xs font-semibold text-white truncate">
                  {bowlerVis.name} #{bowlerVis.jerseyNumber}
                </div>
              </div>
              <PlayerPortrait
                playerId={bowlerVis.id}
                name={bowlerVis.name}
                role={bowlerVis.role}
                primaryColor={bowlingFranchise.primaryColor}
                secondaryColor={bowlingFranchise.secondaryColor}
                jerseyNumber={bowlerVis.jerseyNumber}
                variant="chip"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Video Game Controller Deck */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5 space-y-4">
        {/* Batting Timing Sweet-Spot Meter */}
        {isUserBatting && animateBeforeCommit && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">
                Shot Timing Meter (Hit center green zone for +12% power)
              </span>
              <span ref={meterLabelRef} className="font-mono text-emerald-400 tabular-nums">
                SWEET SPOT
              </span>
            </div>
            <div className="relative h-4 rounded-full bg-slate-950 border border-slate-700 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-rose-500/35 via-sky-500/30 to-rose-500/35" />
              <div
                className="absolute top-0 bottom-0 bg-emerald-500/60 border-x border-emerald-300"
                style={{ left: '39%', width: '22%' }}
              />
              <div
                ref={meterCursorRef}
                className="absolute top-0 bottom-0 w-1.5 bg-white shadow-[0_0_8px_#fff]"
                style={{ left: 'calc(50% - 3px)' }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          {/* Left: D-Pad Direction / Line Control */}
          <div className="md:col-span-5 flex flex-col items-center justify-center p-3 rounded-xl bg-slate-950/80 border border-slate-800">
            <div className="text-[11px] font-semibold text-slate-400 mb-2">
              {isUserBatting ? 'Aim Shot Direction (A / W / D)' : 'Bowl Line Target (A / W / D)'}
            </div>
            <div className="grid grid-cols-3 gap-1.5 w-44">
              <div />
              <button
                type="button"
                disabled={controlsLocked}
                onClick={() => setDirection('STRAIGHT')}
                className={`min-h-[42px] rounded-lg border flex flex-col items-center justify-center text-[10px] font-bold cursor-pointer transition-colors ${
                  direction === 'STRAIGHT'
                    ? 'bg-amber-400 border-amber-300 text-slate-950'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <ArrowUp className="w-4 h-4" />
                <span>STR</span>
              </button>
              <div />
              <button
                type="button"
                disabled={controlsLocked}
                onClick={() => setDirection('OFF')}
                className={`min-h-[42px] rounded-lg border flex flex-col items-center justify-center text-[10px] font-bold cursor-pointer transition-colors ${
                  direction === 'OFF'
                    ? 'bg-amber-400 border-amber-300 text-slate-950'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <ArrowLeft className="w-4 h-4" />
                <span>OFF</span>
              </button>
              <div className="min-h-[42px] rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-center">
                <ArrowDown className="w-3.5 h-3.5 text-slate-600" />
              </div>
              <button
                type="button"
                disabled={controlsLocked}
                onClick={() => setDirection('LEG')}
                className={`min-h-[42px] rounded-lg border flex flex-col items-center justify-center text-[10px] font-bold cursor-pointer transition-colors ${
                  direction === 'LEG'
                    ? 'bg-amber-400 border-amber-300 text-slate-950'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <ArrowRight className="w-4 h-4" />
                <span>LEG</span>
              </button>
            </div>
          </div>

          {/* Right: Arcade Action Buttons */}
          <div className="md:col-span-7 space-y-2.5">
            {isUserBatting ? (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white">
                    {superBallMode ? 'Super Ball Shot Buttons' : 'Swing Controller (Keys: 1 / 2 / 3 or Space)'}
                  </span>
                  <span className="text-slate-400">Aim: {direction}</span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    disabled={controlsLocked}
                    onClick={() => triggerShot('DEFEND')}
                    className="min-h-[68px] p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 active:scale-[0.98] disabled:opacity-45 text-left transition-all cursor-pointer"
                  >
                    <div className="flex items-center justify-between text-emerald-400 font-bold text-sm">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <Shield className="w-4 h-4" />
                        Defend
                      </span>
                      <span className="font-mono text-[11px] opacity-80">[1]</span>
                    </div>
                    <div className="text-[11px] text-slate-300 mt-1">Safe 1s &amp; 2s</div>
                  </button>

                  <button
                    type="button"
                    disabled={controlsLocked}
                    onClick={() => triggerShot('BALANCED')}
                    className="min-h-[68px] p-3 rounded-xl border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 active:scale-[0.98] disabled:opacity-45 text-left transition-all cursor-pointer"
                  >
                    <div className="flex items-center justify-between text-sky-300 font-bold text-sm">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <Target className="w-4 h-4" />
                        Drive
                      </span>
                      <span className="font-mono text-[11px] opacity-80">[2]</span>
                    </div>
                    <div className="text-[11px] text-slate-300 mt-1">Gap 4s &amp; control</div>
                  </button>

                  <button
                    type="button"
                    disabled={controlsLocked}
                    onClick={() => triggerShot('LOFTED')}
                    className="min-h-[68px] p-3 rounded-xl border border-amber-400 bg-amber-400 hover:bg-amber-300 active:scale-[0.98] disabled:opacity-45 text-left transition-all cursor-pointer"
                  >
                    <div className="flex items-center justify-between text-slate-950 font-bold text-sm">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <Zap className="w-4 h-4" />
                        Loft / 6
                      </span>
                      <span className="font-mono text-[11px]">[Space]</span>
                    </div>
                    <div className="text-[11px] text-slate-900 font-medium mt-1">Max Six Power</div>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white">
                    {superBallMode ? 'Super Ball Delivery Pad' : 'Bowling Controller (Keys: 1 / 2 / 3 / 4)'}
                  </span>
                  <span className="text-slate-400">Line: {direction}</span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {(
                    [
                      { id: 'YORKER', title: 'Yorker', keyHint: '1', desc: 'Toe-crushing dot / bowled' },
                      { id: 'BOUNCER', title: 'Bouncer', keyHint: '2', desc: 'Short pace & wicket threat' },
                      { id: 'SLOWER', title: 'Slower Ball', keyHint: '3', desc: 'Deceives lofted hitters' },
                      { id: 'SPIN', title: 'Spin', keyHint: '4', desc: 'Drift & tight economy' },
                    ] as const
                  ).map((del) => (
                    <button
                      key={del.id}
                      type="button"
                      disabled={controlsLocked}
                      onClick={() => triggerDelivery(del.id)}
                      className={`min-h-[54px] p-3 rounded-xl border active:scale-[0.98] disabled:opacity-45 text-left transition-all cursor-pointer ${
                        selectedDelivery === del.id
                          ? 'border-sky-400 bg-sky-500/20'
                          : 'border-slate-700 bg-slate-950/80 hover:border-sky-400'
                      }`}
                    >
                      <div className="flex items-center justify-between text-sm font-bold text-sky-300">
                        <span className="whitespace-nowrap">{del.title}</span>
                        <span className="font-mono text-[11px] text-slate-400">[{del.keyHint}]</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{del.desc}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
