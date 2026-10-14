// Claude Vault Companion: makes an OPEN VS Code window follow the other machine.
// The vault itself can only write VS Code's per-folder state (open Claude chat tabs) while the
// window is CLOSED (VS Code re-persists it from memory otherwise). So when a newer state from the
// other machine arrives for this project, this extension offers to (or, in auto mode, does)
// close the window, lets the vault watcher apply the state, and the watcher reopens the folder.
// It also exports this window's chat tabs whenever a Claude tab opens/closes.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const HOME = os.homedir();
const LOCAL = path.join(HOME, '.claude-vault');
const STATE_DIR = path.join(HOME, '.claude', 'vscode-state');
const safeName = (s) => s.replace(/[<>:"/\\|?*]/g, '_');
const keysHash = (keys) => crypto.createHash('sha256').update(JSON.stringify(Object.keys(keys).sort().map((k) => [k, keys[k]]))).digest('hex');
function vaultMjs() { try { return path.join(fs.readFileSync(path.join(LOCAL, 'vault-dir.txt'), 'utf8').trim(), 'vault.mjs'); } catch { return 'C:\\claude-vault\\vault.mjs'; } }
function runVault(cmd) { try { spawn(process.platform === 'win32' ? 'node.exe' : 'node', [vaultMjs(), cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* node missing: the scheduled sync still runs */ } }

function activate(ctx) {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder || folder.uri.scheme !== 'file') return;
  const fsPath = folder.uri.fsPath;
  const project = path.basename(fsPath);
  const stateFile = path.join(STATE_DIR, safeName(project) + '.json');
  const out = vscode.window.createOutputChannel('Claude Vault');
  const log = (m) => {
    const line = `[${new Date().toISOString()}] companion(${project}): ${m}`;
    out.appendLine(line);
    try { fs.mkdirSync(LOCAL, { recursive: true }); fs.appendFileSync(path.join(LOCAL, 'sync.log'), line + '\n'); } catch { /* never fail on logging */ }
  };

  // heartbeat: tells the vault this folder's window is open (storage.json misses windows opened by the code CLI)
  const hbDir = path.join(LOCAL, 'windows');
  const hbFile = path.join(hbDir, safeName(project) + '.alive');
  const beat = () => { try { fs.mkdirSync(hbDir, { recursive: true }); fs.writeFileSync(hbFile, fsPath); } catch { /* ignore */ } };
  beat();
  const hb = setInterval(beat, 30000);
  ctx.subscriptions.push({ dispose: () => { clearInterval(hb); try { fs.unlinkSync(hbFile); } catch { /* ignore */ } } });

  // idle tracking (auto mode)
  let lastActivity = Date.now();
  const touch = () => { lastActivity = Date.now(); };
  ctx.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(touch),
    vscode.window.onDidChangeActiveTextEditor(touch),
    vscode.workspace.onDidChangeTextDocument(touch),
    vscode.window.onDidChangeWindowState((s) => { if (s.focused) touch(); }),
    vscode.window.onDidChangeActiveTerminal(touch),
  );

  // The vault writes ~/.claude-vault/pending/<project>.json when it has a tab MERGE waiting for this window to close
  const pendingFile = path.join(LOCAL, 'pending', safeName(project) + '.json');
  function readRemote() {
    try {
      const d = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
      if (!d || (!d.adds.length && !d.removes.length)) return null;
      return { machine: (d.hosts || []).join('+') || 'the other machine', exportedAt: d.at, hash: d.at, adds: d.adds.length, removes: d.removes.length };
    } catch { return null; }
  }
  function vaultApplied() { return fs.existsSync(pendingFile) ? undefined : 'done'; }
  function claudeStreaming() {   // a transcript of this project written in the last 30 s = a chat is running
    const slugs = [fsPath, fsPath.charAt(0).toLowerCase() + fsPath.slice(1)].map((p) => p.replace(/[^a-zA-Z0-9]/g, '-'));
    for (const s of slugs) {
      const dir = path.join(HOME, '.claude', 'projects', s);
      try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl') && Date.now() - fs.statSync(path.join(dir, f)).mtimeMs < 30000) return true; } catch { /* no such project dir */ }
    }
    return false;
  }

  let prompting = false;
  let suppressCloseEvents = false;
  let exportPending = false, lastTabChange = 0, lastExport = 0;
  // Live merge: the vault computed { adds: [{sid,title,from}], removes: [{sid,title}] } for this project and left it in
  // ~/.claude-vault/pending/<project>.json because this window is open (VS Code holds the database while it runs).
  // 'claude-vscode.editor.open' takes a session id (the extension calls it that way itself, and it is idempotent), so
  // the missing chats are opened right here; tombstoned tabs are closed by label. No database write, no reopen.
  let merging = false, lastBatchAt = 0, lastMemoryLog = 0;
  async function applyPendingLive(reason) {
    if (merging) return;
    const r = readRemote(); if (!r) return;
    const cfg = vscode.workspace.getConfiguration('claudeVaultCompanion');
    const mode = cfg.get('mode', 'auto');
    if (mode === 'off') return;
    let plan; try { plan = JSON.parse(fs.readFileSync(pendingFile, 'utf8')); } catch { return; }
    if (mode === 'ask' && plan.at !== ctx.workspaceState.get('askedAt')) {
      await ctx.workspaceState.update('askedAt', plan.at);
      const pick = await vscode.window.showInformationMessage(`Claude Vault: ${plan.adds.length} chat tab(s) opened on ${r.machine}${plan.removes.length ? ' and ' + plan.removes.length + ' closed there' : ''}. Merge them into this window?`, 'Merge', 'Not now');
      if (pick !== 'Merge') { log('user declined the live merge for plan ' + plan.at); return; }
    }
    // throttle: a laptop with 0.6 GB free and 24 chats to open must not be flattened
    const maxOpens = Math.max(1, cfg.get('maxLiveOpens', 8)), delayMs = Math.max(0, cfg.get('openDelayMs', 1500)), minFreeMB = cfg.get('minFreeMemoryMB', 1024);
    const freeMB = Math.round(os.freemem() / 1048576);
    if (freeMB < minFreeMB) { if (Date.now() - (lastMemoryLog || 0) > 300000) { lastMemoryLog = Date.now(); log(`live merge postponed: ${freeMB} MB free (< ${minFreeMB} MB); will retry`); } return; }
    if (Date.now() - lastBatchAt < 60000 && (ctx.workspaceState.get('mergedSids') || []).length) return;   // one batch per minute
    merging = true;
    try {
      const isClaude = (t) => t.input && typeof t.input.viewType === 'string' && t.input.viewType.includes('claudeVSCodePanel');
      const done = new Set(ctx.workspaceState.get('mergedSids') || []);
      let opened = 0, closed = 0;
      suppressCloseEvents = true;
      for (const t of plan.removes || []) {
        const tab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => isClaude(x) && x.label === t.title);
        if (tab) { try { await vscode.window.tabGroups.close(tab, true); closed++; } catch (err) { log('close failed for ' + t.title + ': ' + err.message); } }
      }
      const activeGroup = vscode.window.tabGroups.activeTabGroup, activeTab = activeGroup && activeGroup.activeTab;
      const activeIndex = activeTab ? activeGroup.tabs.indexOf(activeTab) : -1;
      const todo = (plan.adds || []).filter((t) => !done.has(t.sid)).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));   // newest activity first
      if (!todo.length && !closed) { try { fs.unlinkSync(pendingFile); } catch { /* gone */ } return; }   // the vault re-plans until VS Code flushes its state; nothing new to do
      const batch = todo.slice(0, maxOpens);
      for (const t of batch) {
        try { await vscode.commands.executeCommand('claude-vscode.editor.open', t.sid, undefined, undefined, undefined, undefined, { programmatic: true }); opened++; done.add(t.sid); }
        catch (err) { log('open failed for ' + t.sid + ' (' + t.title + '): ' + err.message); done.add(t.sid); }
        await new Promise((res) => setTimeout(res, delayMs));
      }
      // give the focus back to whatever the user had in front (opening tabs steals it)
      if (activeIndex >= 0) { try { await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', activeIndex); } catch { /* best effort */ } }
      await ctx.workspaceState.update('mergedSids', [...done].slice(-500));
      const remaining = todo.length - batch.length;
      lastBatchAt = Date.now();
      if (remaining <= 0) { try { fs.unlinkSync(pendingFile); } catch { /* gone */ } }
      log(`merged live (${reason}): +${opened} opened from ${r.machine}, -${closed} closed${remaining > 0 ? ', ' + remaining + ' more in the next batch (one batch per minute)' : ''}, ${freeMB} MB free`);
      vscode.window.setStatusBarMessage(`Claude Vault: merged ${opened} chat tab(s) from ${r.machine}${closed ? ', closed ' + closed : ''}${remaining > 0 ? ', ' + remaining + ' more coming' : ''}`, 8000);
      exportPending = true; lastTabChange = Date.now();   // publish the new state soon
    } finally { setTimeout(() => { suppressCloseEvents = false; }, 2000); merging = false; }
  }
  async function check(reason) { try { await applyPendingLive(reason); } catch (err) { log('live merge failed: ' + err.message); } }
  async function reopen(r, how) {
    if (vscode.workspace.textDocuments.some((d) => d.isDirty)) {
      vscode.window.showWarningMessage('Claude Vault: not reopening, an editor has unsaved changes. Save them, then run "Claude Vault: Reopen this window".');
      log('reopen blocked: unsaved changes');
      return;
    }
    const markerDir = path.join(LOCAL, 'reopen');
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(path.join(markerDir, safeName(project) + '.json'), JSON.stringify({ folder: fsPath, project, requestedAt: new Date().toISOString(), hash: r.hash, from: r.machine, how }));
    await ctx.workspaceState.update('appliedHash', r.hash);
    log(`reopen requested (${how}) to apply chats from ${r.machine} (${r.exportedAt}); closing window`);
    // The local Claude tabs are about to be replaced anyway, so close them first: a busy webview is the
    // likeliest thing to keep the window from closing. Then verify the window actually went away.
    suppressCloseEvents = true;   // everything closed from here on is the reopen, not the user
    try {
      const claudeTabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input && typeof t.input.viewType === 'string' && t.input.viewType.includes('claudeVSCodePanel'));
      if (claudeTabs.length) await vscode.window.tabGroups.close(claudeTabs, true);
    } catch (err) { log('closing Claude tabs failed: ' + err.message); }
    await vscode.commands.executeCommand('workbench.action.closeWindow');
    setTimeout(async () => {
      log('window still alive 3 s after closeWindow; retrying with all editors closed');
      try { await vscode.commands.executeCommand('workbench.action.closeAllEditors'); } catch { /* ignore */ }
      await vscode.commands.executeCommand('workbench.action.closeWindow');
      setTimeout(() => {
        log('window still alive after the retry; asking the user to close it');
        vscode.window.showWarningMessage(`Claude Vault: this window would not close by itself (a dialog may be waiting, or a chat is still running). Close it yourself within 3 minutes and it reopens with the chats from ${r.machine}.`);
      }, 3000);
    }, 3000);
  }

  // react to the vault dropping a newer state file (2-minute pull lane), with a fallback poll
  try {
    fs.mkdirSync(path.join(LOCAL, 'pending'), { recursive: true });
    const w = fs.watch(path.join(LOCAL, 'pending'), (_ev, name) => { if (name && name.toLowerCase() === path.basename(pendingFile).toLowerCase()) setTimeout(() => check('watch'), 1500); });
    ctx.subscriptions.push({ dispose: () => w.close() });
  } catch (e) { log('watcher unavailable, polling only: ' + e.message); }
  const iv = setInterval(() => check('interval'), 60000);
  ctx.subscriptions.push({ dispose: () => clearInterval(iv) });
  setTimeout(() => { log('asking the vault for this project\'s merge plan'); runVault('vscode-state'); }, 5000);
  setTimeout(() => check('activate'), 25000);

  // export this window's chat tabs when a Claude tab opens/closes (VS Code flushes its state lazily, hence the delay)
  // at most one export per 60 s per window, and only once no chat of this project is streaming
  lastExport = 0;
  ctx.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs((e) => {
    const isClaude = (t) => t.input && typeof t.input.viewType === 'string' && t.input.viewType.includes('claudeVSCodePanel');
    const touched = [...e.opened, ...e.closed, ...e.changed];
    if (!touched.some(isClaude)) return;
    for (const t of e.closed) if (isClaude(t) && !suppressCloseEvents) {   // an explicit close, recorded by title; only this can create a tombstone (never during a vault-driven reopen)
      try { fs.mkdirSync(path.join(LOCAL, 'closed'), { recursive: true }); fs.appendFileSync(path.join(LOCAL, 'closed', safeName(project) + '.jsonl'), JSON.stringify({ title: t.label, at: new Date().toISOString() }) + '\n'); log('Claude tab closed by user: ' + t.label); } catch { /* ignore */ }
    }
    touch(); exportPending = true; lastTabChange = Date.now();
  }));
  const exportIv = setInterval(() => {
    if (!exportPending) return;
    const now = Date.now();
    if (now - lastTabChange < 20000 || now - lastExport < 60000 || claudeStreaming()) return;
    exportPending = false; lastExport = now;
    log('Claude tabs changed and no chat is streaming, exporting');
    runVault('vscode-state');
  }, 15000);
  ctx.subscriptions.push({ dispose: () => clearInterval(exportIv) });

  // WIP conflict: the vault refused to apply the other machine's uncommitted code because this tree has its own edits
  const wipStatusFile = path.join(LOCAL, 'wip', os.hostname(), 'status.json');
  let shownConflictAt = ctx.workspaceState.get('wipConflictShownAt');
  async function checkWipConflict() {
    try {
      if (!fs.existsSync(wipStatusFile)) return;
      const st = JSON.parse(fs.readFileSync(wipStatusFile, 'utf8'));
      const c = st[project];
      if (c && c.retireRefused && c.at !== shownConflictAt) {
        shownConflictAt = c.at; await ctx.workspaceState.update('wipConflictShownAt', c.at);
        log(`retire refused: ${c.why}`);
        vscode.window.showWarningMessage(`Claude Vault: ${project} was retired (forget) from ${c.by}, but this copy was NOT removed: ${c.why}. Commit/push or discard, then it is recycled at the next check; or run: node C:\\claude-vault\\vault.mjs forget --undo "${project}"`);
        return;
      }
      if (!c || !c.diverged || c.at === shownConflictAt) return;
      shownConflictAt = c.at; await ctx.workspaceState.update('wipConflictShownAt', c.at);
      const files = (c.files || []).slice(0, 6).join(', ') + ((c.files || []).length > 6 ? ', ...' : '');
      log(`WIP conflict with ${c.from}: ${files}`);
      const pick = await vscode.window.showWarningMessage(`Claude Vault: ${c.from} has uncommitted changes in ${project} that were NOT applied here because this machine changed the same project. Files: ${files}. Commit or discard on one side; nothing was overwritten.`, 'Open backup log', 'Show files');
      if (pick === 'Open backup log') { const bl = path.join(LOCAL, 'wip', os.hostname(), 'backup.log'); if (fs.existsSync(bl)) vscode.window.showTextDocument(vscode.Uri.file(bl)); else vscode.window.showInformationMessage('Claude Vault: no backup log yet (nothing was ever replaced on this machine).'); }
      if (pick === 'Show files') vscode.window.showInformationMessage('Conflicting files: ' + (c.files || []).join(', '));
    } catch (err) { log('wip conflict check failed: ' + err.message); }
  }
  const wipIv = setInterval(checkWipConflict, 60000); ctx.subscriptions.push({ dispose: () => clearInterval(wipIv) });
  setTimeout(checkWipConflict, 8000);

  ctx.subscriptions.push(vscode.commands.registerCommand('claudeVaultCompanion.reopenNow', async () => {
    runVault('vscode-state');
    setTimeout(async () => { if (readRemote()) await check('command'); else vscode.window.showInformationMessage('Claude Vault: this window already matches the other machine.'); }, 15000);
  }));
  ctx.subscriptions.push(vscode.commands.registerCommand('claudeVaultCompanion.exportNow', () => { log('manual export'); runVault('vscode-state'); }));
  log('active (mode ' + vscode.workspace.getConfiguration('claudeVaultCompanion').get('mode', 'auto') + ')');
}
function deactivate() {}
module.exports = { activate, deactivate };
