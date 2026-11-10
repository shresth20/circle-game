/* Game state machine: title -> 6 walls (intro cinematic disabled) -> finale.
   The six pieces are shuffled and dealt one per wall, so every piece is
   asked exactly once per play.  Each wall = one question:
   present (front) -> three answer buttons (+ zombie timer) -> throw ->
     right: zombie knocked out, window opens (side), then the learner takes
       the controller: hold RUN, tap JUMP through the circle, run on to the
       next wall (runAndJump)
     wrong / time out: the zombie breaks the glass and attacks, the boy
     falls in fright - no fight back - and Replay plays the wall again.
   Correctness comes from ZD.geo.matches on the configured data. */
window.ZD = window.ZD || {};

(function () {
  const { el, wait, shuffle } = ZD.util;
  const M = ZD.motion;
  const { EASE, PHYS } = M;
  const T = (k, v) => ZD.T(k, v);
  const geo = ZD.geo;
  const fx = () => ZD.scene.fx;
  const D = (ms) => ZD.scene.D(ms);
  /* Resolves once `sprite` reaches frame `f` of the animation it is playing
     now (or stops playing it): key a reaction to a drawn pose, not to a
     guessed delay - the animator holds frames for whole display refreshes. */
  const atFrame = (sprite, f) => new Promise((res) => {
    const key = sprite.sheetKey;
    const check = () => (sprite.sheetKey !== key || !sprite.anim || sprite.frame >= f ? res() : requestAnimationFrame(check));
    check();
  });

  class Abort extends Error {}

  /* resolves when a Web Animation finishes or is cancelled (also when it
     already has) */
  const animDone = (a) => a.finished.then(() => {}, () => {});

  /* Game-over camera (game.defeatCam): zoom, and where the fallen boy's
     body lands on screen (stage px) - centred across, low on screen,
     under the centred sign + Replay button */
  /* Character sheets each beat switches to, decoded ahead of it
     (ZD.scene.primeSheets) so no sprite blinks on its first frame:
     throw = the front view's throw and its reactions, win / lose = the
     side view after the piece goes through / the glass breaks. */
  const SHEETS = {
    throw: ['hero.backThrow', 'hero.backCheer', 'hero.backFear', 'zombie.front.hit', 'zombie.front.attack'],
    win: ['zombie.side.hit', 'zombie.side.die', 'zombie.side.dead', 'hero.sideCheer', 'hero.sideRun', 'hero.sideLeap', 'hero.sideJump'],
    lose: ['zombie.side.run', 'zombie.side.leap', 'zombie.side.attack', 'hero.sideFear', 'hero.sideFall'],
    arrive: ['zombie.side.walk', 'zombie.side.run', 'zombie.side.idle'],
  };
  const DEFEAT_FOCUS = { x: 960, y: 960 };
  const DEFEAT_SHIFT = { x: 260, y: 90 };
  const REPLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M20.5 3.5v5h-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* Openings for one wall (all of the wall's piece): shuffled, refilled
     when used up, and never the same opening twice in a row - so a retry
     after a miss shows the piece in a new direction / size. */
  class Deck {
    constructor(pool) {
      this.pool = pool.map((o) => geo.normalize(o));
      this.queue = shuffle(this.pool);
      this.last = null;
    }
    next() {
      if (!this.queue.length) this.queue = shuffle(this.pool);
      let i = this.queue.findIndex((o) => o !== this.last);
      if (i < 0) i = 0;
      this.last = this.queue.splice(i, 1)[0];
      return this.last;
    }
  }

  /* Deal the six pieces (shuffled) onto the mission's rounds: one wall per
     piece, each drawing openings of its piece from its round's tier. */
  function dealWalls(mission) {
    const order = shuffle(geo.PIECES);
    return mission.rounds.map((r, i) => ({
      id: `w${i + 1}`,
      n: i + 1,
      total: mission.rounds.length,
      piece: order[i],
      hits: 1,
      timer: r.timer,
      delay: r.delay || 0,
      openings: mission.openings[r.tier].filter((o) => geo.idOf(o) === order[i]),
    }));
  }

  /* The piece the learner fired, drawn pointing the same way as the
     opening so the mismatch is plain to see. */
  function wrongPiece(chosenId, target) {
    const [size, type] = chosenId.split('-');
    const sweep = size === target.size ? target.sweep : 360 - target.sweep;
    return geo.normalize({ type, sweep, start: geo.midAngle(target) - sweep / 2 });
  }

  const game = {
    epoch: 0,
    paused: false,
    missionIndex: 0,
    pendingAction: null,

    /* ------------------------------------------------------------ boot */
    run() {
      this._loop('home');
    },

    /* One game flow.  Every awaited step is followed by guard(E); bumping
       this.epoch (pause-menu restart / home) makes the stale flow throw
       Abort at its next guard, and a fresh _loop takes over. */
    async _loop(start) {
      let E = ++this.epoch;
      this.pendingAction = null;
      try {
        this.resetAll();
        if (start === 'home') {
          await ZD.intro.title();
          this.guard(E);
          // the story + how-to-play cinematic; it hands back the epoch to
          // carry on with (Skip moves to a new one so the demo's
          // half-finished steps abort at their next guard)
          E = await ZD.intro.play(E);
          this.guard(E);
          this.missionIndex = 0;
        }
        let action = 'play';
        while (action === 'play' || action === 'next') {
          if (action === 'next') this.missionIndex++;
          const mission = ZD.MISSIONS[this.missionIndex];
          if (!mission) break;
          action = await this.playMission(mission, E);
        }
      } catch (e) {
        if (!(e instanceof Abort)) console.error(e);
        if (E !== this.epoch) return; // superseded by a newer flow
      }
      if (E === this.epoch) this._loop('home');
    },

    guard(E) {
      if (E !== this.epoch) throw new Abort();
    },

    /* Back to a clean scene.  keep: overlay ids left as they are (the
       intro resets the scene under its own cover, then fades it away). */
    resetAll({ keep = [] } = {}) {
      ZD.clock.clearAll();
      ZD.clock.resume();
      this.paused = false;
      // (keep the kept overlays' own tweens - e.g. the intro curtain)
      M.stopAll({ keep: keep.map((id) => document.getElementById(id)) });
      I18n.stop();
      ['title', 'intro', 'pause', 'complete', 'gameover', 'lesson'].forEach((id) => {
        if (keep.includes(id)) return;
        const o = document.getElementById(id);
        o.className = 'overlay';
        o.innerHTML = '';
      });
      const stage = document.getElementById('stage');
      stage.classList.remove('demo');
      if (!keep.includes('intro')) stage.classList.remove('intro-on');
      document.getElementById('world').classList.remove('alarm');
      document.getElementById('world').style.opacity = '';
      this.clearDefeatCam();
      ZD.controls.reset();
      ZD.ui.hideGrid(true);
      ZD.ui.timerHide(true);
      ZD.ui.clearGuide();
      ZD.ui.showHud(false);
      const { front, side } = ZD.scene;
      [front, side].forEach((s) => {
        s.projectile.show(false);
        s.hero.setRotation(0);
        s.hero.setFlip(false);
        s.hero.setOffsetY(0);
        s.hero.setPos(s.heroHome.x, s.heroHome.y);
        s.hero.el.style.opacity = '';
      });
      front.stopZombie();
      front.setZombieHp(0, 0);
      front._placeZombie(front.zpose.mid, 0);
      front.glass.restore();
      front.setTarget(null);
      front.frame('wide', { duration: 0 });
      front.idle();
      side.clearHorde();
      side.removeGate();
      side.walls.forEach((w, i) => {
        M.stop(w.glass.el); // (prepareRetry's cross-fade)
        w.glass.el.style.opacity = '';
        w.glass.restore();
        w.offset = 0;
        w.root.style.display = i === side.cur ? '' : 'none';
        w.root.style.opacity = '';
      });
      side.setTarget(null);
      side.zombie.setFlip(false);
      side.zombie.setRotation(0);
      side.zombie.setOffsetY(0);
      side.zombie.el.style.opacity = '';
      side.zombieOffset = 0;
      side.setScroll(0);
      side.setScrolling(false);
      side.zombie.setPos(side.zombieHome.x, side.zombieHome.y);
      side.showCover(false);
      side.idle();
    },

    /* ----------------------------------------------------------- pause */
    togglePause() {
      if (this.paused) return this.resume();
      if (document.getElementById('title').classList.contains('visible')) return;
      this.paused = true;
      I18n.stop();
      ZD.clock.pause();
      ZD.audio.play('click');
      ZD.ui.pauseMenu(() => this.resume());
    },
    resume() {
      if (!this.paused) return;
      this.paused = false;
      ZD.ui.closePanel('pause');
      ZD.clock.resume();
    },

    /* --------------------------------------------------------- mission */
    async playMission(mission, E) {
      this.mission = mission;
      this.walls = dealWalls(mission);
      ZD.ui.showHud(true);
      let wi = 0;
      while (wi < this.walls.length) {
        const wall = this.walls[wi];
        this.guard(E);
        // the two zombie variants take turns, one per wall
        ZD.scene.setZombieSkin(wi);
        ZD.ui.setStage(wall.n, wall.total);
        await this.wallTitle(wall);
        const result = await this.playWall(wall, E);
        this.guard(E);
        if (result === 'gameover') {
          // the boy is down: Replay retries the same wall with a fresh zombie
          await this.gameOver(E, wall);
          this.guard(E);
          this.resetAfterGameOver();
          wall.retry = true;
          continue;
        }
        // cleared: the window is open and the learner takes the controller -
        // run to the wall, jump through the circle, run on to the next wall
        // (after the last wall: to the safe zone)
        const last = wi === this.walls.length - 1;
        const next = wi + 1;
        // the next wall's zombie (the other skin) walks in at the end of the run
        if (!last) ZD.scene.primeSheets('side', SHEETS.arrive, ZD.scene.zombieSkins[next % ZD.scene.zombieSkins.length]);
        await this.runAndJump(E, last ? { distance: 2000, gate: true } : { distance: 1750, onPass: () => ZD.scene.setZombieSkin(next) });
        this.guard(E);
        // build the next wall's front-view land now (it is hidden), not on
        // the frame the view swings in
        if (!last) ZD.scene.front.setScenery(ZD.scene.side.travel);
        wi++;
      }
      return this.finale(E);
    },

    /* Side view: the wall's line comes up in the instruction bar while the
       zombie walks in, slowly, towards the wall.  While it is still walking
       the view swings to the front (playWall), where it carries on walking -
       it never stops and stands between the two views.
       wall.coach: the first wall and every retry get the step-by-step
       prompts in playWall; later walls get the short version. */
    async wallTitle(wall) {
      const { side, camera } = ZD.scene;
      if (camera.current !== 'side') camera.cut('side');
      // the front view is painted now, unseen, at the shot the swing will
      // reveal: by the time the view swings (seconds from now) its images
      // are decoded and its tiles rastered, so nothing pops in mid-move
      camera.prewarm('front', { shot: 'focus' });
      ZD.scene.primeSheets('front', SHEETS.throw);
      // short lines, one at a time
      const keys = wall.retry ? ['guideRetry', 'guideRetry2'] : wall.n === wall.total ? ['guideWallLast'] : ['guideWall', 'guideZombie'];
      wall.coach = wall.n === 1 || !!wall.retry;
      wall.retry = false;
      ZD.audio.play('alarm');
      side.zombieWalkIn(5200);
      const vars = { n: wall.n, total: wall.total };
      const lines = keys.map((k) => ZD.ui.guide(k, { vars, kind: 'alert' }));
      // read in full, but never hold the zombie's walk-in up
      await Promise.all([wait(D(2600)), Promise.race([lines[lines.length - 1], wait(D(4600))])]);
      // the bar slides away before the view swings (the front view's bar is narrower)
      await ZD.ui.hideBanner();
    },


    /* ------------------------------------------------------------ wall
       One zombie per wall; `wall.hits` right answers knock it out (1 = one
       question per wall; >1 puts a new opening in the same glass per hit).
       A wrong tap or a time-out ends the run: the answer panel shows the
       right piece, the zombie breaks the glass and the boy falls in fright
       (wrongSide); Replay then plays the wall again. */
    async playWall(wall, E) {
      const { front, side, camera } = ZD.scene;
      const deck = this.deckFor(wall);
      let hp = wall.hits;
      let first = true;
      front.setZombieHp(hp, wall.hits);
      for (;;) {
        // (a retry starts on the opening gameOver already put up)
        const target = wall.next || deck.next();
        wall.next = null;

        // present the opening (front view): the camera pushes in on the
        // wall and the window's rim lights switch on
        side.wall.glass.restore();
        side.setTarget(target);
        if (camera.current !== 'front') {
          front.glass.restore();
          front.setTarget(target);
          front.glass.lightsOff();
          front.idle();
          // the zombie is still walking towards the wall (side view): it
          // walks on in the front view, through the swing, and the timer
          // picks the walk up from wherever it has got to
          front.zombieWalkUp(2200);
          // ONE camera move: the view swings in and the camera glides
          // straight on into the wall (Camera.to with a shot)
          this.focusWall(true);
          await camera.to('front', { shot: 'focus' });
          side.settleZombie();
        } else if (first) {
          front.setTarget(target);
          front.glass.lightsOff();
          this.focusWall();
        } else {
          const reform = front.glass.reform(target);
          front.glass.lightsOff(); // (reform restored them) - they fade up below
          await reform;
          this.guard(E);
          this.focusWall();
        }
        first = false;
        this.guard(E);

        const timed = !!wall.timer;
        // step by step: where to look (first wall / retry), then what to do
        if (wall.coach) ZD.ui.guide('guideLook');
        ZD.ui.guide('guideAsk', { kind: 'ask' });
        ZD.audio.play('pop');
        // timed wall: after the wall's thinking time (wall.delay, shorter
        // stage by stage) the meter (face -> red line -> wall) appears and
        // rides the climb tween.  Until then the zombie waits behind the glass.
        const startClimb = () => {
          ZD.ui.timerShow(ZD.scene.skinIndex, wall.timer);
          if (wall.coach) ZD.ui.guide('guideHurry', { kind: 'alert' });
          return front.zombieClimb(wall.timer * 1000, (q, hop) => ZD.ui.timerSet(q, hop));
        };
        let grace = null;
        let climb;
        if (!timed) {
          front.zombiePace();
          climb = new Promise(() => {});
        } else if (wall.delay > 0) {
          front.zombieLurk();
          climb = new Promise((r) => (grace = ZD.clock.timeout(r, wall.delay * 1000))).then(startClimb);
        } else {
          climb = startClimb();
        }
        const t0 = performance.now();
        const asked = ZD.ui.ask(target.id);
        let res;
        try {
          res = await this.awaitInput(Promise.race([asked.then((id) => ({ id })), climb.then(() => ({ timeout: true }))]), E);
        } finally {
          if (grace) grace.cancel(); // answered (or left) before the timer came up
        }
        this.guard(E);
        ZD.ui.endAsk();
        front.stopZombie();
        if (timed) res.timeout ? ZD.ui.timerHit() : ZD.ui.timerHide();
        ZD.ui.hideBanner();
        const chosen = res.timeout ? null : res.id;
        const correct = !!chosen && geo.matches(chosen, target);
        this.record(wall, target, chosen, performance.now() - t0);

        if (correct) {
          ZD.ui.markAnswer(chosen, 'correct');
          hp--;
          const final = hp === 0;
          await this.throwFront(geo.normalize(target), target, true, E, { final, hpIndex: hp });
          this.guard(E);
          if (final) {
            await this.correctSide(target, E);
            return 'cleared';
          }
          continue;
        }

        // wrong tap or time out
        if (chosen) {
          ZD.ui.markAnswer(chosen, 'wrong');
          ZD.ui.markAnswer(target.id, 'reveal');
          await this.throwFront(wrongPiece(chosen, target), target, false, E);
        } else {
          await this.timeUpFront(E);
        }
        this.guard(E);
        // what the gap really was, while the zombie breaks in (side view)
        ZD.ui.guide(chosen ? 'guideWrong' : 'guideTimeUp', { vars: { name: T(geo.labelKey(target)) }, kind: 'bad', now: true });
        await this.wrongSide(E);
        return 'gameover';
      }
    },

    /* Wrap an input promise so pause-menu restarts can abort it. */
    awaitInput(p, E) {
      return new Promise((res, rej) => {
        this._kick = () => rej(new Abort());
        p.then((v) => {
          this._kick = null;
          res(v);
        }, rej);
      });
    },

    /* Teacher data: which piece was confused with which (kept on this device;
       ZD.report() prints a summary in the console). */
    record(wall, target, chosen, ms) {
      const entry = { t: Date.now(), mission: this.mission.id, wall: wall.id, target: target.id, sweep: Math.round(target.sweep), chosen: chosen || 'timeout', correct: !!chosen && chosen === target.id, ms: Math.round(ms) };
      const log = ZD.prefs.get('log', []);
      log.push(entry);
      ZD.prefs.set('log', log.slice(-400));
    },

    /* Asking: the camera pushes in on the wall (the answer panel keeps its
       side of the screen) and, as it arrives, the window's rim lights
       flicker on. */
    focusWall(entering = false) {
      const { front } = ZD.scene;
      // entering: Camera.to runs the glide (swing + push-in as one move);
      // the lights come up as the camera settles on the wall
      ZD.clock.timeout(() => ZD.audio.play('focus'), entering ? 260 : 0);
      ZD.clock.timeout(() => front.glass.lightUp(), entering ? 1000 : 420);
      if (!entering) front.frame('focus', { duration: 1200, easing: 'glide' });
    },

    /* --------------------------------------------- front: throw sequence
       1. lock-in: a quick punch-in on the window, its rim lights flare
       2. pull back to the wide shot: the hero winds up and throws, the
          piece leaving the hand as the camera settles
       3. the camera rides with the piece into the wall (then the outcome,
          and the view swings to the side at the window) */
    async throwFront(spec, target, correct, E, { final = true, hpIndex = 0 } = {}) {
      const { front, camera } = ZD.scene;
      const P = front.projectile;
      // the side view is painted now, unseen: the outcome swings to it
      // (with the sheets its characters will switch to decoded)
      camera.prewarm('side');
      if (!correct || final) ZD.scene.primeSheets('side', correct ? SHEETS.win : SHEETS.lose);
      P.setSpec(spec, 0);
      P.show(false);
      ZD.audio.play('pick');
      front.glass.pick();
      await front.frame('lock', { duration: 300, easing: 'easeOutCubic' });
      this.guard(E);
      await wait(D(200));
      this.guard(E);
      ZD.audio.play('pullback');
      front.glass.highlight('idle');
      // (ends as the piece leaves the hand, so the next move starts from rest)
      front.frame('wide', { duration: 690, easing: 'easeInOutCubic' });
      await wait(D(300));
      this.guard(E);
      front.hero.play({ sheet: 'hero.backThrow', fps: 18 }).then(() => front.hero.play({ sheet: 'hero.backIdle', fps: 9, loop: true }));
      await wait(7 / 18 * 1000);
      this.guard(E);
      if (correct) ZD.ui.hideGrid(); // buttons slide away as the piece leaves the hand
      ZD.audio.play('whoosh');
      const from = front.heroHand;
      const to = front.hole;
      const ctrl = { x: from.x + (to.x - from.x) * 0.5, y: Math.min(from.y, to.y) - 150 };
      let locked = false;
      // eases in and out with the flight: no abrupt stop at the wall
      front.frame('impact', { duration: 900, easing: 'easeInOutSine' });
      await P.fly({
        from, to, ctrl,
        duration: D(900),
        ease: PHYS.RAMP,
        scaleFrom: 1.25, scaleTo: 1.0,
        rotFrom: -40, rotTo: 0, spin: correct ? 20 : 35,
        onProgress: (t) => {
          if (!locked && t > 0.6) {
            locked = true;
            front.glass.highlight('approach');
            ZD.audio.play('lock');
          }
        },
      });
      this.guard(E);
      if (correct) {
        // the exact shape slips through the glass without breaking it
        front.glass.highlight('good');
        ZD.audio.play('pass');
        fx().sparkles(front.fxLayer, to.x, to.y, 22, '#c7ffd8');
        fx().ring(front.fxLayer, to.x, to.y, '#7CFF8A', 80);
        fx().flash('#9dffb0', 300, 0.35);
        front.popZombieHp(hpIndex);
        await P.vanish({ to: { scale: 0.5 }, ms: D(320), ease: PHYS.ACCEL });
        if (final) {
          await ZD.scene.camera.to('side', { zoomAt: to });
          return;
        }
        // a hit: the zombie reels back; the name is read aloud as the reward
        const z = front.zombie;
        ZD.audio.play('hit');
        ZD.audio.play('groan');
        fx().sparkles(front.fxLayer, z.x, z.y - 120 * z.scale, 16, '#b4ff9d');
        fx().puffs(front.fxLayer, z.x, z.y - 110 * z.scale, 5);
        front.hero.play({ sheet: 'hero.backCheer', fps: 14 }).then(() => front.hero.play({ sheet: 'hero.backIdle', fps: 9, loop: true }));
        ZD.audio.play('yay');
        I18n.say(geo.labelKey(target));
        // same beat as before (time for the name to be read aloud)
        await Promise.all([front.zombieKnockBack(), wait(D(1250))]);
        this.guard(E);
      } else {
        // anything else smashes into the glass
        front.glass.highlight('bad');
        front.glass.crack(0, 0);
        ZD.audio.play('crack');
        fx().shards(front.fxLayer, to.x, to.y, 16);
        fx().ring(front.fxLayer, to.x, to.y, '#ff3b5c', 80);
        fx().flash('#ff3b5c', 320, 0.3);
        fx().shake(12, 480);
        front.hero.play({ sheet: 'hero.backFear', fps: 14 }).then(() => front.hero.setFrame(11));
        // it bounces off and drops away, turning
        P.vanish({ to: { x: P.x - 120, y: P.y + 320, rot: P.rot - 140 }, ms: D(520), ease: PHYS.ACCEL });
        ZD.audio.play('fail');
        // the camera creeps in on the cracked glass: the zombie is coming
        front.frame('lock', { duration: 900, easing: 'easeOutCubic' });
        await wait(D(800));
        this.guard(E);
        ZD.ui.hideGrid();
        await ZD.scene.camera.to('side', { zoomAt: to });
      }
    },

    /* Time out: the zombie reaches the glass and bangs until it cracks. */
    async timeUpFront(E) {
      const { front, camera } = ZD.scene;
      camera.prewarm('side'); // the view swings to the side after the bang
      ZD.scene.primeSheets('side', SHEETS.lose);
      ZD.ui.hideGrid();
      ZD.audio.play('alarm');
      front.hero.play({ sheet: 'hero.backFear', fps: 14 }).then(() => front.hero.setFrame(11));
      const bang = front.zombieBang();
      // punch in on the zombie banging at the glass
      front.frame('lock', { duration: 450, easing: 'easeOutCubic' });
      await wait(D(450));
      this.guard(E);
      front.glass.highlight('bad');
      front.glass.crack(0, 0);
      ZD.audio.play('crack');
      fx().shards(front.fxLayer, front.hole.x, front.hole.y, 12);
      fx().shake(12, 480);
      await bang;
      this.guard(E);
      await wait(D(300));
      this.guard(E);
      await ZD.scene.camera.to('side', { zoomAt: front.hole });
    },


    async sideFlightToZombie(P) {
      const { side } = ZD.scene;
      const from = { x: side.hole.x + 40, y: side.hole.y };
      const to = { x: side.zombie.x - 40, y: side.groundY - 150 };
      ZD.audio.play('whoosh');
      await P.fly({ from, to, ctrl: { x: (from.x + to.x) / 2, y: to.y - 50 }, duration: D(460), ease: PHYS.LINEAR, scaleFrom: 0.8, scaleTo: 1.0, sxFrom: 0.45, sxTo: 0.95, spin: 60 });
      P.vanish({ to: { scale: 0.2 }, ms: D(260), ease: PHYS.DECEL });
    },

    async zombieHit() {
      const { side } = ZD.scene;
      const z = side.zombie;
      ZD.audio.play('bonk');
      ZD.audio.play('squish');
      fx().puffs(side.fxLayer, z.x, z.y - 150, 8);
      fx().ring(side.fxLayer, z.x, z.y - 150, '#fff2a8', 70);
      fx().sparkles(side.fxLayer, z.x, z.y - 160, 10, '#b4ff9d');
      fx().shake(6, 300);
      const o = { d: 0 };
      const baseX = z.x;
      M.to(o, { d: 90, ms: D(500), ease: PHYS.DECEL, onUpdate: () => z.setPos(baseX + o.d, z.y) });
      await z.play({ sheet: 'zombie.side.hit', fps: 16 });
      ZD.audio.play('groan');
      await z.play({ sheet: 'zombie.side.die', fps: 15 });
      z.setSheet('zombie.side.dead');
      z.setFrame(0);
    },

    /* ----------------------------------------------- side: correct path */
    async correctSide(target, E, { review = true } = {}) {
      const { side } = ZD.scene;
      const P = side.projectile;
      P.setSpec(target, 0);
      side.wall.glass.highlight('good');
      P.set(side.hole.x + 10, side.hole.y, 0.8, 0, 0.45);
      await this.sideFlightToZombie(P);
      this.guard(E);
      await this.zombieHit();
      this.guard(E);
      ZD.audio.play('success');
      side.hero.play({ sheet: 'hero.sideCheer', fps: 12 }).then(() => side.hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true }));
      ZD.audio.play('yay');
      fx().sparkles(side.fxLayer, side.hero.x, side.hero.y - 200, 24);
      fx().sparkles(side.fxLayer, side.zombie.x, side.zombie.y - 120, 18, '#b4ff9d');
      fx().ring(side.fxLayer, side.hole.x, side.hole.y, '#7CFF8A', 140);
      // free review while the window opens and the hero goes through:
      // one line - the rule (it starts with the name), read aloud
      // (the bar stays up through the run-and-jump that follows)
      if (review) {
        // two short lines: what it was, then why
        ZD.ui.guide('guideCorrect', { vars: { name: T(geo.labelKey(target)) }, kind: 'good', now: true });
        ZD.ui.guide(geo.ruleKey(target), { kind: 'good' });
      }
      await side.wall.glass.unlock();
      ZD.audio.play('unlock');
      this.guard(E);
    },

    /* ------------------------------------------- run & jump (controller)
       After a knock-out the window stays open and the learner drives the
       hero with the on-screen controller (js/controls.js): hold RUN
       (bottom-left) to run at the wall, tap JUMP (bottom-right) to leap
       through the circle, then run on to the next checkpoint (or, with
       `gate`, the safe zone).  A jump before the take-off zone is a small
       hop; running into the wall without jumping bumps off it.  The JUMP
       button pulses while a jump would go through, RUN pulses while the
       hero waits for it.  One time-based rAF loop drives the hero, the
       camera and the leap; it freezes while paused.  Resolves at the next
       checkpoint with the side scene at its home layout. */
    runAndJump(E, { distance = 1750, gate = false, onPass } = {}) {
      const { side } = ZD.scene;
      const { clamp } = ZD.util;
      const C = ZD.controls;
      const hero = side.hero;
      const zombie = side.zombie;
      const H = side.hole; // window centre (checkpoint px)
      const groundY = side.heroHome.y;
      const RUN = side.heroRunSpeed; // px/s; the legs follow the distance run
      const ACCEL = 3000;
      const DECEL = 3400;
      const CAM_X = 760; // the camera keeps the running hero about here on screen
      const CAM_K = 5; // camera follow stiffness (1/s)
      const BUMP_X = side.wallHome + 10; // without a jump the hero stops here, at the wall
      const TAKEOFF_X = H.x - 520; // a jump from here on goes through the circle
      const LAND_MIN = H.x + 280; // land clear of the wall's near corner
      const END_X = distance + side.heroHome.x; // the hero's spot at the next checkpoint
      const CROUCH = 0.11; // s, hero.sideLeap 1-2
      const HOP_T = 0.56; // s, a hop (hero.sideJump 3-8 in the air)
      const HOP_H = 90; // px

      let x = hero.x; // hero feet, checkpoint px (screen x = x - cam)
      let v = 0;
      let lift = 0; // hop height
      let cam = side.scrollX;
      let mode = 'ground'; // ground | crouch | leap | hop | land | settle | done
      let t = 0; // time in the current mode (s)
      let clock = 0;
      let passed = false;
      let pose = null;
      let leap = null;
      let landFor = 0;
      let ran = 0; // distance run (px): drives the run cycle (side.heroRunAt)
      let lastBump = -1;
      let settleFrom = 0;
      let settleFor = 0;
      // the instruction bar follows what the learner has to do next; a
      // line is only sent when the needed step changes
      let told = null;
      const tell = (key, opts) => {
        if (told === key) return;
        told = key;
        // replaces a prompt that has not come up yet (it is out of date);
        // the rule review before it is never dropped
        ZD.ui.guide(key, Object.assign({ prompt: true, replace: true }, opts));
      };

      const setPose = (p) => {
        if (p === pose) return;
        pose = p;
        if (p === 'idle') hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true });
      };
      const manual = (sheet, frame) => {
        pose = 'manual';
        hero.stop();
        hero.setSheet(sheet);
        hero.setFrame(frame);
      };
      const approach = (a, b, step) => (a < b ? Math.min(b, a + step) : Math.max(b, a - step));
      /* RUN held -> full speed; released -> brake.  After the wall the hero
         eases to a stop exactly on the next checkpoint's spot. */
      const drive = (dt) => {
        let target = C.running ? RUN : 0;
        if (passed) target = Math.min(target, Math.sqrt(2 * DECEL * Math.max(0, END_X - x)));
        v = approach(v, target, (target > v ? ACCEL : DECEL) * dt);
        x += v * dt;
      };
      const blockAtWall = () => {
        if (passed || x < BUMP_X) return;
        x = BUMP_X;
        if (v > 160 && clock - lastBump > 0.7) {
          // ran into the wall: bump back a little - it needs a jump
          lastBump = clock;
          tell('guideJump'); // (in case the bar is still on an earlier line)
          ZD.audio.play('bonk');
          fx().shake(5, 220);
          fx().puffs(side.fxLayer, x + 40 - cam, groundY - 150, 4);
          v = -180;
        } else {
          v = Math.min(v, 0);
        }
      };

      const startCrouch = () => {
        mode = 'crouch';
        t = 0;
        manual('hero.sideLeap', 1);
        // the knocked-out zombie fades as the hero goes for the window
        M.to(zombie.el, { opacity: 0, ms: D(500), ease: EASE.IN });
      };
      const startLeap = () => {
        const core = side.heroLeapCore;
        const x1 = Math.max(2 * H.x - x, LAND_MIN);
        const P0 = { x, y: groundY - core };
        const P2 = { x: x1, y: groundY - core };
        // quadratic arc whose midpoint is the window centre (as SideScene.leapThrough)
        const P1 = { x: 2 * H.x - (P0.x + P2.x) / 2, y: 2 * H.y - (P0.y + P2.y) / 2 };
        leap = { P0, P1, P2, core, x1, dur: clamp(0.38 + (x1 - x) * 0.00055, 0.7, 1.0), crossed: false };
        mode = 'leap';
        t = 0;
        manual('hero.sideLeap', 3);
        ZD.audio.play('swoosh');
      };
      const startHop = () => {
        mode = 'hop';
        t = 0;
        manual('hero.sideJump', 3);
        ZD.audio.play('pop');
      };
      const startLand = (sheet, fps) => {
        mode = 'land';
        t = 0;
        landFor = 3 / fps;
        pose = 'manual';
        hero.play({ sheet, fps, from: 9, to: 11 });
      };
      const passWall = () => {
        passed = true;
        leap = null;
        hero.setRotation(0);
        side.showCover(false);
        ZD.audio.play('thud');
        fx().puffs(side.fxLayer, x - cam, groundY - 10, 6);
        v = 160;
        startLand('hero.sideLeap', 14);
        tell(gate ? 'guideClearedLast' : 'guideCleared', { kind: 'good' });
        // the next checkpoint has no zombie yet: it walks in when the hero
        // has arrived (wallTitle -> side.zombieWalkIn)
        M.stop(zombie.el);
        onPass && onPass();
        side.sendZombieTo(distance, false);
      };
      const arrive = () => {
        mode = 'settle';
        t = 0;
        x = END_X;
        v = 0;
        setPose('idle');
        C.hide();
        // the next wall (or the safe zone) brings its own line
        ZD.ui.hideBanner();
        settleFrom = cam;
        settleFor = clamp(Math.abs(distance - cam) / 900, 0.3, 0.9);
      };

      const step = (dt) => {
        clock += dt;
        t += dt;
        if (mode === 'ground') {
          drive(dt);
          blockAtWall();
          if (passed && x >= END_X - 0.5) arrive();
          else if (C.takeJump()) {
            if (!passed && x >= TAKEOFF_X) startCrouch();
            else startHop();
          } else setPose(v > 40 ? 'run' : 'idle');
          // legs locked to the road: one run-cycle frame per RUN_FRAME_PX run
          if (mode === 'ground' && pose === 'run') {
            ran += Math.abs(v) * dt;
            if (side.heroRunAt(ran)) {
              ZD.audio.play('step');
              fx().dust(side.fxLayer, x - cam - 18, groundY - 8);
            }
          }
        } else if (mode === 'crouch') {
          v = approach(v, 0, DECEL * 0.5 * dt); // keep most of the run-up
          x = Math.min(x + v * dt, BUMP_X);
          if (t >= CROUCH / 2) hero.setFrame(2);
          if (t >= CROUCH) startLeap();
        } else if (mode === 'leap') {
          const k = Math.min(1, t / leap.dur);
          const u = 1 - k;
          const { P0, P1, P2 } = leap;
          x = u * u * P0.x + 2 * u * k * P1.x + k * k * P2.x;
          leap.y = u * u * P0.y + 2 * u * k * P1.y + k * k * P2.y;
          leap.deg = 18 * Math.sin(Math.PI * k);
          hero.setFrame(3 + Math.min(5, Math.floor(k * 6)));
          if (!leap.crossed && k >= 0.4) {
            leap.crossed = true;
            fx().sparkles(side.fxLayer, H.x - cam, H.y, 10, '#c7ffd8');
          }
          if (k >= 1) {
            x = leap.x1;
            passWall();
          }
        } else if (mode === 'hop') {
          const k = Math.min(1, t / HOP_T);
          drive(dt); // a little air control
          blockAtWall();
          if (passed) x = Math.min(x, END_X);
          lift = HOP_H * 4 * k * (1 - k);
          hero.setFrame(3 + Math.min(5, Math.floor(k * 6)));
          if (k >= 1) {
            lift = 0;
            ZD.audio.play('step');
            startLand('hero.sideJump', 18);
          }
        } else if (mode === 'land') {
          v = approach(v, 0, DECEL * 0.5 * dt);
          x += v * dt;
          blockAtWall();
          if (passed) x = Math.min(x, END_X);
          if (t >= landFor) {
            mode = 'ground';
            pose = null;
          }
        }

        // camera: follows the hero; at the checkpoint it glides to frame it
        if (mode === 'settle') {
          const k = Math.min(1, t / settleFor);
          cam = settleFrom + (distance - settleFrom) * (0.5 - Math.cos(Math.PI * k) / 2);
          if (k >= 1) mode = 'done';
        } else {
          const target = clamp(x - CAM_X, 0, distance);
          cam += (target - cam) * (1 - Math.exp(-CAM_K * dt));
        }
        side.setScroll(cam);

        // place the hero (screen px)
        if (mode === 'leap') {
          const r = (leap.deg * Math.PI) / 180;
          hero.setRotation(leap.deg);
          hero.setPos(x - leap.core * Math.sin(r) - cam, leap.y + leap.core * Math.cos(r));
          side.showCover(true); // follows the wall as the camera moves
        } else {
          hero.setPos(x - cam, groundY - lift);
        }

        // which button to press now: the button pulses, the bar says it
        const atWall = mode === 'ground' && !passed && x >= TAKEOFF_X;
        if (atWall) tell('guideJump');
        C.hint('jump', atWall);
        C.hint('run', mode === 'ground' && !atWall && !C.running);
      };

      // set up: the next checkpoint waits off screen; the knocked-out zombie
      // stays where it fell while the camera moves
      side.prepareRun(distance, { gate });
      side.zombieOffset = zombie.x + side.scrollX - side.zombieHome.x;
      document.getElementById('world').classList.remove('alarm');
      hero.setFlip(false);
      hero.setRotation(0);
      setPose('idle');
      C.show();
      // (waits for the rule line to be read)
      tell('guideRun');

      return new Promise((resolve) => {
        let last = performance.now();
        const frame = (now) => {
          if (E !== this.epoch) return resolve(); // restarted / home: the caller's guard aborts
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          if (!ZD.clock.paused) step(dt);
          if (mode === 'done') {
            side.finishRun(distance);
            return resolve();
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    },

    /* The circle is open: the defeated zombie fades, the hero runs at the wall
       and leaps through the circle to the far side (hero.sideLeap sheet:
       0-2 crouch, 3 take-off, 4-7 mid-air, 8 touch-down, 9-11 land). */
    /* beforeLeap (intro demo): the hero runs up, stops at the take-off and
       waits for it (the demo hand taps JUMP), then leaps from standing. */
    async heroJumpThrough({ beforeLeap } = {}) {
      const { side } = ZD.scene;
      const hero = side.hero;
      M.to(side.zombie.el, { opacity: 0, ms: D(500), ease: EASE.IN });
      const takeoff = side.hole.x - 330;
      const landing = side.hole.x + 330;
      // run-up: picks up speed into the take-off, legs locked to the road
      await side.heroRunTo(takeoff, { ease: beforeLeap ? PHYS.GLIDE : PHYS.RAMP, ramp: 0.35 });
      if (beforeLeap) {
        hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true });
        await beforeLeap();
      }
      // crouch + spring (from a run, skip the standing frame)
      await hero.play({ sheet: 'hero.sideLeap', fps: 18, from: beforeLeap ? 0 : 1, to: 2 });
      ZD.audio.play('swoosh');
      // airborne frames follow the arc, so they stay in sync at any speed
      hero.stop();
      side.showCover(true);
      await side.leapThrough(hero, {
        x0: takeoff, x1: landing, y: side.heroHome.y, core: side.heroLeapCore, duration: 850, tilt: 18,
        onProgress: (t) => hero.setFrame(3 + Math.min(5, Math.floor(t * 6))),
        onCross: () => fx().sparkles(side.fxLayer, side.hole.x, side.hole.y, 10, '#c7ffd8'),
      });
      side.showCover(false);
      ZD.audio.play('thud');
      fx().puffs(side.fxLayer, landing, side.heroHome.y - 10, 6);
      await hero.play({ sheet: 'hero.sideLeap', fps: 14, from: 9, to: 11 });
      hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true });
    },

    /* ------------------------------------------------- side: wrong path
       The zombie breaks in and the boy falls in fright.  He stays down
       while the zombie looms over him, then the game-over screen offers
       Replay (playMission retries the wall). */
    async wrongSide(E) {
      document.getElementById('world').classList.add('alarm');
      await this.zombieBreakIn(E);
      this.guard(E);
      ZD.audio.play('gameover');
      // zombieBreakIn leaves the zombie standing over him, clawing (looped);
      // a short beat, then gameOver pushes the camera in on the two of them
      await wait(D(600));
      this.guard(E);
    },

    /* Wrong piece: the glass shatters as the zombie dives through the circle,
       lands on the hero's side and attacks; the hero falls in fright. */
    async zombieBreakIn(E) {
      const { side } = ZD.scene;
      const z = side.zombie;
      const hero = side.hero;
      const glass = side.wall.glass;
      glass.crack(0, 0);
      ZD.audio.play('alarm');
      ZD.audio.play('groan');
      side.showCover(true);
      // the hero sees it coming: fear starts with the alarm (skip the calm
      // lead-in frames), then trembles on the scared frames until the hit
      const tremble = () => hero.play({ sheet: 'hero.sideFear', fps: 8, from: 8, to: 11, loop: true });
      hero.setRotation(0);
      hero.play({ sheet: 'hero.sideFear', fps: 14, from: 2 }).then(() => hero.sheetKey === 'hero.sideFear' && tremble());
      // charge at the wall from behind it
      z.play({ sheet: 'zombie.side.run', fps: 16, loop: true });
      const runTo = side.hole.x + 300;
      const o = { x: z.x };
      await M.to(o, { x: runTo, ms: D(520), ease: PHYS.ACCEL, onUpdate: () => z.setPos(o.x, side.zombieHome.y) });
      if (E != null) this.guard(E);
      // leap through the circle (zombie.side.leap: 0-1 crouch, 2-6 airborne,
      // 7-11 land, 12-14 attack-ready) - the glass breaks as the head hits it
      await z.play({ sheet: 'zombie.side.leap', fps: 14, from: 0, to: 1 });
      if (E != null) this.guard(E);
      z.stop(); // airborne frames follow the arc
      // close in: from here its attack-ready claws (leap 12-14) reach his
      // raised hands, and the attack lunge reaches his chest
      const landX = side.heroHome.x + 200;
      await side.leapThrough(z, { x0: runTo, x1: landX, y: side.zombieHome.y, core: side.zombieLeapCore, duration: 900, tilt: 30,
        onProgress: (t) => z.setFrame(2 + Math.min(4, Math.floor(t * 5))),
        onCross: () => {
        glass.shatter();
        ZD.audio.play('shatter');
        fx().shards(side.fxLayer, side.hole.x, side.hole.y, 18, ['#bfe9ff', '#ffffff', '#ff8aa0', '#e0a070']);
        fx().shake(14, 500);
        fx().flash('#ff3b5c', 300, 0.35);
        ZD.audio.play('scream');
        // startled: the hero trembles where he stands as the zombie bursts through
        tremble();
      } });
      side.showCover(false);
      if (E != null) this.guard(E);
      ZD.audio.play('thud');
      fx().puffs(side.fxLayer, landX, side.zombieHome.y - 10, 6);
      // touch down, rise into attack-ready, a beat face to face
      await z.play({ sheet: 'zombie.side.leap', fps: 16, from: 7, to: 11 });
      if (E != null) this.guard(E);
      await z.play({ sheet: 'zombie.side.leap', fps: 10, from: 12, to: 14 });
      if (E != null) this.guard(E);
      await wait(D(250));
      if (E != null) this.guard(E);
      // attack: the boy is too frightened to fight back - he recoils,
      // staggers away and falls flat on his back where he stood (no
      // knockback).  hero.sideFall: 0 startle, 1-3 recoil, 4-5 stagger,
      // 6-7 sits down hard, 8-11 flat on his back.  It starts on frame 2,
      // whose backward lean carries on from the tremble (frame 1 stands up
      // straight again), and stays on the last frame.
      const atk = z.play({ sheet: 'zombie.side.attack', fps: 16 });
      // he goes down as the claws reach him: frame 6, one before the
      // deepest lunge of both skins (frame 7)
      await atFrame(z, 6);
      if (E != null) this.guard(E);
      fx().shake(8, 360);
      const fall = hero.play({ sheet: 'hero.sideFall', fps: 12, from: 2 });
      // dust where he lands: his seat at frame 6, his back at frame 9
      // (4 and 7 frames in), behind his feet
      wait(D(340)).then(() => {
        ZD.audio.play('thud');
        fx().puffs(side.fxLayer, hero.x - 90, hero.y - 8, 6);
      });
      wait(D(590)).then(() => fx().puffs(side.fxLayer, hero.x - 200, hero.y - 6, 4));
      // follow-through: as the lunge pulls back (frame 11) it shuffles in
      // after him while he goes down, then keeps clawing at him (left
      // looping for the game-over beat)
      await Promise.race([atk, atFrame(z, 11)]);
      if (E != null) this.guard(E);
      z.play({ sheet: 'zombie.side.run', fps: 14, loop: true });
      const stepIn = { x: z.x };
      await M.to(stepIn, { x: side.heroHome.x + 115, ms: D(420), ease: PHYS.GLIDE, onUpdate: () => z.setPos(stepIn.x, side.zombieHome.y) });
      if (E != null) this.guard(E);
      z.play({ sheet: 'zombie.side.attack', fps: 12, loop: true });
      await fall;
    },

    /* ----------------------------------------------------------- finale
       (the learner has already run to the safe zone: runAndJump) */
    async finale(E) {
      const { side } = ZD.scene;
      // made it: a cheer at the safe zone, then run inside
      ZD.audio.play('fanfare');
      const line = ZD.ui.guide('guideSafe', { kind: 'good', now: true });
      await side.hero.play({ sheet: 'hero.sideCheer', fps: 12 });
      this.guard(E);
      await side.enterSafeZone();
      this.guard(E);
      await Promise.all([wait(D(900)), line]);
      this.guard(E);
      await ZD.ui.hideBanner();
      this.guard(E);

      // end screen: just the title and Replay
      const p = ZD.ui.panel({ id: 'complete', title: T('endTitle'), buttons: [{ label: T('btnReplay'), cls: 'primary' }], cls: 'complete' });
      ZD.ui.showHud(false);
      await this.awaitInput(p.result, E);
      this.guard(E);
      this.resetAll();
      return 'play';
    },

    /* -------------------------------------------------------- game over
       The boy is down and the zombie keeps clawing at him.  The camera
       pushes in on the two of them (defeatCam), the view dims to dusk
       purple, a soft burst of red rays opens and the GAME OVER sign drops
       in over them with the Replay button under it.  Replay zooms back out
       and playMission retries the wall. */
    async gameOver(E, wall) {
      ZD.ui.showHud(false);
      const ov = document.getElementById('gameover');
      ov.innerHTML = '';
      const shade = el('div', { class: 'go-shade' });
      const rays = el('div', { class: 'go-rays' }, [el('div', { class: 'go-rays-spin' })]);
      const sign = el('img', { class: 'go-sign', src: ZD.assets.imageUrl('gameOverSign'), alt: T('gameOverTitle'), draggable: 'false' });
      const btn = el('button', { class: 'btn primary huge go-retry' }, [
        el('span', { class: 'go-retry-icon', 'aria-hidden': 'true', html: REPLAY_ICON }),
        el('span', { text: T('btnRetry') }),
      ]);
      ov.append(shade, rays, sign, btn);
      ov.className = 'overlay gameover visible';

      // 1. push in on the boy and the zombie; the shade comes up as the
      //    camera settles, then the rays open behind where the sign lands
      this.defeatCam();
      M.enter(shade, null, { ms: D(700), delayMs: D(450) });
      M.enter(rays, { scale: 0.35 }, { ms: D(800), delayMs: D(850) });
      // 2. the sign drops in and lands with a thump (the bar, which said
      //    what the gap was, makes way for it)
      await wait(D(950));
      this.guard(E);
      ZD.ui.hideBanner();
      ZD.audio.play('swoosh');
      M.fromTo(sign, { opacity: 0 }, { opacity: 1, ms: D(220), ease: PHYS.LINEAR });
      await M.fromTo(sign, { y: -160, scale: 0.55 }, { y: 0, scale: 1, ms: D(620), ease: EASE.POP });
      this.guard(E);
      ZD.audio.play('thud');
      fx().shake(9, 320);
      // 3. Replay pops up under it
      await M.pop(btn, { y: 70, scale: 0.7 }, { ms: D(480) });
      this.guard(E);
      btn.focus({ preventScroll: true });
      // behind the game-over screen the wall is already set for the retry
      this.prepareRetry(wall);

      await this.awaitInput(new Promise((res) => btn.addEventListener('click', () => {
        ZD.audio.play('click');
        res();
      }, { once: true })), E);
      this.guard(E);
      // leave: the sign and button go, the camera eases back out
      ZD.audio.play('swoosh');
      M.exit([sign, btn], { scale: 0.85 }, { ms: D(240) });
      const out = this.defeatCamOut(D(650));
      await M.exit([shade, rays], null, { ms: D(500), delayMs: D(150) });
      await out;
      this.guard(E);
      ov.className = 'overlay';
      ov.innerHTML = '';
    },

    /* A wall's openings deck lives on the wall, so a retry draws from the
       same deck and never repeats the opening just missed. */
    deckFor(wall) {
      return (wall.deck = wall.deck || new Deck(wall.openings));
    },

    /* While the game-over screen is up: mend the wall's glass and put up
       the retry's opening (a new one) - a quick cross-fade on the glass,
       out of shot or under the shade - so when Replay zooms back out the
       wall already shows the new question, never the broken old one. */
    async prepareRetry(wall) {
      const { side, front } = ZD.scene;
      const target = (wall.next = this.deckFor(wall).next());
      const g = side.wall.glass;
      await M.exit(g.el, null, { ms: D(200) });
      g.restore();
      side.setTarget(target);
      front.glass.restore();
      front.setTarget(target);
      await M.enter(g.el, null, { ms: D(320) });
      g.el.style.opacity = '';
    },

    /* Camera drift on the defeat (side view): one compositor move (Web
       Animation, transform only, ease-out) toward the fallen boy.  Do not
       scale the whole scene here: a 1.5x full-screen background was the
       second place where browsers could show stretched/low-resolution GPU
       tiles.  The shade and sign provide the visual push-in instead. */
    defeatCam() {
      const { side } = ZD.scene;
      // the boy's body: he lies flat to the left of where he stood
      // (hero.sideFall last frame), head to the left
      const bx = side.hero.x - 120;
      const by = side.hero.y - 35;
      // Drift only as far as the oversized scenery safely covers.  This
      // moves attention toward the action without exposing a scene edge.
      const tx = Math.max(-DEFEAT_SHIFT.x, Math.min(DEFEAT_SHIFT.x, DEFEAT_FOCUS.x - bx));
      const ty = Math.max(-DEFEAT_SHIFT.y, Math.min(DEFEAT_SHIFT.y, DEFEAT_FOCUS.y - by));
      this.clearDefeatCam();
      const v = side.el;
      this._defeatTo = `translate(${tx}px, ${ty}px)`;
      this._defeatCamAnim = ZD.clock.track(v.animate(
        [{ transform: 'translate(0px, 0px)' }, { transform: this._defeatTo }],
        { duration: D(1400), easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }
      ));
      return this._defeatCamAnim;
    },

    /* Ease the camera back out to the plain side view, then drop the move. */
    async defeatCamOut(ms) {
      if (!this._defeatCamAnim) return;
      const back = ZD.clock.track(ZD.scene.side.el.animate(
        [{ transform: this._defeatTo }, { transform: 'translate(0px, 0px)' }],
        { duration: ms, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' }
      ));
      this._defeatCamAnim.cancel();
      this._defeatCamAnim = back;
      await animDone(back);
      this.clearDefeatCam();
    },

    clearDefeatCam() {
      if (this._defeatCamAnim) this._defeatCamAnim.cancel();
      this._defeatCamAnim = null;
    },

    resetAfterGameOver() {
      const { side, front } = ZD.scene;
      this.clearDefeatCam();
      document.getElementById('world').classList.remove('alarm');
      side.hero.setRotation(0);
      side.hero.setPos(side.heroHome.x, side.heroHome.y);
      side.zombie.setPos(side.zombieHome.x, side.zombieHome.y);
      side.zombie.setRotation(0);
      side.zombie.setFlip(false);
      side.wall.glass.restore();
      side.idle();
      // the retry's fresh zombie walks in again (wallTitle)
      side.zombie.show(false);
      front.glass.restore();
      front.frame('wide', { duration: 0 });
      front.idle();
      ZD.ui.showHud(true);
    },
  };

  /* Console helper for teachers / LXD: ZD.report() summarises the answer
     log on this device (which piece was confused with which). */
  ZD.report = () => {
    const log = ZD.prefs.get('log', []);
    const rows = {};
    log.forEach((e) => {
      const r = (rows[e.target] = rows[e.target] || { asked: 0, right: 0, timeouts: 0, mixedWith: {} });
      r.asked++;
      if (e.correct) r.right++;
      else if (e.chosen === 'timeout') r.timeouts++;
      else r.mixedWith[e.chosen] = (r.mixedWith[e.chosen] || 0) + 1;
    });
    const table = Object.entries(rows).map(([piece, r]) => ({ piece, asked: r.asked, right: r.right, timeouts: r.timeouts, mixedWith: Object.entries(r.mixedWith).map(([k, n]) => `${k} x${n}`).join(', ') }));
    console.table(table);
    return { answers: log.length, table };
  };

  game.wrongPiece = wrongPiece;
  ZD.game = game;
})();
