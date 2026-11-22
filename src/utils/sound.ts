class SoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    duration: number,
    type: OscillatorType = 'triangle',
    gainVal = 0.08,
    delay = 0
  ) {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playBid() {
    this.playTone(540, 0.09, 'triangle', 0.07);
    this.playTone(720, 0.1, 'triangle', 0.05, 0.04);
  }

  playPaddle() {
    this.playTone(620, 0.08, 'triangle', 0.08);
    this.playTone(840, 0.09, 'sine', 0.06, 0.03);
  }

  playGavelTick() {
    this.playTone(300, 0.06, 'sine', 0.045);
  }

  playSold() {
    this.playTone(440, 0.12, 'sine', 0.09, 0);
    this.playTone(554.37, 0.12, 'sine', 0.09, 0.08);
    this.playTone(659.25, 0.24, 'sine', 0.1, 0.16);
  }

  playDuelWin() {
    this.playTone(587.33, 0.12, 'triangle', 0.08, 0);
    this.playTone(880, 0.22, 'triangle', 0.09, 0.09);
  }

  playDuelLoss() {
    this.playTone(320, 0.15, 'sawtooth', 0.04, 0);
    this.playTone(240, 0.2, 'sawtooth', 0.04, 0.1);
  }

  playBatHit(isBoundary: boolean, isSix: boolean) {
    if (isSix) {
      this.playTone(660, 0.14, 'triangle', 0.1, 0);
      this.playTone(880, 0.18, 'sine', 0.09, 0.07);
      this.playTone(1046.5, 0.25, 'sine', 0.08, 0.15);
    } else if (isBoundary) {
      this.playTone(520, 0.12, 'triangle', 0.09, 0);
      this.playTone(784, 0.18, 'sine', 0.08, 0.07);
    } else {
      this.playTone(380, 0.07, 'triangle', 0.06, 0);
    }
  }

  playWicket() {
    this.playTone(220, 0.16, 'sawtooth', 0.07, 0);
    this.playTone(146.8, 0.28, 'sawtooth', 0.07, 0.11);
  }
}

export const soundFX = new SoundEngine();
