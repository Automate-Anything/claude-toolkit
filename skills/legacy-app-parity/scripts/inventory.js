async () => {
  // legacy-app-parity / inventory.js
  // The "layout contract" for ONE screen: every control, its label, position,
  // order, tab order, field rules, menu path, plus data-table headers, headings
  // and prominent text. Run it with the Chrome DevTools MCP evaluate_script tool:
  // pass this whole file as `function` and set `filePath` to
  // docs/parity/_raw/inventory/<side>/<SCREEN_ID>.json so the output lands on disk.
  // Same script on the old system and on the new app; layout_diff.py compares them.
  //
  // Privacy: field VALUES are not recorded unless includeValues is true. Turn it on
  // only in a sandbox with fake data (it is how you capture defaults on a new form).
  const OPTIONS = {
    includeValues: false,
    includeStyles: true,
    maxElements: 4000,
    maxOptions: 100,
    maxTextBlocks: 400,
  };

  const out = {
    schema: 'legacy-app-parity/inventory@1',
    meta: {},
    elements: [],
    tables: [],
    headings: [],
    textBlocks: [],
    frames: [],
    pageKeyHandlers: [],
    truncated: false,
    warnings: [],
  };

  const clean = (s, max = 160) => {
    if (s == null) return '';
    const t = String(s).replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '...' : t;
  };

  const ROLE_SELECTOR = [
    'a[href]', 'area[href]', 'button', 'input', 'select', 'textarea', 'summary',
    '[role=button]', '[role=link]', '[role=menuitem]', '[role=menuitemcheckbox]',
    '[role=menuitemradio]', '[role=tab]', '[role=checkbox]', '[role=radio]',
    '[role=switch]', '[role=combobox]', '[role=textbox]', '[role=searchbox]',
    '[role=spinbutton]', '[role=slider]', '[role=option]', '[role=treeitem]',
    '[onclick]', '[ondblclick]', '[tabindex]', '[contenteditable=""]',
    '[contenteditable=true]',
  ].join(',');

  const LANDMARK_TAGS = { NAV: 'nav', HEADER: 'header', MAIN: 'main', ASIDE: 'aside', FOOTER: 'footer', FORM: 'form' };
  const LANDMARK_ROLES = ['navigation', 'banner', 'main', 'complementary', 'contentinfo', 'form', 'search', 'menubar', 'menu', 'toolbar', 'tablist', 'dialog', 'region'];

  function roleOf(el) {
    const explicit = (el.getAttribute('role') || '').split(/\s+/)[0];
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === 'A' || tag === 'AREA') return el.hasAttribute('href') ? 'link' : 'generic';
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'SELECT') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'number') return 'spinbutton';
      if (t === 'search') return 'searchbox';
      if (t === 'hidden') return 'hidden';
      if (t === 'file') return 'file';
      return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return 'clickable';
  }

  function textById(doc, ids) {
    return ids.split(/\s+/).map((id) => {
      const n = doc.getElementById(id);
      return n ? n.textContent : '';
    }).join(' ');
  }

  // Legacy pages often put the label in the previous table cell or as bare text
  // before the control, with no <label>. This recovers it.
  function nearbyText(el) {
    const cell = el.closest('td,th');
    if (cell) {
      let prev = cell.previousElementSibling;
      while (prev) {
        const t = clean(prev.innerText || prev.textContent, 80);
        if (t) return t;
        prev = prev.previousElementSibling;
      }
    }
    let node = el.previousSibling;
    let hops = 0;
    while (node && hops < 4) {
      const t = clean(node.nodeType === 3 ? node.textContent : (node.innerText || node.textContent), 80);
      if (t) return t;
      node = node.previousSibling;
      hops++;
    }
    return '';
  }

  function accessibleName(el, doc) {
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = clean(textById(doc, by)); if (t) return [t, 'aria-labelledby']; }
    const al = el.getAttribute('aria-label');
    if (al && clean(al)) return [clean(al), 'aria-label'];
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      const t = (el.type || '').toLowerCase();
      if (['button', 'submit', 'reset'].includes(t) && el.value) return [clean(el.value), 'value'];
      if (t === 'image' && el.alt) return [clean(el.alt), 'alt'];
      if (el.id) {
        try {
          const lab = doc.querySelector('label[for="' + CSS.escape(el.id) + '"]');
          if (lab && clean(lab.textContent)) return [clean(lab.textContent), 'label-for'];
        } catch (e) { /* odd ids */ }
      }
      const wrap = el.closest('label');
      if (wrap) {
        const clone = wrap.cloneNode(true);
        clone.querySelectorAll('input,select,textarea').forEach((n) => n.remove());
        const tw = clean(clone.textContent);
        if (tw) return [tw, 'label-wrap'];
      }
    }
    if (tag === 'IMG' || tag === 'AREA') { if (el.alt) return [clean(el.alt), 'alt']; }
    if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
      const inner = clean(el.innerText || el.textContent);
      if (inner) return [inner, 'text'];
      const img = el.querySelector('img[alt]');
      if (img && clean(img.alt)) return [clean(img.alt), 'img-alt'];
    }
    if (el.title && clean(el.title)) return [clean(el.title), 'title'];
    if (el.placeholder && clean(el.placeholder)) return [clean(el.placeholder), 'placeholder'];
    const near = nearbyText(el);
    if (near) return [near, 'nearby-text'];
    if (el.name) return [clean(el.name), 'name-attr'];
    return ['', 'none'];
  }

  function landmarkPath(el) {
    const parts = [];
    let n = el.parentElement;
    while (n && n.tagName !== 'BODY') {
      const r = (n.getAttribute('role') || '').split(/\s+/)[0];
      const lt = LANDMARK_TAGS[n.tagName];
      if (lt || LANDMARK_ROLES.includes(r)) {
        const name = clean(n.getAttribute('aria-label') || n.id || '', 40);
        parts.unshift((r || lt) + (name ? '[' + name + ']' : ''));
      }
      n = n.parentElement;
    }
    return parts.join(' > ');
  }

  function sectionLabel(el) {
    const fs = el.closest('fieldset');
    if (fs) { const lg = fs.querySelector('legend'); if (lg && clean(lg.textContent)) return clean(lg.textContent, 80); }
    const dlg = el.closest('[role=dialog],dialog');
    if (dlg) { const h = dlg.querySelector('h1,h2,h3,h4,[role=heading]'); if (h) return clean(h.textContent, 80); }
    // Nearest heading ABOVE the element in document order.
    const all = el.ownerDocument.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading],legend,caption');
    let best = '';
    for (const h of all) {
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = clean(h.textContent, 80);
      else break;
    }
    return best;
  }

  // Dropdown menus in old systems are nested ul/li. Build "Reports > Sales > Daily".
  function menuPath(el) {
    const parts = [];
    let li = el.closest('li');
    if (!li) return '';
    li = li.parentElement ? li.parentElement.closest('li') : null;
    while (li) {
      const head = Array.from(li.children).find((c) => /^(A|SPAN|BUTTON|DIV|LABEL)$/.test(c.tagName));
      const t = clean(head ? (head.innerText || head.textContent) : '', 60);
      if (t) parts.unshift(t);
      li = li.parentElement ? li.parentElement.closest('li') : null;
    }
    return parts.join(' > ');
  }

  function isVisible(el, win, rect) {
    if (rect.width <= 0 || rect.height <= 0) return false;
    const cs = win.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    return true;
  }

  function styleOf(el, win) {
    const cs = win.getComputedStyle(el);
    return {
      fontFamily: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim(),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: cs.color,
      background: cs.backgroundColor,
      borderColor: cs.borderTopColor,
      borderWidth: cs.borderTopWidth,
      radius: cs.borderTopLeftRadius,
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
    };
  }

  function dataTableOf(el) {
    const tr = el.closest('tr');
    if (!tr) return null;
    const table = tr.closest('table');
    if (!table || !table.__parityDataTable) return null;
    if (tr.closest('thead') || tr.querySelector('th')) return null;
    const cell = el.closest('td');
    return { tableIndex: table.__parityDataTable - 1, colIndex: cell ? cell.cellIndex : -1 };
  }

  let seq = 0;

  function scan(doc, win, offX, offY, framePath) {
    const sx = win.scrollX || 0;
    const sy = win.scrollY || 0;

    // Data tables first, so controls in their rows can be marked as row actions.
    doc.querySelectorAll('table,[role=grid],[role=table]').forEach((t) => {
      const isGrid = t.getAttribute('role') === 'grid' || t.getAttribute('role') === 'table';
      const ths = t.querySelectorAll(':scope > thead th, :scope > tbody > tr:first-child > th, :scope > tr:first-child > th, [role=columnheader]');
      if (!isGrid && !t.tHead && ths.length === 0) return; // layout table, skip
      const headers = Array.from(ths).map((h) => clean(h.innerText || h.textContent, 60));
      const r = t.getBoundingClientRect();
      out.tables.push({
        index: out.tables.length,
        framePath,
        caption: t.caption ? clean(t.caption.textContent, 80) : '',
        section: sectionLabel(t),
        headers,
        sortableHeaders: Array.from(ths).filter((h) => h.querySelector('a,button') || h.hasAttribute('aria-sort')).map((h) => clean(h.textContent, 60)),
        columnCount: headers.length || (t.rows[0] ? t.rows[0].cells.length : 0),
        rowCount: t.rows ? t.rows.length : 0,
        rect: { x: Math.round(r.left + sx + offX), y: Math.round(r.top + sy + offY), w: Math.round(r.width), h: Math.round(r.height) },
      });
      t.__parityDataTable = out.tables.length;
    });

    const candidates = new Set(doc.querySelectorAll(ROLE_SELECTOR));
    // Old systems bind clicks in JS on plain elements. A pointer cursor is the tell.
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    let inspected = 0;
    while (node && inspected < 40000) {
      inspected++;
      if (!candidates.has(node) && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
        const cs = win.getComputedStyle(node);
        if (cs.cursor === 'pointer') {
          const parentPointer = node.parentElement && (candidates.has(node.parentElement) || win.getComputedStyle(node.parentElement).cursor === 'pointer');
          if (!parentPointer) candidates.add(node);
        }
      }
      node = walker.nextNode();
    }

    const ordered = Array.from(candidates).sort((a, b) => (a === b ? 0 : (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)));

    for (const el of ordered) {
      if (out.elements.length >= OPTIONS.maxElements) { out.truncated = true; break; }
      const role = roleOf(el);
      if (role === 'hidden') {
        // Hidden inputs are data-model evidence (old forms post them), not layout.
        out.elements.push({ i: seq++, framePath, role: 'hidden', tag: 'INPUT', name: el.name || '', id: el.id || '', visible: false });
        continue;
      }
      const rect = el.getBoundingClientRect();
      const [label, labelSource] = accessibleName(el, doc);
      const e = {
        i: seq++,
        framePath,
        tag: el.tagName,
        role,
        type: el.tagName === 'INPUT' ? (el.type || 'text').toLowerCase() : undefined,
        label,
        labelSource,
        name: el.getAttribute('name') || undefined,
        id: el.id || undefined,
        href: el.tagName === 'A' || el.tagName === 'AREA' ? clean(el.getAttribute('href'), 300) : undefined,
        onclick: el.getAttribute('onclick') ? clean(el.getAttribute('onclick'), 200) : undefined,
        rect: {
          x: Math.round(rect.left + sx + offX),
          y: Math.round(rect.top + sy + offY),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
        visible: isVisible(el, win, rect),
        disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
        tabindex: el.hasAttribute('tabindex') ? Number(el.getAttribute('tabindex')) : undefined,
        accesskey: el.accessKey || undefined,
        landmarks: landmarkPath(el) || undefined,
        section: sectionLabel(el) || undefined,
        menuPath: menuPath(el) || undefined,
      };
      const dt = dataTableOf(el);
      if (dt) { e.rowAction = true; e.tableIndex = dt.tableIndex; e.colIndex = dt.colIndex; }
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
        e.required = !!el.required || el.getAttribute('aria-required') === 'true';
        e.readOnly = !!el.readOnly;
        if (el.maxLength > 0) e.maxLength = el.maxLength;
        ['min', 'max', 'step', 'pattern', 'autocomplete', 'inputmode'].forEach((a) => { if (el.getAttribute(a)) e[a] = el.getAttribute(a); });
        if (el.multiple) e.multiple = true;
        if (el.tagName === 'SELECT') {
          const opts = Array.from(el.options);
          e.options = opts.slice(0, OPTIONS.maxOptions).map((o) => clean(o.textContent, 80));
          e.optionCount = opts.length;
          if (OPTIONS.includeValues) e.selected = opts.filter((o) => o.selected).map((o) => clean(o.textContent, 80));
        }
        if (OPTIONS.includeValues) {
          if (el.type === 'checkbox' || el.type === 'radio') e.checked = el.checked;
          else if (el.tagName !== 'SELECT') e.value = clean(el.value, 200);
        } else if (el.tagName !== 'SELECT') {
          e.hasValue = el.type === 'checkbox' || el.type === 'radio' ? el.checked : !!el.value;
        }
      }
      if (OPTIONS.includeStyles && e.visible) e.style = styleOf(el, win);
      out.elements.push(e);
    }

    doc.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]').forEach((h) => {
      const r = h.getBoundingClientRect();
      if (!isVisible(h, win, r)) return;
      out.headings.push({
        framePath,
        level: /^H\d$/.test(h.tagName) ? Number(h.tagName[1]) : Number(h.getAttribute('aria-level') || 2),
        text: clean(h.textContent, 120),
        rect: { x: Math.round(r.left + sx + offX), y: Math.round(r.top + sy + offY), w: Math.round(r.width), h: Math.round(r.height) },
      });
    });

    // Prominent plain text: page titles drawn with <font><b>, bold field labels in
    // layout tables, section captions. Only an element's OWN text counts.
    const tw = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_ELEMENT);
    let tn = tw.currentNode;
    while (tn && out.textBlocks.length < OPTIONS.maxTextBlocks) {
      if (!candidates.has(tn) && !/^(SCRIPT|STYLE|NOSCRIPT|OPTION|SELECT|TEXTAREA|HTML|BODY)$/.test(tn.tagName)) {
        const own = Array.from(tn.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' ');
        const t = clean(own, 120);
        if (t && t.length > 1) {
          const cs = win.getComputedStyle(tn);
          const fw = parseInt(cs.fontWeight, 10) || 400;
          const fsz = parseFloat(cs.fontSize) || 0;
          if (fw >= 600 || fsz >= 16 || /^(H\d|LABEL|LEGEND|CAPTION|TH|DT)$/.test(tn.tagName)) {
            const r = tn.getBoundingClientRect();
            if (isVisible(tn, win, r)) {
              out.textBlocks.push({
                framePath,
                tag: tn.tagName,
                text: t,
                fontSize: cs.fontSize,
                fontWeight: cs.fontWeight,
                rect: { x: Math.round(r.left + sx + offX), y: Math.round(r.top + sy + offY), w: Math.round(r.width), h: Math.round(r.height) },
              });
            }
          }
        }
      }
      tn = tw.nextNode();
    }

    ['onkeydown', 'onkeyup', 'onkeypress'].forEach((a) => {
      [doc.documentElement, doc.body].forEach((n) => {
        if (n && n.getAttribute(a)) out.pageKeyHandlers.push({ framePath, on: n.tagName, attr: a, code: clean(n.getAttribute(a), 300) });
      });
    });

    // Framesets and iframes are common in old systems. Same-origin frames are
    // scanned in place; cross-origin ones are listed so you can open them directly.
    doc.querySelectorAll('iframe,frame').forEach((f, idx) => {
      const r = f.getBoundingClientRect();
      const entry = {
        framePath: framePath + '/' + (f.name || f.id || f.tagName.toLowerCase() + idx),
        src: clean(f.getAttribute('src'), 300),
        rect: { x: Math.round(r.left + sx + offX), y: Math.round(r.top + sy + offY), w: Math.round(r.width), h: Math.round(r.height) },
        scanned: false,
      };
      try {
        const cd = f.contentDocument;
        if (cd && cd.documentElement) {
          entry.scanned = true;
          out.frames.push(entry);
          scan(cd, f.contentWindow, r.left + sx + offX, r.top + sy + offY, entry.framePath);
          return;
        }
      } catch (e) { /* cross-origin */ }
      entry.note = 'cross-origin or not loaded: open its src directly and inventory it as its own screen';
      out.frames.push(entry);
    });
  }

  out.meta = {
    url: location.href,
    title: document.title,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    docSize: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    devicePixelRatio: window.devicePixelRatio,
    compatMode: document.compatMode,
    capturedAt: new Date().toISOString(),
    options: OPTIONS,
  };
  if (document.compatMode === 'BackCompat') out.warnings.push('Page renders in quirks mode (no doctype). Box sizes may differ from a standards-mode rebuild.');

  scan(document, window, 0, 0, '');

  // Sequential focus (Tab) order: positive tabindex first, then document order.
  const focusable = out.elements.filter((e) => e.visible && !e.disabled && e.role !== 'hidden' && !(e.tabindex < 0) &&
    (e.tabindex !== undefined || ['A', 'AREA', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(e.tag) || e.role === 'textbox'));
  const positive = focusable.filter((e) => e.tabindex > 0).sort((a, b) => a.tabindex - b.tabindex || a.i - b.i);
  const natural = focusable.filter((e) => !(e.tabindex > 0));
  positive.concat(natural).forEach((e, n) => { e.tabOrder = n; });

  out.counts = {
    elements: out.elements.length,
    visibleInteractive: out.elements.filter((e) => e.visible && e.role !== 'hidden').length,
    tables: out.tables.length,
    headings: out.headings.length,
    textBlocks: out.textBlocks.length,
    frames: out.frames.length,
  };
  return out;
}
