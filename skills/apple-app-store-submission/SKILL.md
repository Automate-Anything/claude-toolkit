---
name: apple-app-store-submission
description: The field guide for getting an iOS app APPROVED on the Apple App Store the first time, distilled from a real submission that was rejected multiple times before passing. Read this BEFORE you build or submit ANY iOS app, and BEFORE you touch auth, signup, subscriptions/billing, account deletion, Sign in with Apple, or the App Store Connect metadata/screenshots/review-notes of an app you intend to ship to Apple. It covers the guidelines that actually get apps rejected (3.1.1 in-app purchase / "reader" and B2B rules, 2.1 app completeness + information requests, 4.0/4.8 Sign in with Apple, 5.1.1(v) account deletion, 2.3.x screenshots, 5.1.1 data collection/purpose strings), the code patterns that satisfy each (with notes for a Capacitor/webview app), the App Store Connect submission checklist (screenshots sizes, demo account, review notes, export compliance), and the mechanical lessons (build/sign via CI, capture screenshots at the right pixel sizes, record the review video, pull files off a wired iPhone). Use when the user mentions the App Store, App Store Connect, TestFlight, an Apple rejection, a guideline number (3.1.1, 2.1, 4.0, 5.1.1, 2.3), "guideline", app review, review notes, demo account, account deletion requirement, Sign in with Apple, In-App Purchase / IAP, screenshots for the store, "why did Apple reject", or shipping/resubmitting an iOS app. This is Apple-specific.
---

# Getting an iOS app APPROVED on the App Store (first time)

> **Why this skill exists.** A real iOS app was rejected by App Review
> **multiple times** before it passed, each round surfacing a new guideline that
> should have been satisfied up front. Every rejection cost days. This skill is the
> checklist that would have made the FIRST submission pass. Read it before you
> build the auth/billing/account surfaces of any iOS app, and again before you
> hit Submit. It is app-agnostic: the patterns apply to any app, B2B or
> consumer-facing.
>
> ⚠️ **Adapt to your app.** Where this skill says "the pattern we shipped" and
> names files or a specific stack, treat those as a reference implementation of a
> Capacitor/webview app. Map each pattern onto your own codebase, and once you've
> shipped an app from this repo, update this skill with your real bundle id, CI
> workflow, and account facts so the mechanical sections become concrete.

> **The one-line mental model:** Apple reviews the *build you submitted*, on a
> *real device*, as a *real user*, and reads your *review notes*. Anything a
> reviewer can reach that violates a guideline is a rejection, even if "a real
> user would never do that." Build for the reviewer's worst-case path.

---

## 0. The rejection scoreboard (what actually got us rejected)

Learn these by heart. Every one is preventable. The guideline number is what
Apple cites in the rejection message; the "real cause" is what you actually have
to change.

| Guideline | Apple's words | Real cause | The fix (this skill's section) |
|---|---|---|---|
| **3.1.1** | "Remove the account registration features for business and organizations" | The app let a business **create an account** (which leads to a paid subscription) inside the app, outside In-App Purchase | §3, no signup / no purchase surfaces inside the iOS app |
| **4** (Design) | "Sign in with Apple ... requires users to provide their name/email even though that information is already provided" | A post-Apple-sign-in screen re-asked for the name Apple's framework already returned | §4, consume Apple's name/email, never re-ask |
| **5.1.1(v)** | "The app supports account creation but does not include an option to initiate account deletion" | Deletion existed but was hard to find and labelled "workspace" not "account"; and the reviewer needs to SEE it complete | §5, findable, clearly labelled, recorded end-to-end |
| **2.1** (App Completeness) | "We need additional information ... provide a demo video / device list / business model" | New app, insufficient review notes + no demo account context | §6, review notes + demo account + video |
| **2.1(b)** (Information Needed) | 5 business-model questions | Apple couldn't tell how money works and whether IAP is owed | §3 + §6, answer all 5 in writing |
| **2.3.3 / 2.3.x** | "Screenshots must show the app in use, not the login page / wrong dimensions" | Screenshots were the auth screen, or the wrong pixel size for the slot | §7, signed-in shots at exact sizes |
| **5.1.1** (Privacy) | dead privacy URL / labels don't match / no ATT prompt | The **largest rejection bucket overall**: privacy policy, nutrition labels, ATT | §8 |
| **5.1.2(i)** (NEW, Nov 2025) | personal data sent to third-party AI without consent | An AI feature calls OpenAI/Anthropic/etc. with user content and no named-provider consent modal | §8 |
| **Privacy manifest** | auto-rejected at UPLOAD | Missing `PrivacyInfo.xcprivacy` / required-reason API codes / an out-of-date SDK | §8 |

**The meta-lesson:** these are not bugs, they are *policy*. You cannot test your
way to knowing them. You have to design for them before you write the auth page.
Two are enforced by machines, not reviewers (the privacy manifest at upload, and
the required-reason-API check), those reject the build before a human ever sees it.

---

## 1. Do this BEFORE writing any code (the pre-flight)

Answer these about the app you are about to build. Each answer forces a design
decision that, if skipped, becomes a rejection.

1. **Does the app let anyone create an account?** If yes → account deletion is
   **mandatory and must be reachable + completable in-app** (§5). No exceptions.
2. **Is there any way to buy anything, or unlock a paid feature?** If yes → it
   must go through **In-App Purchase**, OR it must qualify for an exception (B2B,
   "reader", physical goods/services) and be structured accordingly (§3). Getting
   this wrong is the single most common and most expensive rejection.
3. **Who pays, and are they consumers or businesses?** This decides whether IAP
   is owed at all (§3). Write the answer down now; you will paste it into review
   notes verbatim (§6).
4. **Does it offer Sign in with Apple?** If it offers ANY third-party login
   (Google, Facebook, etc.), Apple sign-in is **required** as an equivalent
   option, and it must be implemented to spec (§4).
5. **What data does it collect, and why?** Every sensitive permission needs a
   purpose string that explains the "why" with an example (§8). The App Privacy
   questionnaire must match reality (§8).
6. **Is it consumer-facing with user-generated content?** If users can post
   content others see, you owe **moderation, reporting, blocking, and a EULA**
   (§9, the consumer-app section). This is new territory for a customer-facing
   app and is aggressively enforced.

If you can answer all six and have a plan for each, you are ready to build. If
not, you are about to ship a rejection.

---

## 2. The platform reality (Capacitor / webview apps specifically)

If your iOS app is a **Capacitor (or similar) shell around a web app**, that shapes
every fix below. The reference implementation this skill draws from was a
React/Vite web app wrapped in Capacitor:

- **One codebase, two platforms.** The auth page, billing screens, and account
  settings are the SAME web code that renders in the browser. You cannot make a UI
  change "iOS only" by editing a different file; you gate it at runtime.
- **Have one native gate helper** (`isNative` / `isIOS`, from
  `Capacitor.isNativePlatform()` / `getPlatform() === 'ios'`). Every
  Apple-compliance branch keys off these. Web and Android must be unaffected.
- **Open external URLs with an in-app browser helper.** On native it opens an
  `SFSafariViewController` / Custom Tab; on web it's a normal navigation. This is
  how you send a user "to the website" without violating anything.
- **Copy changes are shared.** Rewording "Delete workspace" -> "Delete account"
  improves web too, that's fine. Only *structural* behavior (hiding signup,
  blocking a screen) gets `isNative`-gated.
- **The webview may load remote JS.** If the config points at your live site, the
  app runs the deployed bundle, not the one in the build. For screenshots /
  review builds you may want the *bundled* assets instead (see §7).

---

## 3. Guideline 3.1.1: payments, IAP, and the B2B exception (the big one)

This is the rejection that costs the most and confuses the most. Read it twice.

### The rule

If your app **unlocks features or content via a purchase or subscription**, that
purchase must use **In-App Purchase** and Apple takes its cut, UNLESS you fall
into a specific exception. Critically, Apple treats **the ability to register /
create an account that leads to a paid plan** as "an external mechanism for
purchase," and will order it removed from the app.

### The exceptions (know which one you are)

- **Business / enterprise (B2B) apps sold to organizations, not consumers.**
  This is the classic B2B SaaS case. A company subscribes on the web; staff sign in on the app
  to do their job. Apple does **not** require IAP for this, but it **does**
  require that the app contain **no signup and no purchase UI**. The app is
  sign-in only. (This is why Slack, Salesforce, Shopify POS have no sign-up
  button on iOS.)
- **"Reader" apps** (Netflix, Spotify, Kindle): may let users access
  previously-purchased content, but historically could not link out to buy.
  (Rules here shifted with the 2025 US injunction, see below.)
- **Physical goods & services** consumed outside the app (Uber, Amazon): pay
  outside IAP, that's allowed.
- **Consumer digital content/features** (a game unlock, a pro tier in a consumer
  app): **must** use IAP. No wiggle room. Apple states it flatly in 3.1.3(c):
  **"Consumer, single user, or family sales must use in-app purchase."** If your
  NEXT app is consumer-facing and sells a subscription to consumers, **you will owe
  IAP**: budget for Apple's cut, and see §9.2 for the paywall display rules and
  the required Restore Purchases button. Do NOT try to reuse the B2B "send them to
  the web" pattern for consumer sales; that's a rejection.

### What we did for the B2B case (the pattern)

For the iOS build only (`isNative`):
1. **No Sign Up tab** on the auth page. Hide the signup tab when `isNative`, and
   make any `?signup=true` deep link land on Sign In.
2. **NO "create your account on our website" link on iOS.** ⚠️ HARD-WON LESSON:
   a real submission treated that link as "safe" (a Sign In tab plus a post-OAuth
   blocked card with an "Open [your site]" button), and **Apple rejected it under
   3.1.1**: "The app includes an account registration feature ... considered access
   to external mechanisms for purchases", next step "Remove the account registration
   features". The LINK ITSELF is the registration feature. On iOS there must be ZERO
   signup pointers: no link, no "sign up on our website" copy, no URL. A neutral "No
   account found" dead-end is the accepted pattern (what Slack does). Android native
   may keep the web link (Play allows it), so gate the removal on `isIOS`, not
   `isNative`.
3. **The post-signup profile screen can't render on native.** Make it return a card
   when `isNative`, so no account can be born in the app and no name/business is
   collected there. ⚠️ On iOS that card must be a pure "No account found" screen
   (sign-out button only, no web link): an earlier round's "finish setting up on the
   web" + "Open [your site]" button led the reviewer to the web signup form (which
   asks name/email) and was rejected under **Guideline 4** ("required to provide
   name/email after Sign in with Apple") and doubled as the 3.1.1 registration
   pointer. A fresh Apple/Google identity on iOS also skips
   trial provisioning + onboarding entirely (route a fresh native identity straight
   to the no-account screen).
4. **No pricing / plan-purchase screens on native, and on iOS not even a
   "manage billing on the web" LINK.** Hide the plans route and upgrade CTAs on all
   native. ⚠️ HARD-WON LESSON: the tempting posture ("billing read-only + a single
   Manage-plan-on-the-web button") is the same pointer-is-the-violation problem as
   the signup link. Introduce a single gate (e.g. `canShowWebBillingLink` = Android
   native only), make the open-web-billing action a hard no-op on iOS, neutralize or
   hide every trial/upgrade/limit banner and dialog on iOS, and on the iOS billing
   tab show plan names + dates but NO dollar amounts. Gate any NEW billing pointer on
   that one flag, never bare `isNative`.

### The US external-link injunction: current state (know it, don't over-rely on it)

Timeline: April 2025 a US court found Apple in willful contempt and forced it to
allow external-purchase links/buttons/CTAs on the **US storefront** with no
entitlement and **0% commission** (down from 27%). **Dec 11, 2025** the Ninth
Circuit partially reversed and said Apple *may* charge a fee covering its costs/IP,
and remanded to set a "reasonable" rate. As of now the **0% US external-link
commission still stands until the district court sets a rate**: but it's US-only,
still in flux, and Apple still reviews the surrounding UX. **The safe, universal
design is still "no purchase UI in the app."** Codified in the guidelines as: 3.1.3
anti-steering applies **except on the US storefront**; reader apps (3.1.3(a)) and
US apps may include purchase links. Lean on the injunction only deliberately, only
for the US, and expect scrutiny.

### Guideline numbers to cite precisely (they're renumbered/specific)

- **3.1.3(a)**: reader apps (magazines, newspapers, books, audio, music, video).
- **3.1.3(c)**: the **enterprise/B2B exception** a B2B app relies on: "sold
  directly by you to organizations... **Consumer, single user, or family sales
  must use in-app purchase.**"
- **3.1.3(e)**: physical goods/services consumed outside the app (pay outside IAP).
- **3.1.1** also bans other unlock mechanisms (license keys, QR codes, crypto),
  requires a **restore** mechanism, non-expiring IAP credits, and disclosed
  loot-box odds. Digital gift cards redeemable for digital goods = IAP only.

### The 5 business-model questions (Guideline 2.1(b)): pre-write these

Apple asks these to decide if you owe IAP. Answer all five in review notes:
1. Who are the users that will use the paid content/subscriptions/features?
2. Where can users purchase them?
3. What previously-purchased content/features can a user access in the app?
4. What paid features are unlocked in-app that do NOT use IAP?
5. Are the services sold to single users, consumers, or for family use?

The winning answers for a B2B app: users are **businesses**; purchasing happens
**only on the web**; the app only reflects access already bought; **nothing** is
purchased/unlocked in-app; sold to **businesses for business use**. If your answers
to #2/#4 would be "in the app," you owe IAP, go implement it, don't argue.

---

## 4. Guideline 4: Sign in with Apple, done to spec

### The rules that get you rejected

- **If you offer any third-party sign-in, you must offer Sign in with Apple** as
  an equivalent option (with narrow exceptions for apps using only your own
  account system, or an enterprise/education login).
- **Do not re-ask for data Apple already gave you.** Apple's `AuthenticationServices`
  framework returns the user's name and email **on first authorization**. If your
  app then shows a "complete your profile" form asking for name/email, that's a
  Guideline 4 rejection. Consume what Apple returned; only ask for things Apple
  cannot provide (e.g. a business name), and only when genuinely required.
- **Apple returns the name only ONCE** (first authorization). Capture it then and
  store it; you will not get it again. The identity token carries a stable user
  id and (if the user allowed) a relay email, but NOT the name on later logins.
- **Respect "Hide My Email."** Users may give you a private relay address. Treat
  it as a real, deliverable email; never require them to "fix" it.

### The pattern we shipped

- `src/lib/capacitor.ts appleNativeSignIn()` reads `givenName`/`familyName` from
  the first-authorization response and stashes them, exchanges the identity token
  with Supabase, and signs the user in.
- The screen that used to re-ask for the name (`CompleteProfile.tsx`) is now
  structurally unreachable on native (it returns a web-handoff card). So the app
  **cannot** re-ask, which is exactly what Guideline 4 wants. Even if you keep a
  profile screen, pre-fill from Apple's data and hide the fields Apple supplied.

### Design/HIG details reviewers check (this is guideline **4.8**, "Login Services")

- Prefer the **system button** (`ASAuthorizationAppleIDButton`). Custom is allowed
  but must follow the rules exactly.
- **Title text must be exactly one of three**: "Sign in with Apple", "Sign up with
  Apple", or "Continue with Apple". Nothing else.
- **Logo/title colors: black or white only.** No custom colors. Corner radius may
  be set to match your other buttons.
- **Default height 44 pt**; keep clear margin around it (≥ 1/10 of its height).
- Must be **at least as prominent** as the other sign-in options (equal placement/
  size, not buried below them).

### The 4.8 requirement, precisely

4.8 requires that if you use any third-party/social login to set up the primary
account, you ALSO offer a login option that (a) limits collection to name + email,
(b) lets the user **keep their email private** (Hide My Email relay), and (c)
doesn't collect app interactions for ads without consent. Sign in with Apple is the
one that satisfies all three. **Exceptions** (no alternative required): your own
account system only; or an **education/enterprise/business app that requires an
existing enterprise or education account**.

---

## 5. Guideline 5.1.1(v): account deletion (mandatory if you have signup)

### The rules

- **If the app supports account creation, it must support account deletion,
  initiated from within the app.** Deactivate/disable is NOT enough, it must
  actually delete.
- **It must be findable.** Reviewers look under Account / Settings. If it's buried
  or labelled something they don't recognize (we labelled it "Delete workspace"),
  they will report it as missing. Label it **"Delete account"** and put it where a
  user expects.
- **A grace period before permanent purge is allowed**, but the account must be
  clearly presented as deleted (access ends immediately). Don't phrase it as a
  "request" that "we'll process", that reads as a support ticket, which Apple
  rejects.
- **If deletion requires a website**, you may link out, but the app must link
  **directly to the deletion page**, not a generic support page. In-app is
  strongly preferred.
- **Highly-regulated industries** may require a customer-service step, but you
  must justify it. Don't use this unless you truly qualify.

### The pattern we shipped

- `src/components/settings/DeleteAccountSection.tsx`, owner-only, self-hides for
  non-owners. Confirm phrase (`DELETE MY ACCOUNT`) prevents accidents (allowed).
- Reworded all copy from "workspace" → "account" (EN + ES), and from "deletion
  request received, 72 hours" → "your account has been deleted, signing you out."
- Surfaced it on the **main Account page** (not only a buried Security tab), so a
  reviewer finds it immediately.
- Backend: confirming blocks every session immediately and schedules a full purge
  at +30 days (`purge_company` cron). Immediate lockout = "deleted now"; purge is
  the grace window.

### The recording Apple demands

Round 2 they required a **screen recording, on a physical device, of the full
deletion completing** (not cancelled): sign in → navigate to delete → confirm →
show the signed-out result. Record it on a **throwaway account**, never the demo
account (deleting the demo breaks the reviewer's login). See §10 for building a
throwaway account and §11 for capturing the video.

---

## 6. Guideline 2.1: App Completeness + the review-notes packet

New apps get an "information needed" hold if the reviewer can't fully exercise the
app. Prevent it by front-loading everything into **App Review Information → Notes**
and the demo account fields.

### The demo account (non-negotiable if there's a login wall)

- Put **working credentials** in the App Review sign-in fields (not just the
  notes). If there are multiple account types, provide one per type.
- The demo account must clear **every gate**: email confirmed, not blocked,
  profile complete, phone verified (if you gate on it), and an **active
  subscription so no paywall** blocks the reviewer. A demo account stuck behind
  your own paywall/onboarding is an instant "we couldn't access the app."
- ⚠️ **The demo subscription must stay clean for the WHOLE review window, not
  just on submit day.** Round-3 lesson (2026-08-25): the demo account's trial
  was set to end 2026-08-24 and Apple reviewed on 2026-08-25, so the reviewer
  met the "trial ended" dialog and inactive-subscription banners whose CTAs
  pointed at web billing, feeding a 3.1.1 citation. Before EVERY submission,
  verify `trial_end` / `current_period_end` on the demo subscription are at
  least 60 days out, the AI/credit wallet is funded, and no lifecycle banner
  can fire mid-review.
- The demo account must **survive review**: never let a flow (like the deletion
  recording) delete it.

### The review-notes packet (paste all of this)

1. What the app is, who it's for, the problem it solves (2-3 sentences).
2. How to sign in (demo creds) and reach the main features.
3. The 5 business-model answers (§3).
4. Devices + OS you tested on.
5. External services powering core features (auth, payments, messaging, AI, etc.).
6. Whether features/content differ by region (or confirm they don't).
7. Any regulated-industry or third-party-material authorization, if applicable.
8. A link/attachment to a **demo video** if the app is non-obvious (see §11).

### The demo video (when asked, or proactively for a complex app)

One continuous recording, **on a real device**, **starting from app launch**,
walking the core flows. If the app has account creation/login/deletion, paid
flows, user-generated content + reporting/blocking, or sensitive-permission
prompts, **show each of them**. No narration required.

---

## 7. Screenshots (Guideline 2.3.3): the mechanical trap

### The rules

- **Show the app in use**, not the login page, splash, or title art. Signed-in,
  real screens with representative content.
- **Exact pixel dimensions per device slot.** Wrong size = hard reject at upload.
  You upload per device family (iPhone, iPad); the largest size in each family
  usually scales down to the smaller slots.

### Current required sizes (2025-2026; verify against App Store Connect each time: Apple changes these)

You only need the **largest slot per family**; Apple scales it down to the smaller ones.
Upload iPhone **6.9"** and iPad **13"** and you're covered. Format: `.png`/`.jpg`, **no
alpha/transparency**, 1-10 images per slot.

| Slot | Portrait | Status |
|---|---|---|
| **iPhone 6.9"** (17/16/15 Pro Max, iPhone Air) | **1320 × 2868** | **The one required iPhone upload** (or give 6.5" instead) |
| iPhone 6.5" (14 Plus, 13/12/11 Pro Max, XS Max, XR) | **1284 × 2778** | Required only if you don't provide 6.9" |
| iPhone 6.3" (17/16/15 Pro) | 1206 × 2622 | Optional (scales from 6.5"+) |
| **iPad 13"** (iPad Pro M4/M5, iPad Air M2+) | **2064 × 2752** | **Required for iPad apps** |
| iPad 12.9" (Pro 2nd gen) | 2048 × 2732 | Optional (scales from 13") |

Note: an old **1242 × 2688** is the legacy XS Max/11 Pro Max geometry; current App Store
Connect pairs the 6.5" slot with **1284 × 2778**. When in doubt, capture 6.9" = **1320 × 2868**
and iPad 13" = **2064 × 2752** and let Apple downscale.

A screenshot taken on an **older/smaller device** (e.g. iPhone SE, 750 × 1334)
is BOTH the wrong resolution AND the wrong aspect ratio (16:9 vs 19.5:9), it can
never be resized to fit. You must capture at the right geometry.

### How to capture at the right geometry without that exact device

- **A real Pro Max / 13" iPad**: native screenshots are already correct.
- **The iOS Simulator** (macOS/CI): boots a device of the exact class;
  `xcrun simctl io <udid> screenshot` renders native pixels. Apple accepts
  simulator screenshots. Use `simctl status_bar override --time 9:41 ...` for the
  clean marketing status bar. (A CI workflow that boots an iPad Pro 13" sim and
  captures works well, see the CI notes in §12.)
- **A webview app is a web app**: for signed-in screens you can drive the SAME
  site in a desktop browser at the exact device viewport
  (e.g. chrome-devtools MCP `emulate` at `1032×1376×2` = 2064×2752 physical for
  iPad 13"), sign in, navigate each page, and screenshot at true pixels. This was
  faster than a sim-login harness for us. Verify each PNG is the exact size.
- **Framing older captures**: if you must reuse small on-device captures, compose
  each onto a correct-size canvas (headline + the screen in a card). Acceptable,
  but plainer than real full-bleed captures.

---

## 8. Guideline 5.1.1 / 5.1.2: privacy (the #1 rejection bucket overall)

Privacy (5.1.1) is the single largest source of rejections. Treat this section as
mandatory, not optional polish.

- **Purpose strings** (`Info.plist` `NS...UsageDescription`): every sensitive
  capability (camera, mic, location, contacts, photos, notifications, tracking)
  needs a string that says **why** and gives an **example** of use. "We need
  access to your camera" is a reject; "Used to scan product barcodes when adding
  inventory" passes.
- **App Privacy nutrition labels** must match reality **including all third-party
  SDK / analytics / ad data**: what you collect, whether it's linked to identity,
  whether it's used to track. A label that says you "track" with **no ATT prompt**
  (or the reverse) is a classic rejection.
- **App Tracking Transparency**: if you link user/device data with third-party data
  across apps/sites, or share to a data broker, you must call
  `AppTrackingTransparency` and show the prompt **before** accessing IDFA/tracking,
  with an `NSUserTrackingUsageDescription` string.
- **Privacy policy URL is required and must be live/reachable.** A dead privacy URL
  is a 5.1.1 reject.
- **Data minimization (5.1.1(iii))**: only request data relevant to core function;
  prefer the out-of-process picker / share sheet over full Photos/Contacts access.
  Requiring registration for features that don't need an account is a 5.1.1 issue.
- **Account-deletion + data**: the deletion flow must actually delete the user's
  data (or explain lawful retention like tax records), not just the login.

### ⭐ 5.1.2(i): third-party AI consent (NEW, enforced Nov 2025), READ if the app uses AI

Apple now requires: **"You must clearly disclose where personal data will be shared
with third parties, including with third-party AI, and obtain explicit permission
before doing so."**

- **Triggered by** sending user messages, voice, photos, documents, or any personal
  content to a third-party LLM or cloud AI (OpenAI, Anthropic, Google Gemini,
  Mistral, Cohere) or a cloud transcription/vision service. Any app with AI drafting,
  voice transcription, auto-replies, or similar does this, so it applies to any
  AI-using app.
- **Requires an in-app consent modal, shown BEFORE the first such call**, that
  **names the specific provider(s)**, states the purpose, and captures explicit
  consent. A privacy-policy link alone is **NOT** sufficient.
- **On-device inference (Core ML / Apple Foundation Models) does NOT trigger it** -
  data never leaves the device.
- Violation → app removal. Design the consent gate into any AI feature up front.

### ⭐ Privacy Manifest + Required-Reason APIs (`PrivacyInfo.xcprivacy`): automated submit-time gate

This is **not** a reviewer judgment call, App Store Connect **rejects the upload
automatically** if it's wrong. Since **May 1, 2024**, an app (and its third-party
SDKs) that uses a "required reason" API without declaring it in a privacy manifest
is not accepted.

- The manifest is a plist named **`PrivacyInfo.xcprivacy`** in the app target,
  holding `NSPrivacyAccessedAPITypes` (required-reason declarations),
  `NSPrivacyCollectedDataTypes` (feeds the nutrition label),
  `NSPrivacyTracking` / `NSPrivacyTrackingDomains`.
- **Third-party SDKs on Apple's "requires a privacy manifest and signature" list**
  must ship their **own signed** manifest. If a flagged SDK/pod lacks it, the build
  is rejected → **update those pods to manifest-shipping versions** before archiving.
  Xcode 15+ merges everything into a **Privacy Report**: check it before submit.
- **The 5 required-reason API categories** and you must declare the **exact approved
  reason code**:
  - `NSPrivacyAccessedAPICategoryFileTimestamp` (file dates) → e.g. `C617.1`, `3B52.1`, `0A2A.1`, `DDA9.1`
  - `NSPrivacyAccessedAPICategorySystemBootTime` (uptime) → `35F9.1`, `8FFB.1`, `3D61.1`
  - `NSPrivacyAccessedAPICategoryDiskSpace` → `E174.1`, `85F4.1`, `7D9E.1`, `B728.1`
  - `NSPrivacyAccessedAPICategoryActiveKeyboards` → `3EC4.1`, `54BD.1`
  - `NSPrivacyAccessedAPICategoryUserDefaults` → `CA92.1` (app-scoped, the common one), `1C8F.1`, `C56D.1`, `AC6B.1`
- **The most common trigger is `NSUserDefaults`**: nearly every app (and most
  Capacitor plugins) touches it. Declare it, usually with `CA92.1`.
- **Capacitor specifics**: Capacitor/Cordova plugins commonly touch `NSUserDefaults`,
  file timestamps, and disk space. Add a `PrivacyInfo.xcprivacy` to the App target,
  make sure Capacitor core + every native plugin pod is on a manifest-shipping
  version, and verify the consolidated Privacy Report in Xcode before archiving.

---

## 9. Consumer-facing apps: the extra bar (READ before building any consumer app)

A **customer-facing** app (your users' customers, i.e. real consumers) is held to
EVERYTHING a B2B app is, PLUS UGC/safety, PLUS IAP for any consumer purchase, PLUS
stricter privacy, PLUS the whole minors regime. **The B2B "no signup, no purchase
UI" pattern from §3 does NOT transfer**: a consumer app WANTS guest browsing, Sign
in with Apple, and (if it sells anything digital) In-App Purchase. Design all of
this up front.

### 9.1 User-Generated Content (Guideline 1.2): 4 mechanisms + EULA, all testable

If users can post content others can see, the app **must** include, and a reviewer
will actively test for, all four:
1. **Proactive filtering** of objectionable material *before* it's posted (the
   most-missed one, teams build report/block but skip pre-publication filtering).
2. **A report mechanism** on every piece of content, plus timely responses.
3. **Block abusive users** from the service (on every user profile).
4. **Published contact information** so users can reach you (must be reachable).
Plus a **EULA** the user agrees to, and evidence you **act on reports**.

- Put **Report** and **Block** on every post and every profile, obviously, the
  reviewer must SEE them in the running app.
- **1.2.1 Creator Content**: if creators post, provide a way to flag content above
  the app's age rating and an age-restriction mechanism (verified/declared age).
- **Removal timeframe**: Apple's guideline does **not** state a hard "24-hour"
  clock (earlier drafts of this skill implied one, that was wrong). The rule is
  "remove violating content; act promptly; egregious content immediately." Apple's
  lever is **app removal**, not a stated deadline.
- Apps that become primarily porn/anonymous-chat/hot-or-not/bullying "may be
  removed without notice."

### 9.2 Consumer purchases → In-App Purchase is MANDATORY (3.1.1 / 3.1.2)

The §3 B2B exceptions do NOT cover consumers. Verbatim: **"Consumer, single user,
or family sales must use in-app purchase."** So any digital subscription, unlock,
currency, or premium tier sold to a consumer **owes IAP** (budget for Apple's cut).
Nuances:
- **3.1.3(d) person-to-person**: a **1:1** real-time service (tutoring, consult)
  MAY bill outside IAP; **one-to-many** (a class, a broadcast) MUST use IAP.
- **3.1.3(e)** physical goods/services consumed outside the app → non-IAP (Apple
  Pay/card). Digital = IAP; real-world = not IAP.

**Subscription paywall display (3.1.2), a very common repeat rejection.** On the
purchase screen *inside the app*, adjacent to the buy button, show ALL of:
1. Title, 2. Length/duration, 3. Price (+ price-per-unit if relevant),
4. a **functional** Privacy Policy link, 5. a **functional** Terms of Use (EULA)
link. Reviewers click these, a 404 or blank webview fails. **Also** put the
Privacy URL in the ASC field, and the EULA link in the App Description (standard
EULA) or the ASC EULA field (custom EULA). You need BOTH places.
- **Restore Purchases is REQUIRED** (a visible button). Omitting it is a rejection.
- Auto-renewable subs must be **≥7 days**, work across the user's devices, provide
  ongoing value; disclose free-trial duration + what's lost when it ends BEFORE it
  starts. Purchased credits may not expire. No bait-and-switch pricing.

### 9.3 Minors, Kids Category, and the 2025 age system (1.3 / 5.1.4 / 2.3.8)

- **Kids Category (1.3)**: no external links, no purchases, no third-party
  analytics, no third-party ads (narrow contextual-ad exception with human-reviewed
  creatives), no PII/device info to third parties, anything that must exist goes
  **behind a parental gate**.
- **5.1.4**: comply with COPPA/GDPR-K; you need **BOTH** a **parental gate**
  (gates purchases/links) **AND verifiable parental consent** (to collect data) -
  they are not the same thing; teams conflate them. Any app that can collect a
  minor's PII needs a privacy policy and children's-privacy-law compliance.
- **2025 age system (build to this now)**: rating tiers are now
  **4+ / 9+ / 13+ / 16+ / 18+**; Kids bands are **5&under / 6-8 / 9-11**. The
  **Declared Age Range API** tells the app a child's age *range* (not birthdate) -
  Apple expects you to call it before enabling social features. **Social-media
  features must be off for under-13.** The new age-rating questionnaire asks about
  UGC, messaging/chat, ads, social, parental controls, age assurance, and
  unrestricted web access (web access forces 16+).
- **2.3.8**: "For Kids"/"For Children" wording is reserved for the Kids Category.
- **5.1.1(ix)**: highly-regulated fields must be submitted by a **legal entity**.

### 9.4 Safety (1.1 / 1.4): for messaging, dating, meetups, marketplaces

- **1.1.4** bans porn and explicitly names hookup/prostitution facilitation → any
  dating/meetup app is read closely here.
- **1.1.6** "Apps that enable anonymous or prank calls or SMS/MMS will be rejected"
 , anonymity in a comms app is a red flag; also bans fake functionality.
- **1.4** physical-harm rules: medical-measurement claims via device sensors,
  drugs/alcohol/tobacco facilitation, risky-challenge encouragement.
- Person-to-person meetups/marketplaces: expect scrutiny on safety controls
  (report/block are already mandatory as UGC), fraud/spam, and identity.

### 9.5 Consumer privacy + login specifics

- **Privacy policy (5.1.1(i))** required in **two** places: the ASC field AND
  in-app, easily accessible. Must state what's collected, third-party protection,
  and **retention/deletion + how to revoke consent**. A dead URL = auto-reject.
- **Guest browsing (5.1.1(v))**: "If your app doesn't include significant
  account-based features, let people use it without a login." Do NOT gate content
  behind registration it doesn't need, sharing/inviting/profile are not "core
  functionality" that justify a login wall. Consumer content apps get rejected for
  forcing signup before showing anything.
- **Sign in with Apple (4.8)** IS required for a consumer app offering Google/
  Facebook/etc. login, none of the §4 exceptions apply to consumer apps.
- **Optional contact info (5.1.1(x))**: basic contact-info requests must be
  optional; features may not be conditional on providing them. **5.1.2(i)**: may
  not gate functionality on enabling push/location/tracking.
- **Account deletion (§5)** still required, including **guest/auto-generated
  accounts**, a **direct deep-link** to the deletion page if it's web-based, and a
  subscription-billing notice (tell the user Apple billing continues, prompt to
  cancel; may align deletion with sub expiry but must also offer immediate delete).

### 9.6 The classic consumer/no-code rejection: "just a website" (4.2)

A thin WebView wrapper of a website is the #1 minimum-functionality rejection. The
app must "include features, content, and UI that elevate it beyond a repackaged
website" (4.2). For a Capacitor app this is real risk, add genuine native value
(push notifications, offline behavior, device features, native navigation), not
just the site in a shell. **This directly affects any webview/Capacitor-wrapped
consumer app**: make sure it does app-like things, not only render the web.

---

## 10. Building a throwaway/demo account correctly (from live DB)

You need (a) a reviewer **demo account** that survives and clears every gate, and
(b) a **throwaway account** to delete on camera. Build both from the **live**
signup path, verified against the live database, never from memory or a migration
file (they drift). The general recipe (adapt the column/trigger names to your app):

1. **Create the auth user** the way your signup does (confirmed email, hashed
   password, whatever provider metadata your signup trigger reads). If a trigger
   auto-provisions the account/profile on user creation, feed it the fields it
   needs so the profile lands complete.
2. **Clear every onboarding/verification gate** the app has (phone verification,
   profile-complete, etc.). If a gate is enforced by a DB trigger, use whatever
   sanctioned bypass exists rather than fighting it, and stamp the verified fields
   to match. If any such write is destructive or sensitive, get the user's approval
   first.
3. **Give the account active paid access** so no paywall blocks the reviewer: an
   active subscription/entitlement pointing at an all-features plan, with any
   invariant a guard trigger enforces satisfied (e.g. a non-null external billing
   id). Suppress any lifecycle emails/drips that would fire.
4. **Verify every gate in one query**: profile complete, not blocked, verifications
   passed, subscription active. If any is off, the reviewer hits a wall.

⛔ **DB discipline:** pull the live trigger/guard/plan definitions first, match
column names byte-for-byte against the live schema, and get explicit user approval
for any bypass or sensitive write. Follow this repo's own database-change gate.

---

## 11. Capturing artifacts off a wired iPhone (the practical mechanics)

Windows sees an iPhone as a portable device (MTP), exposing the camera roll under
`This PC → Apple iPhone → Internal Storage → DCIM`-equivalent folders (named like
`2026NN_a`). Practical, hard-won mechanics:

- **The phone MUST be unlocked** for the camera roll to appear over USB, and it
  **disconnects when it locks** (looks like "device not found"). Recording a video
  then locking the phone hides it.
- **iOS caches the file list over USB.** A file recorded *while connected* often
  won't appear until you **physically unplug and replug the cable with the phone
  unlocked** (a software refresh isn't enough). Symptom: "0 files from today" when
  you know you just recorded.
- **Enumerate via PowerShell** (`Shell.Application`, `NameSpace(17)` = This PC),
  walk the device folder, filter by modified date, and **CopyHere** the newest
  file to a local dir.
- **Images too large to read?** Downscale with Pillow, or OCR them with the
  built-in Windows OCR (`Windows.Media.Ocr`) to read on-screen error text -
  invaluable for reading an App Store Connect rejection screenshot the user pastes
  as a file.
- **Trim/stitch the video with ffmpeg.** Re-encode (not `-c copy`) for a
  frame-accurate cut so the recording *starts on app launch* (Apple wants that).
  Verify content by extracting frames + OCR before handing it over.

---

## 12. Build & ship mechanics (CI-driven, no local Mac needed)

- **A macOS runner is the compiler/signer/screenshotter.** On a Windows dev box
  there is no local Swift/Xcode; a GitHub Actions macOS runner does the build,
  sign, TestFlight upload, and simulator screenshots. `ios-release.yml` fires on a
  tag / `workflow_dispatch`; it does `pnpm install → vite build → cap sync ios →
  pod install → xcodebuild archive (signed) → export → upload to TestFlight`.
- **Build numbers must increase** for each resubmission. The workflow stamps
  `CURRENT_PROJECT_VERSION` from the CI run number, so a fresh run = a new build,
  no manual bump. Apple rejects a resubmit that reuses the rejected build number.
- **A resubmission needs the NEW build selected** on the version, PLUS the reply,
  PLUS any required video. A reply alone doesn't re-queue; you must Resubmit.
- **Cert quota is a real wall**: CI cloud-signing mints throwaway "Apple
  Development" certs; ~13 fills the quota and archives fail "maximum number of
  certificates." Only the account owner can revoke the pile (keep "Distribution
  Managed"). Pause-and-hand-off.
- **Simulator builds for screenshots** need no signing (`CODE_SIGNING_ALLOWED=NO`
  for unsigned, or ad-hoc `CODE_SIGN_IDENTITY=-` if you need entitlements like App
  Groups to persist a session). Simulator builds can't link device-only
  frameworks with no simulator slice (e.g. some MLKit pods), remove/guard them in
  the shots build.
- **The runner is a datacenter IP.** If your app has a geo/VPN/anti-fraud gate, it
  may block the runner (a real submission hit its own fraud wall on the review sim).
  For a screenshot/review build, load bundled assets (not the deployed bundle whose
  baked-in server URL re-triggers the gate) and make the gate fail-open when its
  backend is unreachable.

### Apple account facts (fill in for your app)

- Record your Team name + Team ID, the App name + Apple ID, and the bundle id here
  once you create them, so a fresh agent has them. The App Store Connect API key
  used for cloud signing must be an **Admin** role (App Manager fails cloud signing
  with "Cloud signing permission error").
- `ITSAppUsesNonExemptEncryption=false` in Info.plist clears the export-compliance
  question for a standard HTTPS app.

---

## 13. The pre-submit checklist (run this EVERY submission)

- [ ] **3.1.1**: no signup / no purchase / no pricing UI reachable on iOS (B2B), OR
      consumer purchases go through IAP. The 5 business-model answers are written.
- [ ] **4**: Sign in with Apple offered (if any 3rd-party login is), and nothing
      re-asks for the name/email Apple provides.
- [ ] **5.1.1(v)**: account deletion is in-app, labelled "Delete account",
      findable under Account/Settings, and actually deletes.
- [ ] **2.1**: demo account in the sign-in fields, clears every gate, survives
      review; review notes packet pasted (§6).
- [ ] **2.3.3**: screenshots show signed-in app at exact pixel sizes for each slot.
- [ ] **5.1.1 privacy**: purpose strings with "why + example"; App Privacy labels
      match reality (incl. SDK data); privacy-policy URL live in BOTH the ASC field
      and in-app; ATT prompt present iff you track.
- [ ] **Privacy manifest**: `PrivacyInfo.xcprivacy` present with the right
      required-reason codes (esp. `NSUserDefaults` → `CA92.1`); every flagged
      third-party pod on a manifest-shipping version; Xcode Privacy Report clean.
- [ ] **AI consent (5.1.2(i))**: if any feature sends user content to a third-party
      AI, a named-provider consent modal fires BEFORE the first call.
- [ ] **Consumer only (§9)**: guest browsing (no needless login wall); UGC
      filter+report+block + EULA; **IAP** for consumer purchases with paywall
      showing title/length/price + working Privacy/EULA links + Restore Purchases;
      age rating honest + Declared Age Range for social under-13; not "just a
      website" (4.2).
- [ ] **Build**: a NEW build number is uploaded and selected; export compliance set.
- [ ] **Required video(s)**: recorded on a real device, start at launch, show the
      demanded flows (deletion completing, etc.), attached to the reply AND notes.
- [ ] **Resubmit** actually clicked (not just a reply).

---

## 14. When you get rejected anyway (the response loop)

1. **Read the exact guideline number and the "Issue Description".** Apple tells
   you precisely what and often on which screen/device.
2. **Map it to the real cause** (§0 table). The citation is the symptom; find the
   thing to change.
3. **Fix in code, typecheck, new build.** For metadata-only issues (notes,
   screenshots, privacy), no build needed, but most guideline hits need a build.
4. **Reply addressing every point**, in plain professional English (no AI-slop, no
   em-dashes, the owner will notice). Say what you changed and attach any required
   video. Keep a living reply doc so each round builds on the last.
5. **Resubmit** (select new build + reply + attach + click Resubmit).
6. **Expect follow-ups.** B2B/IAP (3.1.1) especially can go a couple rounds even
   when you're right, answer the 5 questions crisply and hold the line that
   nothing is purchased in-app.

---

## Related

- `browser-verification`, driving the chrome-devtools browser (used for exact-size screenshots + reading pasted rejection screenshots).
- Android/Play is a separate store with separate rules; keep its submission notes in their own skill once you ship there.
- Once you've shipped from this repo, record your app's billing model (feeds the 3.1.1 answers), the demo/throwaway account credentials, and per-round submission state here or in a memory so the next round builds on the last.
