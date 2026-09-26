import type { WeaponClass } from '@/weapons/weaponData';

interface GunVoice {
  /** Low-pass cutoff of the crack, Hz. */
  cutoff: number;
  /** Body thump frequency, Hz. */
  thump: number;
  decay: number;
  gain: number;
}

const VOICES: Record<WeaponClass, GunVoice> = {
  ar: { cutoff: 5200, thump: 90, decay: 0.16, gain: 0.55 },
  smg: { cutoff: 6500, thump: 120, decay: 0.11, gain: 0.45 },
  lmg: { cutoff: 4200, thump: 75, decay: 0.2, gain: 0.6 },
  sg: { cutoff: 2800, thump: 60, decay: 0.3, gain: 0.8 },
  dmr: { cutoff: 4000, thump: 70, decay: 0.28, gain: 0.7 },
  sr: { cutoff: 3200, thump: 55, decay: 0.45, gain: 0.85 },
  pistol: { cutoff: 6000, thump: 140, decay: 0.12, gain: 0.45 },
};

/**
 * Placeholder synthesized SFX (no asset files yet). Real samples replace
 * these in a later milestone; the call sites stay the same.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  constructor(private volume: number) {}

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.5);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  gunshot(cls: WeaponClass, ads: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const v = VOICES[cls];
    const t = ctx.currentTime;
    const pitch = 0.94 + Math.random() * 0.12;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = pitch;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(v.cutoff * pitch, t);
    lp.frequency.exponentialRampToValueAtTime(400, t + v.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(v.gain * (ads ? 0.9 : 1), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + v.decay);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + v.decay + 0.02);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(v.thump * 2 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(v.thump * 0.5, t + 0.09);
    const og = ctx.createGain();
    og.gain.setValueAtTime(v.gain * 0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  private blip(freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  hit(headshot: boolean, killed: boolean): void {
    if (killed) {
      this.blip(660, 0.12, 0.25, 'triangle');
      setTimeout(() => this.blip(990, 0.16, 0.22, 'triangle'), 60);
    } else if (headshot) this.blip(1800, 0.08, 0.2, 'triangle');
    else this.blip(1200, 0.04, 0.12, 'square');
  }

  click(): void {
    this.blip(2400, 0.025, 0.15, 'square');
  }

  reload(): void {
    this.blip(700, 0.05, 0.12, 'square');
    setTimeout(() => this.blip(500, 0.05, 0.1, 'square'), 90);
  }

  land(): void {
    this.blip(90, 0.1, 0.3);
  }
}
