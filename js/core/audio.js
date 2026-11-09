/* Procedural sound effects + read-aloud + looping theme music (assets/audio/theme-song.webm, .mp3 fallback).
   Every effect is synthesised with WebAudio, so the game needs no audio files
   and works offline.  say() is the read-aloud fallback used by I18n.say when
   no recorded clip exists (browser speech, in the current language). Replace any effect by editing the recipe in SFX below.
   Audio is silenced while the page is inactive (tab hidden / window blurred):
   see setActive(), driven from main.js. */
window.ZD = window.ZD || {};

(function () {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let ambientNodes = null;
  /* Background theme: a looping music file, routed through the master gain
     so mute / page-inactive silence it like every other sound.
     Opus/WebM (64 kbps, ~1.3 MB); the MP3 is only fetched by browsers that
     cannot play WebM Opus (older iOS Safari). */
  const MUSIC_SRC = new Audio().canPlayType('audio/webm; codecs="opus"') ? 'assets/audio/theme-song.webm' : 'assets/audio/theme-song.mp3';
  const MUSIC_VOL = 0.35;
  let musicEl = null;
  let musicBus = null;
  let musicOn = false;
  const state = {
    muted: ZD.prefs.get('muted', false),
    active: !document.hidden,
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
    /* zombie timer: a soft heartbeat in the last seconds */
    heartbeat: () => {
      tone({ type: 'sine', freq: 70, to: 45, dur: 0.14, vol: 0.32 });
      tone({ type: 'sine', freq: 62, to: 40, dur: 0.16, vol: 0.24, delay: 0.2 });
    },
    /* glass reseals with a new opening */
    reform: () => {
      [880, 1175, 1568].forEach((f, i) => tone({ type: 'sine', freq: f, dur: 0.16, vol: 0.1, delay: i * 0.06 }));
      noise({ dur: 0.35, vol: 0.08, filter: 'highpass', freq: 4000, attack: 0.05 });
    },
    /* camera pushes in on the wall: a soft low swell */
    focus: () => {
      noise({ dur: 0.9, vol: 0.12, filter: 'lowpass', freq: 220, to: 900, q: 0.6, attack: 0.35 });
      tone({ type: 'sine', freq: 110, to: 165, dur: 0.9, vol: 0.06, attack: 0.3 });
    },
    /* the window's rim lights switch on: a bright neon "tink" + buzz */
    lights: () => {
      tone({ type: 'triangle', freq: 1046, to: 1568, dur: 0.16, vol: 0.08 });
      tone({ type: 'sawtooth', freq: 120, dur: 0.22, vol: 0.025, attack: 0.02 });
      noise({ dur: 0.25, vol: 0.04, filter: 'highpass', freq: 5000, attack: 0.02 });
    },
    /* an answer is picked: a punchy lock-in on the window */
    pick: () => {
      tone({ type: 'sine', freq: 130, to: 60, dur: 0.16, vol: 0.22 });
      tone({ type: 'square', freq: 660, to: 990, dur: 0.08, vol: 0.08 });
      tone({ type: 'sine', freq: 1320, dur: 0.2, vol: 0.12, delay: 0.05 });
    },
    /* camera pulls back to the wide shot: a reversed whoosh */
    pullback: () => noise({ dur: 0.5, vol: 0.16, filter: 'bandpass', freq: 1500, to: 320, q: 0.8, attack: 0.18 }),
    /* a piece hits the zombie (not the final knockout) */
    hit: () => {
      tone({ type: 'square', freq: 220, to: 90, dur: 0.16, vol: 0.2 });
      noise({ dur: 0.12, vol: 0.25, filter: 'lowpass', freq: 1400 });
      tone({ type: 'triangle', freq: 880, to: 1320, dur: 0.12, vol: 0.12, delay: 0.08 });
    },
  };

  /* ---- read-aloud (browser speech) ------------------------------------- */
  const speech = window.speechSynthesis || null;
  /* Speaks `text`; resolves when it has been spoken (or cut off, or at once
     when nothing is spoken) - never rejects.  The instruction bar waits on
     it so a line is not replaced while it is still being read out. */
  function say(text) {
    if (!speech || !text || state.muted || !state.active) return Promise.resolve();
    try {
      speech.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = (window.I18n && I18n.langCode) || 'en-IN';
      u.rate = 0.95;
      const done = new Promise((res) => {
        u.onend = res;
        u.onerror = res;
      });
      speech.speak(u);
      return done;
    } catch (e) {
      /* speech not available - captions are always on screen */
      return Promise.resolve();
    }
  }
  function stopSpeech() {
    try {
      speech && speech.cancel();
    } catch (e) {
      /* ignore */
    }
  }

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

  function music(on) {
    musicOn = on;
    if (!ensure()) return;
    if (!musicEl) {
      musicEl = new Audio(MUSIC_SRC);
      musicEl.loop = true;
      musicEl.preload = 'auto';
      musicEl.addEventListener('error', () => console.warn('theme music missing:', MUSIC_SRC));
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.0001;
      ctx.createMediaElementSource(musicEl).connect(musicBus).connect(master);
    }
    if (on) {
      if (state.active) musicEl.play().catch(() => {});
      musicBus.gain.cancelScheduledValues(now());
      musicBus.gain.setTargetAtTime(MUSIC_VOL, now(), 0.6);
    } else {
      musicBus.gain.setTargetAtTime(0.0001, now(), 0.3);
      const el = musicEl;
      setTimeout(() => !musicOn && el.pause(), 1500);
    }
  }

  const audio = {
    get muted() {
      return state.muted;
    },
    get ready() {
      return state.ready;
    },
    /* Call from a user gesture (tap) to unlock audio on mobile browsers. */
    unlock() {
      if (!ensure()) return;
      if (state.active && ctx.state === 'suspended') ctx.resume();
      // silent buffer kick for iOS
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    },
    play(name) {
      // muted first: a muted effect must not build the audio graph (creating
      // the AudioContext is a ~100 ms main-thread stall)
      if (!state.active || state.muted || !ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      const fx = SFX[name];
      if (fx) fx();
    },
    say,
    stopSpeech,
    setMuted(m) {
      state.muted = m;
      ZD.prefs.set('muted', m);
      if (m) stopSpeech();
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, now(), 0.02);
    },
    /* Page focus: inactive -> suspend the whole audio graph (ambient loop
       included) and drop new effects; active -> resume where it left off. */
    setActive(on) {
      state.active = on;
      if (!on) stopSpeech();
      if (!ctx) return;
      if (on) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        if (musicOn && musicEl) musicEl.play().catch(() => {});
      } else {
        if (musicEl) musicEl.pause();
        if (ctx.state === 'running') ctx.suspend().catch(() => {});
      }
    },
    ambient,
    music,
  };

  ZD.audio = audio;
})();
