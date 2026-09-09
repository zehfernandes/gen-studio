---
name: add-timeline
description: Add dialkit's timeline dock so an animated sketch is keyframed clips (at, duration, from, to, easing) instead of hand-written easing math, sampled by frame so the export matches the preview exactly. Writes to plugins/ only, no new dependencies.
---

# Add a keyframe timeline (dialkit)

`t` gives you one number from 0 to 1. Anything staged — this fades in at 0.5 s, that slides for 1.2 s and then holds — becomes hand-written clamp/remap/easing math inside `draw`. dialkit ships a timeline (already a dependency, nothing to install): clips are declared as data, edited in a dock at the bottom of the window, and read back as interpolated values.

The one thing that makes this safe here: **the timeline is sampled by frame, never by wall clock.** `controller.seek(seconds)` sets the playhead synchronously and `getValues()` reads it synchronously, so a `seek(api.time)` at the top of `draw` gives the export the same values as the preview. dialkit's own transport never runs, and the stage stays the single source of time.

## Rules

- Write to `plugins/` only. Never edit `core/`.
- `autoplay: false`, always. A playing dialkit transport advances on its own `requestAnimationFrame` and drifts from `api.frame` within a second — and the hidden export renderer has no RAF at all, so the file would come out frozen at time 0.
- Sample inside `draw`, from `api.time`. Never from `performance.now()`, `Date.now()`, or the dock's own `values.time`. This is rule 3 of "preview = export" (`docs/sketch.md`); the timeline is not an exception to it.
- One module-level controller, shared by the preview and the hidden export instance. Creating one inside `setup` gives the export a second, unsynced timeline.
- Timeline values are **not** params. They never reach `params.json` or the export sidecar. The clip config in the code is the source of truth; dock edits are session-only tuning, exactly like the Size folder.

## Steps

1. Write `plugins/timeline.ts` from the reference below. No install — `dialkit` is already a dependency.
2. Register it in `plugins/index.ts`, once. It self-registers the dock through `hooks.load`, so a bare import is enough:
   ```ts
   import './timeline';
   ```
3. In an animated sketch (`config.fps` **and** `config.duration`), declare clips at module level and read them in `draw`:
   ```js
   import { defineTimeline } from '/plugins/timeline.ts';

   export const config = { fps: 30, duration: 4, size: { preset: 'Instagram post' } };
   export const params = { seed: 1 };

   const tl = defineTimeline('poster', {
     duration: 4,
     drop:  { at: 0,   duration: 1.2, from: { y: -0.3 }, to: { y: 0.5 }, transition: { ease: [0.2, 0.8, 0.2, 1] } },
     flash: { at: 1.2, duration: 0.4, from: { a: 1 },    to: { a: 0 } },
   });

   export function draw(c, t, api) {
     const { drop, flash } = tl.at(api);
     c.fillStyle = '#efeee8';
     c.fillRect(0, 0, api.width, api.height);
     c.globalAlpha = flash.current.a;
     c.fillRect(0, drop.current.y * api.height, api.width, api.height * 0.1);
   }
   ```
4. Verify: `pnpm check`; then `pnpm dev` and open the sketch. The dock appears at the bottom with a row per clip and a playhead that tracks the stage — `Space` plays, `←`/`→` step, and the playhead follows both. Edit a clip's timing in the dock: the canvas updates on the next frame. Press `E`: the MP4 shows the same staging as the preview, and its first frame matches frame 0 on screen. Open a still sketch (no `fps`): the dock hides, no errors.

## The core contract it implements

- `api.time` is `api.frame / api.fps` (`core/api.ts`). `api.frame` is set by `Stage` on screen and by `makeExportRenderer.drawFrame` during an export — sampling from it is exactly what makes the two paths agree. It is `0` for stills, so a still sketch always reads the timeline at time 0.
- `api.frames` is `round(fps × duration)` and `t = frame / frames` (`core/timing.ts`), so seconds are `t × config.duration`. Keep the timeline's `duration` equal to `config.duration`: `seek` clamps to the timeline's own duration, so a short timeline freezes for the tail of the loop and a long one never reaches its end.
- Module-level state in a sketch is shared between the preview and the export instance (`AGENTS.md`, Playback). That is why one controller created at import time serves both.
- `hooks.load` fires after each sketch (or each new size) loads, with `(sketch, app)` — that is where the dock mounts, and where `config.fps` is known.
- Sampling needs no mounted UI: `createDialTimeline` registers its values in dialkit's store independently of the dock, so the hidden export renderer reads clips correctly with nothing on screen.
- The export sidecar records params, seed, size, fps and duration — enough to reproduce the file **from this code**. Clip timings live in the code, so commit them like any other sketch edit.

## Pitfalls

- `createDialTimeline`'s `autoplay` defaults to **true**. Omitting `{ autoplay: false }` is the one failure that looks like it works: the preview animates from dialkit's RAF, and the export comes out frozen or juddering.
- `defineTimeline` runs at module import, and a browser caches a sketch module for the life of the page. Switching away and back re-uses the same controller — do **not** `destroy()` it in `dispose`, or the sketch returns with a dead timeline. (`core/controls.ts#sketchControls` documents the same trap for param descriptors.)
- Clip values are numbers or CSS strings. Colors interpolate (`from: { ink: '#1c1612' }`); arrays do not — keep geometry as separate `x`/`y` tracks, or use a `props` clip with one track per property.
- `clip.current` is the value interpolated **at the playhead** — that is what `draw` wants. `clip.animate` is the endpoint meant for handing to a motion library, and drawing with it reads as a jump cut.
- The dock is fixed to the bottom of the window and overlaps `#stage`. If it covers the artwork, `setVisible(false)` and scrub with `←`/`→` rather than adding a layout toggle to core.
- Timelines from previously-visited sketches stay registered in dialkit's store for the session, so the dock accumulates a row per animated sketch you open. Cosmetic, clears on reload — see the `ponytail:` note in the reference before deciding to fix it.
- Scrubbing the dock does not move the stage (see "Going further"). The playhead follows the stage, not the other way round, so the stage's own transport — `Space`, `←`/`→` — stays the way to move through the loop.

## Reference implementation

```ts
// plugins/timeline.ts
import { createDialTimeline, createDialTimelineRoot } from 'dialkit/vanilla';
import type { TimelineConfig } from 'dialkit/vanilla';
import { hooks } from '../core';
import type { Api } from '../core';

/**
 * The stage owns time. dialkit's transport is never played (`autoplay: false`); every draw seeks it
 * to the frame the host is on, so the preview and the hidden export renderer read identical values.
 * `seek` sets the playhead synchronously and `getValues` reads it synchronously, which is what makes
 * sampling inside `draw` exact.
 *
 *   const tl = defineTimeline('poster', { duration: 4, drop: { at: 0, duration: 1.2, from: { y: 0 }, to: { y: 1 } } });
 *   const { drop } = tl.at(api);   // drop.current.y, drop.progress, drop.active
 */
export function defineTimeline<T extends TimelineConfig>(name: string, config: T) {
  // ponytail: never destroyed — the browser caches a sketch module, so switching away and back hands
  // the same controller out again and a destroyed one would come back dead. The cost is a stale row
  // in the dock per animated sketch visited; pass a stable `id` and unregister in hooks.load if that bites.
  const ctrl = createDialTimeline(name, config, { autoplay: false });
  return {
    ctrl,
    /** Seek to this frame's time and read every clip. Synchronous, so the export gets exact values. */
    at(api: Api) {
      ctrl.seek(api.time);
      return ctrl.getValues();
    },
  };
}

// One dock for the window, mounted the first time an animated sketch loads.
let dock: ReturnType<typeof createDialTimelineRoot> | undefined;

hooks.load.push((sketch) => {
  if (!(sketch.config.fps && sketch.config.duration)) return dock?.setVisible(false);
  if (!dock) {
    dock = createDialTimelineRoot({ theme: 'dark', defaultVisible: true, defaultOpen: true });
    document.body.appendChild(dock.element);
  }
  dock.setVisible(true);
});
```

## Going further (only if asked)

- **Scrubbing the dock moves the stage.** `ctrl.subscribe(values => app.stage.seek(Math.round(values.time * fps)))`, wired in `hooks.load`. Note the feedback loop: your own per-draw `seek` notifies that subscriber, which seeks the stage, which redraws, which seeks again. Guard it with a boolean set around the `seek` in `at()` — notification is synchronous, so a plain flag is enough — and round both sides to the same frame or the playhead and canvas fight over sub-frame times.
- **Clip timings as params.** Put `at`/`duration` in `params` and call `ctrl.updateConfig()` when they change: the timings then land in versions and the sidecar, so a saved version replays exactly. Costs a config rebuild per edit — worth it only if the user wants versions to capture staging.
- **One timeline row per sketch.** `createDialTimeline(name, config, { id: 'tl-' + sketch.name })` makes registration idempotent across module re-imports, so switching sketches replaces the dock row instead of adding one.
- **Driving `params` from clips** (so the panel shows the animated value) fights core's model: `params` is what the *user* set and what versions store. Read `clip.current` in `draw` instead.
