/* ==================================================================
   HOLE IN THE WALL – Parts of a Circle
   A 2.5D canvas game: a piece of a circle flies down the runway
   toward the wall. Name the part before it hits. Correct → it snaps
   into the hole and you pass. Wrong → the wall shatters.
================================================================== */
'use strict';
(() => {
  const W = 1672, H = 941;
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  /* ---------------- layout constants ---------------- */
  const WALL = { cx: 712, cy: 420, r: 165 };            // circle on the wall
  const WALL_RECT = { x: 432, y: 205, w: 566, h: 445 };  // inner wall panel (for cracks)
  const RUN_START = { x: 712, y: 935 };                  // where the piece spawns
  const START_SCALE = 1.9;
  const TOTAL_LEVELS = 10;
  const PANEL = { x: 1095, y: 125, w: 540, h: 580 };
  const BTN = { x: 1120, y0: 300, w: 490, h: 64, gap: 14 };
  const START_BTN = { x: W / 2 - 170, y: 760, w: 340, h: 74 };
  const MUTE_BTN = { x: 1600, y: 890, r: 22 };

  const C = {
    pink: '#ff3fa4', pinkLight: '#ff8fd0', pinkDark: '#9c0f5e',
    cyan: '#35f0ff', green: '#4dff9a', red: '#ff4d6d', yellow: '#ffd84d',
    wall: '#e4eaf7', navy: '#0b1230', text: '#eef4ff', dim: '#9fb3d9',
  };

  /* ---------------- curriculum ---------------- */
  const PARTS = {
    sector:   { name: 'Sector',   desc: 'The slice between two radii and an arc.' },
    segment:  { name: 'Segment',  desc: 'The region between a chord and an arc.' },
    arc:      { name: 'Arc',      desc: 'A curved piece of the circumference.' },
    chord:    { name: 'Chord',    desc: 'A straight line joining two points on the circle.' },
    radius:   { name: 'Radius',   desc: 'A line from the centre to the circumference.' },
    diameter: { name: 'Diameter', desc: 'A chord that passes through the centre.' },
  };
  const ALL_TYPES = Object.keys(PARTS);
  const levelPool = lvl => lvl <= 3 ? ['sector', 'segment', 'arc', 'chord']
                       : lvl <= 6 ? ['sector', 'segment', 'arc', 'chord', 'radius']
                       : ALL_TYPES;
  const levelDuration = lvl => Math.max(4.5, 9.5 - (lvl - 1) * 0.55);

  /* ---------------- game state ---------------- */
  const G = {
    state: 'loading',       // loading | title | intro | play | resolve | gameover | win
    level: 1, score: 0, lives: 3, streak: 0, correctCount: 0,
    best: +(localStorage.getItem('hitw_best') || 0),
    round: null, lastType: null,
    time: 0, introT: 0, rebuildT: 0,
    fx: { shake: 0, flash: 0, flashColor: '#fff', zoom: 0, sweep: 0 },
    particles: [], floaters: [], cracks: null, crackT: 0,
    heartAnim: [0, 0, 0],
    hover: -1, hoverStart: false, hoverMute: false,
    scoreDisplay: 0, paused: false,
  };

  /* ---------------- helpers ---------------- */
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const easeInQuad = t => t * t;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const font = (size, fam = 'Rajdhani', weight = 700) => `${weight} ${size}px '${fam}', sans-serif`;

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }
  // angled sci-fi panel (cut corners)
  function techPanel(c, x, y, w, h, cut = 14) {
    c.beginPath();
    c.moveTo(x + cut, y); c.lineTo(x + w, y); c.lineTo(x + w, y + h - cut);
    c.lineTo(x + w - cut, y + h); c.lineTo(x, y + h); c.lineTo(x, y + cut);
    c.closePath();
  }
  function glowText(c, text, x, y, size, color, glow, fam = 'Orbitron', weight = 800, align = 'center') {
    c.save();
    c.font = font(size, fam, weight);
    c.textAlign = align; c.textBaseline = 'middle';
    c.shadowColor = glow; c.shadowBlur = 18;
    c.fillStyle = color;
    c.fillText(text, x, y);
    c.shadowBlur = 0;
    c.fillText(text, x, y);
    c.restore();
  }
  function heartPath(c, x, y, s) {
    c.beginPath();
    c.moveTo(x, y + s / 4);
    c.bezierCurveTo(x, y, x - s / 2, y, x - s / 2, y + s / 4);
    c.bezierCurveTo(x - s / 2, y + s / 2, x, y + s * 0.75, x, y + s);
    c.bezierCurveTo(x, y + s * 0.75, x + s / 2, y + s / 2, x + s / 2, y + s / 4);
    c.bezierCurveTo(x + s / 2, y, x, y, x, y + s / 4);
    c.closePath();
  }

  /* ---------------- shapes ---------------- */
  function makeShape(type) {
    const p = { type };
    const a0 = rnd(0, 360) * DEG;
    switch (type) {
      case 'sector':   p.a0 = a0; p.a1 = a0 + rnd(55, 110) * DEG; break;
      case 'segment':  p.a0 = a0; p.a1 = a0 + rnd(100, 150) * DEG; break;
      case 'arc':      p.a0 = a0; p.a1 = a0 + rnd(70, 130) * DEG; p.th = 32; break;
      case 'chord':    p.a0 = a0; p.a1 = a0 + rnd(100, 150) * DEG; p.th = 24; break;
      case 'radius':   p.a0 = a0; p.th = 24; break;
      case 'diameter': p.a0 = a0; p.th = 24; break;
    }
    return p;
  }
  function barPath(c, x0, y0, x1, y1, th) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L * th / 2, ny = dx / L * th / 2;
    c.moveTo(x0 + nx, y0 + ny); c.lineTo(x1 + nx, y1 + ny);
    c.lineTo(x1 - nx, y1 - ny); c.lineTo(x0 - nx, y0 - ny);
    c.closePath();
  }
  function tracePath(c, p, R) {
    c.beginPath();
    switch (p.type) {
      case 'sector':   c.moveTo(0, 0); c.arc(0, 0, R, p.a0, p.a1); c.closePath(); break;
      case 'segment':  c.arc(0, 0, R, p.a0, p.a1); c.closePath(); break;
      case 'arc':      c.arc(0, 0, R, p.a0, p.a1); c.arc(0, 0, R - p.th, p.a1, p.a0, true); c.closePath(); break;
      case 'chord':    barPath(c, R * Math.cos(p.a0), R * Math.sin(p.a0), R * Math.cos(p.a1), R * Math.sin(p.a1), p.th); break;
      case 'radius':   barPath(c, 0, 0, R * Math.cos(p.a0), R * Math.sin(p.a0), p.th); break;
      case 'diameter': barPath(c, -R * Math.cos(p.a0), -R * Math.sin(p.a0), R * Math.cos(p.a0), R * Math.sin(p.a0), p.th); break;
    }
  }
  function centroid(p) {
    const R = WALL.r;
    const mid = (p.a0 + (p.a1 ?? p.a0)) / 2;
    let d = 0;
    switch (p.type) {
      case 'sector': d = R * 0.5; break;
      case 'segment': d = R * 0.78; break;
      case 'arc': d = R - p.th / 2; break;
      case 'chord': d = R * Math.cos((p.a1 - p.a0) / 2); break;
      case 'radius': d = R * 0.5; break;
      case 'diameter': d = 0; break;
    }
    return { x: Math.cos(mid) * d, y: Math.sin(mid) * d };
  }

  /* ---------------- round lifecycle ---------------- */
  function makeRound(level) {
    const pool = levelPool(level);
    let type;
    do { type = pool[Math.floor(Math.random() * pool.length)]; } while (type === G.lastType && pool.length > 1);
    G.lastType = type;
    const distract = shuffle(ALL_TYPES.filter(t => t !== type)).slice(0, 3);
    const options = shuffle([type, ...distract]);
    return {
      type, shape: makeShape(type), options, correctIdx: options.indexOf(type),
      t: 0, duration: levelDuration(level),
      answered: false, chosen: -1, result: null, answerT: 0,
      zipFrom: 0, zipT: 0, impacted: false, filled: false, broken: false,
      afterT: 0, tickAcc: 0, bannerT: 0, gained: 0, mult: 1,
    };
  }

  function startGame() {
    G.paused = false;
    G.level = 1; G.score = 0; G.scoreDisplay = 0; G.lives = 3; G.streak = 0; G.correctCount = 0;
    G.lastType = null; G.particles = []; G.floaters = []; G.cracks = null;
    G.heartAnim = [0, 0, 0];
    SFX.click();
    SFX.startMusic();
    startRound();
  }

  function startRound() {
    const wasBroken = G.round && G.round.broken;
    G.round = makeRound(G.level);
    G.cracks = null;
    G.rebuildT = wasBroken ? 1 : 0;
    G.state = 'intro';
    G.introT = 1.3;
    G.hover = -1;
    SFX.ready();
  }

  function answer(idx) {
    if (G.state !== 'play') return;
    const r = G.round;
    r.answered = true; r.chosen = idx; r.answerT = r.t;
    r.result = idx === r.correctIdx ? 'correct' : (idx === -1 ? 'timeout' : 'wrong');
    G.state = 'resolve';
    r.zipFrom = r.t; r.zipT = 0;
    if (r.result === 'correct') SFX.pick(); else SFX.wrong();
  }

  function onImpact() {
    const r = G.round;
    r.impacted = true; r.bannerT = 0;
    const cen = centroid(r.shape);
    const ix = WALL.cx + cen.x, iy = WALL.cy + cen.y;

    if (r.result === 'correct') {
      r.filled = true;
      G.streak++; G.correctCount++;
      r.mult = G.streak >= 6 ? 3 : G.streak >= 3 ? 2 : 1;
      const bonus = Math.round(100 * (1 - r.answerT));
      r.gained = (100 + bonus) * r.mult;
      G.score += r.gained;
      SFX.snap(); SFX.correct();
      if (r.mult > 1) SFX.combo(r.mult);
      G.fx.flash = 0.6; G.fx.flashColor = C.green; G.fx.zoom = 1; G.fx.sweep = 1; G.fx.shake = 0.25;
      burstSparks(ix, iy, 46);
      ring(ix, iy, C.green); ring(ix, iy, C.cyan, 0.15);
      confetti(WALL.cx, WALL.cy - 120, 26);
      floater(ix, iy - 40, `+${r.gained}`, C.green, 44);
      if (r.mult > 1) floater(ix, iy - 95, `COMBO x${r.mult}`, C.yellow, 30);
      r.afterT = 2.0;
    } else {
      r.broken = true;
      G.streak = 0;
      G.lives = Math.max(0, G.lives - 1);
      G.heartAnim[G.lives] = 1;
      SFX.crash(); SFX.heartLost();
      G.fx.flash = 0.7; G.fx.flashColor = C.red; G.fx.shake = 1;
      G.cracks = makeCracks(ix, iy); G.crackT = 0;
      shards(ix, iy, 22, C.wall); shards(ix, iy, 12, C.pink);
      burstSparks(ix, iy, 18, [C.red, C.yellow]);
      floater(ix, iy - 40, r.result === 'timeout' ? 'TOO SLOW' : 'WALL BROKEN', C.red, 36);
      r.afterT = 2.8;
    }
  }

  function afterResolve() {
    if (G.lives <= 0) { endGame('gameover'); return; }
    G.level++;
    if (G.level > TOTAL_LEVELS) { endGame('win'); return; }
    startRound();
  }

  function endGame(kind) {
    G.state = kind;
    G.hover = -1;
    if (G.score > G.best) { G.best = G.score; localStorage.setItem('hitw_best', G.best); }
    SFX.stopMusic();
    if (kind === 'win') { SFX.win(); confetti(W / 2, 80, 80); } else SFX.gameover();
  }

  /* ---------------- effects ---------------- */
  function burstSparks(x, y, n, colors = [C.pink, C.cyan, '#ffffff', C.pinkLight]) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), sp = rnd(180, 640);
      G.particles.push({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 350,
        life: rnd(0.5, 1.0), max: 1, size: rnd(2.5, 6), color: colors[i % colors.length] });
    }
  }
  function ring(x, y, color, delay = 0) {
    G.particles.push({ kind: 'ring', x, y, r: 10, vr: 520, life: 0.7 + delay, max: 0.7, delay, color });
  }
  function confetti(x, y, n) {
    const cols = [C.pink, C.cyan, C.green, C.yellow, '#ffffff'];
    for (let i = 0; i < n; i++) {
      G.particles.push({ kind: 'confetti', x: x + rnd(-220, 220), y: y + rnd(-20, 20),
        vx: rnd(-80, 80), vy: rnd(-200, 40), g: 420, rot: rnd(0, TAU), vr: rnd(-8, 8),
        w: rnd(6, 12), h: rnd(10, 18), life: rnd(1.4, 2.2), max: 2, color: cols[i % cols.length] });
    }
  }
  function shards(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), sp = rnd(120, 520);
      G.particles.push({ kind: 'shard', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, g: 900,
        rot: rnd(0, TAU), vr: rnd(-10, 10), size: rnd(10, 30), grow: rnd(0.6, 1.6),
        life: rnd(1.1, 1.6), max: 1.6, color });
    }
  }
  function floater(x, y, text, color, size = 36) {
    G.floaters.push({ x, y, text, color, size, life: 1.4, max: 1.4 });
  }
  function trail(r, pose) {
    const cx = pose.x + pose.cen.x * pose.s, cy = pose.y + pose.cen.y * pose.s;
    for (let i = 0; i < 2; i++) {
      G.particles.push({ kind: 'trail', x: cx + rnd(-30, 30) * pose.s, y: cy + rnd(-20, 20) * pose.s,
        vx: rnd(-20, 20), vy: rnd(120, 260), g: 0, life: rnd(0.3, 0.55), max: 0.55,
        size: rnd(3, 8) * pose.s, color: Math.random() < 0.5 ? C.pink : C.cyan });
    }
  }
  function makeCracks(px, py) {
    const cracks = [];
    const n = 8 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      let ang = (i / n) * TAU + rnd(-0.3, 0.3), x = px, y = py;
      const pts = [{ x, y }];
      const segs = 5 + Math.floor(Math.random() * 4);
      for (let s = 0; s < segs; s++) {
        const len = rnd(22, 48);
        ang += rnd(-0.5, 0.5);
        x += Math.cos(ang) * len; y += Math.sin(ang) * len;
        pts.push({ x, y });
      }
      cracks.push({ pts, w: rnd(1.5, 3.5) });
    }
    return cracks;
  }

  function updateParticles(dt) {
    const P = G.particles;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      if (p.kind === 'ring') {
        if (p.delay > 0) { p.delay -= dt; continue; }
        p.r += p.vr * dt; p.life -= dt;
        if (p.life <= 0) P.splice(i, 1);
        continue;
      }
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.rot !== undefined) p.rot += p.vr * dt;
      if (p.kind === 'shard') p.size += p.grow * 30 * dt;
      p.life -= dt;
      if (p.life <= 0) P.splice(i, 1);
    }
    const F = G.floaters;
    for (let i = F.length - 1; i >= 0; i--) {
      const f = F[i];
      f.y -= 45 * dt; f.life -= dt;
      if (f.life <= 0) F.splice(i, 1);
    }
  }

  /* ---------------- update ---------------- */
  function update(dt) {
    if (G.paused) return;
    G.time += dt;
    G.fx.shake = Math.max(0, G.fx.shake - dt * 2.2);
    G.fx.flash = Math.max(0, G.fx.flash - dt * 2.0);
    G.fx.zoom = Math.max(0, G.fx.zoom - dt * 1.4);
    G.fx.sweep = Math.max(0, G.fx.sweep - dt * 1.2);
    G.rebuildT = Math.max(0, G.rebuildT - dt * 1.4);
    G.crackT = Math.min(1, G.crackT + dt * 3);
    for (let i = 0; i < 3; i++) G.heartAnim[i] = Math.max(0, G.heartAnim[i] - dt * 1.5);
    if (G.scoreDisplay < G.score) G.scoreDisplay = Math.min(G.score, G.scoreDisplay + Math.max(60, (G.score - G.scoreDisplay) * 6) * dt);
    updateParticles(dt);

    if (G.state === 'intro') {
      G.introT -= dt;
      if (G.introT <= 0) { G.state = 'play'; SFX.launch(); }
    } else if (G.state === 'play') {
      const r = G.round;
      r.t += dt / r.duration;
      if (r.t > 0.65) {
        r.tickAcc += dt;
        const period = r.t > 0.88 ? 0.14 : 0.3;
        if (r.tickAcc > period) { r.tickAcc = 0; SFX.tick(); }
      }
      trail(r, piecePose(r));
      if (r.t >= 1) { r.t = 1; answer(-1); }
    } else if (G.state === 'resolve') {
      const r = G.round;
      if (!r.impacted) {
        r.zipT += dt / 0.32;
        const k = Math.min(1, r.zipT);
        r.t = lerp(r.zipFrom, 1, easeInQuad(k));
        trail(r, piecePose(r)); trail(r, piecePose(r));
        if (k >= 1) onImpact();
      } else {
        r.bannerT += dt;
        r.afterT -= dt;
        if (r.afterT <= 0) afterResolve();
      }
    }
  }

  /* ---------------- piece ---------------- */
  function piecePose(r) {
    const t = r.t;
    const s = lerp(START_SCALE, 1, t);
    const cen = centroid(r.shape);
    const x = lerp(RUN_START.x - cen.x * START_SCALE, WALL.cx, t);
    const y = lerp(RUN_START.y - cen.y * START_SCALE, WALL.cy, t);
    const rot = Math.sin(G.time * 5) * 0.08 * (1 - t);
    return { x, y, s, rot, cen };
  }

  function drawPiece(c, shape, x, y, s, rot, pivot, opts = {}) {
    const depth = opts.depth ?? 13;
    c.save();
    c.translate(x + pivot.x * s, y + pivot.y * s);
    c.rotate(rot);
    c.translate(-pivot.x * s, -pivot.y * s);
    c.scale(s, s);
    // 2.5D extrusion
    for (let i = depth; i > 0; i -= 1.5) {
      c.save(); c.translate(i * 0.35, i);
      tracePath(c, shape, WALL.r);
      c.fillStyle = i > depth * 0.6 ? '#6b0a42' : C.pinkDark;
      c.fill(); c.restore();
    }
    // glow halo
    if (opts.glow !== false) {
      c.save();
      c.lineWidth = 14; c.strokeStyle = 'rgba(255,63,164,0.25)'; c.lineJoin = 'round';
      tracePath(c, shape, WALL.r); c.stroke();
      c.restore();
    }
    // face
    tracePath(c, shape, WALL.r);
    const g = c.createLinearGradient(-WALL.r, -WALL.r, WALL.r, WALL.r);
    g.addColorStop(0, '#ffa3dc'); g.addColorStop(0.45, C.pink); g.addColorStop(1, '#d4147a');
    c.fillStyle = opts.fill || g; c.fill();
    c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineJoin = 'round'; c.stroke();
    // specular streak
    c.save();
    tracePath(c, shape, WALL.r); c.clip();
    const sg = c.createLinearGradient(-WALL.r, -WALL.r, WALL.r * 0.3, WALL.r * 0.3);
    sg.addColorStop(0, 'rgba(255,255,255,0.45)'); sg.addColorStop(0.5, 'rgba(255,255,255,0)');
    c.fillStyle = sg; c.fillRect(-WALL.r - 5, -WALL.r - 5, WALL.r * 2 + 10, WALL.r * 2 + 10);
    c.restore();
    c.restore();
  }

  function drawFlyingPiece() {
    const r = G.round;
    if (!r || G.state === 'intro' || r.impacted) return;
    const pose = piecePose(r);
    // floor shadow
    const sx = pose.x + pose.cen.x * pose.s, sy = pose.y + pose.cen.y * pose.s + 95 * pose.s;
    ctx.save();
    ctx.globalAlpha = 0.35 * (1 - r.t * 0.6);
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(sx + 10 * pose.s, sy, 110 * pose.s, 22 * pose.s, 0, 0, TAU); ctx.fill();
    ctx.restore();
    drawPiece(ctx, r.shape, pose.x, pose.y, pose.s, pose.rot, pose.cen);
  }

  /* ---------------- wall ---------------- */
  function drawWallCircle() {
    const r = G.round;
    const pulse = 0.5 + 0.5 * Math.sin(G.time * 5);
    ctx.save();
    ctx.translate(WALL.cx, WALL.cy);
    if (G.rebuildT > 0) ctx.globalAlpha = 1 - G.rebuildT;

    // halo
    ctx.beginPath(); ctx.arc(0, 0, WALL.r + 16, 0, TAU);
    ctx.fillStyle = `rgba(53,240,255,${0.08 + 0.05 * pulse})`; ctx.fill();
    // disc
    ctx.beginPath(); ctx.arc(0, 0, WALL.r, 0, TAU);
    const g = ctx.createRadialGradient(-50, -60, 10, 0, 0, WALL.r);
    g.addColorStop(0, '#e8f4ff'); g.addColorStop(1, '#9cc2ee');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = '#1d2a4a'; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(53,240,255,0.7)';
    ctx.beginPath(); ctx.arc(0, 0, WALL.r + 6, 0, TAU); ctx.stroke();

    if (r && (G.state === 'intro' || G.state === 'play' || G.state === 'resolve')) {
      if (!r.filled) {
        // the hole
        ctx.save();
        ctx.beginPath(); ctx.arc(0, 0, WALL.r, 0, TAU); ctx.clip();
        tracePath(ctx, r.shape, WALL.r);
        ctx.fillStyle = '#070b1d'; ctx.fill();
        ctx.save();
        tracePath(ctx, r.shape, WALL.r); ctx.clip();
        ctx.lineWidth = 22; ctx.strokeStyle = `rgba(255,63,164,${0.2 + 0.25 * pulse})`;
        tracePath(ctx, r.shape, WALL.r); ctx.stroke();
        ctx.restore();
        ctx.restore();
        // dashed marching outline
        ctx.save();
        ctx.setLineDash([10, 8]); ctx.lineDashOffset = -G.time * 50;
        ctx.lineWidth = 3; ctx.strokeStyle = '#ff6fc0'; ctx.lineJoin = 'round';
        tracePath(ctx, r.shape, WALL.r); ctx.stroke();
        ctx.restore();
      } else {
        // the fitted piece
        ctx.save();
        ctx.beginPath(); ctx.arc(0, 0, WALL.r, 0, TAU); ctx.clip();
        drawPiece(ctx, r.shape, 0, 0, 1, 0, { x: 0, y: 0 }, { depth: 0, glow: false });
        ctx.restore();
        ctx.save();
        ctx.lineWidth = 5; ctx.strokeStyle = `rgba(77,255,154,${0.5 + 0.5 * pulse})`;
        ctx.shadowColor = C.green; ctx.shadowBlur = 20; ctx.lineJoin = 'round';
        tracePath(ctx, r.shape, WALL.r); ctx.stroke();
        ctx.restore();
      }
    }
    // centre dot
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fillStyle = '#1d2a4a'; ctx.fill();
    ctx.restore();

    // rebuild scanline
    if (G.rebuildT > 0) {
      const y = WALL.cy - WALL.r - 10 + (1 - G.rebuildT) * (WALL.r * 2 + 20);
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 3; ctx.shadowColor = C.cyan; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.moveTo(WALL.cx - WALL.r - 20, y); ctx.lineTo(WALL.cx + WALL.r + 20, y); ctx.stroke();
      ctx.restore();
    }
    // pass-through light sweep
    if (G.fx.sweep > 0) {
      const k = 1 - G.fx.sweep;
      ctx.save();
      ctx.beginPath(); ctx.arc(WALL.cx, WALL.cy, WALL.r + 10, 0, TAU); ctx.clip();
      ctx.globalAlpha = (1 - k) * 0.8;
      const x = WALL.cx - WALL.r - 60 + k * (WALL.r * 2 + 120);
      const sg = ctx.createLinearGradient(x - 60, 0, x + 60, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.9)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg; ctx.fillRect(x - 60, WALL.cy - WALL.r - 20, 120, WALL.r * 2 + 40);
      ctx.restore();
    }
  }

  function drawCracks() {
    if (!G.cracks) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(WALL_RECT.x, WALL_RECT.y, WALL_RECT.w, WALL_RECT.h); ctx.clip();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const cr of G.cracks) {
      const n = cr.pts.length;
      const reach = G.crackT * (n - 1);
      const full = Math.floor(reach), frac = reach - full;
      for (const pass of [0, 1]) {
        ctx.beginPath();
        ctx.moveTo(cr.pts[0].x, cr.pts[0].y);
        for (let i = 1; i <= full && i < n; i++) ctx.lineTo(cr.pts[i].x, cr.pts[i].y);
        if (full + 1 < n) {
          const a = cr.pts[full], b = cr.pts[full + 1];
          ctx.lineTo(lerp(a.x, b.x, frac), lerp(a.y, b.y, frac));
        }
        if (pass === 0) { ctx.lineWidth = cr.w + 2; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; }
        else { ctx.lineWidth = cr.w; ctx.strokeStyle = '#10182f'; }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ---------------- runway ---------------- */
  function drawRunway() {
    const n = 6;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const speed = G.state === 'play' ? 0.45 : 0.18;
    for (let i = 0; i < n; i++) {
      const u = ((i / n) + G.time * speed) % 1;          // 0 = bottom, 1 = at wall
      const y = lerp(925, 675, u);
      const w = lerp(150, 50, u), h = w * 0.32;
      const a = 0.55 * Math.sin(u * Math.PI);
      ctx.strokeStyle = `rgba(53,240,255,${a})`;
      ctx.lineWidth = lerp(9, 3, u);
      ctx.beginPath();
      ctx.moveTo(712 - w / 2, y + h); ctx.lineTo(712, y); ctx.lineTo(712 + w / 2, y + h);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------- particles ---------------- */
  function drawParticles() {
    for (const p of G.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      if (p.kind === 'spark' || p.kind === 'trail') {
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.kind === 'trail' ? a : 1), 0, TAU); ctx.fill();
      } else if (p.kind === 'ring') {
        if (p.delay > 0) { ctx.restore(); continue; }
        ctx.strokeStyle = p.color; ctx.lineWidth = 6 * a + 1;
        ctx.shadowColor = p.color; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
      } else if (p.kind === 'confetti') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      } else if (p.kind === 'shard') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-p.size / 2, p.size * 0.4); ctx.lineTo(p.size * 0.1, -p.size * 0.6); ctx.lineTo(p.size * 0.55, p.size * 0.3);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    for (const f of G.floaters) {
      const a = clamp(f.life / f.max, 0, 1);
      const pop = f.max - f.life < 0.3 ? easeOutBack((f.max - f.life) / 0.3) : 1;
      ctx.save();
      ctx.globalAlpha = Math.min(1, a * 1.5);
      ctx.translate(f.x, f.y); ctx.scale(pop, pop);
      glowText(ctx, f.text, 0, 0, f.size, f.color, f.color);
      ctx.restore();
    }
  }

  /* ---------------- HUD ---------------- */
  function panelBg(x, y, w, h, cut = 14, border = 'rgba(53,240,255,0.55)') {
    ctx.save();
    techPanel(ctx, x, y, w, h, cut);
    ctx.fillStyle = 'rgba(8, 14, 40, 0.78)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = border; ctx.stroke();
    ctx.restore();
  }

  function drawHUD() {
    // title (top-left)
    panelBg(24, 22, 420, 78, 16);
    ctx.save();
    ctx.font = font(26, 'Orbitron', 900); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const tg = ctx.createLinearGradient(44, 0, 420, 0);
    tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, C.cyan);
    ctx.fillStyle = tg; ctx.shadowColor = C.cyan; ctx.shadowBlur = 12;
    ctx.fillText('HOLE IN THE WALL', 44, 50);
    ctx.shadowBlur = 0;
    ctx.font = font(17, 'Rajdhani', 600); ctx.fillStyle = C.pinkLight; ctx.letterSpacing = '4px';
    ctx.fillText('PARTS OF A CIRCLE', 46, 80);
    ctx.restore();

    // stats (top-right)
    panelBg(PANEL.x, 22, PANEL.w, 78, 16);
    ctx.save();
    ctx.textBaseline = 'middle';
    const labelY = 44, valY = 74;
    ctx.font = font(14, 'Rajdhani', 700); ctx.fillStyle = C.dim; ctx.letterSpacing = '2px'; ctx.textAlign = 'center';
    ctx.fillText('LEVEL', PANEL.x + 90, labelY);
    ctx.fillText('SCORE', PANEL.x + 265, labelY);
    ctx.fillText('LIVES', PANEL.x + 445, labelY);
    ctx.letterSpacing = '0px';
    ctx.font = font(30, 'Orbitron', 800); ctx.fillStyle = C.text;
    ctx.fillText(`${Math.min(G.level, TOTAL_LEVELS)}/${TOTAL_LEVELS}`, PANEL.x + 90, valY);
    ctx.fillStyle = C.cyan;
    ctx.fillText(String(Math.round(G.scoreDisplay)).padStart(4, '0'), PANEL.x + 265, valY);
    // dividers
    ctx.strokeStyle = 'rgba(53,240,255,0.35)'; ctx.lineWidth = 1;
    [PANEL.x + 178, PANEL.x + 352].forEach(x => { ctx.beginPath(); ctx.moveTo(x, 36); ctx.lineTo(x, 88); ctx.stroke(); });
    // hearts
    for (let i = 0; i < 3; i++) {
      const alive = i < G.lives;
      const anim = G.heartAnim[i];
      const hx = PANEL.x + 410 + i * 36, hy = 60;
      ctx.save();
      const sc = 1 + anim * 0.6;
      ctx.translate(hx + (anim > 0 ? rnd(-3, 3) * anim : 0), hy);
      ctx.scale(sc, sc);
      heartPath(ctx, 0, -14, 28);
      ctx.fillStyle = alive ? C.red : (anim > 0 ? `rgba(255,77,109,${anim})` : 'rgba(255,255,255,0.12)');
      ctx.shadowColor = C.red; ctx.shadowBlur = alive ? 12 : 0;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // level progress dots
    ctx.save();
    for (let i = 0; i < TOTAL_LEVELS; i++) {
      const x = PANEL.x + 20 + i * ((PANEL.w - 40) / (TOTAL_LEVELS - 1)), y = 112;
      const done = i < G.level - 1, cur = i === G.level - 1;
      ctx.beginPath(); ctx.arc(x, y, cur ? 5 : 3.5, 0, TAU);
      ctx.fillStyle = done ? C.green : cur ? C.cyan : 'rgba(255,255,255,0.2)';
      if (cur) { ctx.shadowColor = C.cyan; ctx.shadowBlur = 10; }
      ctx.fill();
    }
    ctx.restore();

    // mute button
    ctx.save();
    ctx.beginPath(); ctx.arc(MUTE_BTN.x, MUTE_BTN.y, MUTE_BTN.r, 0, TAU);
    ctx.fillStyle = G.hoverMute ? 'rgba(53,240,255,0.25)' : 'rgba(8,14,40,0.75)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(53,240,255,0.5)'; ctx.stroke();
    ctx.font = font(20, 'Rajdhani', 700); ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(SFX.muted ? '🔇' : '🔊', MUTE_BTN.x, MUTE_BTN.y + 1);
    ctx.restore();
  }

  function btnRect(i) { return { x: BTN.x, y: BTN.y0 + i * (BTN.h + BTN.gap), w: BTN.w, h: BTN.h }; }

  function drawQuestionPanel() {
    const r = G.round;
    if (!r) return;
    panelBg(PANEL.x, PANEL.y, PANEL.w, PANEL.h, 18);

    // tag
    ctx.save();
    techPanel(ctx, PANEL.x + 24, PANEL.y + 22, 150, 32, 8);
    ctx.fillStyle = C.cyan; ctx.fill();
    ctx.font = font(16, 'Orbitron', 800); ctx.fillStyle = C.navy; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.letterSpacing = '2px';
    ctx.fillText('QUESTION', PANEL.x + 99, PANEL.y + 39);
    ctx.restore();

    // question text
    ctx.save();
    ctx.font = font(30, 'Rajdhani', 700); ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('Which part of the circle is', PANEL.x + 26, PANEL.y + 92);
    ctx.fillText('flying toward the wall?', PANEL.x + 26, PANEL.y + 128);
    ctx.restore();

    // options
    const letters = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < 4; i++) {
      const b = btnRect(i);
      const hovered = G.hover === i && G.state === 'play';
      let fill = 'rgba(16, 26, 70, 0.9)', border = 'rgba(53,240,255,0.6)', badge = C.cyan, textCol = C.text;
      let scale = hovered ? 1.03 : 1;
      if (r.answered) {
        if (i === r.correctIdx && r.impacted) { fill = 'rgba(20, 90, 60, 0.95)'; border = C.green; badge = C.green; }
        else if (i === r.chosen && r.result !== 'correct') { fill = 'rgba(110, 20, 40, 0.95)'; border = C.red; badge = C.red; }
        else if (i === r.chosen && r.result === 'correct') { fill = 'rgba(20, 90, 60, 0.95)'; border = C.green; badge = C.green; }
        else { textCol = 'rgba(238,244,255,0.45)'; border = 'rgba(53,240,255,0.2)'; badge = 'rgba(53,240,255,0.3)'; }
      } else if (hovered) { fill = 'rgba(53,240,255,0.18)'; border = C.cyan; }
      ctx.save();
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2); ctx.scale(scale, scale); ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
      techPanel(ctx, b.x, b.y, b.w, b.h, 12);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = hovered ? 3 : 2; ctx.strokeStyle = border;
      if (hovered) { ctx.shadowColor = C.cyan; ctx.shadowBlur = 14; }
      ctx.stroke(); ctx.shadowBlur = 0;
      // letter badge
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + 72, b.y); ctx.lineTo(b.x + 58, b.y + b.h); ctx.lineTo(b.x, b.y + b.h); ctx.closePath();
      ctx.fillStyle = badge; ctx.fill();
      ctx.font = font(26, 'Orbitron', 800); ctx.fillStyle = C.navy; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(letters[i], b.x + 32, b.y + b.h / 2 + 1);
      ctx.font = font(30, 'Rajdhani', 700); ctx.fillStyle = textCol; ctx.textAlign = 'left';
      ctx.fillText(PARTS[r.options[i]].name, b.x + 92, b.y + b.h / 2 + 1);
      if (r.answered && r.impacted && i === r.correctIdx) {
        ctx.font = font(28, 'Rajdhani', 700); ctx.fillStyle = C.green; ctx.textAlign = 'right';
        ctx.fillText('✔', b.x + b.w - 20, b.y + b.h / 2 + 1);
      } else if (r.answered && i === r.chosen && r.result === 'wrong') {
        ctx.font = font(28, 'Rajdhani', 700); ctx.fillStyle = C.red; ctx.textAlign = 'right';
        ctx.fillText('✖', b.x + b.w - 20, b.y + b.h / 2 + 1);
      }
      ctx.restore();
    }

    // impact timer
    const barY = PANEL.y + 540, barX = PANEL.x + 26, barW = PANEL.w - 52;
    const t = G.state === 'intro' ? 0 : clamp(r.answered ? r.answerT : r.t, 0, 1);
    const remaining = Math.max(0, (1 - t) * r.duration);
    ctx.save();
    ctx.font = font(15, 'Rajdhani', 700); ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.letterSpacing = '2px';
    ctx.fillText('IMPACT IN', barX, barY - 18);
    ctx.textAlign = 'right'; ctx.fillStyle = t > 0.75 ? C.red : C.text; ctx.letterSpacing = '0px';
    ctx.font = font(20, 'Orbitron', 700);
    ctx.fillText(remaining.toFixed(1) + 's', barX + barW, barY - 18);
    roundRect(ctx, barX, barY, barW, 12, 6); ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fill();
    const fw = barW * (1 - t);
    if (fw > 2) {
      roundRect(ctx, barX, barY, fw, 12, 6);
      const bg = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      bg.addColorStop(0, C.red); bg.addColorStop(0.4, C.yellow); bg.addColorStop(1, C.cyan);
      ctx.fillStyle = bg; ctx.shadowColor = t > 0.75 ? C.red : C.cyan; ctx.shadowBlur = 10; ctx.fill();
    }
    ctx.restore();

    // streak + keys hint
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = font(16, 'Rajdhani', 600); ctx.fillStyle = 'rgba(159,179,217,0.8)'; ctx.textAlign = 'left';
    ctx.fillText('Keys  1 – 4  or  A – D', barX, PANEL.y + 566);
    if (G.streak > 0) {
      const mult = G.streak >= 6 ? 3 : G.streak >= 3 ? 2 : 1;
      ctx.textAlign = 'right';
      ctx.font = font(18, 'Orbitron', 800); ctx.fillStyle = mult > 1 ? C.yellow : C.cyan;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
      ctx.fillText(`STREAK ${G.streak}  ×${mult}`, barX + barW, PANEL.y + 566);
    }
    ctx.restore();
  }

  /* ---------------- banners ---------------- */
  function drawBanner() {
    const r = G.round;
    if (!r || !r.impacted || G.state !== 'resolve') return;
    const k = clamp(r.bannerT / 0.35, 0, 1);
    const pop = easeOutBack(k);
    const fade = r.afterT < 0.3 ? r.afterT / 0.3 : 1;
    const ok = r.result === 'correct';
    const title = ok ? 'CORRECT!' : (r.result === 'timeout' ? 'TOO SLOW!' : 'WRONG!');
    const col = ok ? C.green : C.red;
    const cx = WALL.cx, cy = 775;
    const name = PARTS[r.type].name.toUpperCase();
    const article = /^[AEIOU]/.test(name) ? 'an ' : 'a ';
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(cx, cy); ctx.scale(pop, pop); ctx.translate(-cx, -cy);
    techPanel(ctx, cx - 290, cy - 80, 580, 160, 18);
    ctx.fillStyle = 'rgba(6, 10, 30, 0.86)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 24; ctx.stroke();
    ctx.shadowBlur = 0;
    glowText(ctx, title, cx, cy - 36, 46, col, col);
    ctx.font = font(24, 'Rajdhani', 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = C.text;
    const lead = (ok ? "It's " : 'It was ') + article;
    ctx.font = font(24, 'Rajdhani', 700);
    const wLead = ctx.measureText(lead).width;
    ctx.font = font(26, 'Orbitron', 800);
    const wName = ctx.measureText(name).width;
    const startX = cx - (wLead + wName + 8) / 2;
    ctx.textAlign = 'left';
    ctx.font = font(24, 'Rajdhani', 700); ctx.fillStyle = C.text;
    ctx.fillText(lead, startX, cy + 14);
    ctx.font = font(26, 'Orbitron', 800); ctx.fillStyle = C.pinkLight;
    ctx.fillText(name, startX + wLead + 8, cy + 14);
    ctx.font = font(21, 'Rajdhani', 600); ctx.fillStyle = C.dim; ctx.textAlign = 'center';
    ctx.fillText(PARTS[r.type].desc, cx, cy + 50);
    ctx.restore();
  }

  function drawIntro() {
    const k = 1 - G.introT / 1.3;        // 0 → 1
    const a = k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1;
    const sc = lerp(1.5, 1, easeOutCubic(Math.min(1, k / 0.3)));
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(WALL.cx, WALL.cy); ctx.scale(sc, sc); ctx.translate(-WALL.cx, -WALL.cy);
    glowText(ctx, `LEVEL ${G.level}`, WALL.cx, WALL.cy - 24, 64, '#ffffff', C.cyan);
    glowText(ctx, 'GET READY', WALL.cx, WALL.cy + 34, 26, C.pinkLight, C.pink, 'Rajdhani', 700);
    ctx.restore();
  }

  function drawPaused() {
    ctx.fillStyle = 'rgba(4, 7, 24, 0.6)'; ctx.fillRect(0, 0, W, H);
    glowText(ctx, 'PAUSED', W / 2, H / 2 - 20, 64, '#fff', C.cyan);
    ctx.save();
    ctx.font = font(24, 'Rajdhani', 600); ctx.fillStyle = C.dim; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Press P or ESC to continue', W / 2, H / 2 + 40);
    ctx.restore();
  }
  function togglePause() {
    if (!['intro', 'play', 'resolve'].includes(G.state)) return;
    G.paused = !G.paused;
    SFX.click();
  }

  /* ---------------- title / end screens ---------------- */
  function drawStartButton(label) {
    const b = START_BTN;
    const pulse = 0.5 + 0.5 * Math.sin(G.time * 4);
    ctx.save();
    const sc = G.hoverStart ? 1.05 : 1 + pulse * 0.02;
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2); ctx.scale(sc, sc); ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
    techPanel(ctx, b.x, b.y, b.w, b.h, 16);
    const g = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
    g.addColorStop(0, C.pink); g.addColorStop(1, '#8a2be2');
    ctx.fillStyle = g; ctx.shadowColor = C.pink; ctx.shadowBlur = 20 + pulse * 14; ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.stroke();
    ctx.font = font(28, 'Orbitron', 800); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.letterSpacing = '3px';
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.restore();
    ctx.save();
    ctx.font = font(16, 'Rajdhani', 600); ctx.fillStyle = C.dim; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.6 + pulse * 0.4;
    ctx.fillText('or press SPACE', b.x + b.w / 2, b.y + b.h + 24);
    ctx.restore();
  }

  function drawDemoCircle(cx, cy, R) {
    // decorative spinning circle with a glowing sector / arc / chord
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU);
    ctx.fillStyle = 'rgba(159,194,238,0.9)'; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = '#1d2a4a'; ctx.stroke();
    const a0 = G.time * 0.6;
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.clip();
    drawPiece(ctx, { type: 'sector', a0, a1: a0 + 80 * DEG }, 0, 0, R / WALL.r, 0, { x: 0, y: 0 }, { depth: 0 });
    drawPiece(ctx, { type: 'arc', a0: a0 + 150 * DEG, a1: a0 + 250 * DEG, th: 32 }, 0, 0, R / WALL.r, 0, { x: 0, y: 0 }, { depth: 0, fill: C.cyan });
    drawPiece(ctx, { type: 'chord', a0: a0 + 270 * DEG, a1: a0 + 20 * DEG, th: 24 }, 0, 0, R / WALL.r, 0, { x: 0, y: 0 }, { depth: 0, fill: C.yellow });
    ctx.restore();
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fillStyle = '#1d2a4a'; ctx.fill();
    ctx.restore();
  }

  function drawTitle() {
    ctx.fillStyle = 'rgba(4, 7, 24, 0.62)'; ctx.fillRect(0, 0, W, H);
    drawDemoCircle(WALL.cx, WALL.cy, 150);
    ctx.save();
    ctx.font = font(68, 'Orbitron', 900); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tg = ctx.createLinearGradient(W / 2 - 400, 0, W / 2 + 400, 0);
    tg.addColorStop(0, C.cyan); tg.addColorStop(0.5, '#ffffff'); tg.addColorStop(1, C.pink);
    ctx.fillStyle = tg; ctx.shadowColor = C.cyan; ctx.shadowBlur = 26;
    ctx.fillText('HOLE IN THE WALL', W / 2, 96);
    ctx.shadowBlur = 0;
    ctx.font = font(26, 'Rajdhani', 700); ctx.fillStyle = C.pinkLight; ctx.letterSpacing = '8px';
    ctx.fillText('PARTS OF A CIRCLE', W / 2, 150);
    ctx.restore();

    // how to play cards
    const cards = [
      { n: '1', title: 'WATCH', text: 'A piece of a circle flies\ntoward the wall.' },
      { n: '2', title: 'NAME IT', text: 'Pick its name: Arc, Chord,\nSegment, Sector…' },
      { n: '3', title: 'PASS OR BREAK', text: 'Correct → it fits the hole.\nWrong → the wall shatters!' },
    ];
    const cw = 330, ch = 150, gap = 30, x0 = W / 2 - (cw * 3 + gap * 2) / 2, y0 = 600;
    cards.forEach((cd, i) => {
      const x = x0 + i * (cw + gap);
      panelBg(x, y0, cw, ch, 14, i === 2 ? 'rgba(255,63,164,0.6)' : 'rgba(53,240,255,0.55)');
      ctx.save();
      ctx.beginPath(); ctx.arc(x + 36, y0 + 36, 20, 0, TAU); ctx.fillStyle = i === 2 ? C.pink : C.cyan; ctx.fill();
      ctx.font = font(22, 'Orbitron', 800); ctx.fillStyle = C.navy; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(cd.n, x + 36, y0 + 37);
      ctx.font = font(22, 'Orbitron', 800); ctx.fillStyle = C.text; ctx.textAlign = 'left';
      ctx.fillText(cd.title, x + 68, y0 + 37);
      ctx.font = font(21, 'Rajdhani', 600); ctx.fillStyle = C.dim;
      cd.text.split('\n').forEach((line, li) => ctx.fillText(line, x + 24, y0 + 84 + li * 28));
      ctx.restore();
    });
    drawStartButton('START');
    if (G.best > 0) {
      ctx.save();
      ctx.font = font(20, 'Rajdhani', 700); ctx.fillStyle = C.yellow; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`BEST SCORE  ${G.best}`, W / 2, 560);
      ctx.restore();
    }
  }

  function drawEnd() {
    const win = G.state === 'win';
    ctx.fillStyle = 'rgba(4, 7, 24, 0.72)'; ctx.fillRect(0, 0, W, H);
    const col = win ? C.green : C.red;
    glowText(ctx, win ? 'WALL CLEARED!' : 'WALL DESTROYED', W / 2, 230, 66, '#fff', col);
    ctx.save();
    ctx.font = font(26, 'Rajdhani', 600); ctx.fillStyle = C.dim; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(win ? 'You named every part of the circle. Nice work!' : 'The wall could not take any more hits.', W / 2, 290);
    ctx.restore();

    panelBg(W / 2 - 300, 350, 600, 230, 18, col);
    const stats = [
      ['SCORE', String(G.score), C.cyan],
      ['CORRECT', `${G.correctCount} / ${Math.min(G.level, TOTAL_LEVELS)}`, C.text],
      ['BEST', String(G.best), C.yellow],
    ];
    stats.forEach((s, i) => {
      const x = W / 2 - 200 + i * 200;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = font(16, 'Rajdhani', 700); ctx.fillStyle = C.dim; ctx.letterSpacing = '3px';
      ctx.fillText(s[0], x, 400);
      ctx.letterSpacing = '0px';
      ctx.font = font(44, 'Orbitron', 800); ctx.fillStyle = s[2]; ctx.shadowColor = s[2]; ctx.shadowBlur = 14;
      ctx.fillText(s[1], x, 460);
      ctx.restore();
    });
    ctx.save();
    ctx.font = font(20, 'Rajdhani', 600); ctx.fillStyle = C.dim; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(G.score >= G.best && G.score > 0 ? '★ NEW BEST SCORE ★' : '', W / 2, 540);
    ctx.restore();
    drawStartButton('PLAY AGAIN');
  }

  /* ---------------- render ---------------- */
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);

    ctx.save();
    const sh = G.fx.shake;
    if (sh > 0) ctx.translate((Math.random() - 0.5) * 26 * sh, (Math.random() - 0.5) * 26 * sh);
    // zoom pulse applies to the scene only, not the HUD
    ctx.save();
    if (G.fx.zoom > 0) {
      const z = 1 + 0.05 * Math.sin(G.fx.zoom * Math.PI);
      ctx.translate(WALL.cx, WALL.cy); ctx.scale(z, z); ctx.translate(-WALL.cx, -WALL.cy);
    }
    ctx.drawImage(bg, 0, 0, W, H);

    if (G.state === 'title') { ctx.restore(); drawTitle(); ctx.restore(); return; }

    drawWallCircle();
    drawCracks();
    drawRunway();
    drawFlyingPiece();
    drawParticles();
    ctx.restore();
    drawHUD();
    drawQuestionPanel();
    drawBanner();
    if (G.state === 'intro') drawIntro();
    if (G.state === 'gameover' || G.state === 'win') { drawParticles(); drawEnd(); }
    if (G.paused && !G.freezeOnly) drawPaused();
    ctx.restore();

    if (G.fx.flash > 0) {
      ctx.save();
      ctx.globalAlpha = G.fx.flash * 0.45; ctx.fillStyle = G.fx.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  /* ---------------- input ---------------- */
  function toLogical(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width * W, y: (e.clientY - rect.top) / rect.height * H };
  }
  function hitButton(p) {
    for (let i = 0; i < 4; i++) if (inRect(p, btnRect(i))) return i;
    return -1;
  }
  function onMove(e) {
    const p = toLogical(e);
    let cursor = 'default';
    G.hoverMute = Math.hypot(p.x - MUTE_BTN.x, p.y - MUTE_BTN.y) <= MUTE_BTN.r;
    if (G.hoverMute) cursor = 'pointer';
    if (G.state === 'play') {
      const h = hitButton(p);
      if (h !== G.hover) { G.hover = h; if (h !== -1) SFX.hover(); }
      if (h !== -1) cursor = 'pointer';
    } else G.hover = -1;
    if (G.state === 'title' || G.state === 'gameover' || G.state === 'win') {
      const hs = inRect(p, START_BTN);
      if (hs && !G.hoverStart) SFX.hover();
      G.hoverStart = hs;
      if (hs) cursor = 'pointer';
    } else G.hoverStart = false;
    canvas.style.cursor = cursor;
  }
  function onDown(e) {
    SFX.unlock();
    const p = toLogical(e);
    if (Math.hypot(p.x - MUTE_BTN.x, p.y - MUTE_BTN.y) <= MUTE_BTN.r) { SFX.toggleMute(); SFX.click(); return; }
    if (G.state === 'title' || G.state === 'gameover' || G.state === 'win') {
      if (inRect(p, START_BTN)) startGame();
      return;
    }
    if (G.paused) { togglePause(); return; }
    if (G.state === 'play') {
      const h = hitButton(p);
      if (h !== -1) answer(h);
    }
  }
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('keydown', e => {
    SFX.unlock();
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') {
      if (G.state === 'title' || G.state === 'gameover' || G.state === 'win') { e.preventDefault(); startGame(); }
    }
    if (k === 'm') { SFX.toggleMute(); }
    if (k === 'p' || k === 'escape') { togglePause(); return; }
    if (G.paused) return;
    if (G.state === 'play') {
      const map = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3 };
      if (k in map) answer(map[k]);
    }
  });

  /* ---------------- resize / loop ---------------- */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  const bg = new Image();
  bg.onload = () => { G.state = 'title'; requestAnimationFrame(loop); };
  bg.onerror = () => { console.error('Could not load assets/images/bg.png'); G.state = 'title'; requestAnimationFrame(loop); };
  bg.src = 'assets/images/bg.png';

  // expose for debugging in the console
  window.HITW = { G, answer, startGame, togglePause, freeze(v) { G.paused = v; G.freezeOnly = v; } };
})();
