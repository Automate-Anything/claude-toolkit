async () => {
  // software-replicator / interactions.js
  // The look-and-feel contract that inventory.js (resting state) does not capture:
  // hover / focus / active / focus-visible styles, cursors, transitions, @keyframes
  // animations and which elements use them, and scrollbars. This is how hover
  // effects, focus rings and animations get COPIED instead of lost.
  //
  // Run with the Chrome DevTools MCP evaluate_script tool and save the output to
  // docs/parity/_raw/interactions/<side>/<SCREEN_ID>.json.
  //
  // It reads the page's own CSS. For the most reliable hover/focus capture on the
  // few most important controls, ALSO hover/focus them with the MCP `hover` tool
  // and re-run inventory.js; the capture playbook explains that pass. This script
  // gives you the full CSS picture in one shot plus a live sample of a few hovers.
  const out = {
    schema: 'software-replicator/interactions@1',
    url: location.href,
    capturedAt: new Date().toISOString(),
    stateRules: [],      // :hover / :focus / :active / :focus-visible rules
    transitions: [],      // elements that animate on state change
    keyframes: [],        // @keyframes definitions
    animatedElements: [], // elements running or declaring an animation
    cursors: [],          // non-default cursors by role
    scrollbars: [],       // custom scrollbar styling
    mediaMotion: null,    // does the page respect prefers-reduced-motion
    warnings: [],
  };

  const clean = (s, max = 400) => {
    if (s == null) return '';
    const t = String(s).replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '...' : t;
  };

  const STATE_RE = /:(hover|focus|active|focus-visible|focus-within|target|checked|disabled|visited)\b/i;
  const seenRule = new Set();
  const seenKf = new Set();

  function eachRule(rules, cb, sheetHref) {
    for (const rule of rules) {
      try {
        if (rule.type === CSSRule.STYLE_RULE) cb(rule, sheetHref);
        else if (rule.type === CSSRule.KEYFRAMES_RULE || rule.constructor.name === 'CSSKeyframesRule') {
          const name = rule.name;
          if (!seenKf.has(name)) {
            seenKf.add(name);
            const frames = [];
            for (const kf of rule.cssRules) frames.push({ key: kf.keyText, css: clean(kf.style.cssText, 300) });
            out.keyframes.push({ name, frames });
          }
        } else if (rule.cssRules) {
          // @media, @supports, @layer: recurse
          eachRule(rule.cssRules, cb, sheetHref);
        }
      } catch (e) { /* odd rule */ }
    }
  }

  // ----- 1. State rules and transition declarations from every stylesheet -----
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) {
      out.warnings.push('Could not read a stylesheet (likely cross-origin): ' + clean(sheet.href || '(inline)', 120));
      continue;
    }
    if (!rules) continue;
    eachRule(rules, (rule, href) => {
      const sel = rule.selectorText || '';
      const css = rule.style ? rule.style.cssText : '';
      if (STATE_RE.test(sel) && css) {
        const m = sel.match(STATE_RE);
        const key = sel + '|' + css;
        if (!seenRule.has(key)) {
          seenRule.add(key);
          if (out.stateRules.length < 600) {
            out.stateRules.push({ state: m[1].toLowerCase(), selector: clean(sel, 200), css: clean(css, 400) });
          }
        }
      }
      if (/transition|animation/i.test(css)) {
        const t = rule.style.transition || rule.style.transitionProperty;
        const a = rule.style.animation || rule.style.animationName;
        if ((t && t !== 'all 0s ease 0s' && t !== 'none') || (a && a !== 'none')) {
          const key = 't|' + sel + '|' + css;
          if (!seenRule.has(key) && out.transitions.length < 400) {
            seenRule.add(key);
            out.transitions.push({ selector: clean(sel, 200), transition: clean(t, 200), animation: clean(a, 200) });
          }
        }
      }
    }, sheet.href);
  }

  // ----- 2. Live sample: computed transition / animation / cursor on real elements -----
  const INTERESTING = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=menuitem],'
    + '[role=tab],[role=switch],[role=checkbox],[tabindex],[onclick],.btn,.button,[class*=btn],[class*=card],'
    + '[class*=nav],[class*=menu],[class*=tab],[class*=toggle],[class*=chip],[class*=badge],[class*=row],tr,li';
  const sampled = new Set();
  const nodes = Array.from(document.querySelectorAll(INTERESTING)).slice(0, 800);
  for (const el of nodes) {
    const cs = getComputedStyle(el);
    // cursor
    if (cs.cursor && cs.cursor !== 'auto' && cs.cursor !== 'default') {
      const role = (el.getAttribute('role') || el.tagName).toLowerCase();
      const k = role + '|' + cs.cursor;
      if (!sampled.has(k) && out.cursors.length < 60) { sampled.add(k); out.cursors.push({ role, cursor: cs.cursor }); }
    }
    // transition on the resting element (what will animate when a state changes)
    if (cs.transitionDuration && cs.transitionDuration !== '0s' && cs.transitionProperty !== 'none') {
      const sig = [cs.transitionProperty, cs.transitionDuration, cs.transitionTimingFunction, cs.transitionDelay].join(' | ');
      if (!sampled.has('tr' + sig) && out.transitions.length < 500) {
        sampled.add('tr' + sig);
        out.transitions.push({ selector: 'computed:' + (el.getAttribute('class') ? '.' + el.className.toString().split(/\s+/)[0] : el.tagName.toLowerCase()), transition: clean(sig, 240), animation: '' });
      }
    }
    // running or declared animation
    if (cs.animationName && cs.animationName !== 'none') {
      const names = cs.animationName.split(',').map((s) => s.trim());
      const sig = cs.animationName + '|' + cs.animationDuration;
      if (!sampled.has('an' + sig) && out.animatedElements.length < 120) {
        sampled.add('an' + sig);
        out.animatedElements.push({
          selector: el.getAttribute('class') ? '.' + el.className.toString().split(/\s+/)[0] : el.tagName.toLowerCase(),
          names, duration: cs.animationDuration, timing: cs.animationTimingFunction,
          iteration: cs.animationIterationCount, delay: cs.animationDelay, direction: cs.animationDirection,
        });
      }
    }
  }

  // ----- 3. Scrollbar styling (webkit) -----
  for (const rule of out.stateRules.length ? [] : []) { /* placeholder */ }
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      eachRule(rules, (rule) => {
        const sel = rule.selectorText || '';
        if (/::-webkit-scrollbar|scrollbar-width|scrollbar-color/i.test(sel + (rule.style ? rule.style.cssText : ''))) {
          if (out.scrollbars.length < 40) out.scrollbars.push({ selector: clean(sel, 160), css: clean(rule.style.cssText, 240) });
        }
      });
    }
  } catch (e) { /* ignore */ }

  // ----- 4. Reduced motion -----
  try { out.mediaMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full'; } catch (e) { out.mediaMotion = null; }

  out.counts = {
    stateRules: out.stateRules.length,
    transitions: out.transitions.length,
    keyframes: out.keyframes.length,
    animatedElements: out.animatedElements.length,
    cursors: out.cursors.length,
    scrollbars: out.scrollbars.length,
  };
  return out;
}
