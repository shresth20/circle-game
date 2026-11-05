# Rules for every game project

- **Always apply the `localization_skill` skill** when creating or editing any game (HTML/CSS/JS): every text line and voice-over clip by key via `T('key')` / `I18n.voice('key')`, English only in `locales.json`, no hard-coded strings. Not optional — invoke it before writing the first line.
- **Always apply the `animation-skill` skill** for any motion, transition, reveal or UI feedback in a game: GSAP bundled locally (no CDN), animate only `transform`/`opacity`, time-based motion, ease-out in / ease-in out, Skip button + `prefers-reduced-motion`, clean up timelines on unmount. Not optional — invoke it before writing any animation code.
