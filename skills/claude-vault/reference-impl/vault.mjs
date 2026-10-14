#!/usr/bin/env node
// claude-vault: encrypted mirror of the Claude Code home folder + project .env files,
// stored as a single-snapshot private git repo. Every byte in the repo (file names
// included) is AES-256-GCM encrypted with a key derived from the user's passphrase.
//
//   node vault.mjs setup    first run on a machine: passphrase, pull, push, scheduler, clone repos
//   node vault.mjs sync     pull remote-newer files, push local changes (runs every 10 min)
//   node vault.mjs restore  pull everything from the remote, never push
//   node vault.mjs status   what the remote snapshot holds
//   node vault.mjs verify   decrypt a random sample of the snapshot and compare to disk
//
// Zero dependencies: Node >= 18 stdlib only (crypto, zlib, fs, child_process).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VAULT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOSTNAME = process.env.CLAUDE_VAULT_HOSTNAME || os.hostname();   // override only for tests
const HOME = os.homedir();
const LOCAL_DIR = path.join(HOME, '.claude-vault');          // machine-local, never in the repo
const STATE_FILE = path.join(LOCAL_DIR, 'state.json');
const KEY_FILE = path.join(LOCAL_DIR, 'key.dpapi');           // passphrase, DPAPI-protected (this Windows user only)
const LOCK_FILE = path.join(LOCAL_DIR, 'sync.lock');
const REPOS_FILE = path.join(LOCAL_DIR, 'repos.json');        // generated list of C:\dev repos, synced like any file
const LOG_FILE = path.join(LOCAL_DIR, 'sync.log');
const CONFIG = JSON.parse(fs.readFileSync(path.join(VAULT_DIR, 'vault.config.json'), 'utf8'));
const CHUNK_SIZE = 4 * 1024 * 1024;
const BRANCH = 'vault';
const BATCH_PUSH_BYTES = 700 * 1024 * 1024;                   // GitHub rejects single pushes > 2 GB
const RECENT_WRITE_MS = 60_000;
const SQUASH_FLAG = path.join(LOCAL_DIR, 'squash-here');           // only machines with this flag ever squash (a squash = full re-upload)
const SQUASH_EVERY_MS = 24 * 3600 * 1000;
const SQUASH_LOCK = 'squash.lock';                                 // published on the remote while a squash upload is running
const SQUASH_LOCK_TTL_MS = 30 * 60 * 1000;                               // a file written in the last minute is "in use"; local wins
const IS_WIN = process.platform === 'win32';

// ----------------------------- logging -----------------------------
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  try {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* logging must never break a sync */ }
}
function die(msg) {
  log('FATAL:', String(msg).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6).join(' | '));
  try { if (fs.existsSync(LOCK_FILE) && Number(fs.readFileSync(LOCK_FILE, 'utf8')) === process.pid) fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }   // exiting from inside the lock must release it
  process.exit(1);
}

// ----------------------------- shell helpers -----------------------------
function run(cmd, args, opts = {}) {
  // Every child gets a timeout (default 5 min): a hung process must never hold the sync lock (a hung
  // 'code --install-extension' held <LAPTOP>'s lock for 13 minutes on 2026-09-29).
  const r = spawnSync(cmd, args, { cwd: opts.cwd || VAULT_DIR, encoding: opts.binary ? 'buffer' : 'utf8', input: opts.input, stdio: opts.inherit ? 'inherit' : 'pipe', maxBuffer: 256 * 1024 * 1024, shell: false, timeout: opts.timeout || 300000, killSignal: 'SIGKILL', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.error && r.error.code === 'ETIMEDOUT') { if (opts.allowFail) return { code: -1, out: opts.binary ? Buffer.alloc(0) : '', err: cmd + ' timed out after ' + Math.round((opts.timeout || 300000) / 1000) + 's' }; throw new Error(cmd + ' ' + args.join(' ') + ' timed out after ' + Math.round((opts.timeout || 300000) / 1000) + 's'); }
  if (r.error) throw r.error;
  const outStr = opts.binary ? r.stdout : (opts.raw ? (r.stdout || '') : (r.stdout || '').trim());
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}):\n${(r.stderr || '') + (opts.binary ? '' : (r.stdout || ''))}`);
  return { code: r.status, out: outStr, err: String(r.stderr || '').trim() };
}
const git = (args, opts) => run('git', args, opts);
function which(bin) { const r = run(IS_WIN ? 'where' : 'which', [bin], { allowFail: true }); return r.code === 0 ? r.out.split(/\r?\n/)[0] : null; }

// ----------------------------- passphrase / keys -----------------------------
function readPassphrase() {
  if (process.env.CLAUDE_VAULT_PASSPHRASE) return process.env.CLAUDE_VAULT_PASSPHRASE;
  if (!fs.existsSync(KEY_FILE)) die(`No passphrase stored. Run: node "${path.join(VAULT_DIR, 'vault.mjs')}" setup`);
  if (!IS_WIN) return fs.readFileSync(KEY_FILE, 'utf8').trim();
  const ps = `$s = Get-Content -LiteralPath '${KEY_FILE.replace(/'/g, "''")}' | ConvertTo-SecureString; ` +
    `[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`;
  const r = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  if (!r.out) die('Stored passphrase could not be decrypted (different Windows user?). Re-run setup.');
  return r.out;
}
function storePassphraseInteractive() {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  if (!IS_WIN) {
    const p = promptHidden('Vault passphrase: ');
    fs.writeFileSync(KEY_FILE, p, { mode: 0o600 });
    return;
  }
  // Read-Host -AsSecureString never echoes; ConvertFrom-SecureString = DPAPI, bound to this Windows user.
  const ps = `
    while ($true) {
      $a = Read-Host -AsSecureString 'Vault passphrase (hidden, min 12 chars)'
      $b = Read-Host -AsSecureString 'Type it again'
      $pa = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($a))
      $pb = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($b))
      if ($pa.Length -lt 12) { Write-Host 'Too short, use at least 12 characters.'; continue }
      if ($pa -ne $pb) { Write-Host 'They do not match, try again.'; continue }
      $a | ConvertFrom-SecureString | Set-Content -Encoding ascii -LiteralPath '${KEY_FILE.replace(/'/g, "''")}'
      break
    }`;
  run('powershell', ['-NoProfile', '-Command', ps], { inherit: true });
}
function promptHidden(q) {
  process.stdout.write(q);
  const buf = fs.readFileSync(0, 'utf8');
  return buf.split(/\r?\n/)[0];
}
function deriveKeys(passphrase, saltHex) {
  const master = crypto.scryptSync(passphrase, Buffer.from(saltHex, 'hex'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const sub = (label) => crypto.createHmac('sha256', master).update(label).digest();
  return { enc: sub('enc'), chunkId: sub('chunkid'), check: sub('check').toString('hex') };
}
function loadOrCreateSaltAndCheck(passphrase) {
  const saltPath = path.join(VAULT_DIR, 'vault.salt');
  const checkPath = path.join(VAULT_DIR, 'vault.check');
  let salt;
  if (fs.existsSync(saltPath)) salt = fs.readFileSync(saltPath, 'utf8').trim();
  else { salt = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(saltPath, salt + '\n'); }
  const keys = deriveKeys(passphrase, salt);
  if (fs.existsSync(checkPath)) {
    if (fs.readFileSync(checkPath, 'utf8').trim() !== keys.check) return null;   // wrong passphrase
  } else fs.writeFileSync(checkPath, keys.check + '\n');
  return keys;
}

// ----------------------------- crypto primitives -----------------------------
// Chunks are content-addressed: id = HMAC(chunkIdKey, sha256(plaintext)). The nonce is
// derived from the id, so an identical chunk always produces identical ciphertext (dedup
// across syncs and machines) and a changed chunk produces a new object. GCM tag is
// appended. Only the id is stored in the manifest; the manifest itself is encrypted.
function encryptChunk(keys, plain) {
  const gz = zlib.gzipSync(plain, { level: 6 });
  const id = crypto.createHmac('sha256', keys.chunkId).update(crypto.createHash('sha256').update(plain).digest()).digest('hex');
  const c = crypto.createCipheriv('aes-256-gcm', keys.enc, Buffer.from(id.slice(0, 24), 'hex'));
  c.setAAD(Buffer.from(id, 'hex'));
  const ct = Buffer.concat([c.update(gz), c.final(), c.getAuthTag()]);
  return { id, ct };
}
function decryptChunk(keys, id, ct) {
  const d = crypto.createDecipheriv('aes-256-gcm', keys.enc, Buffer.from(id.slice(0, 24), 'hex'));
  d.setAAD(Buffer.from(id, 'hex'));
  d.setAuthTag(ct.subarray(ct.length - 16));
  return zlib.gunzipSync(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]));
}
function encryptBlob(keys, plain) {           // random-nonce variant for the manifest
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keys.enc, nonce);
  const gz = zlib.gzipSync(plain, { level: 9 });
  return Buffer.concat([nonce, c.update(gz), c.final(), c.getAuthTag()]);
}
function decryptBlob(keys, buf) {
  const d = crypto.createDecipheriv('aes-256-gcm', keys.enc, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return zlib.gunzipSync(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]));
}
const chunkPath = (id) => path.join(VAULT_DIR, 'chunks', id.slice(0, 2), id);

// ----------------------------- roots + virtual paths -----------------------------
// vpath = "<rootName>/<relative/forward/slash/path>"; the root's real location is per machine.
function expandRoot(v) { return v.replace(/%([^%]+)%/g, (_, n) => process.env[n] ?? (n === 'USERPROFILE' ? HOME : '')).replace(/^~(?=$|[\\/])/, HOME); }
const ROOTS = Object.fromEntries(Object.entries(CONFIG.roots).map(([k, v]) => [k, path.resolve(expandRoot(process.env['CLAUDE_VAULT_ROOT_' + k.toUpperCase()] || v))]));
function toReal(vpath) { const i = vpath.indexOf('/'); const root = ROOTS[vpath.slice(0, i)]; if (!root) throw new Error('unknown root in ' + vpath); return path.join(root, ...vpath.slice(i + 1).split('/')); }
function toV(rootName, real) { return rootName + '/' + path.relative(ROOTS[rootName], real).split(path.sep).join('/'); }

const EXCLUDED_DIR_NAMES = new Set(CONFIG.excludeDirNames || []);
// Generated-and-merged files: every machine re-derives them, so "newest mtime wins" is wrong for them.
// They are always taken from the remote when it changed since our last push, merged (set union), and regenerated.
const MERGED_VPATHS = new Set(['home/.claude-vault/claude-json-slice.json', 'home/.claude-vault/repos.json', 'home/.claude-vault/retired.json']);
// Chats and per-project memory are never deleted THROUGH the vault. Claude Code's own 30-day cleanup
// (or a fresh machine before its settings arrive) deleting transcripts must not become a vault-wide
// delete: a missing transcript is restored from the vault instead. Everything else keeps delete semantics.
const PROTECTED_PREFIX = 'home/.claude/projects/';
const isProtected = (vpath) => vpath.startsWith(PROTECTED_PREFIX);
function excluded(rel, rules) {   // rel uses forward slashes, relative to the include entry
  for (const r of rules || []) {
    if (r.endsWith('/')) { if (rel === r.slice(0, -1) || rel.startsWith(r)) return true; }
    else if (r.startsWith('*')) { if (rel.endsWith(r.slice(1))) return true; }
    else if (r.endsWith('*')) { if (rel.startsWith(r.slice(0, -1))) return true; }
    else if (rel === r) return true;
  }
  return false;
}
function walk(dir, onFile, opts) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(e.name)) continue;
      if (opts.maxDepth !== undefined && full.split(path.sep).length - opts.baseDepth >= opts.maxDepth) continue;
      walk(full, onFile, opts);
    } else if (e.isFile()) onFile(full);
  }
}
// Enumerate everything the vault covers on THIS machine -> Map<vpath, {real, mtime, size}>
// Windows: fs.stat opens every file (Defender scans each open; 22 s for 31k files on <LAPTOP>). .NET's
// DirectoryInfo.EnumerateFiles fills size and mtime from the directory listing itself, no opens: one
// PowerShell process for the whole tree. Falls back to the plain walk if PowerShell fails.
function enumerateTree(base) {
  if (!IS_WIN) return null;
  const skip = [...EXCLUDED_DIR_NAMES].map((n) => "'" + n.replace(/'/g, "''") + "'").join(',');
  const ps = "$ErrorActionPreference='SilentlyContinue'; $skip=@(" + skip + "); " +
    "function W($d){ foreach($i in $d.EnumerateFiles()){ if(-not ($i.Attributes -band [IO.FileAttributes]::ReparsePoint)){ [Console]::Out.WriteLine($i.FullName+'|'+$i.LastWriteTimeUtc.Ticks+'|'+$i.Length) } }; " +
    "foreach($s in $d.EnumerateDirectories()){ if($skip -contains $s.Name){continue}; if($s.Attributes -band [IO.FileAttributes]::ReparsePoint){continue}; W $s } }; " +
    "W ([IO.DirectoryInfo]'" + base.replace(/'/g, "''") + "')";
  const r = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { allowFail: true, raw: true, timeout: 240000 });
  if (r.code !== 0) return null;
  const out = [];
  for (const line of r.out.split(/\r?\n/)) {
    if (!line) continue;
    const j = line.lastIndexOf('|'), i = line.lastIndexOf('|', j - 1); if (i < 0) continue;
    const ticks = Number(line.slice(i + 1, j)), size = Number(line.slice(j + 1));
    out.push({ real: line.slice(0, i), m: Math.floor((ticks - 621355968000000000) / 10000), s: size });
  }
  return out;
}
function scanLocal(state) {
  const files = new Map();
  const add = (rootName, real, known) => {
    if (known) { files.set(toV(rootName, real), { real, mtime: known.m, size: known.s }); return; }
    let st; try { st = fs.statSync(real); } catch { return; }
    files.set(toV(rootName, real), { real, mtime: Math.floor(st.mtimeMs), size: st.size });
  };
  for (const inc of CONFIG.include) {
    const base = path.join(ROOTS[inc.root], ...(inc.path || '').split('/').filter(Boolean));
    if (inc.type === 'dir') {
      const listed = enumerateTree(base);
      if (listed) { for (const f of listed) { const rel = path.relative(base, f.real).split(path.sep).join('/'); if (!excluded(rel, inc.exclude)) add(inc.root, f.real, f); } }
      else walk(base, (f) => { const rel = path.relative(base, f).split(path.sep).join('/'); if (!excluded(rel, inc.exclude)) add(inc.root, f); }, { baseDepth: base.split(path.sep).length });
    } else if (inc.type === 'file') {
      if (fs.existsSync(base)) add(inc.root, base);
    } else if (inc.type === 'envfiles') {
      // every <root>/<project>/**/.env* up to maxDepth, skipping dependency dirs
      walk(base, (f) => { if (/^\.env(\..*)?$/.test(path.basename(f)) && !/\.example$/.test(f)) add(inc.root, f); }, { baseDepth: base.split(path.sep).length, maxDepth: inc.maxDepth || 4 });
    }
  }
  // synthetic: the portable slice of ~/.claude.json and the repo list
  writeClaudeJsonSlice();
  writeReposList();
  for (const f of [CLAUDE_JSON_SLICE, REPOS_FILE, RETIRED_FILE]) if (fs.existsSync(f)) add('home', f);
  walk(path.join(LOCAL_DIR, 'wip'), (f) => add('home', f), { baseDepth: 0 });
  walk(RETIRED_DIR, (f) => add('home', f), { baseDepth: 0 });
  return files;
}

// ----------------------------- ~/.claude.json (portable slice + merge) -----------------------------
const CLAUDE_JSON = path.join(HOME, '.claude.json');
const CLAUDE_JSON_SLICE = path.join(LOCAL_DIR, 'claude-json-slice.json');
const PORTABLE_PROJECT_KEYS = ['allowedTools', 'mcpServers', 'enabledMcpjsonServers', 'disabledMcpjsonServers', 'hasTrustDialogAccepted', 'hasClaudeMdExternalIncludesApproved', 'mcpContextUris'];
// Deterministic serialization so two machines that hold the same settings produce byte-identical slices (no ping-pong).
function canon(v) {
  if (Array.isArray(v)) { const a = v.map(canon); return a.every((x) => typeof x === 'string') ? [...new Set(a)].sort() : a; }
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
function writeClaudeJsonSlice() {
  try {
    if (!fs.existsSync(CLAUDE_JSON)) return;
    const j = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8'));
    const slice = { mcpServers: j.mcpServers || {}, projects: {} };
    for (const [p, v] of Object.entries(j.projects || {})) { slice.projects[p] = {}; for (const k of PORTABLE_PROJECT_KEYS) if (v[k] !== undefined) slice.projects[p][k] = v[k]; }
    const txt = JSON.stringify(canon(slice), null, 1);
    if (fs.existsSync(CLAUDE_JSON_SLICE) && fs.readFileSync(CLAUDE_JSON_SLICE, 'utf8') === txt) return;  // keep mtime stable when nothing changed
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    fs.writeFileSync(CLAUDE_JSON_SLICE, txt);
  } catch (e) { log('claude.json slice skipped:', e.message); }
}
function mergeClaudeJsonSlice() {   // called after the slice file was refreshed from the remote
  try {
    if (!fs.existsSync(CLAUDE_JSON_SLICE)) return;
    const slice = JSON.parse(fs.readFileSync(CLAUDE_JSON_SLICE, 'utf8'));
    const j = fs.existsSync(CLAUDE_JSON) ? JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8')) : {};
    j.mcpServers = { ...(j.mcpServers || {}), ...(slice.mcpServers || {}) };
    j.projects = j.projects || {};
    for (const [p, v] of Object.entries(slice.projects || {})) {
      const cur = j.projects[p] || {};
      const merged = { ...cur, ...v };
      if (Array.isArray(cur.allowedTools) || Array.isArray(v.allowedTools)) merged.allowedTools = [...new Set([...(cur.allowedTools || []), ...(v.allowedTools || [])])].sort();
      merged.mcpServers = { ...(cur.mcpServers || {}), ...(v.mcpServers || {}) };
      j.projects[p] = merged;
    }
    fs.writeFileSync(CLAUDE_JSON, JSON.stringify(j, null, 2));
    log('merged ~/.claude.json project settings from vault');
  } catch (e) { log('claude.json merge skipped:', e.message); }
}

// ----------------------------- repo list (so a new machine clones every project) -----------------------------
function writeReposList() {
  try {
    const dev = ROOTS.dev; if (!dev || !fs.existsSync(dev)) return;
    // MERGE with what the vault already knows: a fresh machine has no repos yet and must not wipe the list.
    const byName = new Map();
    try { for (const r of JSON.parse(fs.readFileSync(REPOS_FILE, 'utf8'))) byName.set(r.name, r); } catch { /* none yet */ }
    for (const e of fs.readdirSync(dev, { withFileTypes: true })) {
      if (!e.isDirectory() || !fs.existsSync(path.join(dev, e.name, '.git'))) continue;
      const r = run('git', ['-C', path.join(dev, e.name), 'remote', 'get-url', 'origin'], { allowFail: true });
      if (r.code === 0 && r.out) byName.set(e.name, { name: e.name, url: r.out });
    }
    for (const n of [...byName.keys()]) if (isRetired(n)) byName.delete(n);
    const list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    const txt = JSON.stringify(list, null, 1);
    if (fs.existsSync(REPOS_FILE) && fs.readFileSync(REPOS_FILE, 'utf8') === txt) return;
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    fs.writeFileSync(REPOS_FILE, txt);
  } catch (e) { log('repo list skipped:', e.message); }
}
function cloneMissingRepos(state) {
  // Runs on EVERY sync: a project added on one machine exists on the other within 10 minutes.
  // "Missing" = no .git folder. The folder itself often already exists, because the vault restores
  // C:\dev\<project>\.env before anything else, so a plain git clone would refuse (not empty):
  // clone IN PLACE instead, keeping untracked files such as .env.
  try {
    if (!fs.existsSync(REPOS_FILE)) return;
    const dev = ROOTS.dev; if (!dev) return; fs.mkdirSync(dev, { recursive: true });
    state.repoCloneFailed = state.repoCloneFailed || {};
    for (const r of JSON.parse(fs.readFileSync(REPOS_FILE, 'utf8'))) {
      if (isRetired(r.name)) continue;
      const target = path.join(dev, r.name);
      const hasGit = fs.existsSync(path.join(target, '.git'));
      if (hasGit && run('git', ['-C', target, 'rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true }).code === 0) continue;   // cloned = has a commit, not "has a .git folder"
      const gitWasOurs = hasGit && run('git', ['-C', target, 'rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true }).code !== 0;   // an empty .git from a failed attempt
      if (Date.now() - (state.repoCloneFailed[r.name] || 0) < 10 * 60 * 1000) continue;   // retry a failed clone every 10 min, not every sync
      try {
        const g = (args) => run('git', ['-C', target, ...args]);
        fs.mkdirSync(target, { recursive: true });
        const preexisting = fs.readdirSync(target).length > 0;
        log((preexisting ? 'cloning in place (folder already had files): ' : 'cloning: ') + r.url + ' -> ' + target);
        g(['init', '-q']);
        if (run('git', ['-C', target, 'remote', 'get-url', 'origin'], { allowFail: true }).code !== 0) g(['remote', 'add', 'origin', r.url]); else g(['remote', 'set-url', 'origin', r.url]);
        // credentials: the machine's default helper first (Git Credential Manager, the user's work account);
        // if GitHub answers "not found"/auth, retry through the gh login (private repos of the vault's GitHub account)
        let fr = run('git', ['-C', target, 'fetch', '-q', 'origin'], { allowFail: true });
        if (fr.code !== 0 && which('gh') && /github\.com/.test(r.url)) { fr = run('git', ['-C', target, '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'fetch', '-q', 'origin'], { allowFail: true }); if (fr.code === 0) { g(['config', '--replace-all', 'credential.helper', '']); g(['config', '--add', 'credential.helper', '!gh auth git-credential']); log('  ' + r.name + ': reachable only through the gh login; this repo now uses it (repo-local config)'); } }
        if (fr.code !== 0) throw new Error(fr.err || 'fetch failed');
        // default branch: what the remote advertises as HEAD; else main, master, or the only branch there is
        run('git', ['-C', target, 'remote', 'set-head', 'origin', '-a'], { allowFail: true });
        let branch = run('git', ['-C', target, 'symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { allowFail: true }).out.replace('refs/remotes/origin/', '');
        if (!branch) {
          const remoteBranches = g(['branch', '-r', '--format=%(refname:short)']).out.split(/\r?\n/).map((b) => b.replace(/^origin\//, '')).filter((b) => b && b !== 'HEAD');
          branch = ['main', 'master'].find((b) => remoteBranches.includes(b)) || remoteBranches[0];
          if (!branch) throw new Error('remote has no branches');
        }
        // a tracked file that already exists locally would block the checkout: move it aside, keep everything else (.env stays)
        const tracked = g(['ls-tree', '-r', '--name-only', 'origin/' + branch]).out.split(/\r?\n/).filter(Boolean);
        const moved = [];
        for (const f of tracked) { const fp = path.join(target, f); if (fs.existsSync(fp)) { fs.renameSync(fp, fp + '.vault-moved'); moved.push(f); } }
        g(['checkout', '-q', '-b', branch, '--track', 'origin/' + branch]);
        if (moved.length) log('  ' + r.name + ': ' + moved.length + ' local file(s) collided with tracked files and were moved aside (*.vault-moved): ' + moved.slice(0, 5).join(', ') + (moved.length > 5 ? ', ...' : ''));
        delete state.repoCloneFailed[r.name];
        log('  ' + r.name + ' ready on branch ' + branch);
      } catch (e) {
        state.repoCloneFailed[r.name] = Date.now();
        // never leave a half-made .git behind (it would look "cloned" to a naive check and hide the failure)
        try { if ((gitWasOurs || !hasGit) && run('git', ['-C', target, 'rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true }).code !== 0) fs.rmSync(path.join(target, '.git'), { recursive: true, force: true }); } catch { /* ignore */ }
        log('  clone failed for ' + r.name + ', will retry in 10 min: ' + (e.message.split('\n').find((l) => /fatal|error|denied|not found/i.test(l)) || e.message.split('\n')[0]));
      }
    }
  } catch (e) { log('repo clone check failed: ' + e.message); }
}

// ----------------------------- VS Code "open Claude chats" state -----------------------------
// VS Code keeps per-folder UI state in %APPDATA%\Code\User\workspaceStorage\<hash>\state.vscdb
// (SQLite, ItemTable(key, value)). The open Claude Code chat tabs live in three keys:
//   Anthropic.claude-code                          the extension's memento (panelTabSessions: id + title)
//   memento/workbench.parts.editor                 VS Code's editor layout (the webview tabs themselves)
//   memento/webviewView.claudeVSCodeSidebarSecondary  the chat shown in the secondary sidebar
// The <hash> differs per machine, so entries are matched by workspace.json's folder URI.
// Export: every sync writes ~/.claude/vscode-state/<project>.json when THIS machine's state changed
// (rides the normal vault sync). Import: a file from another machine is written into the local
// state.vscdb only when that folder's window is not open here (VS Code only reads the db when a
// window opens, and rewrites it from memory while open). Machine-specific bits (user name, the
// extension's versioned install dir) are placeholdered on export and expanded on import.
// Nothing here may ever block the transcript sync: every entry point swallows its own errors.
const VSCODE_KEYS = ['Anthropic.claude-code', 'memento/workbench.parts.editor', 'memento/webviewView.claudeVSCodeSidebarSecondary'];
const VSCODE_STATE_DIR = path.join(HOME, '.claude', 'vscode-state');
const VSCODE_WS = process.env.APPDATA ? path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage') : null;
const VSCODE_STORAGE_JSON = process.env.APPDATA ? path.join(process.env.APPDATA, 'Code', 'User', 'globalStorage', 'storage.json') : null;
let sqliteMod = null, sqliteTried = false;
async function loadSqlite() {
  if (sqliteTried) return sqliteMod; sqliteTried = true;
  try { sqliteMod = await import('node:sqlite'); } catch { log('vscode-state: node:sqlite not available in this Node (' + process.version + '); open-chat sync disabled on this machine'); }
  return sqliteMod;
}
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const localUser = () => path.basename(HOME);
function localClaudeExtVersion() {
  try {
    const dir = path.join(HOME, '.vscode', 'extensions');
    const vers = fs.readdirSync(dir).map((n) => /^anthropic\.claude-code-(\d+\.\d+\.\d+)-/.exec(n)).filter(Boolean).map((m) => m[1]);
    vers.sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]); });
    return vers.pop() || null;
  } catch { return null; }
}
// placeholders: {{USER}} for the profile user name (plain and %-encoded forms), {{CLAUDE_EXT_VER}} for the extension version
function placeholderOut(str) {
  const u = localUser(), ue = encodeURIComponent(u);
  const esc = (x) => x.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
  return str
    .replace(new RegExp('([cC](?::|%3A)(?:\\\\\\\\+|\\/)Users(?:\\\\\\\\+|\\/))(?:' + esc(u) + '|' + esc(ue) + ')(?=\\\\|\\/|"|\'|$)', 'g'), '$1{{USER}}')
    .replace(/anthropic\.claude-code-\d+\.\d+\.\d+-win32-x64/g, 'anthropic.claude-code-{{CLAUDE_EXT_VER}}-win32-x64');
}
function placeholderIn(str) {
  const u = localUser(), ue = encodeURIComponent(u), ver = localClaudeExtVersion();
  let out = str.replace(/([cC](?::|%3A)(?:\\\\+|\/)Users(?:\\\\+|\/))\{\{USER\}\}/g, (m, pre) => pre + (pre.includes('%3A') ? ue : u));
  if (ver) out = out.replace(/\{\{CLAUDE_EXT_VER\}\}/g, ver);
  return out;
}
function vscodeEntries() {   // [{hashDir, folder:'C:/dev/name', project:'name'}] for folders under the dev root
  const VSCODE_WS = VSCODE_WS_DIR();
  if (!VSCODE_WS || !fs.existsSync(VSCODE_WS) || !ROOTS.dev) return [];
  const devPrefix = ROOTS.dev.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() + '/';
  const out = [];
  for (const h of fs.readdirSync(VSCODE_WS)) {
    try {
      const wj = path.join(VSCODE_WS, h, 'workspace.json'); if (!fs.existsSync(wj)) continue;
      const uri = JSON.parse(fs.readFileSync(wj, 'utf8')).folder; if (!uri || !uri.startsWith('file:///')) continue;
      const folder = decodeURIComponent(uri.slice('file:///'.length)).replace(/\\/g, '/');
      if (!folder.toLowerCase().startsWith(devPrefix)) continue;
      const project = folder.slice(devPrefix.length); if (!project || project.includes('/')) continue;
      if (!fs.existsSync(path.join(VSCODE_WS, h, 'state.vscdb'))) continue;
      out.push({ hashDir: path.join(VSCODE_WS, h), folder, project });
    } catch { /* skip odd entries */ }
  }
  return out;
}
// Three signals, any of them = open: (1) the companion's heartbeat file (touched every 30 s by a live
// window), (2) VS Code's own storage.json windowsState (stale for windows opened by the code CLI),
// (3) the window titles of Code.exe processes ("... - <project> - Visual Studio Code").
const HEARTBEAT_DIR = path.join(LOCAL_DIR, 'windows');
function vscodeOpenFolders() {   // lower-cased folder paths whose VS Code window is open right now
  const open = new Set();
  if (!IS_WIN) return open;
  const procs = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', "Get-Process Code -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowTitle } | Where-Object { $_ }"], { allowFail: true }).out;
  if (!procs && !/Code\.exe/i.test(run('tasklist', ['/FI', 'IMAGENAME eq Code.exe', '/NH'], { allowFail: true }).out)) return open;   // VS Code not running at all
  const dev = (ROOTS.dev || '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  try {   // (1) heartbeats
    for (const f of fs.readdirSync(HEARTBEAT_DIR)) {
      const fp = path.join(HEARTBEAT_DIR, f);
      if (Date.now() - fs.statSync(fp).mtimeMs > 90 * 1000) continue;
      try { const folder = fs.readFileSync(fp, 'utf8').trim(); if (folder) open.add(folder.replace(/\\/g, '/').toLowerCase()); } catch { /* ignore */ }
    }
  } catch { /* no heartbeats yet */ }
  try {   // (2) storage.json
    const sj = JSON.parse(fs.readFileSync(VSCODE_STORAGE_JSON, 'utf8'));
    const ws = sj.windowsState || {};
    for (const w of [...(ws.openedWindows || []), ws.lastActiveWindow].filter(Boolean)) {
      if (w.folder && w.folder.startsWith('file:///')) open.add(decodeURIComponent(w.folder.slice('file:///'.length)).replace(/\\/g, '/').toLowerCase());
    }
  } catch { /* no storage.json */ }
  if (dev) {   // (3) window titles: the segment before "Visual Studio Code" is the folder name
    for (const title of procs.split(/\r?\n/)) {
      const parts = title.split(' - ').map((x) => x.trim());
      if (parts.length < 2 || !/Visual Studio Code/i.test(parts[parts.length - 1])) continue;
      const name = parts[parts.length - 2].replace(/^\[.*\]\s*/, '');
      if (name) open.add(dev + '/' + name.toLowerCase());
    }
  }
  return open;
}
function readVscodeKeys(sqlite, dbPath) {   // copy-then-read so an open window's lock never matters
  const tmp = path.join(os.tmpdir(), 'claude-vault-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.db');
  fs.copyFileSync(dbPath, tmp);
  try {
    const d = new sqlite.DatabaseSync(tmp, { readOnly: true });
    const keys = {};
    try { for (const k of VSCODE_KEYS) { const r = d.prepare('SELECT value FROM ItemTable WHERE key = ?').get(k); if (r && r.value != null) keys[k] = (Buffer.isBuffer(r.value) || r.value instanceof Uint8Array) ? { b64: Buffer.from(r.value).toString('base64') } : placeholderOut(String(r.value)); } }
    finally { d.close(); }
    return keys;
  } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
}
const keysHash = (keys) => sha(JSON.stringify(Object.keys(keys).sort().map((k) => [k, keys[k]])));
// THE gate for writing state.vscdb: SQLite keeps the file open for as long as VS Code has that
// workspace's storage open, and Windows refuses an exclusive open while any handle exists. Every
// other "is the window open" signal has been wrong at least once (storage.json is updated BEFORE
// the final flush; the code CLI opens windows storage.json does not list). Held = never write.
function dbHeld(dbPath) {
  if (!IS_WIN) return false;
  const ps = "try { $f=[System.IO.File]::Open('" + dbPath.replace(/'/g, "''") + "','Open','ReadWrite','None'); $f.Close(); 'free' } catch { 'held' }";
  return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { allowFail: true }).out.trim() !== 'free';
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitDbWritable(dbPath, maxMs) {   // not held by VS Code (bail at once: waiting never helps while VS Code runs) AND quiet for 5 s (worth a short wait)
  if (dbHeld(dbPath)) return false;
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - fs.statSync(dbPath).mtimeMs > 5000) return !dbHeld(dbPath);
    if (Date.now() - t0 >= Math.max(maxMs, 6000)) return false;
    await sleep(1000);
  }
}
function vscodeStateFile(project) { return path.join(VSCODE_STATE_DIR, project.replace(/[<>:"/\\|?*]/g, '_') + '.json'); }

// -- Open chat tabs: ONE SHARED SET per project, merged, never replaced ------------------------------
// "Newest wins" replaced a machine's whole tab set with the other's (a window opened with 2 tabs wiped 26,
// 2026-09-29). Now every host publishes its OWN file: vscode-state/hosts/<host>/<project>.json =
//   tabs   { sessionId: { title, openedAt, lastActiveAt } }   what is open on that host
//   closed { sessionId: { closedAt, title } }                 tabs the user explicitly closed there (tombstones)
//   template                                                   one webview-tab entry with placeholders, for hosts that have none yet
// Import = union of every host's tabs minus tombstones (a tombstone beats an older open; a reopen after closedAt
// beats the tombstone). Locally: keep the layout, remove only tombstoned tabs, append the missing ones. A host
// with fewer tabs never shrinks the set. Only an explicit close (companion tab-close event + the tab gone from
// the db) creates a tombstone. The exclusive-open gate and the 5 s verification stay.
const VSCODE_HOSTS_DIR = path.join(VSCODE_STATE_DIR, 'hosts');
const CLOSED_EVENTS_DIR = path.join(LOCAL_DIR, 'closed');      // companion appends {title, at} per explicit close
const PENDING_DIR = path.join(LOCAL_DIR, 'pending');            // "a merge is waiting for this window to close"
const CLAUDE_KEY = 'Anthropic.claude-code', EDITOR_KEY = 'memento/workbench.parts.editor';
const VSCODE_WS_DIR = () => process.env.CLAUDE_VAULT_VSCODE_WS || VSCODE_WS;
function readDbKeys(sqlite, dbPath, keys) {   // copy-then-read; raw strings (no placeholders)
  const tmp = path.join(os.tmpdir(), 'claude-vault-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.db');
  fs.copyFileSync(dbPath, tmp);
  try { const d = new sqlite.DatabaseSync(tmp, { readOnly: true }); const out = {}; try { for (const k of keys) { const r = d.prepare('SELECT value FROM ItemTable WHERE key = ?').get(k); if (r && r.value != null) out[k] = String(r.value); } } finally { d.close(); } return out; }
  finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
}
function parseTabs(raw) {   // -> { claude, editor, tabs: Map(sid -> {title}), leaves: [...] }
  const claude = raw[CLAUDE_KEY] ? JSON.parse(raw[CLAUDE_KEY]) : { panelSessionIds: [], panelTabSessions: [] };
  const editor = raw[EDITOR_KEY] ? JSON.parse(raw[EDITOR_KEY]) : null;
  const tabs = new Map();
  for (const t of claude.panelTabSessions || []) if (t && t.sessionId) tabs.set(t.sessionId, { title: t.title || '' });
  const leaves = [];
  const walkGrid = (node) => { if (!node) return; if (node.type === 'branch') { for (const c of node.data || []) walkGrid(c); return; } if (node.data && Array.isArray(node.data.editors)) leaves.push(node.data); };
  if (editor && editor['editorpart.state'] && editor['editorpart.state'].serializedGrid) walkGrid(editor['editorpart.state'].serializedGrid.root);
  for (const leaf of leaves) for (const e of leaf.editors) {
    if (e.id !== 'workbench.editors.webviewInput') continue;
    try { const v = JSON.parse(e.value); if (String(v.viewType).includes('claudeVSCodePanel')) { const st = v.state ? JSON.parse(v.state) : {}; if (st.sessionID && !tabs.has(st.sessionID)) tabs.set(st.sessionID, { title: v.title || '' }); } } catch { /* skip */ }
  }
  return { claude, editor, tabs, leaves };
}
function sessionLastActive(project, sid) {   // the transcript's mtime = last activity, identical on every machine
  for (const slug of [path.join(ROOTS.dev, project), path.join(ROOTS.dev, project).charAt(0).toLowerCase() + path.join(ROOTS.dev, project).slice(1)].map((x) => x.replace(/[^a-zA-Z0-9]/g, '-'))) {
    try { return Math.floor(fs.statSync(path.join(HOME, '.claude', 'projects', slug, sid + '.jsonl')).mtimeMs); } catch { /* next */ }
  }
  return 0;
}
function hostFile(host, project) { return path.join(VSCODE_HOSTS_DIR, host, project.replace(/[<>:"/\\|?*]/g, '_') + '.json'); }
function readCloseEvents(project, sinceMs) {
  const f = path.join(CLOSED_EVENTS_DIR, project.replace(/[<>:"/\\|?*]/g, '_') + '.jsonl');
  try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && Date.parse(e.at) > sinceMs); } catch { return []; }
}

async function exportVscodeState(state, force) {
  try {
    const sqlite = await loadSqlite(); if (!sqlite) return;
    state.tabs = state.tabs || {};
    let written = 0;
    for (const e of vscodeEntries()) {
      try {
        const raw = readDbKeys(sqlite, path.join(e.hashDir, 'state.vscdb'), [CLAUDE_KEY, EDITOR_KEY]);
        const parsed = parseTabs(raw);
        const st = state.tabs[e.project] || (state.tabs[e.project] = { open: {}, closed: {}, lastExportAt: 0 });
        const now = Date.now(), nowIso = new Date(now).toISOString();
        // tabs open here now: keep openedAt for tabs that were already open at the last export
        const open = {};
        for (const [sid, t] of parsed.tabs) open[sid] = { title: t.title, openedAt: (st.open[sid] && st.open[sid].openedAt) || nowIso, lastActiveAt: sessionLastActive(e.project, sid) };
        // explicit closes: gone from the db since the last export AND the companion saw a close of that title
        const events = readCloseEvents(e.project, st.lastExportAt || 0);
        for (const [sid, prev] of Object.entries(st.open)) {
          if (open[sid]) continue;
          const ev = events.find((x) => x.title === prev.title);
          if (ev) st.closed[sid] = { closedAt: ev.at, title: prev.title };
        }
        for (const [sid, c] of Object.entries(st.closed)) { if (now - Date.parse(c.closedAt) > 30 * 24 * 3600 * 1000) delete st.closed[sid]; if (open[sid] && Date.parse(open[sid].openedAt) > Date.parse(c.closedAt)) delete st.closed[sid]; }   // reopened here
        // a template tab entry so a host without any Claude tab can still add tabs to its layout
        let template = st.template || null;
        for (const leaf of parsed.leaves) for (const ed of leaf.editors) if (ed.id === 'workbench.editors.webviewInput' && ed.value.includes('claudeVSCodePanel')) { template = placeholderOut(ed.value); break; }
        const doc = { project: e.project, host: HOSTNAME, exportedAt: nowIso, tabs: open, closed: st.closed, template };
        const h = sha(JSON.stringify({ tabs: Object.fromEntries(Object.entries(open).map(([k, v]) => [k, v.title])), closed: st.closed }));
        st.open = open; st.lastExportAt = now; st.template = template;
        if (st.exportedHash === h && force !== e.project) continue;
        fs.mkdirSync(path.dirname(hostFile(HOSTNAME, e.project)), { recursive: true });
        fs.writeFileSync(hostFile(HOSTNAME, e.project), JSON.stringify(doc, null, 1));
        st.exportedHash = h; written++;
      } catch (err) { log('vscode-state export skipped for ' + e.project + ': ' + err.message.split('\n')[0]); }
    }
    // the old "newest wins" files must not be applied by anyone any more
    try { for (const f of fs.readdirSync(VSCODE_STATE_DIR)) if (f.endsWith('.json')) fs.unlinkSync(path.join(VSCODE_STATE_DIR, f)); } catch { /* none */ }
    if (written) log('vscode-state: exported open-chat tabs for ' + written + ' project(s)');
  } catch (err) { log('vscode-state export failed: ' + err.message); }
}

function mergedTarget(project) {   // union of every host's tabs minus tombstones -> { target: Map(sid->{title,openedAt,lastActiveAt,hosts}), closed: Map(sid->closedAt), hosts }
  const target = new Map(), closed = new Map(), hosts = [];
  let template = null;
  if (!fs.existsSync(VSCODE_HOSTS_DIR)) return { target, closed, hosts, template };
  for (const host of fs.readdirSync(VSCODE_HOSTS_DIR)) {
    let doc; try { doc = JSON.parse(fs.readFileSync(hostFile(host, project), 'utf8')); } catch { continue; }
    hosts.push(host);
    if (!template && doc.template) template = doc.template;
    for (const [sid, t] of Object.entries(doc.tabs || {})) { const cur = target.get(sid); if (!cur || Date.parse(t.openedAt) > Date.parse(cur.openedAt)) target.set(sid, { title: t.title, openedAt: t.openedAt, lastActiveAt: t.lastActiveAt || 0, hosts: [...((cur && cur.hosts) || []), host] }); else cur.hosts.push(host); }
    for (const [sid, c] of Object.entries(doc.closed || {})) { const cur = closed.get(sid); if (!cur || Date.parse(c.closedAt) > Date.parse(cur)) closed.set(sid, c.closedAt); }
  }
  for (const [sid, closedAt] of closed) { const t = target.get(sid); if (t && Date.parse(t.openedAt) <= Date.parse(closedAt)) target.delete(sid); }   // tombstone beats an older open
  return { target, closed, hosts, template };
}

async function importVscodeState(state, only) {
  try {
    const sqlite = await loadSqlite(); if (!sqlite) return;
    await exportVscodeState(state);   // this host's current tabs and, above all, its tombstones must be known BEFORE merging (or a just-closed tab comes straight back)
    if (!fs.existsSync(VSCODE_HOSTS_DIR)) return;
    const entries = vscodeEntries(); if (!entries.length) return;
    let open = null; const skippedOpen = [], heldSkip = [], neverOpened = [];
    const projects = new Set(); for (const host of fs.readdirSync(VSCODE_HOSTS_DIR)) { try { for (const f of fs.readdirSync(path.join(VSCODE_HOSTS_DIR, host))) if (f.endsWith('.json')) projects.add(f.slice(0, -5)); } catch { /* skip */ } }
    for (const projectSafe of projects) {
      const e = entries.find((x) => x.project.replace(/[<>:"/\\|?*]/g, '_') === projectSafe);
      if (!e) { neverOpened.push(projectSafe); continue; }
      if (only && e.project !== only) continue;
      try {
        const { target, closed, hosts, template } = mergedTarget(e.project);
        const dbPath = path.join(e.hashDir, 'state.vscdb');
        const raw = readDbKeys(sqlite, dbPath, [CLAUDE_KEY, EDITOR_KEY]);
        const local = parseTabs(raw);
        const adds = [...target].filter(([sid]) => !local.tabs.has(sid)).map(([sid, t]) => ({ sid, ...t })).sort((x, y) => (x.lastActiveAt || 0) - (y.lastActiveAt || 0));
        const removes = [...local.tabs.keys()].filter((sid) => closed.has(sid) && !target.has(sid));
        const pendingFile = path.join(PENDING_DIR, projectSafe + '.json');
        if (!adds.length && !removes.length) { try { fs.unlinkSync(pendingFile); } catch { /* none */ } continue; }
        const plan = { project: e.project, adds: adds.map((x) => ({ sid: x.sid, title: x.title, from: x.hosts, lastActiveAt: x.lastActiveAt || 0 })), removes: removes.map((sid) => ({ sid, title: (local.tabs.get(sid) || {}).title || '' })), hosts: hosts.filter((h) => h !== HOSTNAME), at: new Date().toISOString() };
        if (!open) open = vscodeOpenFolders();
        if (open.has(e.folder.toLowerCase())) { skippedOpen.push(e.project + ' (+' + adds.length + '/-' + removes.length + ')'); fs.mkdirSync(PENDING_DIR, { recursive: true }); fs.writeFileSync(pendingFile, JSON.stringify(plan)); continue; }   // the companion offers/does a reopen
        if (!(await waitDbWritable(dbPath, only ? 30000 : 0))) { heldSkip.push(e.project); fs.mkdirSync(PENDING_DIR, { recursive: true }); fs.writeFileSync(pendingFile, JSON.stringify(plan)); continue; }   // VS Code is running: the companion merges live when that window is open
        // -- apply (VS Code not running): keep the layout, remove tombstoned tabs, append the missing ones --
        const claude = local.claude;
        claude.panelTabSessions = (claude.panelTabSessions || []).filter((t) => !removes.includes(t.sessionId));
        claude.panelSessionIds = (claude.panelSessionIds || []).filter((sid) => !removes.includes(sid));
        for (const t of adds) { claude.panelTabSessions.push({ sessionId: t.sid, title: t.title }); if (!claude.panelSessionIds.includes(t.sid)) claude.panelSessionIds.push(t.sid); }
        let editorJson = raw[EDITOR_KEY];
        if (local.editor && local.leaves.length) {
          // remove tombstoned tabs from every group, fixing mru indices
          for (const leaf of local.leaves) {
            const keep = [], oldToNew = new Map();
            leaf.editors.forEach((ed, i) => { let drop = false; if (ed.id === 'workbench.editors.webviewInput') { try { const v = JSON.parse(ed.value); const st = v.state ? JSON.parse(v.state) : {}; drop = removes.includes(st.sessionID); } catch { /* keep */ } } if (!drop) { oldToNew.set(i, keep.length); keep.push(ed); } });
            leaf.editors = keep; leaf.mru = (leaf.mru || []).filter((i) => oldToNew.has(i)).map((i) => oldToNew.get(i));
          }
          // append additions to the group that holds the most Claude tabs (else the first group)
          const count = (leaf) => leaf.editors.filter((ed) => ed.id === 'workbench.editors.webviewInput' && ed.value.includes('claudeVSCodePanel')).length;
          const home = local.leaves.slice().sort((x, y) => count(y) - count(x))[0];
          let tpl = null; for (const leaf of local.leaves) for (const ed of leaf.editors) if (ed.id === 'workbench.editors.webviewInput' && ed.value.includes('claudeVSCodePanel')) { tpl = ed.value; break; }
          if (!tpl && template) tpl = placeholderIn(template);
          if (tpl) {
            for (const t of adds) {
              const v = JSON.parse(tpl); v.title = t.title; v.state = JSON.stringify({ isFullEditor: false, sessionID: t.sid }); v.group = home.id;
              home.editors.push({ id: 'workbench.editors.webviewInput', value: JSON.stringify(v) });
              home.mru = home.mru || []; home.mru.push(home.editors.length - 1);
            }
          } else log('vscode-state: ' + e.project + ': no tab template available yet; tabs added to the extension list only');
          editorJson = JSON.stringify(local.editor);
        }
        const bak = dbPath + '.vault-bak';
        if (!fs.existsSync(bak) || Date.now() - fs.statSync(bak).mtimeMs > 24 * 3600 * 1000) fs.copyFileSync(dbPath, bak);
        const d = new sqlite.DatabaseSync(dbPath);
        try { d.exec('BEGIN IMMEDIATE'); const up = d.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)'); up.run(CLAUDE_KEY, JSON.stringify(claude)); if (editorJson) up.run(EDITOR_KEY, editorJson); d.exec('COMMIT'); }
        catch (err) { try { d.exec('ROLLBACK'); } catch { /* ignore */ } throw err; } finally { d.close(); }
        await sleep(5000);
        const after = parseTabs(readDbKeys(sqlite, dbPath, [CLAUDE_KEY, EDITOR_KEY]));
        const ok = adds.every((t) => after.tabs.has(t.sid)) && removes.every((sid) => !after.tabs.has(sid));
        const unchanged = local.tabs.size - removes.length;
        if (ok) { try { fs.unlinkSync(pendingFile); } catch { /* none */ } log('vscode-state: merged ' + e.project + ': +' + adds.length + (adds.length ? ' from ' + [...new Set(adds.flatMap((x) => x.hosts))].join('+') : '') + ', -' + removes.length + ' closed, ' + unchanged + ' unchanged (verified 5 s later; shows on next window open)'); state.tabs = state.tabs || {}; if (state.tabs[e.project]) { for (const t of adds) state.tabs[e.project].open[t.sid] = { title: t.title, openedAt: t.openedAt, lastActiveAt: t.lastActiveAt }; for (const sid of removes) delete state.tabs[e.project].open[sid]; } }
        else log('vscode-state: merge into ' + e.project + ' was overwritten by VS Code within 5 s (window still alive); will retry');
      } catch (err) { log('vscode-state import skipped for ' + projectSafe + ': ' + err.message.split('\n')[0]); }
    }
    if (skippedOpen.length) log('vscode-state: window open here, merge plan written for the companion (merges live): ' + skippedOpen.join(', '));
    if (heldSkip.length) log('vscode-state: VS Code holds the storage of: ' + heldSkip.join(', ') + ' (VS Code is running); the companion merges live when the window is open, else on the next VS Code start');
    if (neverOpened.length && Date.now() - (state.vscodeNeverOpenedLoggedAt || 0) > 24 * 3600 * 1000) { state.vscodeNeverOpenedLoggedAt = Date.now(); log('vscode-state: never opened in VS Code on this machine, open the folder once then it merges: ' + neverOpened.join(', ')); }
  } catch (err) { log('vscode-state import failed: ' + err.message); }
}

// ----------------------------- companion extension (VS Code) -----------------------------
// companion/ in the vault repo is packaged into a .vsix here (a vsix is a zip) and installed with
// the code CLI whenever its version changes. It offers to reopen an OPEN window when the other
// machine changed that project's chats; the reopen itself is done by the watcher below.
const COMPANION_DIR = path.join(VAULT_DIR, 'companion');
function crc32(buf) { let c, crc = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xFFFFFFFF) >>> 0; }
function zip(entries) {   // minimal ZIP writer (deflate), enough for a vsix
  const locals = [], centrals = []; let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), comp = zlib.deflateRawSync(data), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp); centrals.push(ch, nameBuf); offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}
function buildCompanionVsix(pkg) {
  const files = fs.readdirSync(COMPANION_DIR).filter((f) => fs.statSync(path.join(COMPANION_DIR, f)).isFile());
  const manifest = '<?xml version="1.0" encoding="utf-8"?>\n<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">\n' +
    '  <Metadata>\n    <Identity Language="en-US" Id="' + pkg.name + '" Version="' + pkg.version + '" Publisher="' + pkg.publisher + '"/>\n    <DisplayName>' + pkg.displayName + '</DisplayName>\n    <Description xml:space="preserve">' + pkg.description + '</Description>\n    <Tags></Tags>\n    <Categories>Other</Categories>\n    <GalleryFlags>Public</GalleryFlags>\n' +
    '    <Properties>\n      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="' + pkg.engines.vscode + '"/>\n      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>\n      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>\n      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui,workspace"/>\n    </Properties>\n  </Metadata>\n' +
    '  <Installation>\n    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>\n  </Installation>\n  <Dependencies/>\n  <Assets>\n    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>\n  </Assets>\n</PackageManifest>\n';
  const types = '<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="json" ContentType="application/json"/>\n  <Default Extension="js" ContentType="application/javascript"/>\n  <Default Extension="vsixmanifest" ContentType="text/xml"/>\n  <Default Extension="md" ContentType="text/markdown"/>\n</Types>\n';
  const entries = [{ name: 'extension.vsixmanifest', data: Buffer.from(manifest) }, { name: '[Content_Types].xml', data: Buffer.from(types) }];
  for (const f of files) entries.push({ name: 'extension/' + f, data: fs.readFileSync(path.join(COMPANION_DIR, f)) });
  const out = path.join(LOCAL_DIR, pkg.name + '-' + pkg.version + '.vsix');
  fs.writeFileSync(out, zip(entries));
  return out;
}
function installCompanion(state) {
  try {
    if (!fs.existsSync(path.join(COMPANION_DIR, 'package.json')) || !which('code')) return;
    const pkg = JSON.parse(fs.readFileSync(path.join(COMPANION_DIR, 'package.json'), 'utf8'));
    const srcHash = sha(fs.readdirSync(COMPANION_DIR).sort().map((f) => f + ':' + sha(fs.readFileSync(path.join(COMPANION_DIR, f)))).join('|'));
    const key = pkg.version + '@' + srcHash;
    if (state.companionInstalled === key) return;
    // 'code --install-extension' can hang (13 min on <LAPTOP>): run it detached and never wait for it.
    // Success is verified on a later run through the extensions folder, without touching the code CLI.
    const extDir = path.join(HOME, '.vscode', 'extensions');
    const present = fs.existsSync(extDir) && fs.readdirSync(extDir).some((n) => n.toLowerCase().startsWith(('claude-vault.' + pkg.name + '-' + pkg.version).toLowerCase()));
    if (present && state.companionAttempt && state.companionAttempt.key === key) { state.companionInstalled = key; writeState(state); log('companion extension ' + pkg.version + ' is installed in VS Code (loads in windows opened from now on)'); return; }
    if (state.companionAttempt && state.companionAttempt.key === key && Date.now() - state.companionAttempt.at < 10 * 60 * 1000) return;   // installer still running, or VS Code was closed: check again later
    const vsix = buildCompanionVsix(pkg);
    spawn('cmd', ['/c', 'code', '--install-extension', vsix, '--force'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    state.companionAttempt = { key, at: Date.now() }; writeState(state);
    log('companion extension ' + pkg.version + ' install started in the background (verified on a later sync)');
  } catch (e) { log('companion install skipped: ' + e.message); }
}

// ----------------------------- reopen watcher -----------------------------
// The companion writes ~/.claude-vault/reopen/<project>.json and closes its window. This loop waits
// for the window to be gone, applies the other machine's chat state into state.vscdb for that one
// folder, and opens the folder again with the code CLI. One instance per machine; it exits by itself
// when vault.mjs changes on disk so the next sync restarts it on the new code.
const REOPEN_DIR = path.join(LOCAL_DIR, 'reopen');
const WATCH_PID = path.join(LOCAL_DIR, 'watch.pid');
function pidAlive(pid) { if (!pid) return false; const r = run(IS_WIN ? 'tasklist' : 'ps', IS_WIN ? ['/FI', 'PID eq ' + pid, '/NH'] : ['-p', String(pid)], { allowFail: true }); return IS_WIN ? /node\.exe/i.test(r.out) : r.code === 0; }
function ensureWatcher() {
  try {
    if (!IS_WIN || !fs.existsSync(path.join(VAULT_DIR, 'run-hidden.vbs')) || process.env.CLAUDE_VAULT_NO_WATCHER) return;
    let pid = 0; try { pid = Number(fs.readFileSync(WATCH_PID, 'utf8')); } catch { /* none */ }
    if (pidAlive(pid)) return;
    spawn('wscript.exe', [path.join(VAULT_DIR, 'run-hidden.vbs'), 'watch'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    log('reopen watcher started');
  } catch (e) { log('watcher start failed: ' + e.message); }
}
async function cmdWatch() {
  fs.mkdirSync(REOPEN_DIR, { recursive: true });
  let old = 0; try { old = Number(fs.readFileSync(WATCH_PID, 'utf8')); } catch { /* none */ }
  if (old && old !== process.pid && pidAlive(old)) return;            // one watcher is enough
  fs.writeFileSync(WATCH_PID, String(process.pid));
  const passphrase = readPassphrase();
  log('reopen watcher running (pid ' + process.pid + ')');
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    if (selfHash() !== RUNNING_HASH) { log('watcher: vault.mjs changed, exiting so the next sync restarts me'); try { fs.unlinkSync(WATCH_PID); } catch { /* ignore */ } return; }
    let markers = []; try { markers = fs.readdirSync(REOPEN_DIR).filter((n) => n.endsWith('.json')); } catch { continue; }
    for (const m of markers) {
      const mp = path.join(REOPEN_DIR, m);
      try {
        const req = JSON.parse(fs.readFileSync(mp, 'utf8'));
        const folderKey = String(req.folder).replace(/\\/g, '/').toLowerCase();
        log('watcher: reopen request for ' + req.project + ' (from ' + req.from + ', ' + req.how + '); waiting for the window to close');
        let closed = false;
        for (let i = 0; i < 180; i++) { if (!vscodeOpenFolders().has(folderKey)) { closed = true; break; } await new Promise((r) => setTimeout(r, 1000)); }
        if (!closed) { log('watcher: window for ' + req.project + ' still open after 3 min, giving up on this request (close it by hand; the state applies on the next pull)'); fs.unlinkSync(mp); continue; }
        await new Promise((r) => setTimeout(r, 1500));            // let VS Code finish flushing state.vscdb
        const state = readState();
        const keys = loadOrCreateSaltAndCheck(passphrase);
        if (keys) { await withLock(async () => { try { fetchRemote(); pullPhase(keys, readRemoteManifest(keys), state, { pullOnly: true }); } catch (e) { log('watcher: quick pull skipped: ' + e.message.split('\n')[0]); } }, 60000); }
        await importVscodeState(state, req.project);
        writeState(state);
        fs.unlinkSync(mp);
            spawn('cmd', ['/c', 'code', req.folder], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        log('watcher: reopened ' + req.project + ' with the chats from ' + req.from);
      } catch (e) { log('watcher: request ' + m + ' failed: ' + e.message.split('\n')[0]); try { fs.unlinkSync(mp); } catch { /* ignore */ } }
    }
  }
}


// ----------------------------- WIP lane: uncommitted / unpushed code follows you -----------------------------
// Project code used to reach the other machine only through GitHub (committed AND pushed). An agent
// halfway through an edit is the normal case, so every sync snapshots each C:\dev repo's work in
// progress as GIT OBJECTS (never as loose files: two trees on different commits would corrupt each
// other) into ~/.claude-vault/wip/<host>/<project>/ which rides the encrypted vault:
//   meta.json        branch, HEAD, upstream, porcelain status, diff --stat, contentHash, exportedAt
//   commits.bundle   unpushed commits (upstream..HEAD) + the 'git stash create' commit of tracked changes
//   untracked/**     untracked, non-ignored files, mirrored
// The other machine applies a snapshot only when its own tree is clean or still byte-identical to the
// last snapshot it applied from that host, has no unpushed commits the snapshot lacks, and no chat of
// that project is streaming. Before touching anything it saves its own state (stash create + stash push
// -u, logged to backup.log). Two edited trees are a CONFLICT, surfaced through the companion, never merged.
// Never reset --hard / clean / checkout -f on a project repo. Nothing here is pushed to GitHub.
const WIP_DIR = path.join(LOCAL_DIR, 'wip');
const WIP_MAX_BYTES = 200 * 1024 * 1024;
const wipHostDir = (host) => path.join(WIP_DIR, host);
const g = (dir, args, opts) => run('git', ['-C', dir, ...args], opts);
const gq = (dir, args) => { const r = g(dir, args, { allowFail: true }); return r.code === 0 ? r.out : ''; };
function wipRepos() {
  const dev = ROOTS.dev; if (!dev || !fs.existsSync(dev)) return [];
  return fs.readdirSync(dev, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(dev, e.name, '.git'))).map((e) => ({ name: e.name, dir: path.join(dev, e.name) }));
}
function projectStreaming(dir) {   // a transcript of this project written in the last 30 s
  for (const slug of [dir, dir.charAt(0).toLowerCase() + dir.slice(1)].map((x) => x.replace(/[^a-zA-Z0-9]/g, '-'))) {
    const d = path.join(HOME, '.claude', 'projects', slug);
    try { for (const f of fs.readdirSync(d)) if (f.endsWith('.jsonl') && Date.now() - fs.statSync(path.join(d, f)).mtimeMs < 30000) return true; } catch { /* none */ }
  }
  return false;
}
function runAsync(cmd, args, cwd) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    c.on('close', (code) => resolve({ code, out, err }));
  });
}
let statusCache = new Map();   // dir -> raw porcelain v2, valid for one sync run
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()); })); }
async function prefetchRepoStatus(repos, force) {
  const todo = repos.filter(({ dir }) => force || !statusCache.has(dir));
  await pool(todo, 6, async ({ dir }) => { const r = await runAsync('git', ['-C', dir, 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], dir); if (r.code === 0) statusCache.set(dir, r.out); else statusCache.delete(dir); });   // 6 at a time: a spinning disk thrashes with 26
}
function repoState(dir) {
  let raw = statusCache.get(dir);
  if (raw === undefined) { const r = g(dir, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], { raw: true, allowFail: true }); if (r.code !== 0) return null; raw = r.out; }
  let head = null, branch = null, upstream = null, ahead = 0, behind = 0;
  const entries = [];
  const parts = raw.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]; if (!e) continue;
    if (e.startsWith('# branch.oid ')) head = e.slice(13).trim();
    else if (e.startsWith('# branch.head ')) { const b = e.slice(14).trim(); branch = b === '(detached)' ? null : b; }
    else if (e.startsWith('# branch.upstream ')) upstream = e.slice(18).trim();
    else if (e.startsWith('# branch.ab ')) { const m = /\+(\d+) -(\d+)/.exec(e); if (m) { ahead = Number(m[1]); behind = Number(m[2]); } }
    else if (e.startsWith('1 ') || e.startsWith('2 ') || e.startsWith('u ')) {
      const f = e.split(' ');
      const xy = f[1].replace(/\./g, ' ');
      const fieldCount = e.startsWith('1 ') ? 8 : e.startsWith('2 ') ? 9 : 10;
      const file = f.slice(fieldCount).join(' ');
      entries.push({ xy, file });
      if (e.startsWith('2 ')) i++;   // rename/copy: the original path follows as its own token
    } else if (e.startsWith('? ')) entries.push({ xy: '??', file: e.slice(2) });
  }
  if (!head || head === '(initial)') return null;   // empty repo
  const status = entries.map((e) => e.xy + ' ' + e.file).sort().join('\n');
  const untracked = entries.filter((e) => e.xy === '??').map((e) => e.file);
  const changed = entries.filter((e) => e.xy !== '??').map((e) => e.file);
  const statOf = (f) => { try { const st = fs.statSync(path.join(dir, f)); return st.size + ':' + Math.floor(st.mtimeMs); } catch { return 'gone'; } };
  const fingerprint = sha([head, upstream || '', ahead, behind, status, ...[...changed, ...untracked].map((f) => f + '=' + statOf(f))].join('\n'));
  const st = { head, branch, upstream, ahead, behind, status, entries, untracked, changed, fingerprint, clean: entries.length === 0, pushed: !!upstream && ahead === 0 };
  Object.defineProperty(st, 'upstreamSha', { enumerable: true, get() { if (this._up === undefined) this._up = upstream ? (gq(dir, ['rev-parse', upstream]) || null) : null; return this._up; } });
  return st;
}
function contentHash(dir, st) {   // machine-independent identity of the work in progress
  const diff = g(dir, ['diff', 'HEAD', '--binary', '--no-color'], { allowFail: true }).out;
  const h = crypto.createHash('sha256').update(st.head + '\n' + st.status + '\n').update(diff);
  for (const f of st.untracked) { try { h.update(f + '\n').update(fs.readFileSync(path.join(dir, f))); } catch { h.update(f + '\n(unreadable)'); } }
  return h.digest('hex');
}
// True when checking out <target> would change nothing the user typed: no tracked modifications, and every
// untracked file is byte-identical (after git's clean filters) to the same path in <target>. Those untracked
// files are then removed so git can check the commit out over them (git refuses to overwrite untracked files
// even when identical). Used for the agentless fast-forward and for dropping applied WIP once it was pushed.
function prepareForCheckout(dir, target, st) {
  if (st.changed.length) return false;
  for (const f of st.untracked) {
    const inTarget = gq(dir, ['rev-parse', '--verify', '-q', target + ':' + f]);
    if (!inTarget) return false;
    const local = gq(dir, ['hash-object', '--path=' + f, '--', path.join(dir, f)]);
    if (!local || local !== inTarget) return false;
  }
  for (const f of st.untracked) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* gone */ } }
  return true;
}
function rmDir(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
function dirBytes(d) { let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, e.name); n += e.isDirectory() ? dirBytes(fp) : fs.statSync(fp).size; } } catch { /* none */ } return n; }
function wipLog(host, line) { try { fs.mkdirSync(wipHostDir(host), { recursive: true }); fs.appendFileSync(path.join(wipHostDir(host), 'backup.log'), '[' + new Date().toISOString() + '] ' + line + '\n'); } catch { /* ignore */ } }

async function wipExport(state) {
  try {
    state.wip = state.wip || { exp: {}, app: {}, fetched: {} };
    const host = HOSTNAME; let exported = 0;
    const repos = wipRepos();
    await prefetchRepoStatus(repos);   // reuses what the import step fetched a moment ago; only repos it touched are re-read
    for (const { name, dir } of repos) {
      try {
        const st = repoState(dir); if (!st) continue;
        const exp = (state.wip.exp[name] && typeof state.wip.exp[name] === 'object') ? state.wip.exp[name] : { fp: null, hashes: [] };
        if (exp.fp === st.fingerprint) continue;                               // nothing changed since the last snapshot
        const out = path.join(wipHostDir(host), name); fs.mkdirSync(out, { recursive: true });
        const bundle = path.join(out, 'commits.bundle'), untrackedDir = path.join(out, 'untracked');
        const pushed = st.pushed;
        const meta = { project: name, host, exportedAt: new Date().toISOString(), branch: st.branch, head: st.head, upstream: st.upstream, upstreamSha: st.upstreamSha, status: st.status, untracked: st.untracked, clean: st.clean && pushed,
          basedOn: (state.wip.app[name] && state.wip.app[name].fromHash) || null };   // the other machine's snapshot this tree continues from (if any)
        if (meta.clean) { try { fs.unlinkSync(bundle); } catch { /* none */ } rmDir(untrackedDir); meta.contentHash = contentHash(dir, st); }
        else {
          meta.diffStat = gq(dir, ['diff', 'HEAD', '--stat']);
          meta.stash = gq(dir, ['stash', 'create']) || null;               // tracked changes as a commit; index + tree untouched
          const basis = (st.upstreamSha && gq(dir, ['merge-base', 'HEAD', st.upstreamSha])) || ['origin/HEAD', 'origin/main', 'origin/master', 'origin/dev'].map((r) => gq(dir, ['merge-base', 'HEAD', r])).find(Boolean) || null;
          const needBundle = !!meta.stash || !basis || st.head !== basis;
          if (needBundle) {
            g(dir, ['update-ref', 'refs/claude-vault/head', st.head]);
            const refs = ['refs/claude-vault/head'];
            if (meta.stash) { g(dir, ['update-ref', 'refs/claude-vault/stash', meta.stash]); refs.push('refs/claude-vault/stash'); }
            const r = g(dir, ['bundle', 'create', bundle, ...refs, ...(basis ? ['^' + basis] : [])], { allowFail: true });
            g(dir, ['update-ref', '-d', 'refs/claude-vault/head'], { allowFail: true }); g(dir, ['update-ref', '-d', 'refs/claude-vault/stash'], { allowFail: true });
            if (r.code !== 0) { log('wip: ' + name + ' bundle failed: ' + r.err.split('\n')[0]); try { fs.unlinkSync(bundle); } catch { /* none */ } }
            else meta.hasBundle = true;
          } else { try { fs.unlinkSync(bundle); } catch { /* none */ } }
          // mirror untracked files (copy only changed ones, drop stale ones)
          const keep = new Set(st.untracked);
          const walkRm = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r2 = rel ? rel + '/' + e.name : e.name; const fp = path.join(d, e.name); if (e.isDirectory()) { walkRm(fp, r2); try { fs.rmdirSync(fp); } catch { /* not empty */ } } else if (!keep.has(r2)) fs.unlinkSync(fp); } };
          if (fs.existsSync(untrackedDir)) walkRm(untrackedDir, '');
          for (const f of st.untracked) {
            const src = path.join(dir, f), dst = path.join(untrackedDir, f);
            try { const ss = fs.statSync(src); let ds = null; try { ds = fs.statSync(dst); } catch { /* new */ }
              if (!ds || ds.size !== ss.size || Math.floor(ds.mtimeMs) !== Math.floor(ss.mtimeMs)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); fs.utimesSync(dst, ss.atime, ss.mtime); } } catch { /* vanished mid-way: next snapshot */ }
          }
          const size = (fs.existsSync(bundle) ? fs.statSync(bundle).size : 0) + dirBytes(untrackedDir);
          if (size > WIP_MAX_BYTES) { try { fs.unlinkSync(bundle); } catch { /* none */ } rmDir(untrackedDir); meta.hasBundle = false; meta.tooLarge = size; log('wip: ' + name + ' snapshot too large, skipped (' + (size / 1048576).toFixed(0) + ' MB); metadata only'); }
          meta.contentHash = contentHash(dir, st);
        }
        fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(meta, null, 1));
        exp.fp = st.fingerprint; exp.hashes = [...(exp.hashes || []).filter((h) => h !== meta.contentHash), meta.contentHash].slice(-30);
        state.wip.exp[name] = exp; exported++;
        log('wip: exported ' + name + (meta.clean ? ' (clean, all pushed)' : ' (' + st.changed.length + ' changed, ' + st.untracked.length + ' untracked' + (meta.hasBundle ? ', bundle' : '') + ')'));
      } catch (e) { log('wip: export of ' + name + ' failed: ' + e.message.split('\n')[0]); }
    }
    return exported;
  } catch (e) { log('wip export failed: ' + e.message); }
}

function wipStatusWrite(host, project, entry) {   // read by the companion (toast)
  try { const f = path.join(wipHostDir(host), 'status.json'); let cur = {}; try { cur = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* none */ } if (entry) cur[project] = entry; else delete cur[project]; fs.mkdirSync(wipHostDir(host), { recursive: true }); fs.writeFileSync(f, JSON.stringify(cur, null, 1)); } catch { /* ignore */ }
}

async function wipImport(state) {
  try {
    state.wip = state.wip || { exp: {}, app: {}, fetched: {} };
    const me = HOSTNAME;
    if (!fs.existsSync(WIP_DIR)) return;
    const repoList = wipRepos();
    const repos = Object.fromEntries(repoList.map((r) => [r.name, r.dir]));
    statusCache = new Map(); await prefetchRepoStatus(repoList, true);   // one parallel batch per sync, shared with the export
    const hosts = fs.readdirSync(WIP_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== me).map((e) => e.name);
    for (const host of hosts) {
      for (const project of fs.readdirSync(wipHostDir(host), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
        const dir = repos[project]; if (!dir) continue;                                 // not cloned yet: the clone lane will bring it
        let meta; try { meta = JSON.parse(fs.readFileSync(path.join(wipHostDir(host), project, 'meta.json'), 'utf8')); } catch { continue; }
        if (!meta.contentHash) continue;
        const rec = state.wip.app[project] || {};
        if (rec.from === host && rec.fromHash === meta.contentHash) continue;       // already applied this exact snapshot
        try {
          if (projectStreaming(dir)) { continue; }                                      // a chat of this project is running here
          const lst = repoState(dir); if (!lst) continue;
          const localHash = contentHash(dir, lst);
          if (meta.contentHash === localHash) { state.wip.app[project] = { from: host, fromHash: meta.contentHash, appliedLocalHash: localHash, at: new Date().toISOString(), untracked: meta.untracked }; wipStatusWrite(me, project, null); continue; }   // mirror of what we have
          const myHashes = (state.wip.exp[project] && state.wip.exp[project].hashes) || [];
          if (myHashes.includes(meta.contentHash)) { state.wip.app[project] = { ...rec, from: host, fromHash: meta.contentHash }; wipStatusWrite(me, project, null); continue; }   // a stale mirror of a state this machine had: nothing to do
          const identical = (!!rec.appliedLocalHash && localHash === rec.appliedLocalHash) || (!!meta.basedOn && meta.basedOn === localHash);   // our tree is exactly what their work continues from
          const snapUntracked = path.join(wipHostDir(host), project, 'untracked');
          const sameAsSnapshot = (f) => { try { return fs.readFileSync(path.join(dir, f)).equals(fs.readFileSync(path.join(snapUntracked, f))); } catch { return false; } };
          if (meta.clean) {                                                               // exporter committed+pushed: drop our applied WIP only if the commit contains exactly what we have
            if (rec.from !== host) continue;
            if (!identical && !prepareForCheckout(dir, meta.head, lst)) { if (g(dir, ['cat-file', '-e', meta.head + '^{commit}'], { allowFail: true }).code !== 0) g(dir, ['fetch', '-q', 'origin'], { allowFail: true }); if (!prepareForCheckout(dir, meta.head, lst)) continue; }
          } else if (!lst.clean && !identical) {                                          // two edited trees: a conflict, the user decides
            const files = [...lst.changed, ...lst.untracked.filter((f) => !sameAsSnapshot(f))];
            const entry = { diverged: true, from: host, at: new Date().toISOString(), files: files.slice(0, 40), exportedAt: meta.exportedAt };
            if (!rec.divergedHash || rec.divergedHash !== meta.contentHash + localHash) { log('wip: ' + project + ' diverged (local changes on this machine), not applying; files: ' + entry.files.slice(0, 8).join(', ') + (entry.files.length > 8 ? ', ...' : '')); rec.divergedHash = meta.contentHash + localHash; state.wip.app[project] = rec; }
            wipStatusWrite(me, project, entry);
            continue;
          }
          if (meta.tooLarge) { log('wip: ' + project + ' snapshot from ' + host + ' was too large to transport (' + (meta.tooLarge / 1048576).toFixed(0) + ' MB); not applying'); continue; }
          // -- apply -- (objects first: fetch + unbundle change nothing in the tree; then ancestry; only then save + switch)
          const t0 = Date.now(); const age = Math.round((Date.now() - Date.parse(meta.exportedAt)) / 1000);
          g(dir, ['fetch', '-q', 'origin'], { allowFail: true }); state.wip.fetched[project] = Date.now();
          const bundle = path.join(wipHostDir(host), project, 'commits.bundle');
          if (meta.hasBundle && fs.existsSync(bundle)) { const r = g(dir, ['bundle', 'unbundle', bundle], { allowFail: true }); if (r.code !== 0) log('wip: ' + project + ' unbundle: ' + r.err.split('\n')[0]); }
          if (g(dir, ['cat-file', '-e', meta.head + '^{commit}'], { allowFail: true }).code !== 0) { if (rec.missingHead !== meta.head) { log('wip: ' + project + ' HEAD ' + meta.head.slice(0, 8) + ' from ' + host + ' is not available here (bundle missing?); not applying'); rec.missingHead = meta.head; state.wip.app[project] = rec; } continue; }
          if (lst.head !== meta.head && g(dir, ['merge-base', '--is-ancestor', lst.head, meta.head], { allowFail: true }).code !== 0) {
            // the snapshot does not build on our HEAD
            const behind = g(dir, ['merge-base', '--is-ancestor', meta.head, lst.head], { allowFail: true }).code === 0;   // their HEAD is our past: stale snapshot
            const localPushed = !!lst.upstreamSha && (lst.head === lst.upstreamSha || g(dir, ['merge-base', '--is-ancestor', lst.head, lst.upstreamSha], { allowFail: true }).code === 0);
            const switchOk = !behind && lst.clean && localPushed;                     // a different branch, and nothing here that is not on origin: switching loses nothing
            if (!switchOk) {
              const key = meta.contentHash + lst.head;
              if (rec.behindHash !== key) { log('wip: ' + project + ' snapshot from ' + host + ' (HEAD ' + meta.head.slice(0, 8) + ', ' + (meta.branch || 'detached') + ') ' + (behind ? 'is behind this machine\'s HEAD ' + lst.head.slice(0, 8) + ' (stale); not applying' : 'is on a different history than this machine\'s ' + (lst.branch || 'detached') + ' ' + lst.head.slice(0, 8) + ' which has ' + (lst.clean ? 'unpushed commits' : 'local changes') + '; not applying')); rec.behindHash = key; state.wip.app[project] = rec; }
              wipStatusWrite(me, project, null);
              continue;
            }
            log('wip: ' + project + ' switching from ' + (lst.branch || 'detached') + ' ' + lst.head.slice(0, 8) + ' (clean, all on origin) to ' + host + '\'s ' + (meta.branch || 'detached') + ' ' + meta.head.slice(0, 8));
          }
          const lst2 = repoState(dir);   // prepareForCheckout may have removed untracked duplicates
          const backup = lst2.clean ? null : (gq(dir, ['stash', 'create']) || null);
          wipLog(me, 'pre-apply ' + project + ' branch=' + (lst.branch || 'detached') + ' head=' + lst.head + (backup ? ' stash=' + backup : ' (clean)') + ' before applying ' + host + ' snapshot ' + meta.contentHash.slice(0, 12));
          if (!lst2.clean) { const r = g(dir, ['stash', 'push', '-u', '-m', 'claude-vault pre-apply ' + new Date().toISOString()], { allowFail: true }); if (r.code !== 0) { log('wip: ' + project + ' could not save local state, not applying: ' + r.err.split('\n')[0]); continue; } }
          if (meta.branch) { g(dir, ['checkout', '-q', '-B', meta.branch, meta.head]); if (meta.upstream) g(dir, ['branch', '-q', '--set-upstream-to=' + meta.upstream], { allowFail: true }); }
          else g(dir, ['checkout', '-q', '--detach', meta.head]);
          if (meta.stash) { if (g(dir, ['stash', 'apply', '--index', meta.stash], { allowFail: true }).code !== 0) { const r = g(dir, ['stash', 'apply', meta.stash], { allowFail: true }); if (r.code !== 0) log('wip: ' + project + ' stash apply: ' + r.err.split('\n')[0]); } }
          // untracked: mirror in, remove files we placed last time that the snapshot no longer has
          const untrackedDir = path.join(wipHostDir(host), project, 'untracked');
          for (const f of meta.untracked || []) { const src = path.join(untrackedDir, f), dst = path.join(dir, f); try { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); const ss = fs.statSync(src); fs.utimesSync(dst, ss.atime, ss.mtime); } catch { /* missing in snapshot */ } }
          for (const f of rec.untracked || []) if (!(meta.untracked || []).includes(f) && g(dir, ['ls-files', '--error-unmatch', '--', f], { allowFail: true }).code !== 0) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* gone */ } }
          // verify
          statusCache.delete(dir);
          const nst = repoState(dir); const nh = nst ? contentHash(dir, nst) : null;
          if (nh === meta.contentHash) {
            state.wip.app[project] = { from: host, fromHash: meta.contentHash, appliedLocalHash: nh, at: new Date().toISOString(), untracked: meta.untracked };
            wipStatusWrite(me, project, null);
            log('wip: applied ' + project + ' from ' + host + ', snapshot ' + age + 's old, verified' + (meta.clean ? ' (clean: WIP state dropped, at ' + meta.head.slice(0, 8) + ')' : '') + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
          } else {
            const want = meta.status.split('\n').filter(Boolean), got = (nst ? nst.status : '').split('\n').filter(Boolean);
            log('wip: ' + project + ' applied from ' + host + ' but verification differs; expected status ' + want.length + ' entries, got ' + got.length + '; missing: ' + want.filter((x) => !got.includes(x)).slice(0, 5).join(' | ') + '; extra: ' + got.filter((x) => !want.includes(x)).slice(0, 5).join(' | ') + '. Rolling back.');
            g(dir, ['stash', 'push', '-u', '-q', '-m', 'claude-vault failed-apply ' + new Date().toISOString()], { allowFail: true });
            if (lst.branch) g(dir, ['checkout', '-q', '-B', lst.branch, lst.head], { allowFail: true }); else g(dir, ['checkout', '-q', '--detach', lst.head], { allowFail: true });
            if (!lst2.clean) g(dir, ['stash', 'pop', '-q', 'stash@{1}'], { allowFail: true });
            wipLog(me, 'rolled back ' + project + ' to ' + lst.head + '; the failed apply is kept as the newest stash entry');
            rec.divergedHash = meta.contentHash + localHash; state.wip.app[project] = rec;
          }
        } catch (e) { log('wip: applying ' + project + ' from ' + host + ' failed: ' + e.message.split('\n')[0]); }
      }
    }
    // return to normal for clean repos that are simply behind origin (agentless fast-forward): fetch every 30 min, in parallel
    const due = Object.entries(repos).filter(([name, dir]) => Date.now() - (state.wip.fetched[name] || 0) >= 30 * 60 * 1000 && (() => { const st = repoState(dir); return st && st.upstream && st.branch && !st.changed.length && !projectStreaming(dir); })());
    await pool(due, 4, async ([name, dir]) => { await runAsync('git', ['-C', dir, 'fetch', '-q', 'origin'], dir); state.wip.fetched[name] = Date.now(); statusCache.delete(dir); });
    for (const [name, dir] of due) {
      try {
        const st = repoState(dir); if (!st || !st.upstream || !st.branch || st.changed.length) continue;   // tracked edits: not ours to touch
        const up = gq(dir, ['rev-parse', '@{u}']); if (!up || up === st.head) continue;
        if (g(dir, ['merge-base', '--is-ancestor', st.head, up], { allowFail: true }).code !== 0) continue;   // local commits ahead: not ours to touch
        if (!st.clean && !prepareForCheckout(dir, up, st)) continue;                                        // untracked files that are not in the commit: leave it
        const r = g(dir, ['merge', '-q', '--ff-only', '@{u}'], { allowFail: true });
        log('wip: ' + name + (r.code === 0 ? ' fast-forwarded ' + st.head.slice(0, 8) + ' -> ' + up.slice(0, 8) + ' (committed work from GitHub)' : ' fast-forward failed: ' + r.err.split('\n')[0]));
      } catch (e) { log('wip: ff check for ' + name + ' failed: ' + e.message.split('\n')[0]); }
    }
  } catch (e) { log('wip import failed: ' + e.message); }
}


// ----------------------------- forget: retire a project folder on every machine -----------------------------
// repos.json is a union that never shrinks, so deleting a folder only makes the clone lane bring it back.
// 'node vault.mjs forget "<folder>"' writes a synced tombstone; every machine then removes the folder to the
// Recycle Bin, but ONLY if it has no uncommitted changes, no unpushed commits, no stashes and no running chat.
// Any .env* in it is copied to ~/.claude-vault/retired/<folder>/ first. Chats are never touched.
// 'node vault.mjs forget --undo "<folder>"' lifts the tombstone (nothing is restored automatically).
const RETIRED_FILE = path.join(LOCAL_DIR, 'retired.json');
const RETIRED_DIR = path.join(LOCAL_DIR, 'retired');
function readTombstones() { try { return JSON.parse(fs.readFileSync(RETIRED_FILE, 'utf8')); } catch { return {}; } }
function isRetired(name) { const t = readTombstones()[name]; return !!t && !t.undone; }
function writeTombstone(name, entry) {
  const t = readTombstones(); t[name] = entry;
  fs.mkdirSync(LOCAL_DIR, { recursive: true }); fs.writeFileSync(RETIRED_FILE, JSON.stringify(t, null, 1));
}
function mergeTombstones(remoteFile) {   // newest entry per folder wins (a later --undo beats an earlier forget and vice versa)
  try {
    const mine = readTombstones(), theirs = JSON.parse(fs.readFileSync(remoteFile, 'utf8'));
    let changed = false;
    for (const [k, v] of Object.entries(theirs)) if (!mine[k] || Date.parse(v.at) > Date.parse(mine[k].at)) { mine[k] = v; changed = true; }
    if (changed) fs.writeFileSync(RETIRED_FILE, JSON.stringify(mine, null, 1));
  } catch { /* ignore */ }
}
function retireCheck(dir) {   // null = safe to remove; otherwise the reason
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  const st = repoState(dir);
  if (st && !st.clean) return 'uncommitted changes: ' + [...st.changed, ...st.untracked].slice(0, 5).join(', ');
  const unpushed = gq(dir, ['log', '--oneline', '--branches', '--not', '--remotes']).split(/\r?\n/).filter(Boolean);
  if (unpushed.length) return unpushed.length + ' unpushed commit(s): ' + unpushed[0];
  const stashes = gq(dir, ['stash', 'list']).split(/\r?\n/).filter(Boolean);
  if (stashes.length) return stashes.length + ' stash entr' + (stashes.length === 1 ? 'y' : 'ies');
  if (projectStreaming(dir)) return 'a Claude chat of this project is running';
  return null;
}
function recycle(dir) {   // Windows Recycle Bin (recoverable by the user); throws if it cannot
  const ps = "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('" + dir.replace(/'/g, "''") + "', 'OnlyErrorDialogs', 'SendToRecycleBin')";
  const r = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { allowFail: true });
  if (r.code !== 0 || fs.existsSync(dir)) throw new Error((r.err || r.out || 'recycle failed').split('\n')[0]);
}
function applyTombstones(state) {
  try {
    const dev = ROOTS.dev; if (!dev) return;
    const me = HOSTNAME;
    state.retired = state.retired || {};
    for (const [name, t] of Object.entries(readTombstones())) {
      if (t.undone) { if (state.retired[name]) { delete state.retired[name]; wipStatusWrite(me, name, null); } continue; }
      const dir = path.join(dev, name);
      if (!fs.existsSync(dir)) { state.retired[name] = { done: true, at: t.at }; continue; }
      if (state.retired[name] && state.retired[name].refusedFor && Date.now() - state.retired[name].checkedAt < 10 * 60 * 1000) continue;   // re-check every 10 min, not every sync
      const why = retireCheck(dir);
      if (why) {
        if (!state.retired[name] || state.retired[name].refusedFor !== why) { log('forget: NOT removing ' + name + ' on this machine: ' + why + ' (resolve, then it goes on the next check)'); wipStatusWrite(me, name, { retireRefused: true, why, at: new Date().toISOString(), by: t.by }); }
        state.retired[name] = { refusedFor: why, checkedAt: Date.now() };
        continue;
      }
      // keep any env file (they are ignored by git, so the Recycle Bin copy is the only other place they exist)
      const envs = [];
      walk(dir, (f) => { if (/^\.env(\..*)?$/.test(path.basename(f)) && !/\.example$/.test(f)) envs.push(f); }, { baseDepth: dir.split(path.sep).length, maxDepth: 4 });
      for (const f of envs) { const dst = path.join(RETIRED_DIR, name, path.relative(dir, f)); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(f, dst); }
      try { recycle(dir); } catch (e) { log('forget: could not move ' + name + ' to the Recycle Bin: ' + e.message + '; left in place'); state.retired[name] = { refusedFor: 'recycle failed: ' + e.message, checkedAt: Date.now() }; continue; }
      state.retired[name] = { done: true, at: new Date().toISOString() };
      wipStatusWrite(me, name, null);
      log('forget: ' + name + ' moved to the Recycle Bin on this machine (clean, pushed, no stashes' + (envs.length ? '; ' + envs.length + ' env file(s) kept in ' + path.join(RETIRED_DIR, name) : '') + ')');
    }
  } catch (e) { log('forget check failed: ' + e.message); }
}
function cmdForget(argv) {
  const undo = argv.includes('--undo');
  const name = argv.filter((a) => a !== '--undo').join(' ').trim();
  if (!name) die('usage: vault.mjs forget "<folder name>"  |  vault.mjs forget --undo "<folder name>"');
  if (undo) { writeTombstone(name, { at: new Date().toISOString(), by: HOSTNAME, undone: true }); console.log('tombstone lifted for ' + name + '; nothing is restored automatically (Recycle Bin, or clone it again)'); return; }
  const dir = path.join(ROOTS.dev, name);
  const why = fs.existsSync(dir) ? retireCheck(dir) : null;
  writeTombstone(name, { at: new Date().toISOString(), by: HOSTNAME });
  // drop it from the repo list right away so no machine clones it back
  try { const list = JSON.parse(fs.readFileSync(REPOS_FILE, 'utf8')).filter((r) => r.name !== name); fs.writeFileSync(REPOS_FILE, JSON.stringify(list, null, 1)); } catch { /* none */ }
  console.log('tombstone written for ' + name + (why ? '; this machine will NOT remove it yet: ' + why : '') + '. Every machine removes its copy (Recycle Bin) once clean, pushed and stash-free; env files are kept in ' + RETIRED_DIR + '. Runs on the next sync.');
}

// ----------------------------- state + manifest -----------------------------
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { files: {}, lastGc: 0 }; } }
function writeState(s) { fs.mkdirSync(LOCAL_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s)); }
function readRemoteManifest(keys) {
  const p = path.join(VAULT_DIR, 'manifest.enc');
  if (!fs.existsSync(p)) return { files: {} };
  try { return JSON.parse(decryptBlob(keys, fs.readFileSync(p)).toString('utf8')); }
  catch { die('Cannot decrypt the vault manifest: wrong passphrase, or the repo is corrupt.'); }
}
function chunkFile(keys, real) {
  const ids = []; let written = 0;
  const fd = fs.openSync(real, 'r');
  try {
    const buf = Buffer.allocUnsafe(CHUNK_SIZE);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK_SIZE, null);
      if (n === 0) break;
      const { id, ct } = encryptChunk(keys, buf.subarray(0, n));
      const p = chunkPath(id);
      if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ct); written += ct.length; }
      ids.push(id);
      if (n < CHUNK_SIZE) break;
    }
  } finally { fs.closeSync(fd); }
  if (ids.length === 0) { const { id, ct } = encryptChunk(keys, Buffer.alloc(0)); const p = chunkPath(id); if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ct); written += ct.length; } ids.push(id); }
  return { ids, written };
}
function readChunk(id) {   // working tree first; else the object from the fetched remote commit (repairs the tree as a side effect)
  const p = chunkPath(id);
  try { return fs.readFileSync(p); } catch { /* missing on disk */ }
  const r = run('git', ['show', 'FETCH_HEAD:' + chunkRel(id)], { allowFail: true, binary: true });
  if (r.code === 0 && r.out.length) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, r.out); log('chunk ' + id.slice(0, 12) + ' was missing on disk, restored from the remote commit'); return r.out; }
  throw new Error('chunk ' + id.slice(0, 12) + ' is missing on disk and on the remote');
}
function restoreFile(keys, vpath, entry) {
  const real = toReal(vpath);
  fs.mkdirSync(path.dirname(real), { recursive: true });
  const tmp = real + '.vault-tmp';
  const fd = fs.openSync(tmp, 'w');
  try { for (const id of entry.chunks) fs.writeSync(fd, decryptChunk(keys, id, readChunk(id))); } catch (e) { fs.closeSync(fd); try { fs.unlinkSync(tmp); } catch { /* none */ } throw e; }
  fs.closeSync(fd);
  fs.renameSync(tmp, real);
  fs.utimesSync(real, new Date(entry.mtime), new Date(entry.mtime));
}

// ----------------------------- git plumbing -----------------------------
class RestartWithNewCode extends Error {}
const SELF = fileURLToPath(import.meta.url);
const selfHash = () => crypto.createHash('sha256').update(fs.readFileSync(SELF)).digest('hex');
const RUNNING_HASH = selfHash();
const TOOL_FILES = ['vault.mjs', 'vault.config.json', 'setup.cmd', 'run-hidden.vbs', 'README.md', 'NEW-COMPUTER.md', 'companion'];
function fetchRemote() {
  const r = git(['fetch', '-q', 'origin', BRANCH], { allowFail: true });
  if (r.code !== 0) { if (/couldn't find remote ref|Could not find remote branch/i.test(r.err)) return null; throw new Error('git fetch failed: ' + r.err); }
  const sha = git(['rev-parse', 'FETCH_HEAD']).out;
  // keep locally edited tool files across the reset (an edit here = a tool update for every machine)
  const edited = [...new Set([...git(['diff', '--name-only', 'HEAD', '--', ...TOOL_FILES], { allowFail: true }).out.split(/\r?\n/), ...git(['ls-files', '--others', '--exclude-standard', '--', ...TOOL_FILES]).out.split(/\r?\n/)].map((l) => l.trim()).filter(Boolean))];
  const saved = new Map(edited.filter((f) => fs.existsSync(path.join(VAULT_DIR, f))).map((f) => [f, fs.readFileSync(path.join(VAULT_DIR, f))]));
  git(['reset', '-q', '--hard', 'FETCH_HEAD']);      // working tree is derived data; remote is the truth for the repo files
  for (const [f, buf] of saved) fs.writeFileSync(path.join(VAULT_DIR, f), buf);
  if (saved.size) log('keeping local tool edits: ' + [...saved.keys()].join(', '));
  if (selfHash() !== RUNNING_HASH) throw new RestartWithNewCode('vault.mjs was updated from the remote');
  return sha;
}
function headSha() { const r = git(['rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true }); return r.code === 0 ? r.out : null; }
function pushRef(sha, lease) {
  // lease = the remote sha we believe is current; null = the branch does not exist yet
  const args = ['push', '-q', 'origin', sha + ':refs/heads/' + BRANCH];
  if (lease) args.push('--force-with-lease=refs/heads/' + BRANCH + ':' + lease);
  git(args);
}
function commitTree(tree, parent, msg) { return git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', msg]).out; }

// Snapshot commits are CHILDREN of the remote commit so a push sends only the delta. An orphan
// commit shares no ancestry, and git then re-sends the entire tree (measured: 1.43 GB per push).
const chunkRel = (id) => 'chunks/' + id.slice(0, 2) + '/' + id;
function toolPaths() {
  const out = [];
  for (const t of TOOL_FILES) { const fp = path.join(VAULT_DIR, t); if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) { for (const f of fs.readdirSync(fp)) out.push(t + '/' + f); } else out.push(t); }
  return out;
}
// Stage only what this run touched: git no longer walks 20k chunk files (32 s on <LAPTOP>).
function stageChanges(ctx) {
  if (!headSha()) { git(['add', '-A']); return; }
  // Chunk files left behind by an interrupted run are untracked yet count as "present" for the manifest; they must
  // be committed too or another machine's manifest points at a chunk that is not in the tree (<LAPTOP> FATAL, 2026-09-29).
  const leftovers = git(['ls-files', '--others', '--exclude-standard', '-z', 'chunks'], { raw: true }).out.split('\0').filter(Boolean);
  if (leftovers.length) log('staging ' + leftovers.length + ' chunk file(s) left untracked by an earlier interrupted run');
  const paths = [...ctx.newChunkIds.map(chunkRel), ...ctx.removedChunkIds.map(chunkRel), ...leftovers, 'manifest.enc', 'vault.salt', 'vault.check', '.gitattributes', SQUASH_LOCK, ...toolPaths()];
  git(['update-index', '--add', '--remove', '-z', '--stdin'], { input: paths.join('\0') + '\0' });
}
// Manifest merge for a lost push race: newest entry per file; a file missing on one side is a deletion only if
// that side still had the unchanged pre-race version. Chats are never dropped.
function mergeManifests(oldFiles, ours, theirs) {
  const same = (x, y) => !!x && !!y && x.mtime === y.mtime && x.size === y.size && JSON.stringify(x.chunks) === JSON.stringify(y.chunks);
  const out = {};
  for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const o = oldFiles[k], a = ours[k], b = theirs[k];
    if (a && b) out[k] = b.mtime > a.mtime ? b : a;
    else if (a && !b) { if (same(o, a) && !isProtected(k)) continue; out[k] = a; }   // they deleted it (we had the unchanged old version)
    else if (!a && b) { if (same(o, b) && !isProtected(k)) continue; out[k] = b; }   // we deleted it
  }
  return out;
}
// Lost the lease: do NOT redo the sync. Re-fetch, build our snapshot on top of THEIR new commit (their tree +
// our delta + the merged manifest) in a temporary index, push again. Up to 6 quick attempts.
function mergeOnTopOfRemote(ctx, ourCommit, oldRemoteSha, lease) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const r = git(['fetch', '-q', 'origin', BRANCH], { allowFail: true }); if (r.code !== 0) throw new Error('fetch during merge failed: ' + r.err);
    const theirs = git(['rev-parse', 'FETCH_HEAD']).out;
    if (theirs === lease) { try { pushRef(ourCommit, lease); return { sha: ourCommit }; } catch { continue; } }   // transient rejection
    const theirManifest = JSON.parse(decryptBlob(ctx.keys, git(['show', theirs + ':manifest.enc'], { binary: true }).out).toString('utf8'));
    const merged = { version: 1, generatedAt: new Date().toISOString(), machine: HOSTNAME, files: mergeManifests(ctx.oldManifest, ctx.manifest.files, theirManifest.files) };
    const referenced = new Set(Object.values(merged.files).flatMap((e) => e.chunks));
    const idx = path.join(VAULT_DIR, '.git', 'vault-merge-index'); try { fs.unlinkSync(idx); } catch { /* none */ }
    const gi = (args, opts) => run('git', args, { ...(opts || {}), env: undefined, cwd: VAULT_DIR, ...{ } });
    const envIdx = { GIT_INDEX_FILE: idx };
    const runIdx = (args, opts = {}) => { const r2 = spawnSync('git', args, { cwd: VAULT_DIR, encoding: opts.binary ? 'buffer' : 'utf8', input: opts.input, maxBuffer: 256 * 1024 * 1024, timeout: 300000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...envIdx } }); if (r2.status !== 0) throw new Error('git ' + args.slice(0, 2).join(' ') + ' (merge index) failed: ' + String(r2.stderr || '').split('\n')[0]); return r2.stdout; };
    void gi;
    runIdx(['read-tree', theirs]);
    // our delta relative to the pre-race remote
    const ours = new Map(); for (const line of git(['ls-tree', '-r', '-z', ourCommit], { raw: true }).out.split('\0')) { if (!line) continue; const m = /^(\d+) blob ([0-9a-f]+)\t(.*)$/.exec(line); if (m) ours.set(m[3], { mode: m[1], sha: m[2] }); }
    const diff = git(['diff-tree', '-r', '-z', '--name-status', oldRemoteSha, ourCommit], { raw: true }).out.split('\0');
    const lines = [];
    for (let i = 0; i + 1 < diff.length; i += 2) {
      const status = diff[i], file = diff[i + 1]; if (!status) break;
      if (status.startsWith('D')) { if (file.startsWith('chunks/') && referenced.has(path.basename(file))) continue; lines.push('0 0000000000000000000000000000000000000000\t' + file); }
      else { const e = ours.get(file); if (e) lines.push(e.mode + ' ' + e.sha + '\t' + file); }
    }
    const mBlob = String(runIdx(['hash-object', '-w', '--stdin'], { input: encryptBlob(ctx.keys, Buffer.from(JSON.stringify(merged))) })).trim();
    lines.push('100644 ' + mBlob + '\tmanifest.enc');
    runIdx(['update-index', '--index-info'], { input: lines.join('\n') + '\n' });
    const tree = String(runIdx(['write-tree'])).trim();
    const c2 = commitTree(tree, theirs, 'vault snapshot ' + new Date().toISOString() + ' from ' + HOSTNAME + ' (merged after a push race)');
    try { pushRef(c2, theirs); } catch (e) { if (!/force-with-lease|stale info|rejected/i.test(e.message)) throw e; lease = theirs; continue; }
    git(['update-ref', 'refs/heads/' + BRANCH, c2]);
    git(['reset', '-q', '--hard', c2]);   // working tree = merged snapshot (their newer files land on disk at the next pull phase)
    try { fs.unlinkSync(idx); } catch { /* none */ }
    log('push race with ' + (theirManifest.machine || 'the other machine') + ': merged our snapshot on top of theirs (attempt ' + attempt + ')');
    return { sha: c2, merged };
  }
  throw new Error('lost the push race 6 times in a row');
}
function commitAndPush(expectedRemoteSha, newChunkBytes, ctx) {
  let lease = expectedRemoteSha;
  if (newChunkBytes > BATCH_PUSH_BYTES) {   // large first uploads in < 2 GB pushes (GitHub limit)
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', 'chunks']).out.split('\0').filter(Boolean);
    let batch = [], bytes = 0, n = 0;
    const flush = () => {
      if (!batch.length) return;
      git(['add', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: batch.join('\0') });
      const c = commitTree(git(['write-tree']).out, headSha(), 'vault batch ' + (++n));
      git(['update-ref', 'refs/heads/' + BRANCH, c]);
      pushRef(c, lease); lease = c;
      log('  pushed batch ' + n + ' (' + (bytes / 1048576).toFixed(0) + ' MB)');
      batch = []; bytes = 0;
    };
    for (const f of untracked) { batch.push(f); bytes += fs.statSync(path.join(VAULT_DIR, f)).size; if (bytes >= BATCH_PUSH_BYTES) flush(); }
    flush();
  }
  stageChanges(ctx);
  const tree = git(['write-tree']).out;
  const c = commitTree(tree, headSha(), 'vault snapshot ' + new Date().toISOString() + ' from ' + HOSTNAME);
  git(['update-ref', 'refs/heads/' + BRANCH, c]);
  try { pushRef(c, lease); return { sha: c }; }
  catch (e) {
    if (!lease || !/force-with-lease|stale info|rejected/i.test(e.message)) throw e;
    return mergeOnTopOfRemote(ctx, c, lease, lease);
  }
}

// Squash = replace the remote branch with ONE orphan commit so dead chunk objects stop accumulating.
// It is a FULL re-upload (see above), so: only from a machine with the squash-here flag, at most daily,
// and guarded by a lock commit so the other machines do not push into the middle of it.
function shouldSquash(state) {
  return fs.existsSync(SQUASH_FLAG) && Date.now() - (state.lastSquash || 0) > SQUASH_EVERY_MS && Number(git(['rev-list', '--count', 'HEAD'], { allowFail: true }).out || 0) > 1;
}
function squash(state) {
  const t0 = Date.now();
  const before = headSha();
  const lockPath = path.join(VAULT_DIR, SQUASH_LOCK);
  fs.writeFileSync(lockPath, JSON.stringify({ host: HOSTNAME, at: new Date().toISOString() }));
  git(['add', '-A', '--', SQUASH_LOCK]);
  const lockCommit = commitTree(git(['write-tree']).out, before, 'squash lock');
  git(['update-ref', 'refs/heads/' + BRANCH, lockCommit]);
  pushRef(lockCommit, before);                               // small push; fails fast if someone else moved the branch
  fs.unlinkSync(lockPath); git(['rm', '-q', '--cached', '--', SQUASH_LOCK]);
  const tree = git(['write-tree']).out;                      // snapshot tree WITHOUT the lock
  const orphan = commitTree(tree, null, 'vault snapshot (squashed) ' + new Date().toISOString() + ' from ' + HOSTNAME);
  git(['update-ref', 'refs/heads/' + BRANCH, orphan]);
  log('squash: uploading the full snapshot as one commit (this is the slow, once-a-day push)');
  pushRef(orphan, lockCommit);
  state.lastSquash = Date.now();
  git(['reflog', 'expire', '--expire=now', '--all'], { allowFail: true }); git(['gc', '-q', '--prune=now'], { allowFail: true }); state.lastGc = Date.now();
  log('squash done in ' + ((Date.now() - t0) / 1000).toFixed(0) + 's: remote history is one commit again');
}
// True when another machine's squash upload is in progress (we then pull but do not push).
function remoteSquashLock() {
  const lockPath = path.join(VAULT_DIR, SQUASH_LOCK);
  if (!fs.existsSync(lockPath)) return false;
  try {
    const l = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (l.host !== HOSTNAME && Date.now() - Date.parse(l.at) < SQUASH_LOCK_TTL_MS) return true;
  } catch { /* unreadable = stale */ }
  fs.unlinkSync(lockPath);                                   // ours, or stale: drop it so the next snapshot clears it
  return false;
}
function maybeGc(state) {
  if (Date.now() - (state.lastGc || 0) < 24 * 3600 * 1000) return;
  log('git gc (daily)'); git(['reflog', 'expire', '--expire=now', '--all'], { allowFail: true }); git(['gc', '-q', '--prune=now'], { allowFail: true }); state.lastGc = Date.now();
}

// ----------------------------- the sync itself -----------------------------
async function withLock(fn, waitMs = 0) {
  // Every git command against the vault repo runs under this lock: the scheduled syncs, the watcher's
  // quick pull, and the read-only commands (status/list/verify/wip-state) which reset the working tree
  // too. Concurrent git = "index.lock: File exists" (seen on <LAPTOP> when read-only checks ran during a sync).
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  const t0 = Date.now();
  for (;;) {
    if (!fs.existsSync(LOCK_FILE)) break;
    const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    let owner = 0; try { owner = Number(fs.readFileSync(LOCK_FILE, 'utf8')); } catch { /* unreadable */ }
    if (age >= 2 * 3600 * 1000 || (owner && owner !== process.pid && !pidAlive(owner))) { log('stale lock removed (owner ' + owner + ' is gone)'); break; }
    if (Date.now() - t0 >= waitMs) { log(waitMs ? 'another sync is still running after waiting ' + Math.round(waitMs / 1000) + 's, skipping' : 'another sync is running, skipping'); return; }
    await sleep(1000);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  try { await fn(); } finally { try { fs.unlinkSync(LOCK_FILE); } catch { /* gone */ } }
}

function pullPhase(keys, remote, state, opts) {
  // Apply remote -> disk. Returns the set of vpaths we consider deleted locally (skip on push).
  const locallyDeleted = new Set();
  let downloaded = 0, skipped = 0, restoredProtected = 0;
  const now = Date.now();
  let sliceChanged = false;
  for (const [vpath, r] of Object.entries(remote.files)) {
    let real; try { real = toReal(vpath); } catch { continue; }
    let st = null; try { st = fs.statSync(real); } catch { /* missing */ }
    const prev = state.files[vpath];
    if (MERGED_VPATHS.has(vpath)) {
      if (!prev || JSON.stringify(prev.chunks) !== JSON.stringify(r.chunks) || !st) {
        const localTombstones = vpath.endsWith('retired.json') ? readTombstones() : null;
        try { restoreFile(keys, vpath, r); } catch (err) { log('pull: could not restore ' + vpath + ': ' + err.message + '; skipped this run'); continue; }
        if (localTombstones) {   // newest entry per folder wins between what we had and what arrived
          const merged = readTombstones();
          for (const [k, v] of Object.entries(localTombstones)) if (!merged[k] || Date.parse(v.at) > Date.parse(merged[k].at)) merged[k] = v;
          fs.writeFileSync(real, JSON.stringify(merged, null, 1));
        }
        downloaded++; if (vpath.endsWith('claude-json-slice.json')) sliceChanged = true;
      }
      continue;
    }
    if (!st) {
      if (prev && !opts.full && !isProtected(vpath)) { locallyDeleted.add(vpath); continue; }   // we had it and removed it: propagate the delete
      if (prev && isProtected(vpath)) restoredProtected++;
      try { restoreFile(keys, vpath, r); downloaded++; } catch (err) { log('pull: could not restore ' + vpath + ': ' + err.message + '; skipped this run'); }
      continue;
    }
    const localMtime = Math.floor(st.mtimeMs);
    if (r.mtime <= localMtime + 1000) { skipped++; continue; }              // local is same or newer
    const foreignWip = (vpath.startsWith('home/.claude-vault/wip/') && !vpath.startsWith('home/.claude-vault/wip/' + HOSTNAME + '/')) || (vpath.startsWith('home/.claude/vscode-state/hosts/') && !vpath.startsWith('home/.claude/vscode-state/hosts/' + HOSTNAME + '/'));   // another host's own files: never written here, always take the remote
    if (now - localMtime < RECENT_WRITE_MS && !opts.full && !foreignWip) { skipped++; continue; }   // being written right now, local wins this round
    if (prev && prev.mtime === localMtime && prev.size === st.size && JSON.stringify(prev.chunks) === JSON.stringify(r.chunks)) { skipped++; continue; }
    try { restoreFile(keys, vpath, r); downloaded++; } catch (err) { log('pull: could not restore ' + vpath + ': ' + err.message + '; skipped this run'); }
  }
  // Files we synced before that the remote no longer has: another machine deleted them.
  if (!opts.full) for (const [vpath, prev] of Object.entries(state.files)) {
    if (remote.files[vpath] || isProtected(vpath)) continue;   // protected files are re-pushed, never deleted here
    let real; try { real = toReal(vpath); } catch { continue; }
    let st = null; try { st = fs.statSync(real); } catch { continue; }
    if (Math.floor(st.mtimeMs) === prev.mtime && st.size === prev.size) { try { fs.unlinkSync(real); log('deleted (removed on another machine):', vpath); } catch { /* ignore */ } }
  }
  if (downloaded) log(`pulled ${downloaded} file(s) from the vault (${skipped} up to date)`);
  if (restoredProtected) log(`restored ${restoredProtected} chat/memory file(s) that had been deleted locally (chats are never deleted through the vault)`);
  if (sliceChanged) mergeClaudeJsonSlice();
  return locallyDeleted;
}

async function pushPhase(keys, state, locallyDeleted) {
  const pt = { t: Date.now(), lap(n) { const x = Date.now(); this[n] = ((x - this.t) / 1000).toFixed(1); this.t = x; } };
  await exportVscodeState(state); pt.lap("vsc");
  await wipExport(state); pt.lap("wip");
  const local = scanLocal(state); pt.lap("scan");
  const manifest = { version: 1, generatedAt: new Date().toISOString(), machine: HOSTNAME, files: {} };
  let newBytes = 0, rechunked = 0;
  const chunksRoot = path.join(VAULT_DIR, 'chunks');
  const have = new Set();   // one directory listing instead of 40k existsSync calls
  if (fs.existsSync(chunksRoot)) for (const d of fs.readdirSync(chunksRoot)) { try { for (const f of fs.readdirSync(path.join(chunksRoot, d))) have.add(f); } catch { /* file, not dir */ } }
  const newChunkIds = [];
  for (const [vpath, f] of local) {
    if (locallyDeleted.has(vpath)) continue;
    const prev = state.files[vpath];
    if (prev && Math.abs(prev.mtime - f.mtime) <= 1 && prev.size === f.size && prev.chunks.every((id) => have.has(id))) { manifest.files[vpath] = { mtime: prev.mtime, size: f.size, chunks: prev.chunks }; continue; }
    try { const { ids, written } = chunkFile(keys, f.real); for (const id of ids) if (!have.has(id)) { have.add(id); newChunkIds.push(id); } manifest.files[vpath] = { mtime: f.mtime, size: f.size, chunks: ids }; newBytes += written; rechunked++; if (rechunked <= 8) log('  changed:', vpath, prev ? `(mtime ${prev.mtime} -> ${f.mtime}, size ${prev.size} -> ${f.size})` : '(new)'); }
    catch (e) { log('skip (unreadable):', vpath, e.message); if (prev) manifest.files[vpath] = prev; }
  }
  // GC chunk objects nothing references any more
  const referenced = new Set(Object.values(manifest.files).flatMap((e) => e.chunks));
  const removedChunkIds = [];
  for (const id of have) if (!referenced.has(id)) { try { fs.unlinkSync(chunkPath(id)); removedChunkIds.push(id); } catch { /* gone */ } }
  fs.writeFileSync(path.join(VAULT_DIR, 'manifest.enc'), encryptBlob(keys, Buffer.from(JSON.stringify(manifest))));
  pt.lap("chunk"); state.lastPushTiming = 'vscExp ' + pt.vsc + ' wipExp ' + pt.wip + ' scan ' + pt.scan + ' chunk+manifest ' + pt.chunk;
  return { manifest, newBytes, rechunked, removed: removedChunkIds.length, fileCount: local.size, newChunkIds, removedChunkIds };
}

function ensureGitignore() {
  const p = path.join(VAULT_DIR, '.gitattributes');
  const want = 'chunks/** -delta -text -diff\nmanifest.enc -delta -text -diff\n* text=auto eol=lf\n*.cmd text eol=crlf\n*.vbs text eol=crlf\n';
  if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== want) fs.writeFileSync(p, want);
}

async function cmdSync(opts = {}) {
  if (!opts.pullOnly && !opts.squash && !opts.full) {   // scheduled runs only
    try {
      const st0 = readState();
      if (st0.lastRunMs > 60000 && Date.now() - (st0.lastRunEnd || 0) < st0.lastRunMs) { log('previous run took ' + Math.round(st0.lastRunMs / 1000) + 's (machine under load); skipping this slot so runs do not pile up'); return; }
    } catch { /* ignore */ }
  }
  const runStart = Date.now();
  try { await cmdSyncInner(opts); } finally { try { const st1 = readState(); st1.lastRunMs = Date.now() - runStart; st1.lastRunEnd = Date.now(); writeState(st1); } catch { /* ignore */ } }
}
async function cmdSyncInner(opts = {}) {
  await withLock(async () => {
    const t0 = Date.now();
    const passphrase = readPassphrase();
    for (let attempt = 1; attempt <= 1; attempt++) {
      const tm = { t: Date.now(), lap(name) { const n = Date.now(); this[name] = ((n - this.t) / 1000).toFixed(1); this.t = n; } };
      const remoteSha = fetchRemote(); tm.lap('fetch');
      const keys = loadOrCreateSaltAndCheck(passphrase);
      if (!keys) die('Wrong passphrase for this vault.');
      const remote = readRemoteManifest(keys);
      const state = readState();
      const locallyDeleted = pullPhase(keys, remote, state, opts); tm.lap('pull');
      try { fs.writeFileSync(path.join(LOCAL_DIR, 'vault-dir.txt'), VAULT_DIR); } catch { /* ignore */ }
      cloneMissingRepos(state);
      applyTombstones(state);
      await wipImport(state); tm.lap('wipIn');
      await importVscodeState(state); tm.lap('vscIn');
      installCompanion(state);
      ensureWatcher();
      if (IS_WIN && !process.env.CLAUDE_VAULT_NO_WATCHER && state.schedulerVersion !== 7) { installScheduler(); state.schedulerVersion = 7; writeState(state); }   // new tasks reach every machine by themselves; persisted at once so a later early return cannot re-register (and move the minute slot) next run
      if (!opts.pullOnly && remoteSquashLock()) { log('another machine is squashing the vault right now; pulled only, will push next run'); return; }
      if (opts.pullOnly) { state.files = remote.files; writeState(state); log((opts.full ? 'restore complete: ' : 'pull: ') + Object.keys(remote.files).length + ' files'); return; }
      ensureGitignore();
      const { manifest, newBytes, rechunked, removed, fileCount, newChunkIds, removedChunkIds } = await pushPhase(keys, state, locallyDeleted); tm.lap('scan');
      const dirty = git(['status', '--porcelain', '-uall', '--', 'chunks', 'manifest.enc', 'vault.salt', 'vault.check', '.gitattributes', 'vault.mjs', 'vault.config.json', 'setup.cmd', 'run-hidden.vbs', 'README.md', SQUASH_LOCK]).out;
      const manifestChanged = JSON.stringify(manifest.files) !== JSON.stringify(remote.files);
      if (!manifestChanged && !dirty.split('\n').some((l) => l && !l.includes('manifest.enc'))) {
        git(['checkout', '-q', '--', 'manifest.enc'], { allowFail: true });      // nothing changed; keep the remote's manifest bytes
        state.files = manifest.files;
        if (opts.squash || shouldSquash(state)) { try { squash(state); } catch (e) { log('squash skipped (will retry next run): ' + e.message.split('\n')[0]); } } else maybeGc(state);
        writeState(state);
        log(`in sync (${fileCount} files, ${((Date.now() - t0) / 1000).toFixed(1)}s; fetch ${tm.fetch} pull ${tm.pull} wip ${tm.wipIn} vscode ${tm.vscIn} scan+export ${tm.scan} [${state.lastPushTiming}])`); return;
      }
      try {
        const res = commitAndPush(remoteSha, newBytes, { keys, oldManifest: remote.files, manifest, newChunkIds, removedChunkIds }); tm.lap('push');
        const sha = res.sha;
        state.files = (res.merged || manifest).files; writeState(state);
        log(`pushed snapshot ${sha.slice(0, 8)}: ${fileCount} files, ${rechunked} changed, ${(newBytes / 1048576).toFixed(1)} MB new, ${removed} chunks gc'd, ${((Date.now() - t0) / 1000).toFixed(1)}s (fetch ${tm.fetch} pull ${tm.pull} wip ${tm.wipIn} vscode ${tm.vscIn} scan+export ${tm.scan} [${state.lastPushTiming}] push ${tm.push})`);
        if (opts.squash || shouldSquash(state)) { try { squash(state); } catch (e) { log('squash skipped (will retry next run): ' + e.message.split('\n')[0]); } } else maybeGc(state);
        writeState(state);
        return;
      } catch (e) {
        if (/force-with-lease|stale info|rejected|lost the push race/i.test(e.message)) { log('lost the push race to the other machine (' + e.message.split('\n')[0] + '); nothing lost, will retry next run'); return; }
        throw e;
      }
    }
  }, opts.pullOnly ? 0 : 20000);
}

// ----------------------------- scheduler + setup -----------------------------
function installScheduler() {
  if (!IS_WIN) { log('scheduler: add a cron line like  */10 * * * * node ' + path.join(VAULT_DIR, 'vault.mjs') + ' sync'); return; }
  const vbs = path.join(VAULT_DIR, 'run-hidden.vbs');
  const tr = `wscript.exe "${vbs}" sync`;
  run('schtasks', ['/Delete', '/F', '/TN', 'ClaudeVaultSync'], { allowFail: true });   // retired: it only collided with the 2-minute lane
  // two machines every 2 min would race the push lease; start this one on an even or odd minute derived from the host name
  const parity = fs.existsSync(SQUASH_FLAG) ? 0 : 1;   // the vault's creator (<HOME-PC>) takes even minutes, every other machine odd: two machines never share a slot
  const start = new Date(Date.now() + 120000); start.setSeconds(0, 0); if (start.getMinutes() % 2 !== parity) start.setMinutes(start.getMinutes() + 1);
  const st = String(start.getHours()).padStart(2, '0') + ':' + String(start.getMinutes()).padStart(2, '0');
  run('schtasks', ['/Create', '/F', '/TN', 'ClaudeVaultPull', '/SC', 'MINUTE', '/MO', '2', '/ST', st, '/TR', `wscript.exe "${vbs}" sync`], { allowFail: true });   // full incremental sync every 2 min (WIP lane needs a push)
  // ONLOGON via schtasks needs elevation; Register-ScheduledTask does not
  for (const [name, arg] of [['ClaudeVaultSyncAtLogon', 'sync'], ['ClaudeVaultWatch', 'watch']]) {
    const ps = `$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"${vbs}" ${arg}'; $t = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\\$env:USERNAME"; Register-ScheduledTask -TaskName '${name}' -Action $a -Trigger $t -Force | Out-Null`;
    const r = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { allowFail: true });
    if (r.code !== 0) log('scheduler: could not register ' + name + ': ' + (r.err || r.out).split('\n')[0]);
  }
  log('scheduler: ClaudeVaultPull (full sync) every 2 min on this host\'s minute slot, ClaudeVaultSyncAtLogon + ClaudeVaultWatch at logon');
}
async function cmdSetup() {
  for (const bin of ['git', 'node']) if (!which(bin)) die(`${bin} is not installed. Run: winget install -e --id ${bin === 'git' ? 'Git.Git' : 'OpenJS.NodeJS.LTS'}  then re-run setup.`);
  if (!which('gh')) log('gh (GitHub CLI) not found; git needs stored credentials for private repos. Install: winget install -e --id GitHub.cli');
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  if (!fs.existsSync(path.join(VAULT_DIR, '.git'))) die(`${VAULT_DIR} is not a git clone of the vault repo.`);
  if (!git(['remote', 'get-url', 'origin'], { allowFail: true }).out) die('vault repo has no origin remote.');
  for (const [k, v] of [['user.name', 'claude-vault'], ['user.email', 'claude-vault@users.noreply.github.com'], ['core.autocrlf', 'false'], ['core.compression', '0'], ['gc.auto', '0']]) git(['config', k, v]);
  // Authenticate THIS repo through gh only (repo-local config). The machine-wide helper (Git Credential Manager)
  // keeps serving the user's other GitHub accounts for the project repos; nothing global is touched.
  if (which('gh')) { git(['config', '--replace-all', 'credential.helper', '']); git(['config', '--add', 'credential.helper', '!gh auth git-credential']); }
  // 1. passphrase (verify against the vault if it already has one)
  for (let i = 0; i < 3; i++) {
    if (!process.env.CLAUDE_VAULT_PASSPHRASE && (!fs.existsSync(KEY_FILE) || i > 0)) storePassphraseInteractive();
    fetchRemote();
    const keys = loadOrCreateSaltAndCheck(readPassphrase());
    if (keys) break;
    console.log('That passphrase does not open this vault. Try again.');
    if (i === 2) die('Passphrase rejected 3 times.');
  }
  // 2. pull everything the vault has, then push what this machine has
  for (const [name, dir] of Object.entries(ROOTS)) if (!fs.existsSync(dir)) log(`note: root "${name}" = ${dir} does not exist here yet; it will be created when files are restored`);
  if (!fetchRemote()) { fs.writeFileSync(SQUASH_FLAG, HOSTNAME); log('this machine created the vault: it will do the daily squash (full re-upload); other machines never do'); }
  await cmdSync({ full: true });
  // 3. the projects were cloned during the sync above; install the 10-minute sync
  installScheduler();
  log('setup complete. Open VS Code: every Claude chat, setting, hook and skill is here. Reinstall gstack separately if you use it (it is excluded, 1.3 GB of binaries).');
}
async function cmdStatus() { await withLock(async () => {
  fetchRemote();
  const keys = loadOrCreateSaltAndCheck(readPassphrase()); if (!keys) die('Wrong passphrase.');
  const m = readRemoteManifest(keys);
  const files = Object.entries(m.files);
  const bytes = files.reduce((a, [, e]) => a + e.size, 0);
  const byRoot = {};
  for (const [v] of files) { const r = v.split('/')[0]; byRoot[r] = (byRoot[r] || 0) + 1; }
  console.log(`snapshot from ${m.machine || '?'} at ${m.generatedAt || '?'}: ${files.length} files, ${(bytes / 1073741824).toFixed(2)} GB plaintext`);
  console.log('by root:', byRoot);
  const chunks = new Set(files.flatMap(([, e]) => e.chunks));
  let enc = 0; for (const id of chunks) { try { enc += fs.statSync(chunkPath(id)).size; } catch { /* not fetched */ } }
  console.log(`${chunks.size} encrypted chunks, ${(enc / 1073741824).toFixed(2)} GB in the repo`);
}, 90000); }
async function cmdList() { await withLock(async () => {
  fetchRemote();
  const keys = loadOrCreateSaltAndCheck(readPassphrase()); if (!keys) die('Wrong passphrase.');
  const m = readRemoteManifest(keys);
  for (const [v, e] of Object.entries(m.files).sort()) console.log(`${String(e.size).padStart(11)}  ${new Date(e.mtime).toISOString()}  ${v}`);
}, 90000); }
async function cmdVerify(n = 25) { await withLock(async () => {
  fetchRemote();
  const keys = loadOrCreateSaltAndCheck(readPassphrase()); if (!keys) die('Wrong passphrase.');
  const m = readRemoteManifest(keys);
  const entries = Object.entries(m.files); let ok = 0, diff = 0, missing = 0;
  for (let i = 0; i < n && entries.length; i++) {
    const [vpath, e] = entries[Math.floor(Math.random() * entries.length)];
    let real; try { real = toReal(vpath); } catch { continue; }
    if (!fs.existsSync(real)) { missing++; continue; }
    const fromVault = Buffer.concat(e.chunks.map((id) => decryptChunk(keys, id, fs.readFileSync(chunkPath(id)))));
    const onDisk = fs.readFileSync(real);
    if (fromVault.equals(onDisk)) ok++; else { diff++; console.log('differs (changed since snapshot?):', vpath); }
  }
  console.log(`verify: ${ok} identical, ${diff} differ, ${missing} not on this machine (sample of ${n})`);
}, 90000); }

// ----------------------------- main -----------------------------
const cmd = process.argv[2] || 'sync';
try {
  if (cmd === 'sync') await cmdSync();
  else if (cmd === 'restore') await cmdSync({ pullOnly: true, full: true });
  else if (cmd === 'pull') await cmdSync({ pullOnly: true });
  else if (cmd === 'watch') await cmdWatch();
  else if (cmd === 'companion') { const st = readState(); delete st.companionInstalled; installCompanion(st); writeState(st); }
  else if (cmd === 'setup') await cmdSetup();
  else if (cmd === 'status') await cmdStatus();
  else if (cmd === 'list') await cmdList();
  else if (cmd === 'verify') await cmdVerify(Number(process.argv[3]) || 25);
  else if (cmd === 'scheduler') installScheduler();
  else if (cmd === 'squash') { if (!fs.existsSync(SQUASH_FLAG)) fs.writeFileSync(SQUASH_FLAG, HOSTNAME); await cmdSync({ squash: true }); }
  else if (cmd === 'forget') cmdForget(process.argv.slice(3));
  else if (cmd === 'wip-state') { const dir = path.resolve(process.argv[3] || process.cwd()); const st = repoState(dir); console.log(JSON.stringify({ ...st, entries: undefined, contentHash: st ? contentHash(dir, st) : null, stored: (readState().wip || {}).exp?.[path.basename(dir)] }, null, 1)); }
  else if (cmd === 'wip') { const st = readState(); await wipImport(st); await wipExport(st); writeState(st); }
  else if (cmd === 'vscode-state') { const st = readState(); const force = process.argv[3] === '--force' ? process.argv.slice(4).join(' ') : null; if (!force) await importVscodeState(st); await exportVscodeState(st, force); writeState(st); }
  else die('unknown command ' + cmd);
} catch (e) {
  if (e instanceof RestartWithNewCode) {
    log('vault.mjs updated from the vault; restarting with the new code');
    const r = spawnSync(process.execPath, [SELF, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
    process.exit(r.status ?? 1);
  }
  die(e.stack || e.message);
}
