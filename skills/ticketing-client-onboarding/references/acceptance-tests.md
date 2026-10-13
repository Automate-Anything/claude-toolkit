# Onboarding acceptance checklist (user-verifiable)

"Done" means these pass in the running client app AND show up in the Meridian
control plane - on phone, tablet, and desktop, in light and dark.

## Widget (client app)
- [ ] Avatar menu → Support → Submit a ticket opens the bottom-right dialog.
- [ ] Title/description/type/priority submit; page URL + app version + browser/OS
      are captured automatically into the ticket's context.
- [ ] Attach a file, drag-drop an image, AND paste an image each attach.
- [ ] Snip: dialog hides → browser picker → one frame captured → capture stops →
      dialog reopens with the screenshot attached → optional crop.
- [ ] Snip button is disabled (with a tooltip), not dead, where `getDisplayMedia`
      is unavailable; paste/drag/attach still work (Safari fallback verified).
- [ ] Oversized/blocked file rejected client-side with a clear message.
- [ ] Widget matches the host theme in light AND dark; usable at 320px; tap targets ≥44px;
      keyboard + focus + Esc work; reduced-motion honored.

## Hub round-trip
- [ ] Submitting creates a ticket in the Meridian hub scoped to the right company,
      with the screenshot attached and reporter context intact; the client sees a
      ticket number.
- [ ] The new ticket notifies the agency (in-app + email; desktop/push if enabled).
- [ ] A status/comment change in the hub propagates back to the client app (down-webhook
      verified end-to-end), and the end-user sees updated status / can read the reply.
- [ ] The client's submit options were NOT reduced by the hub integration.

## Security
- [ ] The browser never holds a hub API key; all hub calls go through the client app's
      backend with the key server-side.
- [ ] The down-webhook signature is verified before the client app trusts a payload.
- [ ] The API key is scoped to exactly this company/app and only ticket scopes.

## Agent readiness
- [ ] The client's repo is registered in the hub's repo allowlist so the autonomous
      agent may work its tickets; a test ticket is pickable.
