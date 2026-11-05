/* Title screen + 3-scene cinematic opening (skippable).
   Scene 2 shows the rules with the real game sequences: wrong piece -> the
   zombie breaks in through the circle; right piece -> zombie down, the hero
   jumps through the circle. */
window.ZD = window.ZD || {};

(function () {
  const { el, wait } = ZD.util;
  const T = (k, v) => ZD.T(k, v);
  const D = (ms) => ZD.scene.D(ms);

  const intro = {
    /* Title: logo over the side scene, resolves on tap (unlocks audio). */
    async title() {
      const side = ZD.scene.side;
      ZD.scene.camera.cut('side');
      side.idle();
      side.setTarget(null);
      ZD.ui.showHud(false);
      const ov = document.getElementById('title');
      ov.innerHTML = '';
      ov.className = 'overlay title visible';
      const logo = el('div', { class: 'logo' }, [
        el('div', { class: 'logo-top', text: ZD.T('appTitle').split(' ')[0] }),
        el('div', { class: 'logo-bottom', text: ZD.T('appTitle').split(' ').slice(1).join(' ') }),
        el('div', { class: 'logo-sub', text: T('appSubtitle') }),
      ]);
      const btn = el('button', { class: 'btn primary huge', text: T('appTap') });
      ov.append(logo, btn);
      anime({ targets: logo, translateY: [-60, 0], opacity: [0, 1], duration: 900, easing: 'easeOutElastic(1, .7)' });
      anime({ targets: btn, opacity: [0, 1], translateY: [30, 0], duration: 600, delay: 500, easing: 'easeOutCubic' });
      await new Promise((res) => {
        const go = () => {
          ZD.audio.unlock();
          ZD.audio.play('click');
          ZD.audio.ambient(true);
          res();
        };
        btn.addEventListener('click', go, { once: true });
      });
      await anime({ targets: [logo, btn], opacity: 0, duration: 300, easing: 'linear' }).finished;
      ov.classList.remove('visible');
      ov.innerHTML = '';
    },

    /* Cinematic. Resolves when START MISSION is tapped (or on skip). */
    async play() {
      const side = ZD.scene.side;
      const world = document.getElementById('world');
      let skipped = false;
      const skipBtn = el('button', { class: 'btn ghost skip', text: T('btnSkip') });
      document.getElementById('intro').appendChild(skipBtn);
      document.getElementById('intro').classList.add('visible', 'pass');
      const skipP = new Promise((res) => skipBtn.addEventListener('click', () => {
        skipped = true;
        ZD.audio.play('click');
        res();
      }, { once: true }));
      const step = (p) => Promise.race([p, skipP]);

      try {
        /* Scene 1 - the emergency */
        ZD.scene.camera.cut('side');
        // the wall stands on the road from the first frame, between the hero
        // and the horde
        side.wall.root.style.display = '';
        side.wall.glass.restore();
        side.setTarget(null);
        side.zombie.show(false);
        side.hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true });
        side.hero.setFlip(false);
        world.classList.add('alarm');
        ZD.audio.play('siren');
        const horde = side.spawnHorde(3);
        ZD.ui.caption('intro1Title', { big: true });
        const o = { v: 0 };
        const hordeAnim = anime({ targets: o, v: 1, duration: D(3600), easing: 'easeOutSine', update: () => {
          horde.forEach((z, i) => z.setPos(2000 + i * 230 - o.v * (560 + i * 40), side.groundY + 4 - i * 6));
        } });
        await step(wait(D(1500)));
        if (skipped) throw 'skip';
        side.hero.play({ sheet: 'hero.sideFear', fps: 14 }).then(() => !skipped && side.hero.setFrame(11));
        await step(wait(D(1200)));
        if (skipped) throw 'skip';
        ZD.ui.caption('intro1Vo');
        await step(wait(D(2200)));
        if (skipped) throw 'skip';
        hordeAnim.pause();

        /* Scene 2 - the wall is fixed in the ground; show both outcomes */
        world.classList.remove('alarm');
        await step(anime({ targets: horde.map((z) => z.el), opacity: 0, duration: D(400), easing: 'linear' }).finished);
        side.clearHorde();
        const demo = { type: 'sector', start: -50, sweep: 100 };
        side.setTarget(demo);
        side.zombie.show(true);
        side.zombie.setPos(side.zombieHome.x, side.zombieHome.y);
        side.zombie.play({ sheet: 'zombie.side.idle', fps: 7, loop: true });
        side.hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true });
        ZD.ui.caption('intro2Vo');
        await step(wait(D(2600)));
        if (skipped) throw 'skip';

        // wrong piece: the glass breaks and the zombie dives through the circle
        ZD.ui.caption('intro2Wrong');
        await step(wait(D(1200)));
        if (skipped) throw 'skip';
        await step(ZD.game.sideThrowDemo({ type: 'arc', start: -50, sweep: 100 }, false));
        if (skipped) throw 'skip';
        world.classList.add('alarm');
        await step(ZD.game.zombieBreakIn());
        if (skipped) throw 'skip';
        await step(wait(D(700)));
        if (skipped) throw 'skip';
        await step(ZD.game.securityReset(demo));
        if (skipped) throw 'skip';
        await step(wait(D(600)));
        if (skipped) throw 'skip';

        // right piece: it passes the circle, knocks the zombie out, and the
        // hero jumps through to the next wall
        ZD.ui.caption('intro2Right');
        await step(wait(D(1200)));
        if (skipped) throw 'skip';
        await step(ZD.game.sideThrowDemo(demo, true));
        if (skipped) throw 'skip';
        await step(side.wall.glass.unlock());
        if (skipped) throw 'skip';
        ZD.audio.play('unlock');
        await step(ZD.game.heroJumpThrough());
        if (skipped) throw 'skip';
        await step(wait(D(900)));
        if (skipped) throw 'skip';

        /* Scene 3 - the mission */
        ZD.ui.caption('');
        const ov = document.getElementById('intro');
        const map = el('div', { class: 'mission-map' });
        map.style.backgroundImage = `url("${ZD.assets.imageUrl('roadPersp')}")`;
        const pathEl = el('div', { class: 'map-path' });
        const items = [1, 2, 3].map((n) => el('div', { class: 'map-item' }, [el('div', { class: 'map-wall', style: { backgroundImage: `url("${ZD.assets.wallUrl('front')}")` } }), el('span', { text: T('intro3Wall', { n }) })]));
        const safe = el('div', { class: 'map-item safe' }, [el('div', { class: 'map-gate' }, [el('span', { text: '⌂' })]), el('span', { text: T('intro3Safe') })]);
        const chain = el('div', { class: 'map-chain' });
        items.forEach((it, i) => {
          chain.appendChild(it);
          chain.appendChild(el('div', { class: 'map-arrow', text: '➜' }));
        });
        chain.appendChild(safe);
        const startBtn = el('button', { class: 'btn primary huge start', text: T('btnStartMission') });
        const vo = el('div', { class: 'map-caption', text: T('intro3Vo') });
        map.append(pathEl, chain, vo, startBtn);
        ov.appendChild(map);
        ov.classList.remove('pass');
        anime({ targets: map, opacity: [0, 1], duration: D(500), easing: 'linear' });
        anime({ targets: chain.children, scale: [0, 1], opacity: [0, 1], duration: D(500), delay: anime.stagger(170, { start: 300 }), easing: 'easeOutBack' });
        anime({ targets: startBtn, scale: [0.6, 1], opacity: [0, 1], duration: D(600), delay: 1600, easing: 'easeOutElastic(1, .6)' });
        [0, 1, 2, 3].forEach((i) => ZD.clock.timeout(() => ZD.audio.play('pop'), 300 + i * 170));
        await step(new Promise((res) => startBtn.addEventListener('click', () => {
          ZD.audio.play('unlock');
          res();
        }, { once: true })));
      } catch (e) {
        if (e !== 'skip') throw e;
      }
      // cleanup: a skip can land mid-animation, so stop the demo's tweens
      if (skipped) {
        anime.running.slice().forEach((a) => {
          if (!a.loop) a.pause();
        });
      }
      world.classList.remove('alarm');
      side.showCover(false);
      side.hero.setRotation(0);
      side.hero.el.style.opacity = '';
      side.zombie.setRotation(0);
      side.zombie.setFlip(false);
      side.zombie.el.style.opacity = '';
      side.projectile.el.style.transform = '';
      side.projectile.el.style.opacity = '';
      side.clearHorde();
      side.wall.root.style.display = '';
      side.wall.root.style.opacity = '';
      side.wall.root.style.transform = '';
      side.wall.glass.restore();
      side.setTarget(null);
      side.hero.setFlip(false);
      side.hero.setPos(side.heroHome.x, side.heroHome.y);
      side.zombie.setPos(side.zombieHome.x, side.zombieHome.y);
      side.projectile.show(false);
      side.idle(); // re-shows the zombie if the intro was skipped during scene 1
      ZD.ui.caption('');
      const ov = document.getElementById('intro');
      ov.classList.remove('visible', 'pass');
      ov.innerHTML = '';
    },
  };

  ZD.intro = intro;
})();
