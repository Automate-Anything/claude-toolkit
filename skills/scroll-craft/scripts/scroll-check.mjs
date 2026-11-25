#!/usr/bin/env node
/*
 * scroll-check.mjs - walk a scroll-driven page and report what a reader would hit.
 *
 *   node scroll-check.mjs <url> [--sizes 412x800,360x640,1440x900] [--box "<css selector>"]
 *        [--out <dir>] [--step 0.25] [--wait 400] [--until <px>] [--compare <url2>] [--chrome <path>]
 *
 * Per size it reports:
 *   empty      scroll positions with no words in view and under 30% of the screen covered by a picture
 *   offview    the framed picture box (--box) partly on and partly off the screen
 *   blocked    buttons and links a tap does not reach (another element lies on top at their centre)
 *   overflow   the page is wider than the screen
 *   errors     console errors and page errors
 * With --out it saves one JPEG per position (<size>-<n>.jpg) to look at.
 * With --compare it walks both URLs and counts positions where the --box rectangle differs by more
 * than 2 px (prove a change on one screen size left the other untouched).
 *
 * Needs playwright-core (no bundled browser needed; it uses installed Chrome):
 *   npm i playwright-core            (in a scratch folder; point PW_DIR at it if not resolvable here)
 * Exit code 1 when any size has empty, blocked or overflow findings.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--") && !isValue(a));
function isValue(a) {
  const i = args.indexOf(a);
  return i > 0 && args[i - 1].startsWith("--");
}
function opt(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}
if (!url) {
  console.log("usage: node scroll-check.mjs <url> [--sizes WxH,...] [--box sel] [--out dir] [--compare url2]");
  process.exit(2);
}
const sizes = opt("sizes", "412x800,360x640,1440x900").split(",").map((s) => s.split("x").map(Number));
const boxSel = opt("box", "");
const outDir = opt("out", "");
const step = Number(opt("step", "0.25"));
const wait = Number(opt("wait", "400"));
const until = Number(opt("until", "0"));
const compare = opt("compare", "");

function loadPlaywright() {
  const bases = [process.env.PW_DIR, process.cwd(), path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"))].filter(Boolean);
  for (const b of bases) {
    try {
      const req = createRequire(path.join(b, "package.json"));
      return req("playwright-core");
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
  const list = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(local, "Google/Chrome/Application/chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return list.find((p) => p && fs.existsSync(p));
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true, executablePath: findChrome() });

async function walk(target, w, h, shots) {
  const phone = w < 1024;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(target, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(2500);
  const total = until || (await page.evaluate(() => document.documentElement.scrollHeight - innerHeight));
  const res = { empty: [], offview: [], blocked: new Map(), boxes: [], overflow: false, errors };
  let n = 0;
  for (let y = 0; y <= total; y += Math.round(h * step), n++) {
    await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
    await page.waitForTimeout(wait);
    const r = await page.evaluate((sel) => {
      const vw = innerWidth, vh = innerHeight;
      const seen = (el) => {
        const b = el.getBoundingClientRect();
        if (b.width < 2 || b.height < 2 || b.bottom <= 0 || b.top >= vh || b.right <= 0 || b.left >= vw) return null;
        for (let e = el; e && e !== document.body; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.05) return null;
        }
        return b;
      };
      const words = [...document.querySelectorAll("h1,h2,h3,p,li,a,button,blockquote")].filter((e) => e.textContent.trim() && seen(e)).length;
      let cover = 0;
      for (const e of document.querySelectorAll("img,video,canvas,picture,svg,[style*='background-image']")) {
        const b = seen(e);
        if (!b || b.width * b.height < 4000) continue;
        cover += (Math.min(b.right, vw) - Math.max(b.left, 0)) * (Math.min(b.bottom, vh) - Math.max(b.top, 0));
      }
      cover = Math.min(1, cover / (vw * vh));
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
          blocked.push(`${label} (under ${top.tagName.toLowerCase()}${top.className && typeof top.className === "string" ? "." + top.className.split(" ")[0] : ""})`);
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
      return { words, cover, blocked, box, overflow: document.documentElement.scrollWidth > vw + 1 };
    }, boxSel);
    if (r.words === 0 && r.cover < 0.3) res.empty.push(y);
    if (r.box?.off) res.offview.push(y);
    for (const b of r.blocked) res.blocked.set(b, y);
    if (r.overflow) res.overflow = true;
    res.boxes.push(r.box ? `${r.box.x},${r.box.y},${r.box.w},${r.box.h}` : "");
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, `${w}x${h}-${String(n).padStart(3, "0")}.jpg`), type: "jpeg", quality: 60 });
    }
  }
  await ctx.close();
  return res;
}

let bad = false;
for (const [w, h] of sizes) {
  const a = await walk(url, w, h, outDir);
  console.log(`\n== ${w}x${h}  ${url}`);
  console.log(`empty:    ${a.empty.length ? a.empty.join(", ") + " px" : "none"}`);
  if (boxSel) console.log(`offview:  ${a.offview.length ? a.offview.join(", ") + " px" : "none"}`);
  console.log(`blocked:  ${a.blocked.size ? [...a.blocked].map(([b, y]) => `${b} at ${y}px`).join("; ") : "none"}`);
  console.log(`overflow: ${a.overflow ? "YES" : "no"}`);
  console.log(`errors:   ${a.errors.length ? a.errors.slice(0, 5).join(" | ") : "none"}`);
  if (a.empty.length || a.blocked.size || a.overflow) bad = true;
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
