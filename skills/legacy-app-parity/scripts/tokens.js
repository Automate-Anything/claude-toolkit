() => {
  // legacy-app-parity / tokens.js
  // Reads the design language of the CURRENT page from computed styles: colors,
  // fonts, sizes, weights, spacing, radii, borders, shadows, ranked by how much
  // of the screen uses them, plus a best guess at each color's role. Works on
  // logged-in pages, which public token extractors cannot reach.
  // Run with evaluate_script on 3 to 5 representative screens (a list, an edit
  // form, a dashboard or report, a dialog) and save each with filePath to
  // docs/parity/_raw/tokens/<SCREEN_ID>.json.
  const MAX_NODES = 30000;
  const tally = () => new Map();
  const bump = (m, k, w) => { if (!k) return; m.set(k, (m.get(k) || 0) + w); };
  const top = (m, n = 12) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, weight]) => ({ value, weight: Math.round(weight) }));

  const T = {
    text: tally(), background: tally(), border: tally(), fontFamily: tally(), fontSize: tally(),
    fontWeight: tally(), lineHeight: tally(), radius: tally(), shadow: tally(), padding: tally(),
    gap: tally(), linkColor: tally(), buttonBg: tally(), buttonText: tally(), inputBorder: tally(),
    headerBg: tally(), navBg: tally(), tableHeaderBg: tally(), rowStripe: tally(),
  };
  const transparent = (c) => !c || c === 'transparent' || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c);

  let count = 0;
  const walk = (doc, win) => {
    const w = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_ELEMENT);
    let el = w.currentNode;
    while (el && count < MAX_NODES) {
      count++;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const cs = win.getComputedStyle(el);
        if (cs.visibility !== 'hidden' && cs.display !== 'none') {
          const area = Math.min(r.width * r.height, 2e6);
          const hasOwnText = Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim());
          const textWeight = hasOwnText ? Math.max(1, el.textContent.trim().length) : 0;
          if (!transparent(cs.backgroundColor)) bump(T.background, cs.backgroundColor, area / 100);
          if (hasOwnText) {
            bump(T.text, cs.color, textWeight);
            bump(T.fontFamily, cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), textWeight);
            bump(T.fontSize, cs.fontSize, textWeight);
            bump(T.fontWeight, cs.fontWeight, textWeight);
            bump(T.lineHeight, cs.lineHeight, textWeight);
          }
          if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') bump(T.border, cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, 1);
          if (cs.borderTopLeftRadius !== '0px') bump(T.radius, cs.borderTopLeftRadius, 1);
          if (cs.boxShadow && cs.boxShadow !== 'none') bump(T.shadow, cs.boxShadow, 1);
          const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' ');
          if (pad !== '0px 0px 0px 0px') bump(T.padding, pad, 1);
          if (cs.gap && cs.gap !== 'normal' && cs.gap !== '0px') bump(T.gap, cs.gap, 1);

          const tag = el.tagName;
          const role = el.getAttribute('role') || '';
          if (tag === 'A' && el.hasAttribute('href')) bump(T.linkColor, cs.color, 1);
          const isButton = tag === 'BUTTON' || role === 'button' || (tag === 'INPUT' && /^(button|submit|reset)$/i.test(el.type));
          if (isButton) { bump(T.buttonBg, cs.backgroundColor + (cs.backgroundImage !== 'none' ? ' + gradient/image' : ''), 1); bump(T.buttonText, cs.color, 1); }
          if ((tag === 'INPUT' && !/^(button|submit|reset|checkbox|radio|hidden|image)$/i.test(el.type)) || tag === 'SELECT' || tag === 'TEXTAREA') bump(T.inputBorder, cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, 1);
          if ((tag === 'HEADER' || role === 'banner') && !transparent(cs.backgroundColor)) bump(T.headerBg, cs.backgroundColor, 1);
          if ((tag === 'NAV' || role === 'navigation' || role === 'menubar') && !transparent(cs.backgroundColor)) bump(T.navBg, cs.backgroundColor, 1);
          if (tag === 'TH' && !transparent(cs.backgroundColor)) bump(T.tableHeaderBg, cs.backgroundColor, 1);
          if (tag === 'TR' && !transparent(cs.backgroundColor)) bump(T.rowStripe, cs.backgroundColor, 1);
        }
      }
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        try { if (el.contentDocument) walk(el.contentDocument, el.contentWindow); } catch (e) { /* cross-origin */ }
      }
      el = w.nextNode();
    }
  };
  walk(document, window);

  // The top band of the page is usually the brand bar in old systems even when
  // there is no <header>: sample the background just below the top edge.
  const probe = (x, y) => {
    let el = document.elementFromPoint(x, y);
    while (el) {
      const c = getComputedStyle(el).backgroundColor;
      if (!transparent(c)) return c;
      el = el.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };

  const out = {
    schema: 'legacy-app-parity/tokens@1',
    url: location.href,
    title: document.title,
    viewport: { w: innerWidth, h: innerHeight },
    nodesScanned: count,
    truncated: count >= MAX_NODES,
    probes: {
      topBand: probe(innerWidth / 2, 8),
      leftColumn: probe(12, innerHeight / 2),
      center: probe(innerWidth / 2, innerHeight / 2),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    },
    tokens: {},
  };
  for (const k of Object.keys(T)) out.tokens[k] = top(T[k], k === 'padding' || k === 'shadow' || k === 'border' ? 8 : 12);
  out.guesses = {
    pageBackground: out.probes.bodyBackground,
    surface: (out.tokens.background[0] || {}).value,
    textPrimary: (out.tokens.text[0] || {}).value,
    textSecondary: (out.tokens.text[1] || {}).value,
    link: (out.tokens.linkColor[0] || {}).value,
    primaryButton: (out.tokens.buttonBg[0] || {}).value,
    brandBar: out.probes.topBand,
    baseFont: (out.tokens.fontFamily[0] || {}).value,
    baseSize: (out.tokens.fontSize[0] || {}).value,
  };
  return out;
}
