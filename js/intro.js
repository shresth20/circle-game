/* Title screen + the story / how-to-play cinematic (skippable).
   The story is told ONE sentence at a time in the instruction bar
   (ZD.ui.guide, read aloud), over the real game sequences:
     1. the attack      - a horde runs at the wall, the alarm sounds
     2. the goal        - the camera runs down the road to the Safe Zone
     3. the walls       - back at the first wall, one zombie behind it
     4. the window      - front view: the glowing gap in the glass
     5. the answer      - a demo hand taps the right name; the timer runs
     6. the knock-out   - the piece flies through, the zombie goes down
     7. run and jump    - the hand holds RUN, then taps JUMP
     8. the wrong answer- the glass breaks and the zombie gets through
     9. the route       - walls -> Safe Zone, START MISSION
   Motion is transform / opacity only, time-based (GSAP via ZD.motion /
   Web Animations), and every element is hidden before it is first shown. */
window.ZD = window.ZD || {};

(function () {
  const { el, wait, nextFrame } = ZD.util;
  const M = ZD.motion;
  const { DUR, EASE, PHYS } = M;
  const T = (k, v) => ZD.T(k, v);
  const D = (ms) => ZD.scene.D(ms);

  /* Demo hand: a cartoon glove that points with its index finger.  Drawn
     twice (dark outline pass, then white fill) so the parts read as one
     shape.  Its fingertip is the point it moves to. */
  const HAND_PARTS =
    '<rect x="36" y="6" width="22" height="70" rx="11"/>' +
    '<rect x="26" y="52" width="60" height="56" rx="18"/>' +
    '<rect x="56" y="44" width="18" height="34" rx="9"/>' +
    '<rect x="70" y="50" width="16" height="30" rx="8"/>' +
    '<rect x="12" y="62" width="32" height="18" rx="9" transform="rotate(-25 28 71)"/>';
  const HAND_SVG =
    '<svg viewBox="0 0 100 130" aria-hidden="true">' +
    `<g fill="#2a1145" stroke="#2a1145" stroke-width="10" stroke-linejoin="round">${HAND_PARTS}</g>` +
    `<g fill="#ffffff">${HAND_PARTS}</g>` +
    '<path d="M60 62v12M73 64v12" stroke="#cdbfe0" stroke-width="3" stroke-linecap="round"/>' +
    '<rect x="30" y="104" width="52" height="20" rx="6" fill="#5aa9ff" stroke="#2a1145" stroke-width="5"/>' +
    '</svg>';
  const HAND_W = 118;
  const HAND_TIP = { x: HAND_W * 0.47, y: HAND_W * 1.3 * 0.05 };

  function demoHand(parent) {
    const node = el('div', { class: 'demo-hand', html: HAND_SVG });
    node.style.transformOrigin = `${HAND_TIP.x}px ${HAND_TIP.y}px`;
    const ring = el('div', { class: 'demo-ring' });
    parent.append(ring, node);
    const st = { x: 1500, y: 1250, s: 1 };
    const apply = () => {
      node.style.transform = `translate3d(${(st.x - HAND_TIP.x).toFixed(1)}px, ${(st.y - HAND_TIP.y).toFixed(1)}px, 0) scale(${st.s.toFixed(3)})`;
    };
    node.style.opacity = '0';
    ring.style.opacity = '0';
    apply();
    const tween = (o, ms, ease) => {
      M.stop(st);
      return M.to(st, Object.assign({ ms: D(ms), ease, onUpdate: apply }, o));
    };
    return {
      el: node,
      /* glide in from below the screen to `p` */
      enter(p, ms = 900) {
        M.stop(node);
        if (node.style.opacity === '0') {
          st.x = p.x + 160;
          st.y = 1240;
          st.s = 1;
          apply();
        }
        M.to(node, { opacity: 1, ms: D(260), ease: EASE.OUT });
        return tween({ x: p.x, y: p.y }, ms, EASE.OUT);
      },
      moveTo(p, ms = 700) {
        return tween({ x: p.x, y: p.y }, ms, EASE.INOUT);
      },
      async tap() {
        await tween({ s: 0.84 }, 120, EASE.IN);
        ZD.audio.play('click');
        // a ring opens under the fingertip
        // (placed by left/top, which never animate: GSAP owns its transform)
        M.stop(ring);
        ring.style.left = st.x - 40 + 'px';
        ring.style.top = st.y - 40 + 'px';
        M.fromTo(ring, { opacity: 0.95, scale: 0.3 }, { opacity: 0, scale: 1.5, ms: D(520), ease: PHYS.BURST });
        await tween({ s: 1 }, 220, EASE.POP);
      },
      press() {
        return tween({ s: 0.86 }, 140, EASE.IN);
      },
      release() {
        return tween({ s: 1 }, 200, EASE.POP);
      },
      hide() {
        M.stop(node);
        M.to(node, { opacity: 0, ms: D(240), ease: EASE.IN });
        return tween({ y: st.y + 120 }, 260, EASE.IN);
      },
    };
  }

  /* centre (+ a nudge, in fractions of its size) of a DOM element in stage
     px - the stage is scaled to the screen, overlays use stage px */
  function stagePoint(node, fx = 0, fy = 0) {
    const sr = document.getElementById('stage').getBoundingClientRect();
    const k = sr.width / ZD.scene.STAGE_W;
    const r = node.getBoundingClientRect();
    return { x: (r.left + r.width * (0.5 + fx) - sr.left) / k, y: (r.top + r.height * (0.5 + fy) - sr.top) / k };
  }

  const intro = {
    /* Welcome screen: the road picture (full-picture/image copy 5.png) as
       background, the big logo in the middle and a round PLAY button.  Resolves on tap (which also unlocks audio). */
    async title() {
      const side = ZD.scene.side;
      ZD.scene.camera.cut('side');
      side.idle();
      side.setTarget(null);
      ZD.ui.showHud(false);
      const A = ZD.assets;
      const ov = document.getElementById('title');
      ov.innerHTML = '';
      ov.className = 'overlay title welcome visible';
      // first time: the loading screen (#loader, same layout) is still on top
      const loader = document.getElementById('loader');
      const logoArt = A.image('welcomeLogo');
      const logo = el('div', { class: 'welcome-logo', role: 'img', 'aria-label': T('appTitle'), style: { backgroundImage: `url("${A.imageUrl('welcomeLogo')}")`, aspectRatio: `${logoArt.w} / ${logoArt.h}` } });
      // play button art (circle-game-art/images/image copy.png via build_start_button)
      // over a soft glow; .play-art takes hover / press, its inner .play-img
      // does the gentle "tap me" heartbeat (CSS)
      const art = el('span', { class: 'play-art' }, [el('span', { class: 'play-img', style: { backgroundImage: `url("${A.imageUrl('startButton')}")` } })]);
      const btn = el('button', { class: 'play-btn', 'aria-label': T('btnPlay') }, [el('span', { class: 'play-glow' }), art]);
      ov.append(logo, btn);
      const loops = [];
      if (loader) {
        // swap: the logo is already showing; the loading bar gives way to the button
        logo.style.opacity = 1;
        const slot = loader.querySelector('.welcome-slot');
        await M.exit(slot, { scale: 0.92 });
        loader.remove();
      }
      if (!loader) M.pop(logo, { y: -80, scale: 0.85 }, { duration: DUR.REVEAL });
      M.pop(btn, { scale: 0.3 }, { duration: DUR.SLOW, delay: loader ? 0 : DUR.SLOW });
      // idle: the logo floats (transform only), a slow breath
      loops.push(M.fromTo(logo, { y: 0 }, { y: -10, duration: DUR.IDLE, delay: loader ? 0 : DUR.REVEAL, ease: PHYS.GLIDE, yoyo: true, repeat: -1, immediateRender: false }));
      await new Promise((res) => {
        const go = () => {
          ZD.audio.unlock();
          ZD.audio.play('click');
          ZD.audio.ambient(true);
          ZD.audio.music(true);
          res();
        };
        btn.addEventListener('click', go, { once: true });
      });
      loops.forEach((a) => a.kill());
      M.stop([logo, btn, art]);
      M.to(btn, { scale: 0.9, duration: DUR.FAST, ease: EASE.IN });
      await M.exit([logo, btn], null, { duration: DUR.NORMAL, delay: DUR.INSTANT });
      ov.classList.remove('visible', 'welcome');
      ov.innerHTML = '';
    },

    /* The story + how-to-play cinematic.  E = the game flow's epoch.
       Resolves with the epoch to carry on with once START MISSION is
       tapped, or after Skip (which moves to a new epoch, so any demo step
       still running aborts at its next guard).  Either way the scene is
       reset to a clean first wall under a cover that then fades away. */
    async play(E) {
      const G = ZD.game;
      const geo = ZD.geo;
      const ui = ZD.ui;
      const C = ZD.controls;
      const { side, front, camera } = ZD.scene;
      const stage = document.getElementById('stage');
      const world = document.getElementById('world');
      const ov = document.getElementById('intro');
      const nWalls = ZD.MISSIONS[0].rounds.length;

      ov.innerHTML = '';
      ov.className = 'overlay intro visible pass';
      // the bar sits above the intro's cover; demo buttons ignore taps
      stage.classList.add('intro-on', 'demo');
      const curtain = el('div', { class: 'intro-curtain' });
      curtain.style.opacity = '0';
      const skipBtn = el('button', { class: 'btn ghost skip', text: T('btnSkip') });
      skipBtn.style.opacity = '0';
      ov.append(curtain);
      const hand = demoHand(ov);
      ov.append(skipBtn);
      M.enter(skipBtn, null, { ms: D(400), delayMs: D(600) });

      const SKIP = { skip: true };
      let skipped = false;
      const skipP = new Promise((res) => skipBtn.addEventListener('click', () => {
        skipped = true;
        ZD.audio.play('click');
        res();
      }, { once: true }));
      // every awaited beat: stops at once on Skip
      const step = async (p) => {
        await Promise.race([p, skipP]);
        if (skipped) throw SKIP;
        G.guard(E);
      };
      const pause = (ms) => step(wait(D(ms)));
      const say = (key, o) => ui.guide(key, o);
      const heroIdle = () => side.hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true });

      let cover = null; // what hides the scene while it is reset at the end
      try {
        /* ---- 1. the attack ------------------------------------------ */
        camera.cut('side');
        ZD.scene.setZombieSkin(0);
        side.setScroll(0);
        side.wall.root.style.display = '';
        side.wall.glass.restore();
        side.setTarget(null);
        side.zombie.show(false);
        side.hero.setFlip(false);
        heroIdle();
        await pause(500);
        world.classList.add('alarm');
        ZD.audio.play('siren');
        const horde = side.spawnHorde(3);
        // each runs in from off screen and pulls up behind the wall
        const spots = horde.map((z, i) => ({ x0: 2080 + i * 250, x1: 1440 + i * 205, y: side.groundY + 4 - i * 6 }));
        let scroll = 0;
        const placeHorde = (k) => horde.forEach((z, i) => z.setPos(spots[i].x0 + (spots[i].x1 - spots[i].x0) * k - scroll, spots[i].y));
        placeHorde(0);
        const run = { k: 0 };
        const hordeIn = M.to(run, { k: 1, ms: D(3200), ease: PHYS.DECEL, onUpdate: () => placeHorde(run.k) }).then(() => {
          horde.forEach((z) => z.play({ sheet: 'zombie.side.idle', fps: 7, loop: true }));
        });
        let line = say('storyAttack', { kind: 'alert' });
        await pause(1200);
        side.hero.play({ sheet: 'hero.sideFear', fps: 14 }).then(() => {
          if (!skipped && side.hero.sheetKey === 'hero.sideFear') side.hero.setFrame(11);
        });
        await step(Promise.all([line, hordeIn]));
        world.classList.remove('alarm');

        /* ---- 2. the goal: down the road to the Safe Zone ------------ */
        const PAN = 2000; // the finale's run: the Safe Zone stands there
        side.prepareRun(PAN, { gate: true });
        const cam = { x: 0 };
        const pan = (to, ms) => {
          M.stop(cam);
          return M.to(cam, { x: to, ms: D(ms), ease: PHYS.GLIDE, onUpdate: () => {
            scroll = cam.x;
            side.setScroll(cam.x);
            side.hero.setPos(side.heroHome.x - cam.x, side.heroHome.y);
            placeHorde(1);
          } });
        };
        heroIdle();
        say('storySafe1');
        line = say('storySafe2');
        await pause(700);
        // the horde stays behind at the wall: it fades as the camera leaves
        // it (no zombie may seem to stand at the Safe Zone)
        M.to(horde.map((z) => z.el), { opacity: 0, ms: D(700), delayMs: D(300), ease: EASE.IN });
        await step(pan(PAN, 2800));
        side.clearHorde();
        horde.length = 0; // (the pan back has none to move)
        await step(Promise.all([line, wait(D(900))]));

        /* ---- 3. back to the first wall: one zombie behind it -------- */
        say('storyWalls1', { vars: { n: nWalls } });
        line = say('storyWalls2');
        await step(pan(0, 2400));
        side.removeGate();
        side.zombieOffset = 0;
        side.setScroll(0);
        // the front view (step 4) is painted now, unseen, so it swings in
        // with every tile ready
        camera.prewarm('front', { shot: 'focus' });
        side.zombie.el.style.opacity = '0';
        side.zombie.show(true);
        side.zombie.play({ sheet: 'zombie.side.idle', fps: 7, loop: true });
        await step(M.enter(side.zombie.el, null, { ms: D(600) }));
        side.zombie.el.style.opacity = '';
        await step(line);

        /* ---- 4. the window (front view) ----------------------------- */
        // a minor sector pointing up: clear to see, easy to name
        const t1 = geo.normalize({ type: 'sector', sweep: 100, start: -140 });
        side.setTarget(t1);
        front.glass.restore();
        front.setTarget(t1);
        front.glass.lightsOff();
        front.idle();
        // the bar slides away before the view swings (its width differs per view)
        await step(ui.hideBanner());
        front.zombieWalkUp(2200);
        G.focusWall(true);
        await step(camera.to('front', { shot: 'focus' }));
        side.settleZombie();
        front.zombieLurk();
        // one short line at a time (each waits for the one before)
        say('storyWindow1');
        say('storyWindow2');
        say('storyGap1');
        await step(say('storyGap2'));

        /* ---- 5. the answer: tap the name ---------------------------- */
        ui.ask(t1.id);
        line = say('storyTap', { kind: 'ask' });
        await pause(700); // (the buttons slide in)
        const pill = (id) => stagePoint(ui.answerBtns[id], 0.36, 0.22); // right of the label: the hand never hides a name
        await step(hand.enter(pill(t1.id)));
        await step(line);
        // the zombie timer: the face walks to the wall
        ui.timerShow(ZD.scene.skinIndex, 14);
        front.zombieClimb(14000, (q, hop) => ui.timerSet(q, hop));
        say('storyHurry1', { kind: 'alert' });
        await step(say('storyHurry2', { kind: 'alert' }));
        await step(hand.tap());
        ui._pick(t1.id);
        ui.endAsk();
        front.stopZombie();
        ui.timerHide();
        ui.markAnswer(t1.id, 'correct');
        hand.hide();
        ui.hideBanner();

        /* ---- 6. the knock-out --------------------------------------- */
        await step(G.throwFront(t1, t1, true, E, { final: true }));
        say('storyKnockOut1', { kind: 'good', now: true });
        line = say('storyKnockOut2', { kind: 'good' });
        await step(G.correctSide(t1, E, { review: false }));
        await step(line);

        /* ---- 7. run and jump ---------------------------------------- */
        await step(C.show());
        const runLine = say('storyRun');
        await step(hand.enter(stagePoint(C.runBtn, 0.12, 0.12)));
        await pause(300);
        await step(hand.press());
        C.runBtn.classList.add('pressed');
        let jumpLine = null;
        await step(G.heroJumpThrough({
          beforeLeap: async () => {
            // at the take-off: let go of RUN, then JUMP
            C.runBtn.classList.remove('pressed');
            await step(hand.release());
            await step(runLine);
            jumpLine = say('storyJump');
            await step(hand.moveTo(stagePoint(C.jumpBtn, 0.12, 0.12), 750));
            await pause(450);
            C.jumpBtn.classList.add('pressed');
            await step(hand.tap());
            C.jumpBtn.classList.remove('pressed');
          },
        }));
        hand.hide();
        await step(Promise.all([jumpLine, wait(D(500))]));
        C.hide();

        /* ---- 8. the wrong answer ------------------------------------ */
        await step(ui.hideBanner());
        await step(M.exit(world, null, { ms: D(420) }));
        // out of sight: the wall again, with the other zombie and a new gap
        const t2 = geo.normalize({ type: 'segment', sweep: 120, start: 30 }); // minor segment, pointing down
        ZD.scene.setZombieSkin(1);
        side.hero.setRotation(0);
        side.hero.setFlip(false);
        side.hero.setPos(side.heroHome.x, side.heroHome.y);
        heroIdle();
        side.zombieOffset = 0;
        side.setScroll(0);
        side.zombie.setFlip(false);
        side.zombie.setRotation(0);
        side.zombie.el.style.opacity = '';
        side.zombie.show(true);
        side.zombie.setPos(side.zombieHome.x, side.zombieHome.y);
        side.zombie.play({ sheet: 'zombie.side.idle', fps: 7, loop: true });
        side.showCover(false);
        side.wall.glass.restore();
        side.setTarget(t2);
        front.stopZombie();
        front.glass.restore();
        front.setTarget(t2);
        front.idle();
        front._placeZombie(front.zpose.far, 0);
        camera.cut('front');
        front.frame('focus', { duration: 0 });
        front.glass.lightUp();
        await nextFrame(); // the new frame is drawn before it fades in
        await step(M.enter(world, null, { ms: D(500) }));
        world.style.opacity = '';
        ui.ask(t2.id);
        line = say('storyWrong1', { kind: 'alert' });
        await pause(700);
        const wrongId = Object.keys(ui.answerBtns).find((id) => id !== t2.id);
        await step(hand.enter(pill(wrongId)));
        await step(line);
        await step(hand.tap());
        ui._pick(wrongId);
        ui.endAsk();
        ui.markAnswer(wrongId, 'wrong');
        ui.markAnswer(t2.id, 'reveal');
        hand.hide();
        ui.hideBanner();
        await step(G.throwFront(G.wrongPiece(wrongId, t2), t2, false, E));
        world.classList.add('alarm');
        // the zombie smashes the glass on its way through
        say('storyWrong2', { kind: 'alert', now: true });
        say('storyGotYou', { kind: 'alert' });
        line = say('storyRetry');
        await step(G.zombieBreakIn(E));
        await step(Promise.all([line, wait(D(600))]));

        /* ---- 9. the route: walls -> Safe Zone ----------------------- */
        await step(ui.hideBanner());
        const map = el('div', { class: 'mission-map' });
        map.style.backgroundImage = `url("${ZD.assets.imageUrl('roadPersp')}")`;
        map.style.opacity = '0';
        const items = Array.from({ length: nWalls }, (_, i) => el('div', { class: 'map-item' }, [
          el('div', { class: 'map-wall', style: { backgroundImage: `url("${ZD.assets.wallUrl('front')}")` } }),
          el('span', { text: T('intro3Wall', { n: i + 1 }) }),
        ]));
        const safe = el('div', { class: 'map-item safe' }, [
          el('div', { class: 'map-safe', style: { backgroundImage: `url("${ZD.assets.imageUrl('safeZone')}")` } }),
          el('span', { text: T('intro3Safe') }),
        ]);
        const chain = el('div', { class: 'map-chain' + (nWalls > 3 ? ' many' : '') });
        items.forEach((it) => chain.append(it, el('div', { class: 'map-arrow', html: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 20h20M20 10l10 10-10 10" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>' })));
        chain.appendChild(safe);
        Array.from(chain.children).forEach((c) => (c.style.opacity = '0'));
        const startBtn = el('button', { class: 'btn primary huge start', text: T('btnStartMission') });
        startBtn.style.opacity = '0';
        map.append(chain, startBtn);
        ov.insertBefore(map, curtain);
        ov.classList.remove('pass'); // the map takes the taps (START)
        await step(M.enter(map, null, { ms: D(600) }));
        world.classList.remove('alarm');
        M.pop(chain.children, { scale: 0.6 }, { ms: D(420), stagger: D(110) / 1000 });
        items.concat(safe).forEach((_, i) => ZD.clock.timeout(() => ZD.audio.play('pop'), i * 220));
        say('storyGoal1', { vars: { n: nWalls }, kind: 'good' });
        line = say('storyGoal2', { kind: 'good' });
        await pause(chain.children.length * 110 + 300);
        await step(M.pop(startBtn, { scale: 0.6 }, { ms: D(600) }));
        M.exit(skipBtn, null, { ms: D(200) });
        await step(new Promise((res) => startBtn.addEventListener('click', () => {
          ZD.audio.play('unlock');
          res();
        }, { once: true })));
        M.stop(startBtn);
        await Promise.all([M.to(startBtn, { scale: 0.92, duration: DUR.FAST, ease: EASE.IN }), ui.hideBanner()]);
        cover = map;
      } catch (e) {
        if (e !== SKIP) throw e;
        // Skip: a new epoch (the demo's half-done steps abort at their next
        // guard), and a dark curtain over the scene
        E = ++G.epoch;
        M.stop(curtain);
        ui.hideBanner();
        await M.to(curtain, { opacity: 1, duration: DUR.NORMAL, ease: EASE.IN });
        cover = curtain;
      }

      // under the cover: a clean first wall, then the cover lifts
      skipBtn.remove();
      hand.el.remove();
      G.resetAll({ keep: ['intro'] });
      camera.cut('side');
      ZD.scene.setZombieSkin(0);
      await nextFrame();
      await nextFrame();
      await M.to(cover, { opacity: 0, ms: D(600), ease: EASE.INOUT });
      ov.className = 'overlay';
      ov.innerHTML = '';
      stage.classList.remove('intro-on', 'demo');
      return E;
    },
  };

  ZD.intro = intro;
})();
