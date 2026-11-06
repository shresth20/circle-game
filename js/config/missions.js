/* Mission configuration (data only - no code changes needed to tune it).
   ------------------------------------------------------------------
   There are six pieces:
                 ARC          SECTOR          SEGMENT
       MINOR   minor arc    minor sector    minor segment
       MAJOR   major arc    major sector    major segment
   Each question shows three of them as answer buttons: the right piece
   plus two others at random (see ZD.ui.ask).

   One mission = 6 walls = 6 questions, one question per wall.  At the start
   of every play the six pieces are shuffled and dealt one per wall, so each
   piece is asked exactly once, in a random order.

   mission : { id, titleKey, hearts, rounds, openings }
     hearts    last the whole mission; losing them all replays that wall
     rounds    one entry per wall, in play order: { tier, timer }
                 tier   which opening pool the wall draws from
                 timer  seconds before the zombie climbs through, or null
                        (no timer - the zombie only paces).  Learners can
                        switch the timer off in the pause menu.
     openings  { tier: [O(...), ...] } - each tier must have at least 2
               openings for EVERY piece: after a miss the wall asks the
               same piece again in a different opening.

   O(type, sweep, dir)  one opening
     type   'arc' | 'sector' | 'segment'
     sweep  size in degrees: < 180 minor, > 180 major.  NEVER 180 - a
            semicircle has no button among the six.
     dir    direction the piece points (its middle), degrees clockwise from
            "right": -90 up, 0 right, 90 down, 180 left.

   Difficulty ladder (LXD feedback):
     start   very clear sizes (~90 vs ~270), upright directions
     middle  rotated directions, medium sizes
     hard    sizes close to half (~150 vs ~210) */
window.ZD = window.ZD || {};

(function () {
  const O = (type, sweep, dir) => ({ type, sweep, start: dir - sweep / 2 });
  /* every type at a minor and a major size, once per direction */
  const tier = (minor, major, dirs) => {
    const out = [];
    dirs.forEach((dir, i) => ['arc', 'sector', 'segment'].forEach((type, j) => {
      out.push(O(type, minor[(i + j) % minor.length], dir));
      out.push(O(type, major[(i + j) % major.length], dir + 180));
    }));
    return out;
  };

  ZD.MISSIONS = [
    {
      id: 'm1',
      titleKey: 'mission1',
      hearts: 3,
      rounds: [
        { tier: 'start', timer: null },
        { tier: 'start', timer: 20 },
        { tier: 'middle', timer: 15 },
        { tier: 'middle', timer: 14 },
        { tier: 'hard', timer: 13 },
        { tier: 'hard', timer: 12 },
      ],
      openings: {
        start: tier([90], [270], [-90, 90, 0, 180]),
        middle: tier([100, 115, 125], [235, 250, 260], [-45, 135, 30, 220, -120]),
        hard: tier([145, 150, 155], [205, 210, 215], [50, -130, 170, -10]),
      },
    },
  ];

  /* Points per wall knocked out (no carry-over penalty). */
  ZD.SCORING = { perHit: 100 };

  /* Authoring guard: report openings that break the rules above. */
  const bad = [];
  const PIECES = ['minor-arc', 'minor-sector', 'minor-segment', 'major-arc', 'major-sector', 'major-segment'];
  const idOf = (o) => {
    const s = ((o.sweep % 360) + 360) % 360;
    return `${s < 180 ? 'minor' : 'major'}-${o.type}`;
  };
  ZD.MISSIONS.forEach((m) => {
    if (m.rounds.length !== PIECES.length) bad.push(`${m.id}: ${m.rounds.length} rounds - need one per piece (${PIECES.length})`);
    Object.entries(m.openings).forEach(([name, list]) => {
      list.forEach((o, i) => {
        const s = ((o.sweep % 360) + 360) % 360;
        if (!['arc', 'sector', 'segment'].includes(o.type)) bad.push(`${m.id}.${name}#${i}: unknown type ${o.type}`);
        if (s < 20 || s > 340 || Math.abs(s - 180) < 15) bad.push(`${m.id}.${name}#${i}: sweep ${o.sweep} is too close to 0/180/360`);
      });
      PIECES.forEach((id) => {
        const n = list.filter((o) => idOf(o) === id).length;
        if (n < 2) bad.push(`${m.id}.${name}: only ${n} opening(s) for ${id} (need 2+)`);
      });
    });
    m.rounds.forEach((r, i) => {
      if (!m.openings[r.tier]) bad.push(`${m.id} round ${i + 1}: unknown tier ${r.tier}`);
    });
  });
  if (bad.length) console.warn('[missions] config problems:\n' + bad.join('\n'));
})();
