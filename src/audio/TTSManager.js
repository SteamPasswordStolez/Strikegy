// src/audio/TTSManager.js
// HF9-B2: High-quality TTS hook (via server proxy) + channel-style post FX.
//
// NOTE
// - This module does NOT talk to paid TTS providers directly.
// - Provide a small server proxy (see /server/tts-proxy) or set window.__strikegyTTS.endpoint.

function djb2Hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  // eslint-disable-next-line no-bitwise
  return (h >>> 0).toString(16);
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

export class TTSManager {
  constructor({ soundSystem = null } = {}) {
    this.soundSystem = soundSystem || (typeof window !== 'undefined' ? window.soundSystem : null);
    this.enabled = true;
    this.endpoint = '';
    this.defaultLang = 'en-GB';
    this.voiceMap = {
      RAVEN: 'raven',
      HART: 'hart',
      SHADE: 'shade',
      NOVA: 'nova',
      KESTREL: 'kestrel',
      ATLAS: 'atlas',
      YARA: 'yara',
      RUNE: 'rune',
      NEMESIS: 'nemesis',
      UNKNOWN: 'unknown',
    };

    this._ctx = null;
    this._out = null;
    this._cache = new Map(); // key -> AudioBuffer
    this._current = null; // {src, gain}

    this.reloadConfig();
  }

  reloadConfig() {
    // Priority: window.__strikegyTTS > localStorage > defaults
    try {
      const cfg = (typeof window !== 'undefined' && window.__strikegyTTS) ? window.__strikegyTTS : null;
      if (cfg && typeof cfg === 'object') {
        if (typeof cfg.enabled === 'boolean') this.enabled = cfg.enabled;
        if (typeof cfg.endpoint === 'string') this.endpoint = cfg.endpoint;
        if (typeof cfg.lang === 'string') this.defaultLang = cfg.lang;
        if (typeof cfg.fallback === 'string') this.fallbackMode = cfg.fallback;
      }
    } catch { /* ignore */ }

    try {
      const ep = localStorage.getItem('strikegy_tts_endpoint');
      const en = localStorage.getItem('strikegy_tts_enabled');
      const lang = localStorage.getItem('strikegy_tts_lang');
      const fb = localStorage.getItem('strikegy_tts_fallback');
      if (typeof ep === 'string' && ep.trim()) this.endpoint = ep.trim();
      if (typeof en === 'string') this.enabled = en === '1' || en.toLowerCase() === 'true';
      if (typeof lang === 'string' && lang.trim()) this.defaultLang = lang.trim();
      if (typeof fb === 'string' && fb.trim()) this.fallbackMode = fb.trim();
    } catch { /* ignore */ }

    // If no endpoint is set, we can still speak via fallback (optional).
    const fbMode = String(this.fallbackMode || 'auto').toLowerCase();
    if (!this.endpoint && fbMode === 'off') this.enabled = true;
  }

  _ensureAudio() {
    // Reuse SoundSystem context if possible.
    if (this._ctx && this._out) return this._ctx;
    const ss = this.soundSystem;
    try {
      ss?._ensure?.();
    } catch { /* ignore */ }

    const ctx = ss?.ctx || this._ctx || null;
    const out = ss?.master || null;

    if (ctx && out) {
      this._ctx = ctx;
      this._out = out;
      return ctx;
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this._ctx = new Ctx();
    this._out = this._ctx.destination;
    return this._ctx;
  }

  unlock() {
    const ctx = this._ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  stop() {
    try {
      if (this._current?.src) this._current.src.stop();
    } catch { /* ignore */ }
    this._current = null;
  }

  _voiceForSpeakerTag(tag) {
    const t = String(tag || '').toUpperCase();
    return this.voiceMap[t] || 'default';
  }

  async _fetchBuffer({ text, lang, voice, style } = {}) {
    const ep = String(this.endpoint || '').trim();
    if (!ep) return null;

    const payload = {
      text: String(text || ''),
      lang: String(lang || this.defaultLang || 'en-GB'),
      voice: String(voice || 'default'),
      style: String(style || ''),
      format: 'mp3',
    };

    const res = await fetch(ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    if (!arr || arr.byteLength < 32) return null;

    const ctx = this._ensureAudio();
    if (!ctx) return null;
    return await new Promise((resolve) => {
      try {
        ctx.decodeAudioData(arr.slice(0), (buf) => resolve(buf), () => resolve(null));
      } catch {
        resolve(null);
      }
    });
  }

  _buildChannelFx({ channel = 'RADIO', urgent = false } = {}) {
    const ctx = this._ensureAudio();
    if (!ctx) return null;

    const ch = String(channel || 'RADIO').toUpperCase();
    const input = ctx.createGain();
    const output = ctx.createGain();
    output.gain.value = 1.0;

    // Base filters
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 140;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1250;
    bp.Q.value = 0.9;

    // Mild saturation
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeSaturationCurve(0.65);
    shaper.oversample = '2x';

    // Channel tuning
    if (ch === 'WHISPER') {
      hp.frequency.value = 240;
      lp.frequency.value = 1800;
      bp.frequency.value = 900;
      output.gain.value = 0.75;
    } else if (ch === 'INTERCOM' || ch === 'HQ') {
      hp.frequency.value = 220;
      lp.frequency.value = 3200;
      bp.frequency.value = 1050;
      output.gain.value = 0.90;
    } else if (ch === 'NOISE' || ch === 'UNKNOWN') {
      hp.frequency.value = 180;
      lp.frequency.value = 2800;
      bp.frequency.value = 900;
      output.gain.value = 0.85;
    } else {
      // RADIO / OVERWATCH
      hp.frequency.value = urgent ? 220 : 160;
      lp.frequency.value = urgent ? 4200 : 3600;
      bp.frequency.value = urgent ? 1450 : 1250;
      bp.Q.value = urgent ? 1.15 : 0.95;
      output.gain.value = urgent ? 0.98 : 0.92;
    }

    // Wiring: input -> hp -> bp -> shaper -> lp -> output
    input.connect(hp);
    hp.connect(bp);
    bp.connect(shaper);
    shaper.connect(lp);
    lp.connect(output);

    // Optional static layer for RADIO-ish channels
    let noiseSrc = null;
    let noiseGain = null;
    if (ch === 'RADIO' || ch === 'OVERWATCH' || ch === 'NOISE' || ch === 'UNKNOWN') {
      const n = ctx.createBufferSource();
      n.buffer = makeNoiseBuffer(ctx, 0.35);
      n.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 1100;
      nf.Q.value = 0.6;
      noiseGain = ctx.createGain();
      noiseGain.gain.value = (ch === 'NOISE' || ch === 'UNKNOWN') ? 0.055 : 0.020;
      n.connect(nf);
      nf.connect(noiseGain);
      noiseGain.connect(output);
      try { n.start(); } catch { /* ignore */ }
      noiseSrc = n;
    }

    return { input, output, noiseSrc, noiseGain };
  }

  async _speakWebSpeech({ text, lang, channel='RADIO', urgent=false, volume=1.0 }) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return false;
    const t = String(text || '').trim();
    if (!t) return false;
    // Small radio cues
    try {
      if (this.soundSystem?.play) this.soundSystem.play(urgent ? 'comms_urgent' : 'radio_in');
    } catch {}

    const synth = window.speechSynthesis;
    const L = String(lang || this.defaultLang || 'en-GB');
    const pickVoice = () => {
      const voices = synth.getVoices ? synth.getVoices() : [];
      const want = String(L || '').toLowerCase();          // e.g., 'en-gb'
      const wantBase = want.split('-')[0];                 // 'en'

      // Prefer voices that match the requested language family.
      const pool = voices.filter(v => String(v.lang || '').toLowerCase().startsWith(wantBase));
      const candidates = pool.length ? pool : voices;

      const score = (v) => {
        const name = String(v.name || '').toLowerCase();
        const lang = String(v.lang || '').toLowerCase();
        let sc = 0;

        // Exact match and UK bias
        if (lang === want) sc += 90;
        if (want === 'en-gb') {
          if (lang === 'en-gb') sc += 45;
          if (name.includes('uk') || name.includes('united kingdom')) sc += 30;
          if (name.includes('google') && name.includes('uk') && name.includes('english')) sc += 45;
        }

        // Quality hints
        if (name.includes('neural') || name.includes('natural')) sc += 25;
        if (name.includes('google')) sc += 18;
        if (name.includes('microsoft') || name.includes('siri')) sc += 8;

        // Prefer English labeling
        if (name.includes('english')) sc += 10;
        if (lang.startsWith('en')) sc += 6;

        // Avoid Korean voices here
        if (lang.startsWith('ko') || name.includes('korean') || name.includes('한국')) sc -= 60;

        if (v.default) sc += 4;
        return sc;
      };

      return candidates.sort((a, b) => score(b) - score(a))[0] || null;
    };

    // Some browsers load voices async.
    await new Promise((resolve) => {
      let done = false;
      const tick = () => {
        if (done) return;
        const v = (synth.getVoices && synth.getVoices()) || [];
        if (v.length) { done = true; resolve(true); return; }
        setTimeout(tick, 80);
      };
      tick();
      setTimeout(()=>{ if(!done){ done=true; resolve(false);} }, 600);
    });

    return await new Promise((resolve) => {
      try {
        const u = new SpeechSynthesisUtterance(t);
        u.lang = L;
        const v = pickVoice();
        if (v) u.voice = v;
        // Tune by channel
        const ch = String(channel||'RADIO').toUpperCase();
        // HF9-C3a-3: slightly faster pacing for dialogue (more back-and-forth feel)
        const baseRate = 1.15;
        const whisperRate = 1.08;
        const urgentBoost = 0.08;
        u.rate = ch==='WHISPER' ? whisperRate : (urgent ? (baseRate + urgentBoost) : baseRate);
        u.pitch = ch==='WHISPER' ? 0.92 : 1.0;
        u.volume = Math.max(0, Math.min(1, Number(volume)||1)) * 0.95;
        u.onend = () => {
          try { if (this.soundSystem?.play) this.soundSystem.play('radio_out'); } catch {}
          resolve(true);
        };
        u.onerror = () => resolve(false);
        synth.speak(u);
      } catch {
        resolve(false);
      }
    });
  }

  async speak({
    text,
    lang,
    speakerTag,
    channel = 'RADIO',
    urgent = false,
    voice = null,
    style = null,
    volume = 1.0,
    maxWaitMs = 6500,
  } = {}) {
    const t = String(text || '').trim();
    if (!t) return false;

    this.reloadConfig();
    if (!this.enabled) return false;
    const ep = String(this.endpoint || '').trim();
    const fbMode = String(this.fallbackMode || 'auto').toLowerCase();
    if (!ep) {
      if (fbMode === 'off') return false;
      // fallback: local WebSpeech (optional)
      if (fbMode === 'webspeech' || fbMode === 'auto') {
        return await this._speakWebSpeech({ text: t, lang: lang || this.defaultLang, channel, urgent, volume });
      }
      return false;
    }

    const ctx = this._ensureAudio();
    if (!ctx || !this._out) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    // One voice at a time.
    // NOTE: Do not force-cancel previous line; allow overlap/queue (WebSpeech queues naturally).
    // this.stop();

    const v = String(voice || this._voiceForSpeakerTag(speakerTag));
    const L = String(lang || this.defaultLang || 'en-GB');
    const cacheKey = djb2Hash(`${L}|${v}|${String(style || '')}|${t}`);

    let buf = this._cache.get(cacheKey) || null;
    if (!buf) {
      buf = await this._fetchBuffer({ text: t, lang: L, voice: v, style: style || '' });
      if (!buf) return false;
      this._cache.set(cacheKey, buf);
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const gain = ctx.createGain();
    gain.gain.value = clamp(Number(volume) || 1.0, 0, 2.0) * 0.88;

    const fx = this._buildChannelFx({ channel, urgent }) || null;
    if (fx) {
      src.connect(fx.input);
      fx.output.connect(gain);
    } else {
      src.connect(gain);
    }
    gain.connect(this._out);

    this._current = { src, gain, fx };

    const ended = new Promise((resolve) => {
      src.onended = () => resolve(true);
    });
    try { src.start(); } catch { return false; }

    // Safety: don't hang mission flow if audio is long or provider stalls.
    const maxMs = clamp(Number(maxWaitMs) || 6500, 600, 20000);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), maxMs));

    await Promise.race([ended, timeout]);

    // Clean noise loop if any.
    try { fx?.noiseSrc?.stop?.(); } catch { /* ignore */ }
    return true;
  }
}

function makeNoiseBuffer(ctx, seconds = 0.35) {
  const sec = clamp(Number(seconds) || 0.35, 0.1, 1.2);
  const len = Math.max(1, Math.floor(ctx.sampleRate * sec));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    // slight decay
    const k = 1 - (i / len);
    d[i] = (Math.random() * 2 - 1) * (0.35 + 0.65 * k);
  }
  return buf;
}

function makeSaturationCurve(amount = 0.65) {
  const k = clamp(Number(amount) || 0.65, 0, 3) * 50;
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}
