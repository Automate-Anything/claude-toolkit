#!/usr/bin/env node
// human_chrome.mjs: drive a REAL Chrome that sites cannot tell from a person's.
//
// Why it exists: the chrome-devtools MCP starts a test copy of Chrome with the automation
// flag. That flag shows "Chrome is being controlled by automated test software" and sets
// navigator.webdriver = true, which bot protection (Webflow, Vagaro, Google, Cloudflare)
// reads as "robot" and answers with captchas, blocked logins or security emails.
// This script starts the user's own installed Chrome normally (no automation flag), with
// one extra switch (a debug port) and its own profile folder, so logins made in it STAY.
//
// It only uses quiet DevTools commands: no Runtime.enable (a known bot-detection tell),
// and clicks/typing are real input events (isTrusted = true), not element.click().
//
// Usage (Node 22+, no packages):
//   node human_chrome.mjs start [url]          open (or reuse) the browser, optionally at url
//   node human_chrome.mjs check [--tab T]      what the site can see (webdriver etc.)
//   node human_chrome.mjs tabs                 list tabs: id, url, title
//   node human_chrome.mjs open <url>           NEW tab for you; prints its id (use it as --tab)
//   node human_chrome.mjs nav <url> --tab T    go to url in that tab
//   node human_chrome.mjs text --tab T [N]     the page's visible text (first N chars, default 4000)
//   node human_chrome.mjs eval "<js>" --tab T  run JavaScript, print the result
//   node human_chrome.mjs click "<css>" --tab T  real mouse click on the element's centre
//   node human_chrome.mjs type "<text>" --tab T  type into the focused field
//   node human_chrome.mjs paste "<text>" --tab T the whole text at once, like a paste (never touches the clipboard)
//   node human_chrome.mjs paste-env NAME --tab T  paste the value of NAME from the environment or ./.env.local (never printed)
//   node human_chrome.mjs key Enter --tab T    press a key (Enter, Tab, Escape, Backspace)
//   node human_chrome.mjs shot <file.png> --tab T   screenshot (Read the file to look)
//   node human_chrome.mjs close --tab T        close YOUR tab
// Options: --port N (default 9333), --profile DIR (default %USERPROFILE%\ChromeHumanProfile)
// --tab takes a tab id or any part of its URL. Without --tab the first tab is used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  if (i === -1) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const PORT = Number(opt('--port', '9333'));
const PROFILE = opt('--profile', path.join(os.homedir(), 'ChromeHumanProfile'));
const TAB = opt('--tab', null);
const [cmd, a1, a2] = argv;
const BASE = `http://127.0.0.1:${PORT}`;

async function up() {
  try { return await (await fetch(`${BASE}/json/version`)).json(); } catch { return null; }
}

function chromePath() {
  const c = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  const found = c.find(p => fs.existsSync(p));
  if (!found) throw new Error('Chrome is not installed in a standard place');
  return found;
}

async function start(url) {
  if (!(await up())) {
    fs.mkdirSync(PROFILE, { recursive: true });
    const args = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check'];
    if (url) args.push(url);
    spawn(chromePath(), args, { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 40 && !(await up()); i++) await new Promise(r => setTimeout(r, 250));
    if (!(await up())) throw new Error(`Chrome did not open its debug port ${PORT}`);
    console.log(`started Chrome on port ${PORT}, profile ${PROFILE}`);
  } else {
    console.log(`Chrome already running on port ${PORT}`);
    if (url) await openTab(url);
  }
}

async function pages() {
  return (await (await fetch(`${BASE}/json/list`)).json()).filter(t => t.type === 'page');
}

async function pick() {
  const list = await pages();
  const t = TAB ? list.find(p => p.id === TAB) || list.find(p => p.url.includes(TAB)) : list[0];
  if (!t) throw new Error(TAB ? `no tab matches ${TAB}` : 'no tab is open');
  return t;
}

async function session(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, m => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { send, close: () => ws.close() };
}

async function evaluate(s, expression) {
  const r = await s.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function openTab(url) {
  const browser = await up();
  const s = await session({ webSocketDebuggerUrl: browser.webSocketDebuggerUrl });
  const { targetId } = await s.send('Target.createTarget', { url });
  s.close();
  console.log(`opened tab ${targetId} at ${url}`);
}

const KEYS = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8 };

try {
  if (cmd === 'start') await start(a1);
  else if (!(await up())) throw new Error(`no browser on port ${PORT}: run "node human_chrome.mjs start" first`);
  else if (cmd === 'tabs') for (const p of await pages()) console.log(`${p.id}  ${p.url}  ${p.title}`);
  else if (cmd === 'open') await openTab(a1);
  else {
    const t = await pick();
    const s = await session(t);
    if (cmd === 'check') {
      console.log(JSON.stringify(await evaluate(s, `({url: location.href, webdriver: navigator.webdriver, plugins: navigator.plugins.length, languages: navigator.languages, headless: /Headless/.test(navigator.userAgent)})`), null, 1));
    } else if (cmd === 'nav') {
      await s.send('Page.navigate', { url: a1 });
      console.log(`tab ${t.id} -> ${a1}`);
    } else if (cmd === 'text') {
      console.log(await evaluate(s, `document.body ? document.body.innerText.slice(0, ${Number(a1) || 4000}) : ''`));
    } else if (cmd === 'eval') {
      console.log(JSON.stringify(await evaluate(s, a1), null, 1));
    } else if (cmd === 'click') {
      const box = await evaluate(s, `(() => { const el = document.querySelector(${JSON.stringify(a1)}); if (!el) return null; el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
      if (!box) throw new Error(`nothing matches ${a1}`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await s.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
        await new Promise(r => setTimeout(r, 40 + Math.random() * 80));
      }
      console.log(`clicked ${a1}`);
    } else if (cmd === 'type') {
      for (const ch of a1) {
        await s.send('Input.insertText', { text: ch });
        await new Promise(r => setTimeout(r, 30 + Math.random() * 70));
      }
      console.log('typed');
    } else if (cmd === 'paste') {
      if (!a1) throw new Error('paste needs the text');
      await s.send('Input.insertText', { text: a1 });
      console.log('pasted');
    } else if (cmd === 'paste-env') {
      let v = process.env[a1];
      if (!v && fs.existsSync('.env.local')) {
        const line = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).find(l => l.startsWith(a1 + '='));
        if (line) v = line.slice(a1.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      }
      if (!v) throw new Error(`${a1} is not set (environment or ./.env.local)`);
      await s.send('Input.insertText', { text: v });
      console.log(`pasted ${a1} (value not shown)`);
    } else if (cmd === 'key') {
      const code = KEYS[a1];
      if (!code) throw new Error(`key must be one of ${Object.keys(KEYS).join(', ')}`);
      await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: a1, windowsVirtualKeyCode: code, ...(a1 === 'Enter' ? { text: '\r' } : {}) });
      await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: a1, windowsVirtualKeyCode: code });
      console.log(`pressed ${a1}`);
    } else if (cmd === 'shot') {
      const r = await s.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(a1, Buffer.from(r.data, 'base64'));
      console.log(`saved ${a1}`);
    } else if (cmd === 'close') {
      await fetch(`${BASE}/json/close/${t.id}`);
      console.log(`closed tab ${t.id}`);
    } else {
      throw new Error(`unknown command "${cmd ?? ''}" (see the comment at the top of this file)`);
    }
    s.close();
  }
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
}
