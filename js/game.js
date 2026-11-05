/* Game state machine: title -> intro -> wall x3 -> finale.
   Each wall: present challenge -> select -> throw (front) -> outcome (side)
   -> next.  Correctness comes from ZD.geo.matches on the configured data. */
window.ZD = window.ZD || {};

(function () {
  const { el, wait, shuffle, pick } = ZD.util;
  const T = (k, v) => ZD.T(k, v);
  const geo = ZD.geo;
  const fx = () => ZD.scene.fx;
  const D = (ms) => ZD.scene.D(ms);

  class Abort extends Error {}

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
      ['title', 'intro', 'pause', 'complete', 'gameover'].forEach((id) => {
        const o = document.getElementById(id);
        o.className = 'overlay';
        o.innerHTML = '';
      });
      document.getElementById('world').classList.remove('alarm');
      ZD.ui.hidePrompt();
      ZD.ui.optionsEl.innerHTML = '';
      ZD.ui.optionsEl.classList.remove('visible');
      ZD.ui.bannerEl.classList.remove('visible');
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
      side.idle();
    },

    /* ----------------------------------------------------------- pause */
    togglePause() {
      if (this.paused) return this.resume();
      if (document.getElementById('title').classList.contains('visible')) return;
      this.paused = true;
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
      const { front, side } = ZD.scene;
      this.mission = mission;
      this.hearts = mission.hearts;
      this.score = 0;
      this.throws = 0;
      this.correct = 0;
      this.concepts = new Set();
      ZD.ui.setHearts(this.hearts, mission.hearts);
      ZD.ui.setScore(0, false);
      ZD.ui.showHud(true);
      let wi = 0;
      while (wi < mission.walls.length) {
        const wall = mission.walls[wi];
        ZD.ui.setProgress(wi, mission.walls.length, wi);
        this.guard(E);
        await this.wallTitle(wall, wi);
        const result = await this.playWall(wall, wi, E);
        this.guard(E);
        if (result === 'gameover') {
          const choice = await this.gameOver(wall, this.lastChallenge, E);
          this.guard(E);
          if (choice === 'home') {
            this.pendingAction = 'home';
            throw new Abort();
          }
          // retry the same wall with full hearts
          this.hearts = mission.hearts;
          ZD.ui.setHearts(this.hearts, mission.hearts);
          this.resetAfterGameOver();
          continue;
        }
        ZD.ui.setProgress(wi, mission.walls.length, wi + 1);
        if (wi < mission.walls.length - 1) {
          await this.transition(E);
        }
        wi++;
      }
      return this.finale(E);
    },

    async wallTitle(wall) {
      ZD.ui.showBanner(T(wall.titleKey), null, 'title');
      ZD.audio.play('alarm');
      await wait(D(1500));
      await ZD.ui.hideBanner();
    },

    /* ------------------------------------------------------------ wall */
    async playWall(wall, wi, E) {
      const { front, side, camera } = ZD.scene;
      let misses = 0;
      const pool = shuffle(wall.challenges);
      let k = 0;
      for (;;) {
        const ch = pool[k % pool.length];
        k++;
        this.lastChallenge = ch;
        this.lastWall = wall;
        const target = geo.normalize(ch.target);

        // front view: present the wall + question
        front.glass.restore();
        front.setTarget(target);
        front.idle();
        side.wall.glass.restore();
        side.setTarget(target);
        side.hero.setRotation(0);
        side.hero.setPos(side.heroHome.x, side.heroHome.y);
        side.zombie.setPos(side.zombieHome.x, side.zombieHome.y);
        side.idle();
        if (camera.current !== 'front') await camera.to('front');
        this.guard(E);

        const options = shuffle(ch.options).map((o, i) => {
          const n = geo.normalize(o);
          return { spec: n, id: `${k}-${i}`, label: T(geo.labelKey(n, wall.level)), rot: o.rot || 0 };
        });
        const targetLabel = T(geo.labelKey(target, wall.level));
        this.currentOptions = options.map((o) => ({ id: o.id, correct: geo.matches(o.spec, target, wall.level) }));
        if (ch.mode === 'shape') ZD.ui.showPrompt(T('qShape'), misses ? T('qAttempt', { n: misses + 1 }) : null);
        else if (ch.mode === 'name') ZD.ui.showPrompt(T('qName', { name: targetLabel }), T('qNameSub'));
        else ZD.ui.showPrompt(T('qIdentify'), T('qIdentifySub'));
        ZD.audio.play('pop');

        const chosen = await this.awaitInput(ZD.ui.showOptions(options, ch.mode), E);
        this.guard(E);
        ZD.ui.hidePrompt();
        const correct = geo.matches(chosen.spec, target, wall.level);
        this.throws++;
        ZD.ui.markOption(chosen.id, correct ? 'correct' : 'wrong');

        await this.throwFront(chosen, target, correct, E);
        this.guard(E);
        ZD.ui.hideOptions();

        if (correct) {
          this.correct++;
          const gained = ZD.SCORING.byMisses[Math.min(misses, ZD.SCORING.byMisses.length - 1)] || ZD.SCORING.min;
          this.score += gained;
          this.concepts.add(targetLabel);
          await this.correctSide(target, targetLabel, wall.level, E);
          ZD.ui.setScore(this.score);
          return 'cleared';
        }
        misses++;
        const hint = this.hintFor(chosen.spec, target, wall.level);
        this.hearts--;
        const alive = this.hearts > 0;
        await this.wrongSide(target, hint, alive, E);
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

    hintFor(selected, target, level) {
      const s = geo.normalize(selected);
      const t = geo.normalize(target);
      if (s.type === 'chord') return T('hintChordAny');
      if (s.type !== t.type) {
        const key = I18n.key('hint', s.type, t.type);
        return I18n.has(key) ? T(key) : T(I18n.key('hint', 'generic', t.type));
      }
      return T(I18n.key('hint', 'size', t.size));
    },

    /* --------------------------------------------- front: throw sequence */
    async throwFront(chosen, target, correct, E) {
      const { front } = ZD.scene;
      const P = front.projectile;
      P.setSpec(chosen.spec, chosen.rot);
      P.show(false);
      front.hero.play({ sheet: 'hero.backThrow', fps: 18 }).then(() => front.hero.play({ sheet: 'hero.backIdle', fps: 9, loop: true }));
      await wait(7 / 18 * 1000);
      this.guard(E);
      ZD.ui.hideOptions(); // cards slide away as the piece leaves the hand
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
        rotFrom: chosen.rot || 0, rotTo: 0, spin: correct ? 20 : 35,
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
        front.glass.highlight('good');
        ZD.audio.play('pass');
        fx().sparkles(front.fxLayer, to.x, to.y, 18, '#c7ffd8');
        fx().ring(front.fxLayer, to.x, to.y, '#7CFF8A', 80);
        fx().flash('#9dffb0', 300, 0.35);
        // pass through: shrink into the distance
        await anime({ targets: P.el, scale: [1, 0.5], opacity: [1, 0], duration: D(320), easing: 'easeInQuad' }).finished;
        P.el.style.opacity = '';
        P.el.style.transform = '';
        P.show(false);
        await ZD.scene.camera.to('side', { zoomAt: to });
      } else {
        front.glass.highlight('bad');
        front.glass.crack(0, 0);
        ZD.audio.play('crack');
        fx().shards(front.fxLayer, to.x, to.y, 16);
        fx().ring(front.fxLayer, to.x, to.y, '#ff3b5c', 80);
        fx().flash('#ff3b5c', 320, 0.3);
        fx().shake(12, 480);
        front.hero.play({ sheet: 'hero.backFear', fps: 14 }).then(() => front.hero.setFrame(11));
        // bounce off and drop
        anime({ targets: P.el, translateX: '-=120', translateY: '+=320', rotate: '-=140', opacity: [1, 0], duration: D(520), easing: 'easeInQuad', complete: () => {
          P.el.style.transform = '';
          P.el.style.opacity = '';
          P.show(false);
        } });
        ZD.ui.stamp(T('fbWrong'), 'wrong', 700);
        ZD.audio.play('fail');
        await wait(D(900));
        this.guard(E);
        await ZD.scene.camera.to('side', { zoomAt: to });
      }
    },

    /* Demo throw used by the intro (side camera, always correct). */
    async sideThrowDemo(spec) {
      const { side } = ZD.scene;
      const P = side.projectile;
      P.setSpec(spec, 0);
      side.hero.play({ sheet: 'hero.sideThrow', fps: 18 });
      await wait(7 / 18 * 1000);
      ZD.audio.play('whoosh');
      const from = side.heroHand;
      const to = { x: side.hole.x, y: side.hole.y };
      await P.fly({ from, to, ctrl: { x: (from.x + to.x) / 2, y: to.y - 90 }, duration: D(650), easing: 'easeInSine', scaleFrom: 1.0, scaleTo: 0.8, sxFrom: 0.9, sxTo: 0.45, rotTo: 0, spin: 10 });
      side.wall.glass.highlight('good');
      ZD.audio.play('pass');
      fx().sparkles(side.fxLayer, to.x, to.y, 12, '#c7ffd8');
      await this.sideFlightToZombie(P);
      await this.zombieHit();
      side.hero.play({ sheet: 'hero.sideCheer', fps: 12 }).then(() => side.hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true }));
      ZD.audio.play('yay');
      await wait(D(600));
      side.wall.glass.highlight('idle');
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
    async correctSide(target, label, level, E) {
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
      fx().sparkles(side.fxLayer, side.hero.x, side.hero.y - 200, 14);
      ZD.ui.showBanner(`${T('fbCorrect')} — ${label}`, null, 'good');
      side.wall.glass.unlock().then(() => ZD.audio.play('unlock'));
      await wait(D(1800));
      this.guard(E);
      await ZD.ui.hideBanner();
    },

    /* ------------------------------------------------- side: wrong path */
    async wrongSide(target, hint, alive, E) {
      const { side } = ZD.scene;
      const z = side.zombie;
      const hero = side.hero;
      side.wall.glass.crack(0, 0);
      document.getElementById('world').classList.add('alarm');
      ZD.audio.play('alarm');
      // zombie charges the wall
      z.play({ sheet: 'zombie.side.run', fps: 14, loop: true });
      ZD.audio.play('groan');
      const wallX = side.hole.x + 60;
      const o = { x: z.x };
      await anime({ targets: o, x: wallX, duration: D(820), easing: 'easeInQuad', update: () => z.setPos(o.x, z.y) }).finished;
      this.guard(E);
      // breaks through
      side.wall.glass.shatter();
      ZD.audio.play('shatter');
      fx().shards(side.fxLayer, side.hole.x, side.hole.y, 18, ['#bfe9ff', '#ffffff', '#ff8aa0', '#e0a070']);
      fx().shake(14, 500);
      fx().flash('#ff3b5c', 300, 0.35);
      ZD.ui.stamp(T('fbBreached'), 'breach', 900);
      hero.play({ sheet: 'hero.sideFear', fps: 14 }).then(() => hero.setFrame(11));
      ZD.audio.play('scream');
      const attackX = side.heroHome.x + 150;
      await anime({ targets: o, x: attackX, duration: D(700), easing: 'easeInOutQuad', update: () => z.setPos(o.x, z.y) }).finished;
      this.guard(E);
      // attack + hero knocked
      const atk = z.play({ sheet: 'zombie.side.attack', fps: 16 });
      await wait(D(380));
      ZD.audio.play('thud');
      fx().puffs(side.fxLayer, hero.x + 40, hero.y - 150, 6);
      fx().shake(10, 400);
      const ho = { x: hero.x };
      anime({ targets: ho, x: hero.x - 70, duration: D(380), easing: 'easeOutQuad', update: () => hero.setPos(ho.x, hero.y) });
      hero.play({ sheet: 'hero.sideJump', fps: 14, from: 0, to: 5 }).then(() => hero.setFrame(5));
      ZD.ui.loseHeart(this.hearts); // index of the heart just lost
      await atk;
      this.guard(E);

      if (alive) {
        // security reset: zombie pushed back through the wall, glass restored
        ZD.ui.showBanner(T('fbWrong'), hint, 'bad');
        await wait(D(600));
        this.guard(E);
        ZD.audio.play('unlock');
        fx().flash('#9ad8ff', 400, 0.4);
        fx().ring(side.fxLayer, side.hole.x, side.hole.y, '#9ad8ff', 120);
        z.play({ sheet: 'zombie.side.hit', fps: 14 }).then(() => z.play({ sheet: 'zombie.side.idle', fps: 7, loop: true }));
        const back = { x: z.x };
        anime({ targets: back, x: side.zombieHome.x, duration: D(900), easing: 'easeInOutQuad', update: () => z.setPos(back.x, z.y) });
        hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true });
        anime({ targets: ho, x: side.heroHome.x, duration: D(500), easing: 'easeOutQuad', update: () => hero.setPos(ho.x, hero.y) });
        await wait(D(500));
        side.wall.glass.restore();
        side.setTarget(target);
        document.getElementById('world').classList.remove('alarm');
        await wait(D(2000));
        this.guard(E);
        await ZD.ui.hideBanner();
        ZD.ui.showBanner(T('fbReset'), null, 'info');
        await wait(D(900));
        await ZD.ui.hideBanner();
      } else {
        // defeat (cartoon): hero topples, stars, zombie looms
        ZD.audio.play('gameover');
        z.play({ sheet: 'zombie.side.attack', fps: 12, loop: true });
        // topple backwards, pivoting on the feet; keep the feet far enough right
        // that the head stays on stage
        anime({ targets: ho, x: side.heroHome.x + 60, duration: D(600), easing: 'easeOutQuad', update: () => hero.setPos(ho.x, hero.y) });
        const rot = { r: 0 };
        anime({ targets: rot, r: -84, duration: D(700), easing: 'easeInBack', update: () => hero.setRotation(rot.r) });
        hero.setFrame(5);
        fx().stars(side.fxLayer, side.heroHome.x - 120, hero.y - 90, 5, 2400);
        await wait(D(1900));
        this.guard(E);
      }
    },

    /* ------------------------------------------------------ transition */
    async transition(E) {
      const { side } = ZD.scene;
      ZD.ui.showBanner(T('wallCleared'), T('wallNext'), 'good');
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
      await side.activateShield();
      side.hero.play({ sheet: 'hero.sideCheer', fps: 12 }).then(() => side.hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true }));
      ZD.audio.play('fanfare');
      fx().sparkles(side.fxLayer, 1100, 500, 30, '#9ad8ff');
      fx().sparkles(side.fxLayer, 1300, 420, 30, '#fff2a8');
      await wait(D(1500));
      this.guard(E);

      const accuracy = this.throws ? this.correct / this.throws : 0;
      const hasNext = !!ZD.MISSIONS[this.missionIndex + 1];
      const stats = el('div', { class: 'stats' }, [
        el('div', { class: 'stat-walls' }, mission.walls.map(() => el('div', { class: 'pip done big' }))),
        el('div', { class: 'stat-row' }, [el('span', { text: T('endScore') }), el('b', { text: this.score })]),
        el('div', { class: 'stat-row' }, [el('span', { text: T('endAccuracy') }), el('b', { text: ZD.util.fmtPct(accuracy) })]),
        el('div', { class: 'stat-row concepts' }, [el('span', { text: T('endConcepts') }), el('div', { class: 'chips' }, [...this.concepts].map((c) => el('span', { class: 'chip', text: c })))]),
      ]);
      const buttons = [{ label: T('btnReplay'), cls: 'secondary' }];
      if (hasNext) buttons.unshift({ label: T('btnNextMission'), cls: 'primary' });
      buttons.push({ label: T('btnHome'), cls: 'secondary' });
      const p = ZD.ui.panel({ id: 'complete', title: T('endTitle'), html: el('div', {}, [el('p', { class: 'lead', text: T('endSub') }), stats]), buttons, cls: 'complete' });
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

    /* -------------------------------------------------------- game over */
    async gameOver(wall, ch, E) {
      const { side } = ZD.scene;
      ZD.ui.showHud(false);
      const target = geo.normalize(ch.target);
      const label = T(geo.labelKey(target, wall.level));
      const ov = document.getElementById('gameover');
      ov.style.backgroundImage = `url("${ZD.assets.imageUrl('gameOver')}")`;
      const demoBox = el('div', { class: 'demo' });
      const body = el('div', { class: 'go-body' }, [
        el('p', { class: 'lead', text: T('goSub') }),
        el('p', { class: 'go-need', html: T('goLesson', { name: `<b>${label}</b>` }) }),
        el('p', { class: 'go-watch', text: T('goWatch') }),
        demoBox,
      ]);
      const p = ZD.ui.panel({ id: 'gameover', title: T('goTitle'), html: body, cls: 'gameover', buttons: [{ label: T('btnRetry'), cls: 'primary' }, { label: T('btnHome'), cls: 'secondary' }] });
      ZD.learn.demonstrate(demoBox, target, wall.level);
      const idx = await this.awaitInput(p.result, E);
      this.guard(E);
      return idx === 0 ? 'retry' : 'home';
    },

    resetAfterGameOver() {
      const { side, front } = ZD.scene;
      document.getElementById('world').classList.remove('alarm');
      side.hero.setRotation(0);
      side.hero.setPos(side.heroHome.x, side.heroHome.y);
      side.zombie.setPos(side.zombieHome.x, side.zombieHome.y);
      side.wall.glass.restore();
      side.idle();
      front.glass.restore();
      front.idle();
      ZD.ui.showHud(true);
    },
  };

  ZD.game = game;
})();
