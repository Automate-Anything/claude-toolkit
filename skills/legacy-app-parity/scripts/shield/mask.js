/* legacy-app-parity / mask.js  (served by the parity shield at /__parity_shield/mask.js)
 *
 * Second privacy layer, injected by the proxy as the first script in every page.
 * The proxy already masks identifiers it can recognise in JSON, HTML and CSV.
 * This script masks what only the rendered page reveals: record text in table
 * cells, definition lists and "value" fields, input values that came from the
 * server, contact links, titles and ARIA text, inside open shadow roots too.
 * It keeps masking as the app re-renders (MutationObserver plus a sweep).
 *
 * window.__parityMask.state must be 'on' before any capture. Any internal
 * error flips it to 'error', which makes shield_check.js fail (fail closed).
 * The salt is random per proxy run and unrelated to the proxy's own key.
 */
(function () {
  'use strict';
  if (window.__parityMask) return;
  var SALT = '__SALT__';
  var RUN = '__RUN__';
  var state = { state: 'starting', run: RUN, version: 1, masked: 0, errors: 0, lastError: '' };
  try {
    Object.defineProperty(window, '__parityMask', { value: state, writable: false, configurable: false });
  } catch (e) { window.__parityMask = state; }

  var done = new WeakMap();        // node -> last masked value we wrote
  var produced = new Set();        // every masked value we wrote: never re-mask our own output
  function remember(v) { if (produced.size > 20000) produced.clear(); produced.add(v); return v; }
  var typed = new WeakSet();       // inputs a person (or the agent) typed into: keep their values
  var ACTION_WORDS = /^(view|edit|open|details?|select|print|download|export|add|new|remove|delete|void|save|cancel|close|more|actions?|yes|no|n\/a|none|active|inactive|pending|paid|closed|true|false|ok|-|\u2014|\u2013|\d{1,3}%?)$/i;
  var VALUE_CLASS = /(^|[\s_-])(value|val|data|display|readonly|field-value|info-value|detail-value|record|cell-text)([\s_-]|$)/i;
  var TEXT_INPUT = /^(|text|email|tel|number|date|datetime-local|month|search|url|week|time)$/i;
  var ATTRS = ['title', 'alt', 'aria-label', 'aria-description', 'aria-valuetext', 'aria-placeholder', 'placeholder'];
  var NAME_ATTRS = { 'title': 1, 'alt': 1, 'aria-label': 1, 'aria-description': 1, 'aria-valuetext': 1 };
  // Interface words, filled in by the proxy from the same list it uses itself.
  var UI_WORDS = new Set(__UI_WORDS__);
  var NAME_RUN = /\b([A-Z][a-z'\-]{1,30})((?:\s+[A-Z][a-z'\-]{1,30}){1,2})\b/g;

  // Possible person names: runs of 2 or 3 Capitalized words that are not all
  // interface words ("Client Details" stays, a first and last name is masked).
  function maskNames(t) {
    if (!t) return t;
    return t.replace(NAME_RUN, function (m) {
      var words = m.split(/\s+/);
      for (var i = 0; i < words.length; i++) if (!UI_WORDS.has(words[i].toLowerCase())) return fpe(m);
      return m;
    });
  }

  function fail(e) {
    state.errors += 1;
    state.state = 'error';
    state.lastError = (e && e.name) || 'Error';
  }

  function rng(value) {
    var h = 2166136261 >>> 0;
    var s = SALT + '|' + value;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    var x = h || 1;
    return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
  }

  function fpe(v) {
    if (!v) return v;
    var r = rng(v), out = '';
    for (var i = 0; i < v.length; i++) {
      var c = v.charCodeAt(i);
      if (c >= 97 && c <= 122) out += String.fromCharCode(97 + r() % 26);
      else if (c >= 65 && c <= 90) out += String.fromCharCode(65 + r() % 26);
      else if (c >= 48 && c <= 57) out += String.fromCharCode(48 + r() % 10);
      else if (/\p{L}|\p{N}/u.test(v[i])) out += 'x';
      else out += v[i];
    }
    return out;
  }

  function luhn(d) {
    var t = 0, alt = false;
    for (var i = d.length - 1; i >= 0; i--) { var n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } t += n; alt = !alt; }
    return t % 10 === 0;
  }

  function patterns(t) {
    if (!t) return t;
    t = t.replace(/eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g, '[masked-token]');
    t = t.replace(/[A-Za-z0-9._%+\-]+(?:@|%40)[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, function (m) { return 'user' + fpe(m).replace(/\D/g, '').slice(0, 6).padEnd(6, '0') + '@example.invalid'; });
    t = t.replace(/(?:\d[ \-]?){12,18}\d/g, function (m) { var d = m.replace(/\D/g, ''); return d.length >= 13 && luhn(d) ? fpe(m) : m; });
    t = t.replace(/(^|[^\d])(\d{3})([- ]?)(\d{2})\3(\d{4})(?!\d)/g, function (m, pre, a, sep) { var f = fpe(a + sep); return pre + '9' + f.replace(/\D/g, '').slice(0, 2).padEnd(2, '0') + sep + fpe(m).replace(/\D/g, '').slice(0, 2).padEnd(2, '0') + sep + fpe(m + 'x').replace(/\D/g, '').slice(0, 4).padEnd(4, '0'); });
    t = t.replace(/(^|[^\d.])((?:\+?1[ .\-]?)?\(?\d{3}\)?[ .\-]\d{3}[ .\-]\d{4})(?![\d.])/g, function (m, pre, p) { var i = 0, digits = '55555501' + fpe(p).replace(/\D/g, '').slice(0, 2).padEnd(2, '0'); return pre + p.replace(/^\+?1[ .\-]?/, '').replace(/\d/g, function () { return digits[i++] || '0'; }); });
    t = t.replace(/\b\d{5}-\d{4}\b/g, function (m) { return fpe(m); });
    t = t.replace(/\b\d{1,6}\s+(?:[A-Za-z0-9.'\-]+\s){1,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Ter|Terrace|Trl|Trail|Sq|Square)\b\.?/gi, function (m) { return fpe(m); });
    return t;
  }

  function inside(el, sel) { return !!(el && el.closest && el.closest(sel)); }

  // Is this text node record data (fully masked) or interface text (shape-masked only)?
  function isDataText(node) {
    var el = node.parentElement;
    if (!el) return false;
    var txt = node.nodeValue.trim();
    if (!txt || ACTION_WORDS.test(txt)) return false;
    if (/:$/.test(txt)) return false; // a label
    if (inside(el, 'button,[role=button],select,option,label,legend,caption,th,thead,nav,[role=navigation],[role=menu],[role=menubar],[role=tablist],[role=tab],h1,h2,h3,h4,h5,h6,script,style,noscript,title')) return false;
    if (inside(el, 'td,dd,[role=gridcell],[role=cell],textarea,output')) return true;
    var n = el;
    for (var depth = 0; n && depth < 3; depth++, n = n.parentElement) {
      if (n.className && typeof n.className === 'string' && VALUE_CLASS.test(n.className)) return true;
      var prev = n.previousElementSibling;
      if (prev && (/^(LABEL|DT|TH)$/.test(prev.tagName) || /:\s*$/.test(prev.textContent || ''))) return true;
    }
    return false;
  }

  function maskText(node) {
    var v = node.nodeValue;
    if (!v || done.get(node) === v) return;
    if (produced.has(v)) { done.set(node, v); return; }
    var out;
    if (isDataText(node)) out = v.replace(/\S+/g, function (w) { return ACTION_WORDS.test(w) ? w : fpe(w); });
    else if (inside(node.parentElement, 'h1,h2,h3,h4,h5,h6,title,[role=heading]')) out = patterns(maskNames(v));
    else out = patterns(v);
    if (out !== v) { node.nodeValue = remember(out); state.masked++; }
    done.set(node, node.nodeValue);
  }

  var valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  var areaDesc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

  function maskInput(el) {
    if (typed.has(el)) return;
    var isArea = el.tagName === 'TEXTAREA';
    if (!isArea && (!TEXT_INPUT.test(el.type || '') || el.type === 'password' || el.type === 'hidden')) return;
    var desc = isArea ? areaDesc : valueDesc;
    var v = desc.get.call(el);
    if (!v || done.get(el) === v || produced.has(v)) return;
    var out = remember(fpe(v));
    desc.set.call(el, out);
    done.set(el, out);
    state.masked++;
  }

  function maskAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = el.getAttribute && el.getAttribute(ATTRS[i]);
      if (a && !produced.has(a)) {
        var m = NAME_ATTRS[ATTRS[i]] ? patterns(maskNames(a)) : patterns(a);
        if (m !== a) el.setAttribute(ATTRS[i], remember(m));
      }
    }
    if (el.tagName === 'A') {
      var href = el.getAttribute('href') || '';
      if (/^\s*(mailto|tel|sms|callto):/i.test(href)) el.setAttribute('href', '#parity-masked');
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { maskText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    var n = root.nodeType === 1 ? root : tw.nextNode();
    while (n) {
      if (n.nodeType === 3) maskText(n);
      else {
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.tagName)) { n = tw.nextSibling() || nextUp(tw); continue; }
        maskAttrs(n);
        if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') maskInput(n);
        if (n.shadowRoot && !done.has(n.shadowRoot)) { done.set(n.shadowRoot, 1); observe(n.shadowRoot); walk(n.shadowRoot); }
      }
      n = tw.nextNode();
    }
  }

  function nextUp(tw) {
    while (tw.parentNode()) { var s = tw.nextSibling(); if (s) return s; }
    return null;
  }

  function maskTitle() {
    var t = document.title;
    if (!t || done.get(document) === t) return;
    if (produced.has(t)) { done.set(document, t); return; }
    var out = patterns(maskNames(t));
    if (out !== t) document.title = remember(out);
    done.set(document, document.title);
  }

  function handle(muts) {
    try {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'characterData') maskText(m.target);
        else if (m.type === 'attributes') { maskAttrs(m.target); if (m.attributeName === 'value') maskInput(m.target); }
        else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
      }
      maskTitle();
      if (state.state === 'starting') state.state = state.errors ? 'error' : 'on';
    } catch (e) { fail(e); }
  }

  function observe(root) {
    new MutationObserver(handle).observe(root, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ATTRS.concat(['href', 'value'])
    });
  }

  function markTyped(e) {
    if (e.isTrusted && e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) typed.add(e.target);
  }

  try {
    ['keydown', 'paste', 'drop'].forEach(function (t) { document.addEventListener(t, markTyped, true); });
    observe(document);
    walk(document.documentElement);
    maskTitle();
    state.state = state.errors ? 'error' : 'on';
    document.addEventListener('DOMContentLoaded', function () { try { walk(document.documentElement); maskTitle(); } catch (e) { fail(e); } });
    setInterval(function () {
      try {
        var els = document.querySelectorAll('input,textarea');
        for (var i = 0; i < els.length; i++) maskInput(els[i]);
        maskTitle();
      } catch (e) { fail(e); }
    }, 400);
  } catch (e) { fail(e); }
})();
