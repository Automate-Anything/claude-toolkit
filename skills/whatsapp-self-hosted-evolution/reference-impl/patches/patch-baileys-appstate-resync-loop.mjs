// Build-time patch for the Baileys library inside Evolution API (run after `npm ci`, or on the
// pinned image, see SKILL.md section 3.5). Checked against baileys 7.0.0-rc.9 (Evolution 2.3.7)
// and 7.0.0-rc13.
//
// resyncAppState (lib/Socket/chats.js) loops `while (collectionsToHandle.size)` until every
// app-state collection (labels, mutes, pins, archive) says it has no more patches. Each pass sends
// one query. query() is given no timeout of its own, so waitForMessage uses the library default of
// 60 seconds and, when it runs out, RESOLVES undefined instead of throwing.
// extractSyncdPatches(undefined) is {}. Every way out of the loop (each collectionsToHandle.delete
// and the attempts guard) is inside `for (const key in decoded)`, which never runs on {}. So one
// unanswered query makes the loop send a blind query every 60 seconds for as long as the socket
// lives (about 1,000 a day per number, every one through that number's proxy), and an answer with
// no collections in it spins the loop with no wait at all.
//
// The fix: an empty decode ends this sync pass. WhatsApp's next server_sync notification, or the
// next connect, runs the sync again. Same fix as OpenWA's scripts/patch-baileys-appstate.js
// (https://github.com/rmyndharis/OpenWA, MIT).
//
// Exact and self-disabling: it exits non-zero (failing a Docker build) if the target is not found
// exactly once, so a library upgrade cannot drop it silently. Delete it when Baileys bounds the loop.
//
//   node patch-baileys-appstate-resync-loop.mjs        (from the folder that holds node_modules)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MARKER = '[patch] an empty app-state answer ends this sync pass';

export const TARGET = [
  '                const decoded = await extractSyncdPatches(result, config?.options);',
  '                for (const key in decoded) {',
].join('\n');

export const REPLACEMENT = [
  '                const decoded = await extractSyncdPatches(result, config?.options);',
  `                if (!Object.keys(decoded).length) { // ${MARKER}`,
  "                    logger.warn({ collections: [...collectionsToHandle] }, 'app-state sync got an empty answer, ending this pass');",
  '                    break;',
  '                }',
  '                for (const key in decoded) {',
].join('\n');

/** The change on the text of chats.js. Returns the new text and whether it was already there. */
export function applyAppStateLoopFix(source) {
  if (source.includes(MARKER)) return { source, alreadyApplied: true };
  const count = source.split(TARGET).length - 1;
  if (count !== 1) {
    throw new Error(`expected the resyncAppState decode line exactly once, found ${count}; check whether the loop is still unbounded in this Baileys version`);
  }
  return { source: source.replace(TARGET, REPLACEMENT), alreadyApplied: false };
}

/** Where the installed library's chats.js is, from the folder npm ci ran in. */
export function chatsFile(cwd = process.cwd()) {
  const require = createRequire(join(cwd, 'package.json'));
  const pkgPath = require.resolve('baileys/package.json');
  const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  return { file: join(dirname(pkgPath), 'lib', 'Socket', 'chats.js'), version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { file, version } = chatsFile();
  try {
    const result = applyAppStateLoopFix(readFileSync(file, 'utf8'));
    if (result.alreadyApplied) {
      console.log(`[patch] baileys ${version}: app-state resync loop fix already applied`);
    } else {
      writeFileSync(file, result.source);
      console.log(`[patch] baileys ${version}: an empty app-state answer now ends the sync pass`);
    }
  } catch (error) {
    console.error(`[patch] baileys ${version}: ${error.message}`);
    process.exit(1);
  }
}
