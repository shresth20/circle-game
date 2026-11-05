/* Mission / wall / challenge configuration.
   ------------------------------------------------------------------
   A mission = 3 walls.  A wall = a concept focus + a pool of challenges;
   the game picks a different challenge from the pool on every attempt.

   piece spec:  P(type, start, sweep, rot)
     type   'arc' | 'sector' | 'segment' | 'chord'
     start  start angle (degrees, clockwise from +x)
     sweep  size of the piece in degrees (<180 minor, >180 major; never 180)
     rot    extra rotation applied only to how the OPTION is displayed, so
            learners must recognise the shape in a different orientation.

   challenge:
     mode     'shape'    - options show shape + label, match the opening
              'name'     - prompt names a piece, options show shapes only
              'identify' - options are names only, learner names the opening
     target   the piece missing from the wall
     options  3-4 piece specs; exactly one must match target (type + size,
              or type only when the wall's level is 'basic')

   Add missions by appending to ZD.MISSIONS - no code changes needed. */
window.ZD = window.ZD || {};

(function () {
  const P = (type, start, sweep, rot = 0) => ({ type, start, sweep, rot });
  /* complementary piece of the same type (minor <-> major) */
  const C = (p, rot = 0) => ({ type: p.type, start: p.start + p.sweep, sweep: 360 - p.sweep, rot });

  ZD.MISSIONS = [
    {
      id: 'm1',
      title: 'The Last Safe Zone',
      hearts: 3,
      walls: [
        {
          id: 'w1',
          titleKey: 'wallIntro1',
          lesson: 'encounter', // full Encounter -> Manipulate lesson before this wall
          level: 'basic', // labels: ARC / SECTOR / SEGMENT
          challenges: [
            { mode: 'shape', target: P('sector', -35, 100), options: [P('arc', -35, 100), P('sector', -35, 100), P('segment', -35, 100)] },
            { mode: 'shape', target: P('segment', 200, 120), options: [P('arc', 200, 120), P('sector', 200, 120), P('segment', 200, 120)] },
            { mode: 'shape', target: P('arc', 250, 110), options: [P('arc', 250, 110), P('sector', 250, 110), P('segment', 250, 110)] },
            { mode: 'shape', target: P('sector', 120, 90), options: [P('arc', 120, 90), P('sector', 120, 90), P('segment', 120, 90)] },
            { mode: 'shape', target: P('segment', -20, 100), options: [P('arc', -20, 100), P('sector', -20, 100), P('segment', -20, 100)] },
          ],
        },
        {
          id: 'w2',
          titleKey: 'wallIntro2',
          lesson: 'minorMajor',
          level: 'full',
          challenges: [
            { mode: 'shape', target: P('sector', 40, 240), options: [C(P('sector', 40, 240)), P('sector', 40, 240), P('arc', 40, 240)] },
            { mode: 'shape', target: P('arc', 200, 130), options: [P('arc', 200, 130), C(P('arc', 200, 130)), P('sector', 200, 130)] },
            { mode: 'name', target: P('sector', 150, 110), options: [P('sector', 150, 110), C(P('sector', 150, 110)), P('segment', 150, 110)] },
            { mode: 'shape', target: P('arc', -70, 230), options: [P('arc', -70, 230), C(P('arc', -70, 230)), P('sector', -70, 230)] },
            { mode: 'identify', target: P('sector', 100, 280), options: [P('sector', 100, 280), C(P('sector', 100, 280)), P('arc', 100, 280)] },
            { mode: 'name', target: P('arc', 20, 250), options: [P('arc', 20, 250), C(P('arc', 20, 250)), P('sector', 20, 250)] },
          ],
        },
        {
          id: 'w3',
          titleKey: 'wallIntro3',
          lesson: 'segments',
          level: 'full',
          challenges: [
            { mode: 'shape', target: P('segment', 30, 120), options: [P('segment', 30, 120, 40), P('sector', 30, 120, -30), P('chord', 30, 120, 20), P('arc', 30, 120, 60)] },
            { mode: 'shape', target: P('segment', 190, 240), options: [P('segment', 190, 240, 30), C(P('segment', 190, 240), -45), P('sector', 190, 240, 20), P('chord', 190, 240)] },
            { mode: 'name', target: P('segment', -40, 250), options: [P('segment', -40, 250, 50), C(P('segment', -40, 250), 30), P('sector', -40, 250, -20), P('arc', -40, 250, 40)] },
            { mode: 'identify', target: P('segment', 140, 100), options: [P('segment', 140, 100), P('sector', 140, 100), P('arc', 140, 100), P('chord', 140, 100)] },
            { mode: 'shape', target: P('sector', 230, 140), options: [P('sector', 230, 140, 70), P('segment', 230, 140, -50), C(P('sector', 230, 140), 30), P('chord', 230, 140, 90)] },
            { mode: 'identify', target: P('segment', 60, 230), options: [P('segment', 60, 230), C(P('segment', 60, 230)), P('sector', 60, 230), P('chord', 60, 230)] },
          ],
        },
      ],
    },
    {
      id: 'm2',
      title: 'Night Patrol',
      hearts: 3,
      walls: [
        {
          id: 'w1',
          titleKey: 'wallIntro2',
          lesson: null,
          level: 'full',
          challenges: [
            { mode: 'identify', target: P('arc', 300, 120), options: [P('arc', 300, 120), C(P('arc', 300, 120)), P('sector', 300, 120), P('segment', 300, 120)] },
            { mode: 'shape', target: P('sector', 15, 70), options: [P('sector', 15, 70, 90), P('segment', 15, 70, -60), C(P('sector', 15, 70), 45), P('arc', 15, 70, 30)] },
            { mode: 'name', target: P('segment', 110, 210), options: [P('segment', 110, 210, 80), C(P('segment', 110, 210), -30), P('sector', 110, 210, 20), P('chord', 110, 210, 10)] },
          ],
        },
        {
          id: 'w2',
          titleKey: 'wallIntro3',
          lesson: null,
          level: 'full',
          challenges: [
            { mode: 'identify', target: P('sector', 200, 260), options: [P('sector', 200, 260), C(P('sector', 200, 260)), P('segment', 200, 260), P('arc', 200, 260)] },
            { mode: 'shape', target: P('arc', 75, 220), options: [P('arc', 75, 220, 120), C(P('arc', 75, 220), 45), P('sector', 75, 220, 10), P('segment', 75, 220, -40)] },
            { mode: 'name', target: P('segment', -10, 130), options: [P('segment', -10, 130, 100), C(P('segment', -10, 130), 20), P('sector', -10, 130, 50), P('chord', -10, 130, 45)] },
          ],
        },
        {
          id: 'w3',
          titleKey: 'wallIntro3',
          lesson: null,
          level: 'full',
          challenges: [
            { mode: 'identify', target: P('segment', 240, 110), options: [P('segment', 240, 110), P('sector', 240, 110), C(P('segment', 240, 110)), P('chord', 240, 110)] },
            { mode: 'name', target: P('sector', 320, 290), options: [P('sector', 320, 290, 60), C(P('sector', 320, 290), -20), P('segment', 320, 290, 30), P('arc', 320, 290, 90)] },
            { mode: 'shape', target: P('arc', 160, 95), options: [P('arc', 160, 95, 180), C(P('arc', 160, 95), 30), P('segment', 160, 95, 45), P('chord', 160, 95, -30)] },
          ],
        },
      ],
    },
  ];

  /* Score rules (first-try correct, after 1 miss, after 2 misses). */
  ZD.SCORING = { byMisses: [100, 60, 30], min: 10 };
})();
