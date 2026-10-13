# The embedded support widget + screen-snip (stack-neutral)

The widget is identical in every client app and matches the HOST app's theme. It
is the ONLY thing end-clients touch - never reduce its options. It talks to the
client app's OWN backend, which proxies to the hub (see `hub-integration.md`); the
browser never holds a hub secret.

## Entry point & placement
- A **Support** item in the top-right **avatar/profile menu**; hovering/opening it
  reveals **Submit a ticket** (and, optionally, "My tickets").
- Clicking opens a compact dialog **docked bottom-right** (not a full-screen modal)
  so the user keeps their context. Draggable/dismissible; remembers an unsent draft
  (per-viewer localStorage, wrapped in try/catch).

## Compose fields
Title (required), description (multiline), type (bug / feature request / question /
other), priority (urgent / high / medium / low). Optional: the page URL, app
version, and browser/OS are captured **automatically** into a hidden `context`
payload so you don't ask the user for them.

## Attachments - four ways in, all required
1. **Attach file** - a normal file input.
2. **Drag-and-drop** - a dropzone over the dialog (`dragover`/`drop`, read `dataTransfer.files`).
3. **Paste** - a `paste` listener reads image items from `clipboardData.items`
   (`item.kind==='file' && item.type.startsWith('image/')` → `getAsFile()`).
4. **Snip screen** - the Screen Capture API (below).

Show thumbnails with remove buttons; enforce the hub's size/type limits client-side
before upload and surface a clear message on reject.

## The snip flow (the important one)
Web pages capture the screen via `navigator.mediaDevices.getDisplayMedia` - this is
the portable, cross-platform (macOS + Windows) path. The browser always shows its
own permission/picker first; that's expected and acceptable.

Exact sequence (this is the "hide dialog → capture → reopen" the client asked for):
```js
async function snip() {
  // 1. Hide our own dialog so it isn't in the shot.
  hideDialog();
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser" }, // hint: the current tab/app
      preferCurrentTab: true,               // Chromium: preselect this tab
      audio: false,
    });
  } catch (err) {
    showDialog();                            // user cancelled / unsupported
    return; // fall back to paste/drag/attach
  }
  // 2. Grab exactly one frame.
  const track = stream.getVideoTracks()[0];
  const video = document.createElement("video");
  video.srcObject = stream;
  await video.play();
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  // 3. Stop capture immediately (don't keep recording).
  track.stop();
  stream.getTracks().forEach((t) => t.stop());
  // 4. To PNG, reopen the dialog with it attached.
  canvas.toBlob((blob) => {
    attachScreenshot(new File([blob], `screenshot-${Date.now()}.png`, { type: "image/png" }));
    showDialog();
  }, "image/png");
}
```
- **Region snip**: `getDisplayMedia` returns a whole surface. For a rectangular
  region, capture then let the user **crop** in the dialog (a simple canvas crop
  tool), or capture just the current tab (`preferCurrentTab`) which is usually what
  a support screenshot needs.
- **Permission**: fine to prompt every time; you can ask once and explain why first.

## Cross-platform honesty (build it knowing this)
- **Chromium (Chrome/Edge) + Firefox on macOS AND Windows**: full support.
- **Safari**: supports `getDisplayMedia` with quirks - must be triggered by a user
  gesture, and may only offer whole-screen. **Feature-detect** (`if
  (!navigator.mediaDevices?.getDisplayMedia)`), and when absent degrade gracefully
  to paste / drag / attach (never show a dead "Snip" button - disable it with a tooltip).
- A web page **cannot** silently grab the OS desktop without the picker. A truly
  seamless OS-level region snip needs a **browser extension** or desktop app; if the
  agency ships one (Meridian has a browser extension), that's the v2 upgrade path -
  the extension can `chrome.tabs.captureVisibleTab` / desktopCapture without the picker.

## Accessibility & polish
- Keyboard: the Support menu and dialog are fully keyboard-operable; focus moves
  into the dialog on open and returns on close; `Esc` closes.
- Visible focus rings (host tokens), `aria-label`s on icon buttons, `role="dialog"`
  + `aria-modal` semantics, respect `prefers-reduced-motion` for the open/close.
- States: submitting (button spinner only), success (confirmation + ticket number),
  error (retryable message). Never a jarring jump.

## Theme
Bind every color/spacing/type to the HOST app's tokens/UI kit - the widget must
look native to each app, never like a pasted-in third-party bubble. Reuse the host's
Button/Dialog/Input primitives. See the `ticketing-system` skill's
`references/theme-adaptation.md` for how to discover and bind to any design system.
Do NOT copy another app's palette.

## Submit
On submit, POST to the client app's OWN backend endpoint (e.g. `/api/support/ticket`),
which forwards to the hub with the app's server-side API key and uploads the
screenshot per `hub-integration.md`. Show the returned ticket number. Store a local
mirror row if the app keeps one (hybrid). The reference implementation to mine is
`Automate-Anything/booking_pro_saas` (its Support widget + snip) - copy the working
approach and avoid the bug being fixed there.
