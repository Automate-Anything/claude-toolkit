---
name: "product-animation-website"
description: "Build silent, looping animated product mockups for a website or landing page, prototype them on a Design canvas, and ship them into the real site's code (React, SSG) without hurting SEO, load or layout. Use when someone wants the screenshots or mockups on their site to come alive, wants an animated hero or feature demo, or says 'update the website' with animations. Read product-animation-core first."
---

# Product animation: website loops

Silent animations that loop forever on a website. **Read product-animation-core first**: it holds the source extraction, the story method, the realism rules, the engine and the pattern library. This skill adds how to build, time, prototype and ship the loops.

## 1. Process

1. Get the real source and write one story per screen (core sections 1 to 2). Send the stories to the user before building a batch.
2. Ask decisions one at a time, as multiple choice with a recommended option, in plain language.
3. Prototype on the Design canvas: build one screen, publish, then the next.
4. When the user approves, ship them into the site's code (section 5).

## 2. Timing

- Story length is 6 to 15s.
- Hold the win for 2.5 to 3.5s, then loop.

## 3. Prototype on a Design canvas

**Output.**
- If the Artifact tool lists a "Design" type, use one canvas with one interactive artboard per screen, laid out in rows (80px between artboards, 120px between rows).
- Otherwise, make one self-contained HTML artifact per screen with the same engine.

**Engine on the canvas.** The core engine as a Design Component:

```js
componentDidMount(){ this.total=11500; this.last=performance.now(); this.setState({t:0}); var s=this; this.timer=setInterval(function(){s.tick();},50); }
componentWillUnmount(){ clearInterval(this.timer); }
tick(){ var now=performance.now(); var t=(this.state.t||0)+(now-this.last)*(this.props.speed??1); this.last=now; if(t>this.total)t=0; this.setState({t:t}); }
// renderVals(): var t = this.total ? (this.state.t||0) : 99999;  // before mount = finished frame
```

**Crisp scaling.**
- Keep the mockup at its native width (e.g. 540px), wrapped in `zoom: 2`.
- Put it inside a fixed artboard with about 40px of padding in the page's background color, so the frame shadow shows.
- Size the height generously: extra padding is fine, clipping is not.

**Shared CSS.**
- One support file (`project/<name>.css`), linked relatively right after `support.js`, holds the site's frame/base CSS and the motion utilities below. If the canvas already uses a prefix (e.g. `bp-`), keep it.
- Screen-specific CSS goes in each artboard's `<helmet><style>`.

**Motion utilities.** Paste these into the shared CSS and swap in the brand's color values:

```css
.am-caret{display:inline-block;width:1.5px;height:1.05em;background:currentColor;vertical-align:-2px;margin-left:1px;animation:amBlink 1s steps(2,start) infinite}
@keyframes amBlink{to{visibility:hidden}}
.am-typing{display:inline-flex;gap:3px;align-items:center;height:15px}
.am-typing i{width:5px;height:5px;border-radius:50%;background:currentColor;animation:amBounce 1s infinite ease-in-out}
.am-typing i:nth-child(2){animation-delay:.15s}.am-typing i:nth-child(3){animation-delay:.3s}
@keyframes amBounce{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-3px);opacity:.95}}
.am-in{animation:amIn .38s cubic-bezier(.2,.8,.2,1) both}
@keyframes amIn{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
.am-pop{animation:amPop .45s cubic-bezier(.2,.8,.2,1) both}
@keyframes amPop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1);opacity:1}}
.am-glow{animation:amGlow 1.1s ease-out 3}
@keyframes amGlow{0%{box-shadow:0 0 0 0 rgba(107,29,32,.45)}100%{box-shadow:0 0 0 9px rgba(107,29,32,0)}}
.am-glow-good{animation:amGlowGood 1.1s ease-out 2}
@keyframes amGlowGood{0%{box-shadow:0 0 0 0 rgba(63,125,79,.45)}100%{box-shadow:0 0 0 8px rgba(63,125,79,0)}}
.am-tap{animation:amTap .35s ease}
@keyframes amTap{50%{transform:scale(.93)}}
.am-float{animation:amFloat 2s ease-out both}
@keyframes amFloat{0%{opacity:0;transform:translateY(6px)}15%{opacity:1;transform:translateY(0)}75%{opacity:1;transform:translateY(-12px)}100%{opacity:0;transform:translateY(-18px)}}
.am-skel{display:inline-block;border-radius:5px;background:linear-gradient(90deg,#f2ebdf 25%,#faf6ef 50%,#f2ebdf 75%);background-size:200% 100%;animation:amShim 1.2s linear infinite}
@keyframes amShim{to{background-position:-200% 0}}
.am-flash{animation:amFlash 1.1s ease}
@keyframes amFlash{0%,25%{background-color:#f3e6e3}100%{background-color:rgba(243,230,227,0)}}
@media (prefers-reduced-motion: reduce){[class*="am-"],.am-typing i{animation:none}}
```

Give flashed numbers `display:inline-block; border-radius:5px; padding:0 4px; margin-left:-4px`, so the highlight reads as a chip behind the value. Waveform bars use `transition: height 85ms linear`.

**Design-canvas template rules.**
- **Holes are lookups only.** Compute everything in `renderVals()`.
- **Interpolation works** in class and style attributes: `class="ap {{a.c}} {{a.glow}}"` and `style="top: {{a.top}}px; opacity: {{a.op}}"`.
- **Mount-time animations** (`am-in`, `am-pop`) fire on first render or when the class is added. Re-adding the class on the next loop replays them. Use them for append-only lists and `sc-if` reveals.
- **Never filter a list whose items appear out of order.** Index reuse re-animates the wrong rows; keep all items and drive their opacity instead.
- **Write out literally any items that need different icons,** because holes can't inject markup.
- **Tweaks:** `speed` (0.5 to 1.8x), plus at most one color.
- **Don't verify by rendering unless asked.**

## 4. Shipping onto the real site (React, SSG)

- **One shared clock hook drives every shot.** `t` starts at `Infinity` (the finished frame), so server pre-render, first paint, search engines and reduced-motion visitors all see the static screenshot. It resets to 0 when the shot scrolls into view (IntersectionObserver, threshold about 0.3), pauses off screen or in a hidden tab, and resumes where it left off. Attach it through a ref prop on the shared frame component.
- **Never read `window`, `document`, `Date` or `Math.random` during render,** or hydration breaks (React errors #418/#423). Effects only.
- **Keep the site component's own markup, copy and data;** port only the timeline onto it. Keep each component's export name and props so every page that uses it animates automatically.
- **Cursor positions must be relative to their targets** (percentages, offsets from the target's own box), not canvas pixels, because site frames are responsive.
- **Scope new per-shot CSS to that shot** (a class on its frame, e.g. `.psx.crm-prof .atl-ev`). Shared-looking class names are reused by other shots, and an override bleeds onto them site-wide once both stylesheets have loaded.
- **Skeletons must keep the loaded size.** Lay the real value out invisibly and draw the shimmer on top (a positioned slot with the content at `visibility:hidden`, remounted on load so its entrance still plays). Hand-sized placeholder bars are a few px off and make the card jump when data lands.
- Motion utilities go in one stylesheet imported by the shared frame component, scoped under the mockup wrapper class.
- Large ports can fan out to parallel helpers (a few shots each) once the shared hook and CSS are committed; helpers edit only their own shot files and never commit.

## 5. Verify before going live

- Typecheck the site.
- Server-render each shot (e.g. Vite `ssrLoadModule` + `renderToString`) and check the HTML: no crash, no `NaN` / `Infinity` / `undefined` text, the finished-frame copy present.
- Run a production build and serve it locally (`vite build` + `vite preview` is far faster to browse than the dev server). If the full SSG build fails, build the untouched main branch the same way to prove the failure is pre-existing before blaming the change.
- In a real browser, sample each shot's height and content every ~500ms over a full loop: content must change, height must not (allow 1px).
- Merge to main only with the owner's approval, re-fetching main first. After the push, poll the live page for a string that only the new version renders, then recheck the live console for errors.
- Tear down every local server and browser you started.
