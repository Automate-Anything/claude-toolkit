// Proves the app-state resync loop fix on the INSTALLED Baileys, by running the library's own loop.
//
//   (in the Evolution folder, after npm ci and the patch)
//   node --test path/to/patch-baileys-appstate-resync-loop.test.cjs
//
// The loop is cut out of the installed lib/Socket/chats.js and run with the library's own
// extractSyncdPatches and a stand-in for WhatsApp that never answers. The same loop with the fix
// taken back out is run too, to show the failure the fix removes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

const root = process.cwd();
const fixUrl = pathToFileURL(path.join(__dirname, 'patch-baileys-appstate-resync-loop.mjs')).href;

async function load() {
  const fix = await import(fixUrl);
  const { file } = fix.chatsFile(root);
  const chatUtils = await import(pathToFileURL(path.join(path.dirname(file), '..', 'Utils', 'chat-utils.js')).href);
  return { fix, file, extractSyncdPatches: chatUtils.extractSyncdPatches };
}

// The text of `while (collectionsToHandle.size) { ... }`, found by counting braces.
function cutLoop(source) {
  const start = source.indexOf('while (collectionsToHandle.size) {');
  assert.ok(start >= 0, 'the sync loop is in chats.js');
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('the sync loop has no end');
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
// Every free name the loop reads across rc.9 and rc13. Names a version does not use are ignored.
const NAMES = ['collectionsToHandle', 'attemptsMap', 'forceSnapshotCollections', 'blockedCollections', 'initialVersionMap',
  'globalMutationMap', 'authState', 'query', 'extractSyncdPatches', 'config', 'logger', 'S_WHATSAPP_NET', 'newLTHashState',
  'ensureLTHashStateVersion', 'decodeSyncdSnapshot', 'decodePatches', 'getCachedAppStateSyncKey', 'getAppStateSyncKey',
  'appStateMacVerification', 'isMissingKeyError', 'isAppStateSyncIrrecoverable', 'MAX_SYNC_ATTEMPTS'];

// Runs the loop with WhatsApp never answering (query resolves undefined, as the library's own
// waitForMessage does after its 60 seconds). Stops it after `limit` queries; returns how many it sent.
async function run(loopText, extractSyncdPatches, limit = 5) {
  let queries = 0;
  const warnings = [];
  const loop = new AsyncFunction(...NAMES, `${loopText}\nreturn 'ended';`);
  const notReached = async () => { throw new Error('not reached'); };
  const outcome = await loop(
    new Set(['regular', 'regular_high', 'critical_block']), {}, new Set(), new Set(), {}, {},
    { keys: { get: async () => ({}), set: async () => {} } },
    async () => {
      queries += 1;
      if (queries > limit) throw new Error('still looping');
      return undefined;
    },
    extractSyncdPatches, { options: {} },
    { info() {}, warn: (data, message) => warnings.push(message), debug() {}, trace() {}, error() {} },
    's.whatsapp.net', () => ({ version: 0, hash: Buffer.alloc(128), indexValueMap: {} }), (state) => state,
    notReached, notReached, async () => undefined, async () => undefined,
    { patch: false, snapshot: false }, () => false, () => true, 2,
  ).catch((error) => error.message);
  return { outcome, queries, warnings };
}

test('the installed library carries the fix once, inside the sync loop', async () => {
  const { fix, file } = await load();
  const source = fs.readFileSync(file, 'utf8');
  assert.equal(source.split(fix.MARKER).length - 1, 1);
  assert.ok(cutLoop(source).includes(fix.MARKER));
});

test('with WhatsApp not answering, the patched loop sends one query and ends', async () => {
  const { file, extractSyncdPatches } = await load();
  const result = await run(cutLoop(fs.readFileSync(file, 'utf8')), extractSyncdPatches);
  assert.equal(result.outcome, 'ended');
  assert.equal(result.queries, 1);
  assert.deepEqual(result.warnings, ['app-state sync got an empty answer, ending this pass']);
});

test('the same loop without the fix keeps sending queries (the failure it removes)', async () => {
  const { fix, file, extractSyncdPatches } = await load();
  const unchanged = fs.readFileSync(file, 'utf8').replace(fix.REPLACEMENT, fix.TARGET);
  assert.ok(!unchanged.includes(fix.MARKER));
  const result = await run(cutLoop(unchanged), extractSyncdPatches);
  assert.equal(result.outcome, 'still looping');
  assert.equal(result.queries, 6);
});

test('the fix applies once, stands down when present, and refuses an unknown shape', async () => {
  const { fix } = await load();
  const once = fix.applyAppStateLoopFix(`a\n${fix.TARGET}\nb`);
  assert.equal(once.alreadyApplied, false);
  assert.ok(once.source.includes(fix.MARKER));
  const twice = fix.applyAppStateLoopFix(once.source);
  assert.equal(twice.alreadyApplied, true);
  assert.equal(twice.source, once.source);
  assert.throws(() => fix.applyAppStateLoopFix('no such line'), /exactly once, found 0/);
  assert.throws(() => fix.applyAppStateLoopFix(`${fix.TARGET}\n${fix.TARGET}`), /exactly once, found 2/);
});
