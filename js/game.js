/* Game state machine: title -> intro -> 6 walls -> finale.
   The six pieces are shuffled and dealt one per wall, so every piece is
   asked exactly once per play.  Each wall = one question:
   present (front) -> three answer buttons (+ zombie timer) -> throw ->
     right: zombie knocked out, window opens, hero goes through (side)
     wrong / time out: glass breaks, heart lost, lesson, then the SAME piece
     again in a different opening.
   Correctness comes from ZD.geo.matches on the configured data. */
window.ZD = window.ZD || {};

(function () {
  const { el, wait, shuffle } = ZD.util;
  const T = (k, v) => ZD.T(k, v);
  const geo = ZD.geo;
  const fx = () => ZD.scene.fx;
  const D = (ms) => ZD.scene.D(ms);

  class Abort extends Error {}

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
      const E = ++this.epoch;
      this.pendingAction = null;
      try {
        this.resetAll();
        if (start === 'home') {
          await ZD.intro.title();
          this.guard(E);
          await ZD.intro.play();
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

    resetAll() {
      ZD.clock.clearAll();
      ZD.clock.resume();
      this.paused = false;
      anime.running.slice().forEach((a) => {
        if (!a.loop) a.pause();
      });
      I18n.stop();
      ['title', 'intro', 'pause', 'complete', 'gameover', 'lesson'].forEach((id) => {
        const o = document.getElementById(id);
        o.className = 'overlay';
        o.innerHTML = '';
      });
      document.getElementById('world').classList.remove('alarm');
      ZD.ui.hideGrid(true);
      ZD.ui.hideBanner();
      ZD.ui.stampEl.classList.remove('visible');
      ZD.ui.caption('');
      ZD.ui.showHud(false);
      const { front, side } = ZD.scene;
      [front, side].forEach((s) => {
        s.projectile.show(false);
        s.hero.setRotation(0);
        s.hero.setOffsetY(0);
        s.hero.setPos(s.heroHome.x, s.heroHome.y);
        s.hero.el.style.opacity = '';
      });
      front.stopZombie();
      front.setZombieHp(0, 0);
      front._placeZombie(front.zpose.mid, 0);
      front.glass.restore();
      front.setTarget(null);
      front.idle();
      side.clearHorde();
      side.removeGate();
      side.walls.forEach((w, i) => {
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
      ZD.ui.pauseMenu(
        () => this.resume(),
        () => this.abortTo('restart'),
        () => this.abortTo('home')
      );
    },
    resume() {
      if (!this.paused) return;
      this.paused = false;
      ZD.ui.closePanel('pause');
      ZD.clock.resume();
    },
    /* Kill the running flow and start a fresh one (from the title, or from
       the start of the current mission). */
    abortTo(where) {
      this.paused = false;
      ZD.clock.resume();
      this.epoch++; // stale flow aborts at its next guard
      if (this._kick) this._kick(); // ...or right now if it is waiting for input
      this._loop(where);
    },

    /* --------------------------------------------------------- mission */
    async playMission(mission, E) {
      this.mission = mission;
      this.hearts = mission.hearts;
      this.score = 0;
      this.throws = 0;
      this.correct = 0;
      this.concepts = new Set();
      this.mixups = [];
      this.walls = dealWalls(mission);
      ZD.ui.setHearts(this.hearts, mission.hearts);
      ZD.ui.showHud(true);
      let wi = 0;
      while (wi < this.walls.length) {
        const wall = this.walls[wi];
        this.guard(E);
        await this.wallTitle(wall);
        const result = await this.playWall(wall, E);
        this.guard(E);
        if (result === 'gameover') {
          const choice = await this.gameOver(this.lastTarget, this.lastChosen, E);
          this.guard(E);
          if (choice === 'home') {
            this.pendingAction = 'home';
            throw new Abort();
          }
          // retry the same wall with full hearts (and a fresh zombie)
          this.hearts = mission.hearts;
          ZD.ui.setHearts(this.hearts, mission.hearts);
          this.resetAfterGameOver();
          continue;
        }
        if (wi < this.walls.length - 1) {
          await this.transition(E);
        }
        wi++;
      }
      return this.finale(E);
    },

    async wallTitle(wall) {
      const timed = !!(wall.timer && this.timerOn);
      ZD.ui.showBanner(T('wallTitle', { n: wall.n, total: wall.total }), T(timed ? 'wallSubTimer' : 'wallSubCalm', { s: wall.timer }), 'title');
      ZD.audio.play('alarm');
      await wait(D(2200));
      await ZD.ui.hideBanner();
    },

    /* Zombie timer on/off (pause menu; for younger players / accessibility). */
    get timerOn() {
      return ZD.prefs.get('timer', true);
    },
    setTimerOn(v) {
      ZD.prefs.set('timer', !!v);
      // switched off mid-question: the climbing zombie calms down at once
      const { front } = ZD.scene;
      if (!v && front.climbing) {
        front.zombiePace();
      }
    },

    /* ------------------------------------------------------------ wall
       One zombie per wall; `wall.hits` right answers knock it out (1 = one
       question per wall; >1 puts a new opening in the same glass per hit).
       A wrong tap or a time-out breaks the glass: a heart is lost, the
       correct piece is taught, then the same piece comes back in a
       different opening. */
    async playWall(wall, E) {
      const { front, side, camera } = ZD.scene;
      const deck = new Deck(wall.openings);
      let hp = wall.hits;
      let first = true;
      front.setZombieHp(hp, wall.hits);
      for (;;) {
        const target = deck.next();
        this.lastTarget = target;
        this.lastChosen = null;

        // present the opening (front view)
        side.wall.glass.restore();
        side.setTarget(target);
        if (camera.current !== 'front') {
          front.glass.restore();
          front.setTarget(target);
          front.idle();
          front.stopZombie();
          front._placeZombie(front.zpose.far, 0);
          await camera.to('front');
        } else if (first) {
          front.setTarget(target);
        } else {
          await front.glass.reform(target);
        }
        first = false;
        this.guard(E);

        const timed = !!(wall.timer && this.timerOn);
        ZD.ui.showBanner(T('qWindow'), null, 'ask');
        ZD.audio.play('pop');
        const climb = timed ? front.zombieClimb(wall.timer * 1000) : (front.zombiePace(), new Promise(() => {}));
        const t0 = performance.now();
        const res = await this.awaitInput(Promise.race([ZD.ui.ask(target.id).then((id) => ({ id })), climb.then(() => ({ timeout: true }))]), E);
        this.guard(E);
        ZD.ui.endAsk();
        front.stopZombie();
        ZD.ui.hideBanner();
          const chosen = res.timeout ? null : res.id;
        const correct = !!chosen && geo.matches(chosen, target);
        this.throws++;
        this.record(wall, target, chosen, performance.now() - t0);

        if (correct) {
          this.correct++;
          this.score += ZD.SCORING.perHit;
          this.concepts.add(target.id);
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
        this.lastChosen = chosen;
        this.mixups.push({ target: target.id, chosen });
        if (chosen) {
          ZD.ui.markAnswer(chosen, 'wrong');
          ZD.ui.markAnswer(target.id, 'reveal');
          await this.throwFront(wrongPiece(chosen, target), target, false, E);
        } else {
          await this.timeUpFront(E);
        }
        this.guard(E);
        this.hearts--;
        const alive = this.hearts > 0;
        await this.wrongSide(target, chosen, alive, E);
        if (!alive) return 'gameover';
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

    /* --------------------------------------------- front: throw sequence */
    async throwFront(spec, target, correct, E, { final = true, hpIndex = 0 } = {}) {
      const { front } = ZD.scene;
      const P = front.projectile;
      P.setSpec(spec, 0);
      P.show(false);
      front.hero.play({ sheet: 'hero.backThrow', fps: 18 }).then(() => front.hero.play({ sheet: 'hero.backIdle', fps: 9, loop: true }));
      await wait(7 / 18 * 1000);
      this.guard(E);
      if (correct) ZD.ui.hideGrid(); // buttons slide away as the piece leaves the hand
      ZD.audio.play('whoosh');
      const from = front.heroHand;
      const to = front.hole;
      const ctrl = { x: from.x + (to.x - from.x) * 0.5, y: Math.min(from.y, to.y) - 150 };
      let locked = false;
      await P.fly({
        from, to, ctrl,
        duration: D(900),
        easing: 'easeInSine',
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
        await anime({ targets: P.el, scale: [1, 0.5], opacity: [1, 0], duration: D(320), easing: 'easeInQuad' }).finished;
        P.el.style.opacity = '';
        P.el.style.transform = '';
        P.show(false);
        if (final) {
          await ZD.scene.camera.to('side', { zoomAt: to });
          return;
        }
        // a hit: the zombie reels back; the name is the reward
        const z = front.zombie;
        ZD.audio.play('hit');
        ZD.audio.play('groan');
        fx().sparkles(front.fxLayer, z.x, z.y - 120 * z.scale, 16, '#b4ff9d');
        fx().puffs(front.fxLayer, z.x, z.y - 110 * z.scale, 5);
        front.hero.play({ sheet: 'hero.backCheer', fps: 14 }).then(() => front.hero.play({ sheet: 'hero.backIdle', fps: 9, loop: true }));
        ZD.audio.play('yay');
        I18n.say(geo.labelKey(target));
        const stamp = ZD.ui.stamp(T(geo.labelKey(target)), 'correct', 650, { high: true });
        await front.zombieKnockBack();
        this.guard(E);
        await stamp;
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
        anime({ targets: P.el, translateX: '-=120', translateY: '+=320', rotate: '-=140', opacity: [1, 0], duration: D(520), easing: 'easeInQuad', complete: () => {
          P.el.style.transform = '';
          P.el.style.opacity = '';
          P.show(false);
        } });
        ZD.ui.stamp(T('fbWrong'), 'wrong', 600);
        ZD.audio.play('fail');
        await wait(D(800));
        this.guard(E);
        ZD.ui.hideGrid();
        await ZD.scene.camera.to('side', { zoomAt: to });
      }
    },

    /* Time out: the zombie reaches the glass and bangs until it cracks. */
    async timeUpFront(E) {
      const { front } = ZD.scene;
      ZD.ui.hideGrid();
      ZD.ui.stamp(T('fbTimeUp'), 'wrong', 600);
      ZD.audio.play('alarm');
      front.hero.play({ sheet: 'hero.backFear', fps: 14 }).then(() => front.hero.setFrame(11));
      const bang = front.zombieBang();
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

    /* Demo throw used by the intro (side camera).  Correct: the piece passes
       the circle and knocks the zombie out.  Wrong: it bounces off and cracks
       the glass. */
    async sideThrowDemo(spec, correct = true) {
      const { side } = ZD.scene;
      const P = side.projectile;
      P.setSpec(spec, 0);
      side.hero.play({ sheet: 'hero.sideThrow', fps: 18 }).then(() => side.hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true }));
      await wait(7 / 18 * 1000);
      ZD.audio.play('whoosh');
      const from = side.heroHand;
      const to = { x: side.hole.x, y: side.hole.y };
      await P.fly({ from, to, ctrl: { x: (from.x + to.x) / 2, y: to.y - 90 }, duration: D(650), easing: 'easeInSine', scaleFrom: 1.0, scaleTo: 0.8, sxFrom: 0.9, sxTo: 0.45, rotTo: 0, spin: 10 });
      if (!correct) {
        side.wall.glass.highlight('bad');
        side.wall.glass.crack(0, 0);
        ZD.audio.play('crack');
        fx().shards(side.fxLayer, to.x, to.y, 12);
        fx().shake(8, 300);
        await anime({ targets: P.el, translateX: '-=160', translateY: '+=300', rotate: '-=140', opacity: [1, 0], duration: D(520), easing: 'easeInQuad' }).finished;
        P.el.style.transform = '';
        P.el.style.opacity = '';
        P.show(false);
        return;
      }
      side.wall.glass.highlight('good');
      ZD.audio.play('pass');
      fx().sparkles(side.fxLayer, to.x, to.y, 12, '#c7ffd8');
      await this.sideFlightToZombie(P);
      await this.zombieHit();
      side.hero.play({ sheet: 'hero.sideCheer', fps: 12 }).then(() => side.hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true }));
      ZD.audio.play('yay');
      await wait(D(500));
    },

    async sideFlightToZombie(P) {
      const { side } = ZD.scene;
      const from = { x: side.hole.x + 40, y: side.hole.y };
      const to = { x: side.zombie.x - 40, y: side.groundY - 150 };
      ZD.audio.play('whoosh');
      await P.fly({ from, to, ctrl: { x: (from.x + to.x) / 2, y: to.y - 50 }, duration: D(460), easing: 'linear', scaleFrom: 0.8, scaleTo: 1.0, sxFrom: 0.45, sxTo: 0.95, spin: 60 });
      anime({ targets: P.el, scale: [1, 0.2], opacity: [1, 0], duration: D(260), easing: 'easeOutQuad', complete: () => {
        P.el.style.transform = '';
        P.el.style.opacity = '';
        P.show(false);
      } });
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
      anime({ targets: o, d: 90, duration: D(500), easing: 'easeOutQuad', update: () => z.setPos(baseX + o.d, z.y) });
      await z.play({ sheet: 'zombie.side.hit', fps: 16 });
      ZD.audio.play('groan');
      await z.play({ sheet: 'zombie.side.die', fps: 15 });
      z.setSheet('zombie.side.dead');
      z.setFrame(0);
    },

    /* ----------------------------------------------- side: correct path */
    async correctSide(target, E) {
      const { side } = ZD.scene;
      const P = side.projectile;
      P.setSpec(target, 0);
      side.wall.glass.highlight('good');
      P.set(side.hole.x + 10, side.hole.y, 0.8, 0, 0.45);
      await this.sideFlightToZombie(P);
      this.guard(E);
      await this.zombieHit();
      this.guard(E);
      ZD.ui.stamp(T('fbCorrect'), 'correct', 900);
      ZD.audio.play('success');
      side.hero.play({ sheet: 'hero.sideCheer', fps: 12 }).then(() => side.hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true }));
      ZD.audio.play('yay');
      fx().sparkles(side.fxLayer, side.hero.x, side.hero.y - 200, 24);
      fx().sparkles(side.fxLayer, side.zombie.x, side.zombie.y - 120, 18, '#b4ff9d');
      fx().ring(side.fxLayer, side.hole.x, side.hole.y, '#7CFF8A', 140);
      // free review while the window opens and the hero goes through:
      // the name and its rule, read aloud
      ZD.ui.showBanner(T(geo.labelKey(target)), T(geo.ruleKey(target)), 'good');
      I18n.say(geo.ruleKey(target));
      await side.wall.glass.unlock();
      ZD.audio.play('unlock');
      this.guard(E);
      await this.heroJumpThrough();
      this.guard(E);
      await ZD.ui.hideBanner();
    },

    /* The circle is open: the defeated zombie fades, the hero runs at the wall
       and leaps through the circle to the far side (hero.sideLeap sheet:
       0-2 crouch, 3 take-off, 4-7 mid-air, 8 touch-down, 9-11 land). */
    async heroJumpThrough() {
      const { side } = ZD.scene;
      const hero = side.hero;
      anime({ targets: side.zombie.el, opacity: 0, duration: D(500), easing: 'easeInQuad' });
      const takeoff = side.hole.x - 330;
      const landing = side.hole.x + 330;
      hero.play({ sheet: 'hero.sideRun', fps: 16, loop: true });
      const run = { x: hero.x };
      const steps = setInterval(() => ZD.audio.play('step'), 200);
      await anime({ targets: run, x: takeoff, duration: D(650), easing: 'easeInQuad', update: () => hero.setPos(run.x, side.heroHome.y) }).finished;
      clearInterval(steps);
      // crouch + spring (from a run, so skip the standing frame)
      await hero.play({ sheet: 'hero.sideLeap', fps: 18, from: 1, to: 2 });
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

    /* ------------------------------------------------- side: wrong path */
    async wrongSide(target, chosen, alive, E) {
      document.getElementById('world').classList.add('alarm');
      await this.zombieBreakIn(E, () => ZD.ui.loseHeart(this.hearts)); // index of the heart just lost
      this.guard(E);
      if (alive) {
        // the lesson: the correct piece fills the gap
        await wait(D(500));
        this.guard(E);
        await this.awaitInput(ZD.learn.lesson(target, chosen), E);
        this.guard(E);
        await this.securityReset(target, E);
        this.guard(E);
        await wait(D(500));
        this.guard(E);
      } else {
        // defeat (cartoon): the hero stays down, the zombie looms
        ZD.audio.play('gameover');
        ZD.scene.side.zombie.play({ sheet: 'zombie.side.attack', fps: 12, loop: true });
        await wait(D(1900));
        this.guard(E);
      }
    },

    /* Wrong piece: the glass shatters as the zombie dives through the circle,
       lands on the hero's side and knocks the hero out. */
    async zombieBreakIn(E, onHit) {
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
      await anime({ targets: o, x: runTo, duration: D(520), easing: 'easeInQuad', update: () => z.setPos(o.x, side.zombieHome.y) }).finished;
      if (E != null) this.guard(E);
      // leap through the circle (zombie.side.leap: 0-1 crouch, 2-6 airborne,
      // 7-11 land, 12-14 attack-ready) - the glass breaks as the head hits it
      await z.play({ sheet: 'zombie.side.leap', fps: 14, from: 0, to: 1 });
      if (E != null) this.guard(E);
      z.stop(); // airborne frames follow the arc
      const landX = side.heroHome.x + 260;
      await side.leapThrough(z, { x0: runTo, x1: landX, y: side.zombieHome.y, core: side.zombieLeapCore, duration: 900, tilt: 30,
        onProgress: (t) => z.setFrame(2 + Math.min(4, Math.floor(t * 5))),
        onCross: () => {
        glass.shatter();
        ZD.audio.play('shatter');
        fx().shards(side.fxLayer, side.hole.x, side.hole.y, 18, ['#bfe9ff', '#ffffff', '#ff8aa0', '#e0a070']);
        fx().shake(14, 500);
        fx().flash('#ff3b5c', 300, 0.35);
        ZD.ui.stamp(T('fbBreached'), 'breach', 900);
        ZD.audio.play('scream');
        // startled: the hero flinches back as the zombie bursts through
        const back = { x: hero.x };
        anime({ targets: back, x: side.heroHome.x - 40, duration: D(260), easing: 'easeOutQuad', update: () => hero.setPos(back.x, side.heroHome.y) });
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
      // attack: the hero is knocked flat
      const atk = z.play({ sheet: 'zombie.side.attack', fps: 16 });
      await wait(D(380));
      if (E != null) this.guard(E);
      ZD.audio.play('thud');
      fx().puffs(side.fxLayer, hero.x + 40, hero.y - 150, 6);
      fx().shake(10, 400);
      onHit && onHit();
      hero.play({ sheet: 'hero.sideJump', fps: 14, from: 0, to: 5 }).then(() => hero.setFrame(5));
      const ho = { x: hero.x, r: 0 };
      anime({ targets: ho, x: side.heroHome.x + 90, duration: D(600), easing: 'easeOutQuad', update: () => hero.setPos(ho.x, side.heroHome.y) });
      anime({ targets: ho, r: -84, duration: D(650), easing: 'easeInBack', update: () => hero.setRotation(ho.r) });
      fx().stars(side.fxLayer, side.heroHome.x - 120, side.heroHome.y - 90, 5, 2400);
      await atk;
    },

    /* Security reset after a breach: a shock pulse throws the zombie back
       through the circle, the glass reforms and the hero gets back up. */
    async securityReset(target, E) {
      const { side } = ZD.scene;
      const z = side.zombie;
      const hero = side.hero;
      ZD.audio.play('unlock');
      fx().flash('#9ad8ff', 400, 0.4);
      fx().ring(side.fxLayer, z.x, z.y - 120, '#9ad8ff', 120);
      await z.play({ sheet: 'zombie.side.hit', fps: 16 });
      if (E != null) this.guard(E);
      z.setFlip(true);
      z.play({ sheet: 'zombie.side.run', fps: 16, loop: true });
      ZD.audio.play('swoosh');
      side.showCover(true);
      const up = { r: hero.rot || 0 };
      anime({ targets: up, r: 0, duration: D(600), delay: D(300), easing: 'easeOutBack', update: () => hero.setRotation(up.r) });
      const back = { x: hero.x };
      anime({ targets: back, x: side.heroHome.x, duration: D(500), delay: D(300), easing: 'easeOutQuad', update: () => hero.setPos(back.x, side.heroHome.y) });
      await side.leapThrough(z, { x0: z.x, x1: side.zombieHome.x, y: side.zombieHome.y, core: side.zombieCore, duration: 850 });
      side.showCover(false);
      if (E != null) this.guard(E);
      z.setFlip(false);
      z.play({ sheet: 'zombie.side.idle', fps: 7, loop: true });
      hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true });
      side.wall.glass.restore();
      side.setTarget(target);
      fx().ring(side.fxLayer, side.hole.x, side.hole.y, '#9ad8ff', 120);
      document.getElementById('world').classList.remove('alarm');
    },

    /* ------------------------------------------------------ transition */
    async transition(E) {
      const { side } = ZD.scene;
      ZD.ui.showBanner(T('wallCleared'), null, 'good');
      await wait(D(900));
      ZD.ui.hideBanner();
      await side.runToNext(1750, 2700, { withZombie: true });
      this.guard(E);
      document.getElementById('world').classList.remove('alarm');
    },

    /* ----------------------------------------------------------- finale */
    async finale(E) {
      const { side } = ZD.scene;
      const mission = this.mission;
      ZD.ui.showBanner(T('wallCleared'), null, 'good');
      await wait(D(800));
      ZD.ui.hideBanner();
      await side.runToNext(2000, 3000, { withZombie: false, gate: true });
      this.guard(E);
      document.getElementById('world').classList.remove('alarm');
      // made it: a cheer at the safe zone, then run inside
      ZD.audio.play('fanfare');
      await side.hero.play({ sheet: 'hero.sideCheer', fps: 12 });
      this.guard(E);
      await side.enterSafeZone();
      this.guard(E);
      await wait(D(900));
      this.guard(E);

      const accuracy = this.throws ? this.correct / this.throws : 0;
      const hasNext = !!ZD.MISSIONS[this.missionIndex + 1];
      const stats = el('div', { class: 'stats' }, [
        el('div', { class: 'stat-walls' }, this.walls.map(() => el('div', { class: 'pip done big' }))),
        el('div', { class: 'stat-row' }, [el('span', { text: T('endScore') }), el('b', { text: this.score })]),
        el('div', { class: 'stat-row' }, [el('span', { text: T('endAccuracy') }), el('b', { text: ZD.util.fmtPct(accuracy) })]),
        el('div', { class: 'stat-row concepts' }, [el('span', { text: T('endConcepts') }), el('div', { class: 'chips' }, geo.PIECES.filter((id) => this.concepts.has(id)).map((id) => el('span', { class: 'chip', text: T(geo.labelKey(id)) })))]),
        this.mixupSummary(),
      ]);
      const buttons = [{ label: T('btnReplay'), cls: 'secondary' }];
      if (hasNext) buttons.unshift({ label: T('btnNextMission'), cls: 'primary' });
      buttons.push({ label: T('btnHome'), cls: 'secondary' });
      const p = ZD.ui.panel({ id: 'complete', title: T('endTitle'), html: el('div', {}, [el('p', { class: 'mission-name', text: T(mission.titleKey) }), el('p', { class: 'lead', text: T('endSub') }), stats]), buttons, cls: 'complete' });
      ZD.ui.showHud(false);
      const idx = await this.awaitInput(p.result, E);
      this.guard(E);
      const label = buttons[idx].label;
      this.resetAll();
      if (label === T('btnNextMission')) return 'next';
      if (label === T('btnReplay')) return 'play';
      this.pendingAction = 'home';
      throw new Abort();
    },

    /* "Practise these": the mission's mix-ups, most frequent first. */
    mixupSummary() {
      const counts = new Map();
      this.mixups.forEach((m) => {
        const k = `${m.target}|${m.chosen || ''}`;
        counts.set(k, (counts.get(k) || 0) + 1);
      });
      const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => {
        const [target, chosen] = k.split('|');
        const text = chosen
          ? T('endMixup', { target: T(geo.labelKey(target)), chosen: T(geo.labelKey(chosen)) })
          : T('endMixupTime', { target: T(geo.labelKey(target)) });
        return el('li', {}, [el('span', { text }), n > 1 ? el('b', { text: `×${n}` }) : null]);
      });
      return el('div', { class: 'stat-row mixups' }, [
        el('span', { text: T('endMixups') }),
        rows.length ? el('ul', { class: 'mixup-list' }, rows) : el('div', { class: 'mixup-none', text: T('endNoMixups') }),
      ]);
    },

    /* -------------------------------------------------------- game over
       Cartoon defeat already played; now the short lesson for the opening
       that cost the last heart, then retry the wall. */
    async gameOver(target, chosen, E) {
      ZD.ui.showHud(false);
      const ov = document.getElementById('gameover');
      ov.style.backgroundImage = `url("${ZD.assets.imageUrl('gameOver')}")`;
      const { el: lesson, diagram } = ZD.learn.lessonBody(target, chosen, { size: 280 });
      const body = el('div', { class: 'go-body' }, [el('p', { class: 'lead', text: T('goSub') }), lesson]);
      const p = ZD.ui.panel({ id: 'gameover', title: T('goTitle'), html: body, cls: 'gameover', buttons: [{ label: T('btnRetry'), cls: 'primary' }, { label: T('btnHome'), cls: 'secondary' }] });
      diagram.play();
      const idx = await this.awaitInput(p.result, E);
      I18n.stop();
      this.guard(E);
      return idx === 0 ? 'retry' : 'home';
    },

    resetAfterGameOver() {
      const { side, front } = ZD.scene;
      document.getElementById('world').classList.remove('alarm');
      side.hero.setRotation(0);
      side.hero.setPos(side.heroHome.x, side.heroHome.y);
      side.zombie.setPos(side.zombieHome.x, side.zombieHome.y);
      side.zombie.setRotation(0);
      side.zombie.setFlip(false);
      side.wall.glass.restore();
      side.idle();
      front.glass.restore();
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

  ZD.game = game;
})();
