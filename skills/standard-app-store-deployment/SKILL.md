---
name: standard-app-store-deployment
description: "Standard 34 of the engineering standards library, scoped to the release ENGINEERING of a mobile app: everything except passing Apple review. Covers Google Play (AAB versus APK, testing tracks, staged rollouts, the Data Safety form, review times), Apple certificates, provisioning profiles and TestFlight tiers, APK sideloading, Android keystore and iOS signing management, version and build number rules, OTA updates with EAS Update, feature flags for synchronized rollouts, and App Store Optimization field limits. For Apple review guidelines, rejections, review notes and screenshots, read `apple-app-store-submission` instead. Read this BEFORE releasing to Google Play, generating or handling a keystore, bumping a version, publishing an OTA update, or distributing an APK, and when the user says \"Google Play\", \"Play Console\", \"AAB\", \"APK\", \"sideload\", \"keystore\", \"signing\", \"versionCode\", \"build number\", \"staged rollout\", \"TestFlight\", \"OTA update\", \"EAS Update\", or \"Data Safety form\"."
---

# App Store Deployment: Google Play, release mechanics, and direct APK

**Scope and what lives elsewhere.** Getting an iOS app APPROVED by Apple (guidelines 2.1, 3.1.1,
4.8, 5.1.1, account deletion, Sign in with Apple, review notes, demo account, screenshot sizes,
privacy manifest, the rejection response loop, CI build and sign mechanics) is owned by the
`apple-app-store-submission` skill. Read it before any Apple submission. This skill covers the
rest of the release process and does not repeat it.

> **Agent rule (overrides anything below that implies otherwise).** This standard describes how the
> project and its pipeline should be set up. An agent never commits, pushes, merges, runs
> history-changing git, triggers a deploy, or publishes a release on its own initiative. It does
> those only when the owner explicitly asks in the current conversation. Otherwise: make the change,
> say exactly what is ready, and offer the next step.

Building, submitting to a store, promoting a rollout, and publishing an OTA update are all
releases. The commands below are the reference for how it is done, not an instruction to run them.

## PHILOSOPHY
Shipping to app stores is not the last step. It is a continuous process with its own engineering discipline. A broken release process means you cannot ship fixes. Automate everything, protect your signing keys, and never skip the checklist.

## 1. GOOGLE PLAY STORE (ANDROID)

### Build Format:
- **AAB** (Android App Bundle): Required for Google Play since 2021. Google generates optimized APKs per device.
- **APK**: For direct distribution and sideloading only. Not accepted on Google Play.

### Release Process:
```
Code Complete -> EAS Build (AAB) -> Internal Testing Track ->
Closed Testing (Beta) -> Open Testing -> Production (Staged Rollout)
```

### Staged Rollouts:
- Start at 5-10% of users
- Monitor crash rate and ANR (Application Not Responding) rate
- If stable after 24-48 hours, increase to 25%, then 50%, then 100%
- Halt rollout immediately if crash rate exceeds 1%

### Data Safety Form:
- Required for all apps. Declare what data you collect, share, and why.
- Must be accurate. Google audits and will remove apps for false declarations.
- Update the form every time you add a new SDK or data collection feature.

### Google Play Review:
- First submission: 3-7 days (sometimes longer)
- Updates: Usually 1-3 days
- Rejections: Fix the issue and resubmit. Do not argue. Comply and move on.

## 2. APPLE APP STORE (iOS)

### Certificates and Provisioning:
```
Apple Developer Account ($99/year)
  -> Certificates (Development + Distribution)
    -> Provisioning Profiles (link cert + app ID + devices)
      -> Archive and Upload via Xcode or EAS
```

### Certificate Types:

| Certificate | Purpose |
|------------|---------|
| Development | Run on physical devices during development |
| Distribution (App Store) | Submit to App Store and TestFlight |
| Distribution (Ad Hoc) | Distribute to specific registered devices |
| Distribution (Enterprise) | Internal distribution (requires Enterprise account) |

### TestFlight:
- Internal testers: Up to 100 Apple Developer team members. Builds available immediately.
- External testers: Up to 10,000 users. Requires Apple review (usually 24-48 hours).
- Use TestFlight for all QA before production release.

### App Store Review:
The review guidelines, the common rejection reasons, and how to answer a rejection are not covered
here. Read the `apple-app-store-submission` skill before every Apple submission.

## 3. APK SIDELOADING (DIRECT DISTRIBUTION)

### When to Use:
- Beta testing outside TestFlight/Google Play internal tracks
- Enterprise internal distribution
- Markets where Google Play is unavailable
- Direct download from website

### Building for Direct Distribution:
```bash
# Build APK with EAS
eas build --platform android --profile preview

# Or build locally
npx expo run:android --variant release
```

### Rules:
- Sign APKs with a release keystore (not debug)
- Host APK on HTTPS (browsers block HTTP APK downloads)
- Include version info in filename: myapp-1.2.0-build42.apk
- Provide clear installation instructions (enable "Install from Unknown Sources")
- Implement in-app update checks since there is no store to handle updates

## 4. APP SIGNING AND KEYSTORE MANAGEMENT

### Android Keystore:
```bash
# Generate a keystore (do this ONCE, protect it FOREVER)
keytool -genkey -v -keystore my-app-release.keystore \
  -alias my-app-key -keyalg RSA -keysize 2048 -validity 10000
```

### CRITICAL RULES:
- **NEVER lose your Android keystore.** If you lose it, you cannot update your app. You must publish a new app with a new package name.
- Store the keystore in a secure vault (1Password, AWS Secrets Manager, not in git)
- Back up the keystore in at least 2 secure locations
- Record the keystore password, key alias, and key password separately
- Google Play App Signing: Let Google manage the upload key. If you lose your upload key, Google can reset it. But the app signing key is permanent.

### iOS Signing:
- EAS Build handles signing automatically when connected to Apple Developer account
- For manual management: export certificates from Keychain, store securely
- Certificates expire. Renew before expiration to avoid build failures.

## 5. VERSION MANAGEMENT

### Versioning Strategy:
```
Version String: MAJOR.MINOR.PATCH  (e.g., 1.2.3)
Build Number:   Monotonically increasing integer (e.g., 42)
```

### Platform Mapping:

| Concept | Android | iOS | Expo |
|---------|---------|-----|------|
| User-visible version | versionName | CFBundleShortVersionString | version in app.config.ts |
| Build number | versionCode (integer, must increase) | CFBundleVersion (must increase) | ios.buildNumber, android.versionCode |

### app.config.ts Versioning:
```typescript
export default {
  version: "1.2.3",
  ios: {
    buildNumber: "42",
  },
  android: {
    versionCode: 42,
  },
};
```

### Rules:
- MAJOR: Breaking changes, major redesign
- MINOR: New features, backward compatible
- PATCH: Bug fixes, small improvements
- Build number ALWAYS increases (never reuse, never decrease)
- Automate build number increment in CI/CD

## 6. OTA UPDATES (EAS UPDATE)

### What It Is:
Push JavaScript bundle updates to users without going through app store review. The native shell stays the same, only the JS bundle changes.

### When to Use OTA vs Full Build:

| Change Type | OTA Update | New Build Required |
|-------------|-----------|-------------------|
| Bug fix in JS/TS code | Yes | No |
| UI changes | Yes | No |
| New feature (JS only) | Yes | No |
| New native module added | No | Yes |
| Expo SDK upgrade | No | Yes |
| Native config change | No | Yes |
| App icon or splash change | No | Yes |

### EAS Update Commands:
```bash
# Publish update to preview channel
eas update --branch preview --message "Fix login button alignment"

# Publish update to production
eas update --branch production --message "Fix critical data sync bug"
```

### Rules:
- OTA updates are for JavaScript changes ONLY
- Test OTA updates on preview branch before pushing to production
- Include a rollback plan (publish previous known-good bundle)
- Do not use OTA for major feature releases (users expect store updates for big changes)
- Apple allows OTA for bug fixes but prohibits it for adding major new features

## 7. FEATURE FLAGS FOR SYNCHRONIZED ROLLOUTS

### Why Feature Flags for Mobile:
- Different app versions live in the wild simultaneously
- You cannot force users to update
- Feature flags let you enable features server-side when all platforms are ready

### Implementation:
```typescript
// services/featureFlags.ts
import { apiClient } from "./api";

interface FeatureFlags {
  newDashboard: boolean;
  calendarView: boolean;
  offlineMode: boolean;
  biometricLogin: boolean;
}

export async function getFeatureFlags(): Promise<FeatureFlags> {
  return apiClient<FeatureFlags>("/api/feature-flags");
}
```

### Rules:
- Check flags on app launch and cache locally
- Refresh flags periodically (every 15-30 minutes) and on app foreground
- Default to "off" if flag fetch fails (fail closed)
- Clean up old flags after full rollout (dead flags are tech debt)

## 8. APP STORE OPTIMIZATION (ASO)

### Key ASO Elements:

| Element | Google Play | Apple App Store |
|---------|------------|-----------------|
| Title | 30 chars max | 30 chars max |
| Subtitle | N/A | 30 chars max |
| Short Description | 80 chars | N/A |
| Full Description | 4000 chars | 4000 chars |
| Keywords | In description (Google indexes it) | Dedicated keyword field (100 chars) |
| Screenshots | Up to 8 per device type | Up to 10 per device type |

### Rules:
- Screenshots are the most important ASO asset. They sell the app.
- Show the app in use, not just the UI. Add captions explaining value.
- Localize screenshots and descriptions for target markets
- A/B test listing elements on Google Play (built-in experiment support)

## RELATED SKILLS

- `apple-app-store-submission`: passing Apple review. Required reading for any iOS submission.
- `standard-ci-cd-pipeline`: the general deployment strategies and rollback rules.
- `standard-cross-platform-development`: Expo and EAS configuration.
- `standard-audit-ready-code`: the security and privacy requirements stores check.
- `aso`: listing optimization in depth, if that skill is installed.
