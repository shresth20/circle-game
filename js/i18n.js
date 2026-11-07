/* game-i18n: key-based text + voice-over.
   ------------------------------------------------------------------
   Text   : T('key', {vars})      HTML: <span data-i18n="key">
   Voice  : I18n.say('key', vars) -> plays assets/VO/<lang>/<key>.webm when the
            clip is listed in assets/VO/<lang>/manifest.json, otherwise speaks
            T(key) with the browser speech engine (captions are always shown).
   Source : locales/locales.json  ("en" only until asked). ?lan=hi picks a
            language; missing keys fall back to English, then show the key.
   file:// cannot fetch JSON, so regenerate locales/locales.js after editing:
     node -e "const l=require('./locales/locales.json');require('fs').writeFileSync('locales/locales.js','window.LOCALES='+JSON.stringify(l)+';\n')"
*/
(function () {
  const SPEECH_LANG = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', te: 'te-IN', gu: 'gu-IN', or: 'or-IN' };
  let table = { en: {} };
  let lang = 'en';
  /* Voice-over is switched off for now (new recordings coming). Set to true
     to bring back clips + browser-speech fallback; nothing else needs changing. */
  const VOICE_ON = false;
  let voiceClips = new Set();
  let currentClip = null;

  function cap(s) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
  }

  const I18n = {
    get lang() {
      return lang;
    },
    get langCode() {
      return SPEECH_LANG[lang] || lang;
    },
    /* Build a camelCase key from parts: key('piece', 'minor', 'sector') -> pieceMinorSector */
    key(...parts) {
      return parts
        .join('.')
        .split(/[.\-\s]+/)
        .filter(Boolean)
        .map((p, i) => (i ? cap(p) : p))
        .join('');
    },
    t(key, vars) {
      let s = table[lang] && table[lang][key];
      if (s == null) s = table.en[key];
      if (s == null) return key; // visible on purpose: fix the JSON
      if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
      return s;
    },
    has(key) {
      return (table[lang] && table[lang][key] != null) || table.en[key] != null;
    },
    applyStatic(root = document) {
      root.querySelectorAll('[data-i18n]').forEach((n) => {
        n.textContent = I18n.t(n.dataset.i18n);
      });
      document.documentElement.lang = lang;
    },
    voice(key) {
      return `assets/VO/${lang}/${key}.webm`;
    },
    hasVoice(key) {
      return voiceClips.has(key);
    },
    /* Plays the line; resolves when it has finished (or was cut off / could
       not play).  Never rejects. */
    say(key, vars) {
      const audio = window.ZD && ZD.audio;
      if (!VOICE_ON || (audio && audio.muted)) return Promise.resolve();
      I18n.stop();
      if (voiceClips.has(key)) {
        const a = new Audio(I18n.voice(key));
        currentClip = a;
        return new Promise((res) => {
          a.addEventListener('ended', res, { once: true });
          a.addEventListener('pause', res, { once: true });
          a.play().catch(() => (audio ? audio.say(I18n.t(key, vars)) : Promise.resolve()).then(res));
        });
      }
      return audio ? audio.say(I18n.t(key, vars)) : Promise.resolve();
    },
    stop() {
      if (currentClip) {
        currentClip.pause();
        currentClip = null;
      }
      if (window.ZD && ZD.audio) ZD.audio.stopSpeech();
    },
    /* Load locales (+ the voice manifest), then call cb. */
    load(cb) {
      const q = new URLSearchParams(location.search).get('lan');
      if (q) lang = q.toLowerCase();
      const done = (data) => {
        table = data && data.en ? data : { en: {} };
        if (!table[lang]) lang = 'en';
        loadVoiceManifest().then(() => cb && cb());
      };
      const useScript = () => {
        if (window.LOCALES) return done(window.LOCALES);
        const s = document.createElement('script');
        s.src = 'locales/locales.js';
        s.onload = () => done(window.LOCALES);
        s.onerror = () => done(null);
        document.head.appendChild(s);
      };
      if (location.protocol === 'file:') return useScript(); // fetch is blocked on file://
      fetch('locales/locales.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
        .then(done)
        .catch(useScript); // offline / odd hosting: fall back to the generated locales.js
    },
  };

  function loadVoiceManifest() {
    voiceClips = new Set();
    if (location.protocol === 'file:') return Promise.resolve(); // no clips without a server
    return fetch(`assets/VO/${lang}/manifest.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (m && Array.isArray(m.clips)) voiceClips = new Set(m.clips);
      })
      .catch(() => {});
  }

  window.I18n = I18n;
  window.T = I18n.t;
})();
