/* Circle-part geometry.  Every piece in the game (opening in the wall,
   projectile, answer thumbnail, lesson diagram) is generated from the same
   spec, so what the learner sees is exactly what is evaluated.

   spec = { type: 'arc'|'sector'|'segment'|'chord', start: deg, sweep: deg, rot?: deg }
   Angles are degrees, measured clockwise from the +x axis in screen space.
   A piece is 'minor' when sweep < 180 and 'major' when sweep > 180
   (challenges never use exactly 180 so minor/major is never ambiguous). */
window.ZD = window.ZD || {};

(function () {
  const rad = (d) => (d * Math.PI) / 180;

  function polar(cx, cy, r, deg) {
    return { x: cx + r * Math.cos(rad(deg)), y: cy + r * Math.sin(rad(deg)) };
  }

  const f = (n) => (Math.round(n * 100) / 100).toString();

  function arcCmd(r, p, sweep, dir = 1) {
    return `A ${f(r)} ${f(r)} 0 ${sweep > 180 ? 1 : 0} ${dir} ${f(p.x)} ${f(p.y)}`;
  }

  /* Curved band along the circumference (an arc is a curve - we give it a
     clear thickness so it can be a projectile and a visible opening). */
  function arcPath(cx, cy, r, start, sweep, thick) {
    const r2 = r - thick;
    const a0 = polar(cx, cy, r, start);
    const a1 = polar(cx, cy, r, start + sweep);
    const b1 = polar(cx, cy, r2, start + sweep);
    const b0 = polar(cx, cy, r2, start);
    return `M ${f(a0.x)} ${f(a0.y)} ${arcCmd(r, a1, sweep, 1)} L ${f(b1.x)} ${f(b1.y)} ${arcCmd(r2, b0, sweep, 0)} Z`;
  }

  /* Region between two radii and the arc. */
  function sectorPath(cx, cy, r, start, sweep) {
    const p0 = polar(cx, cy, r, start);
    const p1 = polar(cx, cy, r, start + sweep);
    return `M ${f(cx)} ${f(cy)} L ${f(p0.x)} ${f(p0.y)} ${arcCmd(r, p1, sweep, 1)} Z`;
  }

  /* Region between a chord and the arc. */
  function segmentPath(cx, cy, r, start, sweep) {
    const p0 = polar(cx, cy, r, start);
    const p1 = polar(cx, cy, r, start + sweep);
    return `M ${f(p0.x)} ${f(p0.y)} ${arcCmd(r, p1, sweep, 1)} Z`;
  }

  /* A chord drawn as a straight bar (distractor: it is a boundary, not a region). */
  function chordPath(cx, cy, r, start, sweep, thick) {
    const p0 = polar(cx, cy, r, start);
    const p1 = polar(cx, cy, r, start + sweep);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (thick / 2);
    const ny = (dx / len) * (thick / 2);
    return `M ${f(p0.x + nx)} ${f(p0.y + ny)} L ${f(p1.x + nx)} ${f(p1.y + ny)} L ${f(p1.x - nx)} ${f(p1.y - ny)} L ${f(p0.x - nx)} ${f(p0.y - ny)} Z`;
  }

  /* Open curve of the arc only (for highlighting in lessons). */
  function arcStroke(cx, cy, r, start, sweep) {
    const p0 = polar(cx, cy, r, start);
    const p1 = polar(cx, cy, r, start + sweep);
    return `M ${f(p0.x)} ${f(p0.y)} ${arcCmd(r, p1, sweep, 1)}`;
  }

  function normalize(spec) {
    const s = Object.assign({ start: 0, sweep: 90, rot: 0 }, spec);
    s.sweep = ((s.sweep % 360) + 360) % 360 || 360;
    s.size = s.sweep < 180 ? 'minor' : s.sweep > 180 ? 'major' : 'semi';
    s.id = s.type === 'chord' ? 'chord' : `${s.size}-${s.type}`;
    return s;
  }

  const pieceId = (p) => (typeof p === 'string' ? p : normalize(p).id);

  const geo = {
    polar,
    rad,
    normalize,
    /* SVG path for a piece.  rotOffset rotates the piece about the centre. */
    piecePath(spec, cx, cy, r, rotOffset = 0, thickRatio = 0.26) {
      const s = normalize(spec);
      const start = s.start + rotOffset;
      switch (s.type) {
        case 'arc':
          return arcPath(cx, cy, r, start, s.sweep, r * thickRatio);
        case 'sector':
          return sectorPath(cx, cy, r, start, s.sweep);
        case 'segment':
          return segmentPath(cx, cy, r, start, s.sweep);
        case 'chord':
          return chordPath(cx, cy, r, start, s.sweep, r * thickRatio * 0.9);
        default:
          throw new Error('unknown piece type ' + s.type);
      }
    },
    arcStroke,
    /* The six answers, in grid order (rows = size, columns = type). */
    PIECES: ['minor-arc', 'minor-sector', 'minor-segment', 'major-arc', 'major-sector', 'major-segment'],
    idOf: (spec) => normalize(spec).id,
    /* i18n keys for a piece (spec or id like 'major-sector'):
         piece*  name      MINOR SECTOR
         rule*   one-line rule, repeated on the walk to the next wall */
    labelKey: (p) => I18n.key('piece', pieceId(p)),
    ruleKey: (p) => I18n.key('rule', pieceId(p)),
    /* Correctness is decided from data, never from pixels. */
    matches: (a, b) => pieceId(a) === pieceId(b),
    /* Mid-angle of a piece, handy for placing labels. */
    midAngle(spec, rotOffset = 0) {
      const s = normalize(spec);
      return s.start + rotOffset + s.sweep / 2;
    },
  };

  ZD.geo = geo;
})();
