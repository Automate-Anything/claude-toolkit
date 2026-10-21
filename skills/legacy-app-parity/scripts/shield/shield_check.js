async () => {
  // legacy-app-parity / shield_check.js
  // Gate for live-system work without a sandbox. Run with evaluate_script on the
  // current page BEFORE any screenshot, snapshot, inventory or other read, and
  // after every navigation to a new page. Capture only when ok === true.
  // ok means: the read-only shield answered for THIS page's origin (so traffic
  // goes through it) and the in-page privacy mask is running without errors.
  // In a browser that is not behind the shield, the status request goes to the
  // real server instead and ok is false.
  const out = { url_host: location.host, ok: false };
  const m = window.__parityMask;
  out.mask = m ? m.state : 'absent';
  out.mask_errors = m ? m.errors : null;
  try {
    const r = await fetch('/__parity_shield/status', { cache: 'no-store', credentials: 'omit' });
    const shieldHeader = r.headers.get('X-Parity-Shield');
    const body = r.ok ? await r.json() : null;
    out.status = body ? { shield: body.shield, run: body.run, warnings: body.warnings } : { http: r.status };
    out.served_by_shield = shieldHeader === 'served';
  } catch (e) {
    out.status = { error: String(e && e.name || e).slice(0, 60) };
  }
  out.ok = out.mask === 'on' && !out.mask_errors && out.served_by_shield === true &&
    !!(out.status && out.status.shield === 'enforce' && out.status.run && m && m.run === out.status.run);
  if (!out.ok) out.next = 'Do not capture. Make sure you are in the shielded browser, the shield is running (shieldctl status), and reload the page.';
  return out;
}
