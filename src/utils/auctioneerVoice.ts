export type StudioFemaleVoiceId = 'Kore' | 'Zephyr';

export interface AuctioneerVoiceOption {
  id: StudioFemaleVoiceId;
  label: string;
}

const STUDIO_FEMALE_VOICES: AuctioneerVoiceOption[] = [
  { id: 'Kore', label: 'Ananya · Warm & Sweet (Studio)' },
  { id: 'Zephyr', label: 'Meera · Bright & Clear (Studio)' },
];

const FALLBACK_FEMALE_VOICE_PATTERNS = [
  /microsoft neerja online/i,
  /microsoft aria online/i,
  /microsoft jenny online/i,
  /microsoft sonia online/i,
  /microsoft libby online/i,
  /google uk english female/i,
  /neerja/i,
  /heera/i,
  /veena/i,
  /aditi/i,
  /raveena/i,
  /aria/i,
  /jenny/i,
  /sonia/i,
  /libby/i,
  /natasha/i,
  /samantha/i,
  /victoria/i,
  /karen/i,
  /moira/i,
  /tessa/i,
  /zira/i,
  /google us english/i,
  /female/i,
  /woman/i,
];

const KNOWN_MALE_VOICE_PATTERN =
  /\b(david|mark|daniel|rishi|ravi|george|alex|fred|thomas|oliver|james|ryan|guy|prabhat|male)\b/i;

function base64ToWavUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

function normalizeAuctionSpeech(raw: string): string {
  return raw
    .replace(/₹/g, '')
    .replace(/(\d+)\.0\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function createSilentWavUrl(): string {
  const buffer = new ArrayBuffer(46);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 38, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, 2, true);
  view.setInt16(44, 0, true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

const SPEECH_RATE_STORAGE_KEY = 'ipl_auctioneer_speech_rate';
const MIN_SPEECH_RATE = 0.65;
const MAX_SPEECH_RATE = 1.15;
const DEFAULT_SPEECH_RATE = 0.95;

function clampSpeechRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_SPEECH_RATE;
  return Math.round(Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, rate)) * 100) / 100;
}

class AuctioneerVoiceEngine {
  private enabled = true;
  private selectedVoiceId: StudioFemaleVoiceId = 'Kore';
  private speechRate = DEFAULT_SPEECH_RATE;
  private listeners = new Set<() => void>();
  private speaking = false;
  private fetching = false;
  private playerAudio: HTMLAudioElement | null = null;
  private audioUnlocked = false;
  private activeAbortController: AbortController | null = null;
  private activeToken = 0;
  private activePriority: 'high' | 'normal' = 'normal';
  private queuedNormalText: string | null = null;
  private serverTtsCooldownUntil = 0;

  private audioUrlCache = new Map<string, string>();

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(SPEECH_RATE_STORAGE_KEY);
        if (saved !== null) {
          this.speechRate = clampSpeechRate(parseFloat(saved));
        }
      } catch {
        // ignore storage errors
      }

      if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.addEventListener('voiceschanged', () => {
          this.notify();
        });
      }

      const unlock = () => {
        this.unlockAudioElement();
      };
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
    }
  }

  private ensureAudioElement(): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;
    if (!this.playerAudio) {
      this.playerAudio = new Audio();
      this.playerAudio.preload = 'auto';
      this.playerAudio.volume = 1.0;
    }
    return this.playerAudio;
  }

  private unlockAudioElement() {
    if (this.audioUnlocked || typeof window === 'undefined') return;
    const audio = this.ensureAudioElement();
    if (!audio) return;
    try {
      const silentUrl = createSilentWavUrl();
      audio.src = silentUrl;
      audio.muted = true;
      const p = audio.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
          this.audioUnlocked = true;
          URL.revokeObjectURL(silentUrl);
        }).catch(() => {
          audio.muted = false;
          URL.revokeObjectURL(silentUrl);
        });
      } else {
        audio.muted = false;
        this.audioUnlocked = true;
      }
    } catch {
      // ignore unlock errors
    }
  }

  private notify() {
    this.listeners.forEach((cb) => cb());
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  isBusy(): boolean {
    return this.enabled && (this.speaking || this.fetching);
  }

  setEnabled(val: boolean) {
    this.enabled = val;
    if (!val) {
      this.stop();
    } else {
      this.unlockAudioElement();
    }
    this.notify();
  }

  getVoiceOptions(): AuctioneerVoiceOption[] {
    return STUDIO_FEMALE_VOICES;
  }

  getSelectedVoiceId(): StudioFemaleVoiceId {
    return this.selectedVoiceId;
  }

  setVoiceId(id: StudioFemaleVoiceId) {
    this.selectedVoiceId = id;
    this.notify();
  }

  getSpeechRate(): number {
    return this.speechRate;
  }

  setSpeechRate(rate: number) {
    const next = clampSpeechRate(rate);
    this.speechRate = next;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(SPEECH_RATE_STORAGE_KEY, next.toFixed(2));
      } catch {
        // ignore storage errors
      }
    }
    if (this.playerAudio) {
      const pitchAudio = this.playerAudio as HTMLAudioElement & {
        preservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
      };
      pitchAudio.preservesPitch = true;
      pitchAudio.webkitPreservesPitch = true;
      this.playerAudio.playbackRate = next;
    }
    this.notify();
  }

  private setCachedUrl(key: string, url: string) {
    if (this.audioUrlCache.size >= 160) {
      const oldestKey = this.audioUrlCache.keys().next().value;
      if (oldestKey) {
        const oldUrl = this.audioUrlCache.get(oldestKey);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        this.audioUrlCache.delete(oldestKey);
      }
    }
    this.audioUrlCache.set(key, url);
  }

  private async fetchStudioWavUrl(
    text: string,
    voiceId: StudioFemaleVoiceId,
    externalSignal?: AbortSignal
  ): Promise<{ url: string | null; aborted: boolean }> {
    if (typeof window === 'undefined') return { url: null, aborted: false };

    const normalized = normalizeAuctionSpeech(text);
    if (!normalized) return { url: null, aborted: false };
    const cacheKey = `${voiceId}:${normalized}`;

    const cached = this.audioUrlCache.get(cacheKey);
    if (cached) return { url: cached, aborted: false };

    if (Date.now() < this.serverTtsCooldownUntil) {
      return { url: null, aborted: false };
    }

    const timeoutController = new AbortController();
    const timeoutId = window.setTimeout(() => timeoutController.abort(), 8500);
    const onExternalAbort = () => timeoutController.abort();
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: normalized, voiceName: voiceId }),
        signal: timeoutController.signal,
      });

      if (!res.ok) {
        this.serverTtsCooldownUntil = Date.now() + 30_000;
        return { url: null, aborted: false };
      }

      const data = (await res.json()) as {
        audioBase64?: string | null;
        fallback?: boolean;
        retryAfterMs?: number;
      };
      if (data.fallback || !data.audioBase64) {
        const retryMs =
          typeof data.retryAfterMs === 'number' && data.retryAfterMs > 0
            ? data.retryAfterMs
            : 45_000;
        this.serverTtsCooldownUntil = Date.now() + retryMs;
        return { url: null, aborted: false };
      }

      const url = base64ToWavUrl(data.audioBase64);
      this.setCachedUrl(cacheKey, url);
      return { url, aborted: false };
    } catch {
      if (externalSignal?.aborted) {
        return { url: null, aborted: true };
      }
      // Timed out or transient network failure — fall back to browser voice without long cooldown
      return { url: null, aborted: false };
    } finally {
      window.clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  prewarmPhrase(_text: string) {}
  prewarmCommonCalls() {}

  stop() {
    this.activeToken += 1;
    this.queuedNormalText = null;
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    if (this.playerAudio) {
      this.playerAudio.onplay = null;
      this.playerAudio.onended = null;
      this.playerAudio.onerror = null;
      this.playerAudio.pause();
      this.playerAudio.currentTime = 0;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (this.speaking || this.fetching) {
      this.speaking = false;
      this.fetching = false;
      this.notify();
    }
  }

  private pickFallbackBrowserVoice(): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const all = window.speechSynthesis.getVoices();
    const english = all.filter((v) => v.lang.toLowerCase().startsWith('en'));
    const pool = english.length > 0 ? english : all;
    for (const pattern of FALLBACK_FEMALE_VOICE_PATTERNS) {
      const match = pool.find(
        (v) => pattern.test(v.name) && !KNOWN_MALE_VOICE_PATTERN.test(v.name)
      );
      if (match) return match;
    }
    const nonMale = pool.find((v) => !KNOWN_MALE_VOICE_PATTERN.test(v.name));
    return nonMale || pool[0] || null;
  }

  private flushQueuedNormal() {
    const next = this.queuedNormalText;
    this.queuedNormalText = null;
    if (next && this.enabled) {
      this.speak(next, 'normal');
    }
  }

  private speakBrowserFallback(text: string, token: number) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (token !== this.activeToken || !this.enabled) return;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(normalizeAuctionSpeech(text));
      const voice = this.pickFallbackBrowserVoice();
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = 'en-IN';
      }

      utterance.pitch = this.selectedVoiceId === 'Zephyr' ? 1.07 : 1.03;
      utterance.rate = this.speechRate;
      utterance.volume = 1.0;

      utterance.onstart = () => {
        if (token === this.activeToken) {
          this.speaking = true;
          this.notify();
        }
      };
      utterance.onend = () => {
        if (token === this.activeToken) {
          this.speaking = false;
          this.activePriority = 'normal';
          this.notify();
          this.flushQueuedNormal();
        }
      };
      utterance.onerror = () => {
        if (token === this.activeToken) {
          this.speaking = false;
          this.activePriority = 'normal';
          this.notify();
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      this.speaking = false;
    }
  }

  speak(text: string, priority: 'high' | 'normal' = 'normal') {
    const cleaned = normalizeAuctionSpeech(text);
    if (!this.enabled || !cleaned || typeof window === 'undefined') return;

    // Queue normal calls smoothly if something is actively fetching or speaking rather than cutting mid-word
    if (priority === 'normal' && (this.speaking || this.fetching)) {
      this.queuedNormalText = cleaned;
      return;
    }

    if (priority === 'high') {
      this.queuedNormalText = null;
    }

    const token = ++this.activeToken;
    this.activePriority = priority;

    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    if (this.playerAudio) {
      this.playerAudio.onplay = null;
      this.playerAudio.onended = null;
      this.playerAudio.onerror = null;
      this.playerAudio.pause();
      this.playerAudio.currentTime = 0;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    const controller = new AbortController();
    this.activeAbortController = controller;
    this.speaking = false;
    this.fetching = true;
    this.notify();
    const voiceId = this.selectedVoiceId;

    void this.fetchStudioWavUrl(cleaned, voiceId, controller.signal).then(({ url, aborted }) => {
      if (token === this.activeToken) {
        this.fetching = false;
      }
      if (aborted || token !== this.activeToken || !this.enabled) {
        this.notify();
        return;
      }

      if (!url) {
        this.notify();
        this.speakBrowserFallback(cleaned, token);
        return;
      }

      const audio = this.ensureAudioElement();
      if (!audio) {
        this.speakBrowserFallback(cleaned, token);
        return;
      }

      audio.onplay = () => {
        if (token === this.activeToken) {
          this.audioUnlocked = true;
          this.speaking = true;
          this.notify();
        }
      };
      audio.onended = () => {
        if (token === this.activeToken) {
          this.speaking = false;
          this.activePriority = 'normal';
          this.notify();
          this.flushQueuedNormal();
        }
      };
      audio.onerror = () => {
        if (token === this.activeToken) {
          this.speaking = false;
          this.notify();
          this.speakBrowserFallback(cleaned, token);
        }
      };

      audio.muted = false;
      audio.volume = 1.0;
      audio.src = url;
      audio.currentTime = 0;
      const pitchAudio = audio as HTMLAudioElement & {
        preservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
      };
      pitchAudio.preservesPitch = true;
      pitchAudio.webkitPreservesPitch = true;
      audio.playbackRate = this.speechRate;
      this.speaking = true;
      this.notify();

      audio.play().catch(() => {
        if (token === this.activeToken) {
          this.speaking = false;
          this.notify();
          // If autoplay was blocked inside an iframe or audio failed, fall back cleanly instead of silence
          this.speakBrowserFallback(cleaned, token);
        }
      });
    });
  }

  testVoice() {
    this.unlockAudioElement();
    this.speak('Welcome to the IPL Mega Auction! Let us begin bidding.', 'high');
  }
}

export const auctioneerVoice = new AuctioneerVoiceEngine();
