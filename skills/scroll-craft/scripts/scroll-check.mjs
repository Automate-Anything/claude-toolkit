#!/usr/bin/env node
/*
 * scroll-check.mjs - walk a scroll-driven page and report what a reader would hit.
 *
 *   node scroll-check.mjs <url> [--sizes 412x800,360x640,1440x900] [--box "<css selector>"]
 *        [--out <dir>] [--step 0.25] [--until <px>] [--compare <url2>] [--reduced-motion]
 *        [--chrome <path>]
 *
 * Per size it reports:
 *   empty      positions with no words in view and under 30% of the screen covered by a picture
 *   dead       two positions in a row where nothing on screen changed (the reader scrolls, nothing moves)
 *   offview    the framed picture box (--box) partly on and partly off the screen
 *   blocked    buttons and links a tap does not reach (another element lies on top; a fixed top bar is fine)
 *   poster     a video in view that never painted (readyState < 2 after settling)
 *   soft       a video shown larger than its pixels (displayed size x device pixel ratio > source size)
 *   media      clips or images that failed to load (a 404 clip silently falls back to its poster)
 *   overflow   the page is wider than the screen
 *   errors     console errors and page errors
 * Each position waits until the videos and the picture box stop moving (up to 4 s), not a fixed time.
 * With --out it saves one JPEG per position and, when ffmpeg is installed, a contact sheet per size.
 * With --compare it walks both URLs and counts positions where the --box rectangle differs by more
 * than 2 px (prove a change on one screen size left the other untouched).
 * --reduced-motion walks with prefers-reduced-motion: reduce (the page must still read, never empty).
 * Phones are emulated at device pixel ratio 3 (most current phones), computers at 1.
 *
 * Needs playwright-core (no bundled browser; it uses installed Chrome):
 *   npm i playwright-core   (in a scratch folder; set PW_DIR to it if not resolvable from here)
 * Exit code 1 when any size has empty, blocked, media or overflow findings.
 * Several checks are adapted from nateherk's scroll-craft (MIT): settle, frozen poster, dead scroll.
 */
import { createRequire } from "module";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const FLAGS = new Set(["--reduced-motion"]);
const url = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !FLAGS.has(args[i - 1])));
function opt(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}
if (!url) {
  console.log("usage: node scroll-check.mjs <url> [--sizes WxH,...] [--box sel] [--out dir] [--compare url2] [--reduced-motion]");
  process.exit(2);
}
const sizes = opt("sizes", "412x800,360x640,1440x900").split(",").map((s) => s.split("x").map(Number));
const boxSel = opt("box", "");
const outDir = opt("out", "");
const step = Number(opt("step", "0.25"));
const until = Number(opt("until", "0"));
const compare = opt("compare", "");
const reduced = args.includes("--reduced-motion");

function loadPlaywright() {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
  for (const b of [process.env.PW_DIR, process.cwd(), here].filter(Boolean)) {
    try {
      return createRequire(path.join(b, "package.json"))("playwright-core");
    } catch {
      /* try the next place */
    }
  }
  console.error("playwright-core not found. Run `npm i playwright-core` in a scratch folder and set PW_DIR to it.");
  process.exit(2);
}
function findChrome() {
  const given = opt("chrome", process.env.CHROME);
  if (given) return given;
  const local = process.env.LOCALAPPDATA || "";
  return [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(local, "Google/Chrome/Application/chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((p) => p && fs.existsSync(p));
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true, executablePath: findChrome() });

// What is moving right now: video times and the picture box. Used to settle and to find dead scroll.
const MOTION = (sel) => {
  const v = [...document.querySelectorAll("video")].map((e) => `${e.currentTime.toFixed(2)}${e.seeking ? "s" : ""}`).join(",");
  const el = sel ? document.querySelector(sel) : null;
  const b = el ? el.getBoundingClientRect() : null;
  return v + "|" + (b ? [b.x, b.y, b.width, b.height].map(Math.round).join(",") : "");
};

async function settle(page) {
  let last = "";
  const t0 = Date.now();
  await page.waitForTimeout(150);
  while (Date.now() - t0 < 4000) {
    const now = await page.evaluate(MOTION, boxSel);
    if (now === last && !now.includes("s,") && !now.includes("s|")) return;
    last = now;
    await page.waitForTimeout(80);
  }
}

async function walk(target, w, h, shots) {
  const phone = w < 1024;
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    isMobile: phone,
    hasTouch: phone,
    deviceScaleFactor: phone ? 3 : 1,
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  const page = await ctx.newPage();
  const errors = [];
  const media = new Set();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText || "";
    if (["media", "image"].includes(r.resourceType()) && !why.includes("ABORTED")) media.add(`${r.url().slice(-80)} (${why})`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && ["media", "image", "fetch"].includes(r.request().resourceType()) && /\.(mp4|webm|mov|m3u8|jpe?g|png|webp|avif)(\?|$)/i.test(r.url()))
      media.add(`${r.url().slice(-80)} (HTTP ${r.status()})`);
  });
  await page.goto(target, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(2500);
  const total = until || (await page.evaluate(() => document.documentElement.scrollHeight - innerHeight));
  const res = { empty: [], dead: [], offview: [], blocked: new Map(), poster: new Map(), soft: new Map(), boxes: [], overflow: false, errors, media };
  let n = 0;
  let prev = null;
  for (let y = 0; y <= total; y += Math.round(h * step), n++) {
    await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
    await settle(page);
    const r = await page.evaluate((sel) => {
      const vw = innerWidth, vh = innerHeight, dpr = devicePixelRatio;
      const seen = (el) => {
        const b = el.getBoundingClientRect();
        if (b.width < 2 || b.height < 2 || b.bottom <= 0 || b.top >= vh || b.right <= 0 || b.left >= vw) return null;
        for (let e = el; e && e !== document.body; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.05) return null;
        }
        return b;
      };
      const inView = (b) => (Math.min(b.right, vw) - Math.max(b.left, 0)) * (Math.min(b.bottom, vh) - Math.max(b.top, 0));
      const texts = [...document.querySelectorAll("h1,h2,h3,p,li,a,button,blockquote")].filter((e) => e.textContent.trim() && seen(e));
      let cover = 0;
      for (const e of document.querySelectorAll("img,video,canvas,picture,svg,[style*='background-image']")) {
        const b = seen(e);
        if (b && b.width * b.height >= 4000) cover += inView(b);
      }
      cover = Math.min(1, cover / (vw * vh));
      // Videos in view: never painted (stuck on the poster), or shown larger than their pixels.
      const poster = [], soft = [];
      for (const [k, v] of [...document.querySelectorAll("video")].entries()) {
        const b = seen(v);
        if (!b || inView(b) < vw * vh * 0.2) continue;
        const src = v.currentSrc || v.src || "";
        // Clips loaded as blobs have no useful name: call them by their place on the page.
        const name = `video #${k + 1}` + (src && !src.startsWith("blob:") ? ` (${src.split("/").pop().slice(0, 50)})` : "");
        if (v.readyState < 2) poster.push(name);
        else if (v.videoWidth) {
          const scale = Math.max(b.width / v.videoWidth, b.height / v.videoHeight); // object-fit: cover
          if (scale * dpr > 1.15) soft.push([name, `${v.videoWidth}px shown at ${Math.round(scale * v.videoWidth * dpr)} device px`]);
        }
      }
      const blocked = [];
      for (const e of document.querySelectorAll("a[href],button")) {
        const b = seen(e);
        if (!b) continue;
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        if (cx < 0 || cx > vw || cy < 0 || cy > vh) continue;
        const top = document.elementFromPoint(cx, cy);
        // Passing under a fixed top bar is normal; anything else on top is a dead button.
        const bar = top && top.closest("header, nav, [role=banner]");
        let fixedBar = false;
        for (let a = bar; a && a !== document.body && !fixedBar; a = a.parentElement)
          fixedBar = ["fixed", "sticky"].includes(getComputedStyle(a).position) && !a.contains(e);
        if (top && top !== e && !e.contains(top) && !fixedBar) {
          const label = (e.textContent.trim() || e.getAttribute("aria-label") || e.tagName).slice(0, 40);
          const cls = top.className && typeof top.className === "string" ? "." + top.className.split(" ")[0] : "";
          blocked.push(`${label} (under ${top.tagName.toLowerCase()}${cls})`);
        }
      }
      let box = null;
      if (sel) {
        const el = document.querySelector(sel);
        if (el) {
          const b = el.getBoundingClientRect();
          box = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), framed: b.width * b.height < vw * vh * 0.9 };
          // Partly on screen and partly off (a box wholly scrolled away with its section is fine).
          const visible = b.bottom > 0 && b.top < vh && b.right > 0 && b.left < vw;
          box.off = box.framed && visible && (b.top < -2 || b.bottom > vh + 2 || b.left < -2 || b.right > vw + 2);
        }
      }
      // Everything the reader sees moving: words (position and fade), videos, the box.
      const sig = texts.map((e) => { const b = e.getBoundingClientRect(); return `${Math.round(b.top)}:${getComputedStyle(e).opacity}`; }).join(",");
      return { words: texts.length, cover, poster, soft, blocked, box, sig, scrollY: Math.round(scrollY), overflow: document.documentElement.scrollWidth > vw + 1 };
    }, boxSel);
    const sig = r.sig + "|" + (await page.evaluate(MOTION, boxSel));
    if (prev && prev.sig === sig && prev.scrollY !== r.scrollY) res.dead.push(y);
    prev = { sig, scrollY: r.scrollY };
    if (r.words === 0 && r.cover < 0.3) res.empty.push(y);
    if (r.box?.off) res.offview.push(y);
    for (const b of r.blocked) res.blocked.set(b, y);
    for (const p of r.poster) if (!res.poster.has(p)) res.poster.set(p, y);
    for (const [s, why] of r.soft) if (!res.soft.has(s)) res.soft.set(s, `${why} at ${y}px`);
    if (r.overflow) res.overflow = true;
    res.boxes.push(r.box ? `${r.box.x},${r.box.y},${r.box.w},${r.box.h}` : "");
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, `${w}x${h}-${String(n).padStart(3, "0")}.jpg`), type: "jpeg", quality: 60, scale: "css" });
    }
  }
  if (shots && n) {
    const sheet = path.join(shots, `${w}x${h}-sheet.jpg`);
    const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(shots, `${w}x${h}-%03d.jpg`), "-vf", `scale=260:-1,tile=6x${Math.ceil(n / 6)}`, "-frames:v", "1", sheet]);
    if (ff.status === 0) res.sheet = sheet;
  }
  await ctx.close();
  return res;
}

const list = (arr) => (arr.length ? arr.join(", ") + " px" : "none");
const map = (m, fmt) => (m.size ? [...m].map(fmt).join("; ") : "none");
let bad = false;
for (const [w, h] of sizes) {
  const a = await walk(url, w, h, outDir);
  console.log(`\n== ${w}x${h}  ${url}${reduced ? "  (reduced motion)" : ""}`);
  console.log(`empty:    ${list(a.empty)}`);
  console.log(`dead:     ${list(a.dead)}`);
  if (boxSel) console.log(`offview:  ${list(a.offview)}`);
  console.log(`blocked:  ${map(a.blocked, ([b, y]) => `${b} at ${y}px`)}`);
  console.log(`poster:   ${map(a.poster, ([p, y]) => `${p} at ${y}px`)}`);
  console.log(`soft:     ${map(a.soft, ([s, why]) => `${s}: ${why}`)}`);
  console.log(`media:    ${a.media.size ? [...a.media].join("; ") : "none"}`);
  console.log(`overflow: ${a.overflow ? "YES" : "no"}`);
  console.log(`errors:   ${a.errors.length ? a.errors.slice(0, 5).join(" | ") : "none"}`);
  if (a.sheet) console.log(`sheet:    ${a.sheet}`);
  if (a.empty.length || a.blocked.size || a.media.size || a.overflow) bad = true;
  if (compare && boxSel) {
    const b = await walk(compare, w, h, "");
    const len = Math.min(a.boxes.length, b.boxes.length);
    let diff = 0;
    for (let i = 0; i < len; i++) {
      const p = a.boxes[i].split(",").map(Number), q = b.boxes[i].split(",").map(Number);
      if (p.some((v, k) => Math.abs(v - (q[k] ?? 1e9)) > 2)) diff++;
    }
    console.log(`compare:  ${len} positions against ${compare}, ${diff} different`);
  }
}
if (outDir) console.log(`\nscreenshots: ${path.resolve(outDir)}`);
await browser.close();
process.exit(bad ? 1 : 0);
