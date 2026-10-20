async () => {
  // legacy-app-parity / ready.js
  // Capture gate. Run with evaluate_script BEFORE every screenshot or inventory.
  // A capture taken while the page is still loading, showing an error page, or
  // bounced to a login screen is "confident-wrong" evidence. Only capture when
  // status is READY. Anything else: wait_for, re-login, or record the screen as
  // not captured with its status. Never treat a non-READY capture as a pass.
  const reasons = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;
  };

  if (document.readyState !== 'complete') reasons.push('document.readyState is ' + document.readyState);
  try {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
    if (document.fonts.status !== 'loaded') reasons.push('web fonts still loading');
  } catch (e) { /* very old engines */ }

  const busy = Array.from(document.querySelectorAll('[aria-busy=true],[role=progressbar],.spinner,.loading,.loader,[class*=spinner],[class*=loading],[id*=loading],[id*=spinner],img[src*=loading],img[src*=spinner],img[src*=ajax-loader]')).filter(visible);
  if (busy.length) reasons.push(busy.length + ' visible loading indicator(s)');

  const text = (document.body ? document.body.innerText : '').slice(0, 20000);
  const title = document.title || '';
  const errorPatterns = [
    /Server Error in '.*' Application/i, /Runtime Error/i, /Stack Trace:/i, /An unhandled exception/i,
    /HTTP (Error )?(400|401|403|404|500|502|503)/i, /\b(404|500) - /i, /Internal Server Error/i,
    /Service Unavailable/i, /Bad Gateway/i, /Exception Details/i, /ORA-\d{5}/, /SQLSTATE/i,
    /Microsoft OLE DB/i, /java\.lang\.\w+Exception/, /Whitelabel Error Page/i, /Fatal error/i,
  ];
  const sessionPatterns = [/session (has )?(expired|timed out)/i, /your session/i, /please (log|sign) ?in again/i, /view (has )?expired/i, /ViewExpiredException/];
  let status = 'READY';
  if (errorPatterns.some((p) => p.test(title) || p.test(text))) { status = 'ERROR_PAGE'; reasons.push('error page text detected'); }
  if (sessionPatterns.some((p) => p.test(text))) { status = 'SESSION_EXPIRED'; reasons.push('session-expired text detected'); }
  const pw = Array.from(document.querySelectorAll('input[type=password]')).filter(visible);
  if (pw.length && status === 'READY') {
    status = 'AUTH_BLOCKED';
    reasons.push('a visible password field: this looks like a login screen. Ask the user to log in to YOUR browser window.');
  }
  if (/captcha|are you a robot|verify you are human/i.test(text) || document.querySelector('iframe[src*=captcha],.g-recaptcha,.h-captcha,[data-sitekey]')) {
    status = 'CAPTCHA';
    reasons.push('captcha present: stop and hand to the user. Never try to solve or bypass it.');
  }
  if (status === 'READY' && reasons.length) status = 'NOT_READY';
  if (status === 'READY' && (document.body ? document.body.innerText.trim().length : 0) < 20 && !document.querySelector('frame,iframe')) {
    status = 'NOT_READY';
    reasons.push('page body is nearly empty');
  }
  const frames = Array.from(document.querySelectorAll('frame,iframe')).map((f) => {
    try { return { name: f.name || f.id || '', ready: f.contentDocument ? f.contentDocument.readyState : 'cross-origin' }; } catch (e) { return { name: f.name || '', ready: 'cross-origin' }; }
  });
  if (frames.some((f) => f.ready !== 'complete' && f.ready !== 'cross-origin')) {
    if (status === 'READY') status = 'NOT_READY';
    reasons.push('a frame is still loading');
  }
  return {
    status,
    usable: status === 'READY',
    reasons,
    url: location.href,
    title,
    viewport: { w: innerWidth, h: innerHeight },
    frames,
    checkedAt: new Date().toISOString(),
  };
}
