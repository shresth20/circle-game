/* Procedural sound effects + optional speech narration.
   Everything is synthesised with WebAudio, so the game needs no audio files
   and works offline. Replace any effect by editing the recipe in SFX below. */
window.ZD = window.ZD || {};

(function () {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let ambientNodes = null;
  const state = {
    muted: ZD.prefs.get('muted', false),
    voice: ZD.prefs.get('voice', true),
    ready: false,
  };

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = state.muted ? 0 : 0.9;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 1;
    sfxBus.connect(master);
    state.ready = true;
    return true;
  }

  function now() {
    return ctx.currentTime;
  }

  /* ---- building blocks -------------------------------------------------- */
  function tone({ type = 'sine', freq = 440, to = null, dur = 0.2, vol = 0.3, attack = 0.005, decay = null, delay = 0, detune = 0, bus = sfxBus }) {
    const t0 = now() + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    osc.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (decay || dur));
    osc.connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + (decay || dur) + 0.05);
  }

  function noise({ dur = 0.3, vol = 0.3, delay = 0, filter = 'lowpass', freq = 1000, to = null, q = 1, attack = 0.005, bus = sfxBus }) {
    const t0 = now() + delay;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t0);
    if (to) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /* ---- effect recipes --------------------------------------------------- */
  const SFX = {
    click: () => {
      tone({ type: 'triangle', freq: 660, to: 880, dur: 0.07, vol: 0.18 });
      noise({ dur: 0.05, vol: 0.08, filter: 'highpass', freq: 2000 });
    },
    pop: () => tone({ type: 'sine', freq: 520, to: 1040, dur: 0.12, vol: 0.22 }),
    select: () => {
      tone({ type: 'square', freq: 523, dur: 0.08, vol: 0.12 });
      tone({ type: 'square', freq: 784, dur: 0.12, vol: 0.12, delay: 0.07 });
    },
    tick: () => tone({ type: 'sine', freq: 1200, dur: 0.04, vol: 0.1 }),
    whoosh: () => {
      noise({ dur: 0.45, vol: 0.5, filter: 'bandpass', freq: 400, to: 2600, q: 0.8, attack: 0.06 });
      tone({ type: 'sine', freq: 180, to: 900, dur: 0.4, vol: 0.12 });
    },
    lock: () => {
      tone({ type: 'sine', freq: 880, dur: 0.06, vol: 0.2 });
      tone({ type: 'sine', freq: 1320, dur: 0.1, vol: 0.2, delay: 0.06 });
    },
    pass: () => {
      tone({ type: 'sine', freq: 660, to: 1320, dur: 0.25, vol: 0.3 });
      noise({ dur: 0.3, vol: 0.25, filter: 'bandpass', freq: 1800, to: 4000, q: 1.5 });
      tone({ type: 'triangle', freq: 1760, dur: 0.3, vol: 0.12, delay: 0.1 });
    },
    crack: () => {
      noise({ dur: 0.25, vol: 0.6, filter: 'highpass', freq: 2500, attack: 0.001 });
      noise({ dur: 0.12, vol: 0.5, filter: 'bandpass', freq: 900, q: 2, attack: 0.001 });
      tone({ type: 'square', freq: 2400, to: 600, dur: 0.18, vol: 0.12 });
      for (let i = 0; i < 6; i++) {
        tone({ type: 'sine', freq: 3000 + Math.random() * 3000, dur: 0.05, vol: 0.08, delay: 0.05 + i * 0.045 });
      }
    },
    shatter: () => {
      noise({ dur: 0.6, vol: 0.7, filter: 'highpass', freq: 1800, attack: 0.001 });
      for (let i = 0; i < 14; i++) {
        tone({ type: 'triangle', freq: 2000 + Math.random() * 4500, dur: 0.08, vol: 0.07, delay: Math.random() * 0.5 });
      }
      tone({ type: 'sine', freq: 120, to: 40, dur: 0.5, vol: 0.4 });
    },
    thud: () => {
      tone({ type: 'sine', freq: 140, to: 40, dur: 0.3, vol: 0.6 });
      noise({ dur: 0.18, vol: 0.4, filter: 'lowpass', freq: 500, attack: 0.001 });
    },
    squish: () => {
      noise({ dur: 0.25, vol: 0.35, filter: 'lowpass', freq: 1400, to: 200, q: 3 });
      tone({ type: 'sawtooth', freq: 300, to: 90, dur: 0.25, vol: 0.12 });
    },
    bonk: () => {
      tone({ type: 'triangle', freq: 420, to: 160, dur: 0.22, vol: 0.4 });
      tone({ type: 'sine', freq: 900, to: 300, dur: 0.1, vol: 0.15 });
    },
    groan: () => {
      const base = 110 + Math.random() * 40;
      tone({ type: 'sawtooth', freq: base, to: base * 0.7, dur: 0.7, vol: 0.14, attack: 0.08 });
      tone({ type: 'square', freq: base * 1.5, to: base, dur: 0.7, vol: 0.05, attack: 0.1, detune: 12 });
      noise({ dur: 0.7, vol: 0.08, filter: 'bandpass', freq: 300, q: 4, attack: 0.1 });
    },
    scream: () => {
      tone({ type: 'sawtooth', freq: 500, to: 900, dur: 0.35, vol: 0.12, attack: 0.02 });
      tone({ type: 'sawtooth', freq: 505, to: 720, dur: 0.4, vol: 0.08, attack: 0.02, detune: 20 });
    },
    yay: () => {
      [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.18, vol: 0.2, delay: i * 0.09 }));
    },
    success: () => {
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.22, vol: 0.22, delay: i * 0.08 }));
      noise({ dur: 0.5, vol: 0.12, filter: 'highpass', freq: 5000, attack: 0.05, delay: 0.2 });
    },
    fail: () => {
      tone({ type: 'sawtooth', freq: 300, to: 180, dur: 0.3, vol: 0.18 });
      tone({ type: 'sawtooth', freq: 240, to: 120, dur: 0.45, vol: 0.18, delay: 0.25 });
    },
    heart: () => {
      tone({ type: 'square', freq: 440, to: 220, dur: 0.2, vol: 0.15 });
      noise({ dur: 0.15, vol: 0.2, filter: 'highpass', freq: 3000 });
    },
    siren: () => {
      for (let i = 0; i < 3; i++) {
        tone({ type: 'sawtooth', freq: 440, to: 880, dur: 0.6, vol: 0.09, attack: 0.1, delay: i * 1.2 });
        tone({ type: 'sawtooth', freq: 880, to: 440, dur: 0.6, vol: 0.09, attack: 0.1, delay: i * 1.2 + 0.6 });
      }
    },
    alarm: () => {
      tone({ type: 'square', freq: 740, dur: 0.12, vol: 0.1 });
      tone({ type: 'square', freq: 740, dur: 0.12, vol: 0.1, delay: 0.2 });
    },
    step: () => {
      noise({ dur: 0.07, vol: 0.18, filter: 'lowpass', freq: 700, attack: 0.001 });
      tone({ type: 'sine', freq: 120, to: 60, dur: 0.07, vol: 0.2 });
    },
    swoosh: () => noise({ dur: 0.5, vol: 0.3, filter: 'bandpass', freq: 300, to: 1600, q: 0.7, attack: 0.1 }),
    shield: () => {
      tone({ type: 'sine', freq: 220, to: 880, dur: 0.9, vol: 0.2, attack: 0.1 });
      tone({ type: 'triangle', freq: 330, to: 1320, dur: 0.9, vol: 0.1, attack: 0.1 });
      noise({ dur: 1.0, vol: 0.15, filter: 'bandpass', freq: 800, to: 3200, q: 2, attack: 0.2 });
    },
    unlock: () => {
      tone({ type: 'square', freq: 392, dur: 0.1, vol: 0.12 });
      tone({ type: 'square', freq: 523, dur: 0.1, vol: 0.12, delay: 0.1 });
      tone({ type: 'square', freq: 784, dur: 0.25, vol: 0.14, delay: 0.2 });
      noise({ dur: 0.4, vol: 0.12, filter: 'bandpass', freq: 2000, to: 5000, q: 2, delay: 0.2 });
    },
    fanfare: () => {
      const seq = [[523, 0], [523, 0.12], [523, 0.24], [659, 0.36], [784, 0.6], [659, 0.78], [784, 0.9], [1046, 1.1]];
      seq.forEach(([f, d]) => {
        tone({ type: 'square', freq: f, dur: 0.22, vol: 0.12, delay: d });
        tone({ type: 'triangle', freq: f / 2, dur: 0.25, vol: 0.12, delay: d });
      });
      noise({ dur: 1.2, vol: 0.1, filter: 'highpass', freq: 6000, attack: 0.1, delay: 0.9 });
    },
    gameover: () => {
      [392, 370, 349, 330].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.5, vol: 0.2, delay: i * 0.42 }));
      tone({ type: 'sine', freq: 110, to: 55, dur: 2, vol: 0.2, delay: 1.5 });
    },
    sparkle: () => {
      for (let i = 0; i < 5; i++) tone({ type: 'sine', freq: 1500 + Math.random() * 2500, dur: 0.1, vol: 0.08, delay: i * 0.05 });
    },
    flip: () => {
      tone({ type: 'sine', freq: 700, to: 1100, dur: 0.1, vol: 0.18 });
      tone({ type: 'sine', freq: 1100, to: 1500, dur: 0.12, vol: 0.14, delay: 0.09 });
    },
    drag: () => tone({ type: 'sine', freq: 300 + Math.random() * 200, dur: 0.03, vol: 0.05 }),
  };

  function ambient(on) {
    if (!ensure()) return;
    if (on && !ambientNodes) {
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 320;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.11;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 140;
      lfo.connect(lfoGain).connect(f.frequency);
      const drone = ctx.createOscillator();
      drone.type = 'sine';
      drone.frequency.value = 55;
      const dg = ctx.createGain();
      dg.gain.value = 0.35;
      src.connect(f).connect(g);
      drone.connect(dg).connect(g);
      g.connect(master);
      src.start();
      lfo.start();
      drone.start();
      g.gain.exponentialRampToValueAtTime(0.09, now() + 2);
      ambientNodes = { g, src, lfo, drone };
    } else if (!on && ambientNodes) {
      const a = ambientNodes;
      ambientNodes = null;
      a.g.gain.exponentialRampToValueAtTime(0.0001, now() + 1);
      setTimeout(() => {
        a.src.stop();
        a.lfo.stop();
        a.drone.stop();
      }, 1200);
    }
  }

  const audio = {
    get muted() {
      return state.muted;
    },
    get voiceEnabled() {
      return state.voice;
    },
    get ready() {
      return state.ready;
    },
    /* Call from a user gesture (tap) to unlock audio on mobile browsers. */
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      // silent buffer kick for iOS
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    },
    play(name) {
      if (!ensure() || state.muted) return;
      if (ctx.state === 'suspended') ctx.resume();
      const fx = SFX[name];
      if (fx) fx();
    },
    setMuted(m) {
      state.muted = m;
      ZD.prefs.set('muted', m);
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, now(), 0.02);
      if (m) audio.stopSpeech();
    },
    ambient,
    setVoice(v) {
      state.voice = v;
      ZD.prefs.set('voice', v);
      if (!v) audio.stopSpeech();
    },
    /* Narration through the browser speech engine (captions are always shown). */
    say(text) {
      if (!state.voice || state.muted || !('speechSynthesis' in window) || !text) return;
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = (window.I18n && I18n.langCode) || 'en-US';
        u.rate = 1.0;
        u.pitch = 1.0;
        u.volume = 0.9;
        speechSynthesis.speak(u);
      } catch (e) {
        /* ignore */
      }
    },
    stopSpeech() {
      if ('speechSynthesis' in window) {
        try {
          speechSynthesis.cancel();
        } catch (e) {
          /* ignore */
        }
      }
    },
  };

  ZD.audio = audio;
})();
