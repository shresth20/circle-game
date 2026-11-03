/* ------------------------------------------------------------------
   SFX + music engine. Everything is synthesised with Web Audio,
   so no audio files are required.
------------------------------------------------------------------ */
'use strict';
const SFX = (() => {
  let ctx = null, master = null, musicBus = null;
  let muted = false;
  let musicRunning = false, musicStep = 0, nextNoteTime = 0, musicTimer = null;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.85;
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.55;
      musicBus.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone({ freq = 440, type = 'sine', dur = 0.2, vol = 0.3, attack = 0.005,
                  freqEnd = null, delay = 0, dest = null, detune = 0 }) {
    const c = ensure();
    const t0 = c.currentTime + Math.max(0, delay);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest || master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noise({ dur = 0.5, vol = 0.3, filterFreq = 1000, filterEnd = null,
                   type = 'lowpass', delay = 0, dest = null }) {
    const c = ensure();
    const t0 = c.currentTime + Math.max(0, delay);
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t0);
    if (filterEnd) f.frequency.exponentialRampToValueAtTime(filterEnd, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest || master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /* ---------- tiny generative music loop ---------- */
  const BASS = [55, 55, 65.41, 49];                       // A1 A1 C2 G1
  const ARP  = [220, 329.63, 440, 329.63, 261.63, 392, 523.25, 392];
  const STEP = 0.22;

  function scheduleMusic() {
    if (!musicRunning || !ctx) return;
    while (nextNoteTime < ctx.currentTime + 0.3) {
      const delay = nextNoteTime - ctx.currentTime;
      const bar = Math.floor(musicStep / 16);
      if (musicStep % 4 === 0) {
        tone({ freq: BASS[bar % 4], type: 'triangle', dur: 0.8, vol: 0.2, delay, dest: musicBus });
      }
      const mult = (bar % 4 === 3) ? 1.5 : 1;
      tone({ freq: ARP[musicStep % 8] * mult, type: 'sine', dur: 0.3, vol: 0.06, delay, dest: musicBus });
      if (musicStep % 2 === 1) {
        noise({ dur: 0.05, vol: 0.035, filterFreq: 7000, type: 'highpass', delay, dest: musicBus });
      }
      if (musicStep % 8 === 4) {
        tone({ freq: 110, freqEnd: 50, type: 'sine', dur: 0.18, vol: 0.25, delay, dest: musicBus });
      }
      nextNoteTime += STEP;
      musicStep++;
    }
  }

  const api = {
    unlock() { ensure(); },
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      ensure();
      master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.02);
      return muted;
    },
    startMusic() {
      ensure();
      if (musicRunning) return;
      musicRunning = true;
      musicStep = 0;
      nextNoteTime = ctx.currentTime + 0.1;
      musicTimer = setInterval(scheduleMusic, 100);
    },
    stopMusic() {
      musicRunning = false;
      if (musicTimer) clearInterval(musicTimer);
      musicTimer = null;
    },

    /* ---------- UI ---------- */
    hover()  { tone({ freq: 880, type: 'sine', dur: 0.05, vol: 0.05 }); },
    click()  { tone({ freq: 420, type: 'square', dur: 0.06, vol: 0.1 });
               tone({ freq: 840, type: 'sine', dur: 0.08, vol: 0.08 }); },
    ready()  { tone({ freq: 523.25, type: 'square', dur: 0.12, vol: 0.1 });
               tone({ freq: 783.99, type: 'square', dur: 0.2, vol: 0.1, delay: 0.14 }); },

    /* ---------- gameplay ---------- */
    launch() { noise({ dur: 0.8, vol: 0.22, filterFreq: 300, filterEnd: 3500, type: 'bandpass' });
               tone({ freq: 140, freqEnd: 60, type: 'sine', dur: 0.5, vol: 0.3 }); },
    tick()   { tone({ freq: 1400, type: 'square', dur: 0.035, vol: 0.07 }); },
    pick()   { tone({ freq: 660, type: 'triangle', dur: 0.08, vol: 0.15 }); },
    correct() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.4, vol: 0.22, delay: i * 0.07 }));
      noise({ dur: 0.35, vol: 0.07, filterFreq: 6000, type: 'highpass', delay: 0.2 });
    },
    snap()   { tone({ freq: 220, freqEnd: 70, type: 'sine', dur: 0.18, vol: 0.45 });
               tone({ freq: 2600, type: 'square', dur: 0.03, vol: 0.12 }); },
    wrong()  { tone({ freq: 220, freqEnd: 100, type: 'sawtooth', dur: 0.45, vol: 0.2 });
               tone({ freq: 233, freqEnd: 106, type: 'sawtooth', dur: 0.45, vol: 0.16, detune: 12 }); },
    crash()  { noise({ dur: 1.0, vol: 0.55, filterFreq: 3500, filterEnd: 120 });
               tone({ freq: 90, freqEnd: 28, type: 'sine', dur: 0.7, vol: 0.7 });
               noise({ dur: 0.25, vol: 0.3, filterFreq: 5000, type: 'highpass' });
               noise({ dur: 0.5, vol: 0.2, filterFreq: 1200, filterEnd: 300, delay: 0.12 }); },
    combo(n) { for (let i = 0; i < n; i++)
                 tone({ freq: 880 * Math.pow(1.25, i), type: 'square', dur: 0.1, vol: 0.08, delay: 0.3 + i * 0.07 }); },
    heartLost() { tone({ freq: 330, freqEnd: 165, type: 'triangle', dur: 0.35, vol: 0.2, delay: 0.25 }); },
    levelup() { [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
                  tone({ freq: f, type: 'square', dur: 0.25, vol: 0.1, delay: i * 0.09 })); },
    win() {
      [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.5, vol: 0.2, delay: i * 0.11 }));
      noise({ dur: 1.2, vol: 0.12, filterFreq: 8000, type: 'highpass', delay: 0.5 });
    },
    gameover() { [440, 415.3, 392, 349.2, 293.66].forEach((f, i) =>
                   tone({ freq: f, type: 'triangle', dur: 0.55, vol: 0.22, delay: i * 0.28 })); },
  };
  return api;
})();
