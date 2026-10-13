---
name: standard-cross-platform-development
description: "Standard 32 of the engineering standards library: building one codebase for Android, iOS and web with React Native and Expo. Covers why cross-platform, the Expo ecosystem (EAS Build, Submit, Update, Dev Client) and app.config.ts, monorepo structure, platform-specific code (Platform.select, platform file extensions), web support, shared code patterns (API client, hooks, types), environment configuration with EAS profiles, and testing across platforms. Read it BEFORE starting or restructuring a React Native or Expo project, before writing platform-specific code or sharing code between web and mobile, and when the user says \"React Native\", \"Expo\", \"EAS\", \"cross-platform\", \"one codebase\", \"monorepo for mobile and web\", \"Platform.select\", \"app.config\", or \"build this for iOS and Android\"."
---

# Cross-Platform Development: React Native and Expo

> **Agent rule.** `eas build`, `eas submit` and `eas update` produce and publish releases. An agent
> runs them only when the owner explicitly asks.

## PHILOSOPHY
Write once, adapt per platform. Cross-platform does not mean identical. It means shared logic, shared codebase, and platform-appropriate UI. The goal is 90%+ code sharing with 100% native feel.

## 1. WHY CROSS-PLATFORM

### Framework Comparison:

| Framework | Language | Platforms | Performance | Best For |
|-----------|----------|-----------|-------------|----------|
| **React Native + Expo** | TypeScript/JS | Android, iOS, Web | Near-native | Teams with React experience, rapid iteration |
| **Flutter** | Dart | Android, iOS, Web, Desktop | Near-native | Pixel-perfect custom UI, startup MVPs |
| **Native (Kotlin/Swift)** | Kotlin/Swift | One platform each | Best | Performance-critical, platform-deep apps |

### Why React Native + Expo:
- Single codebase for Android, iOS, and Web
- Hot reload for instant development feedback
- Access to entire npm ecosystem
- Expo handles native complexity (builds, signing, OTA updates)
- TypeScript for type safety across all platforms
- Large hiring pool (React developers can build mobile)

## 2. EXPO ECOSYSTEM

### Managed Workflow (Recommended):
Expo handles native configuration. You write TypeScript, Expo handles Xcode and Android Studio.

```bash
npx create-expo-app@latest my-app --template tabs
```

### Key Expo Services:

| Service | Purpose |
|---------|---------|
| **Expo Router** | File-based routing (like Next.js for mobile) |
| **EAS Build** | Cloud builds for Android and iOS (no local Xcode/Android Studio needed) |
| **EAS Update** | OTA JavaScript bundle updates (skip app store review) |
| **EAS Submit** | Automated store submission |
| **Expo Dev Client** | Custom development builds with native modules |

### Configuration - app.config.ts:
```typescript
import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  name: "MyApp",
  slug: "my-app",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },
  ios: {
    bundleIdentifier: "com.mycompany.myapp",
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: "Used to scan documents",
    },
  },
  android: {
    package: "com.mycompany.myapp",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
    permissions: ["CAMERA"],
  },
  web: {
    favicon: "./assets/favicon.png",
    bundler: "metro",
  },
  plugins: [
    "expo-router",
    "expo-localization",
    ["expo-camera", { cameraPermission: "Allow access to scan documents" }],
  ],
  extra: {
    eas: { projectId: "your-project-id" },
  },
});
```

## 3. MONOREPO STRUCTURE

### Recommended Project Layout:
```
my-app/
  app/                    # Expo Router pages (file-based routing)
    (tabs)/               # Tab navigator group
      index.tsx           # Home tab
      settings.tsx        # Settings tab
    (auth)/               # Auth flow group
      login.tsx
      register.tsx
    _layout.tsx           # Root layout
  components/             # Shared UI components
    ui/                   # Design system primitives
    forms/                # Form components
    platform/             # Platform-specific component wrappers
  hooks/                  # Custom React hooks
  services/               # API clients, business logic
  stores/                 # State management (Zustand stores)
  utils/                  # Pure utility functions
  constants/              # App-wide constants, theme tokens
  locales/                # i18n translation files
  assets/                 # Images, fonts, static files
  types/                  # TypeScript type definitions
  app.config.ts           # Expo configuration
  eas.json                # EAS Build profiles
  tsconfig.json
```

### Rules:
- Flat structure inside each directory. Avoid deeply nested folders.
- One component per file. File name matches export name.
- Index files only for barrel exports, never for component logic.

## 4. PLATFORM-SPECIFIC CODE

### Strategy 1 - Platform File Extensions:
```
Button.tsx           # Default (web fallback)
Button.ios.tsx       # iOS-specific
Button.android.tsx   # Android-specific
Button.native.tsx    # Both iOS and Android (not web)
```
Metro bundler resolves the correct file automatically.

### Strategy 2 - Platform.select:
```typescript
import { Platform, StyleSheet } from "react-native";

const styles = StyleSheet.create({
  container: {
    paddingTop: Platform.select({
      ios: 44,
      android: 0,
      web: 0,
    }),
    fontFamily: Platform.select({
      ios: "System",
      android: "Roboto",
      web: "Inter, sans-serif",
    }),
  },
});
```

### Strategy 3 - Platform.OS Conditionals:
```typescript
import { Platform } from "react-native";

if (Platform.OS === "ios") {
  // iOS-only behavior
} else if (Platform.OS === "android") {
  // Android-only behavior
} else {
  // Web behavior
}
```

### When to Use Each:

| Pattern | Use When |
|---------|----------|
| File extensions (.ios.tsx) | Entire component differs per platform |
| Platform.select | Style or config values differ per platform |
| Platform.OS conditional | Small behavioral branches within shared code |

## 5. WEB SUPPORT

### Expo Web Specifics:
- Expo Router supports web routing out of the box
- Use react-native-web compatible components
- Test web separately, some native modules have no web equivalent

### Web-Only Considerations:
```typescript
import { Platform } from "react-native";

const WebOnlyComponent = Platform.OS === "web"
  ? require("./WebOnlyComponent").default
  : () => null;

// SEO: Expo Router supports Head for meta tags on web
import Head from "expo-router/head";

export default function HomePage() {
  return (
    <>
      <Head>
        <title>My App - Home</title>
        <meta name="description" content="App description" />
      </Head>
    </>
  );
}
```

## 6. SHARED CODE PATTERNS

### Shared Hooks:
```typescript
// hooks/useAuth.ts - works on all platforms
import { useCallback } from "react";
import { useAuthStore } from "@/stores/authStore";
import { authService } from "@/services/auth";

export function useAuth() {
  const { user, setUser, clearUser } = useAuthStore();

  const login = useCallback(async (email: string, password: string) => {
    const result = await authService.login(email, password);
    setUser(result.user);
    return result;
  }, [setUser]);

  const logout = useCallback(async () => {
    await authService.logout();
    clearUser();
  }, [clearUser]);

  return { user, login, logout, isAuthenticated: !!user };
}
```

### Shared Services:
```typescript
// services/api.ts - shared HTTP client
import Constants from "expo-constants";

const BASE_URL = Constants.expoConfig?.extra?.apiUrl ?? "http://localhost:3000";

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = BASE_URL + endpoint;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  return response.json();
}
```

## 7. ENVIRONMENT CONFIGURATION

### EAS Profiles (eas.json):
```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": { "API_URL": "http://localhost:3000" }
    },
    "preview": {
      "distribution": "internal",
      "env": { "API_URL": "https://staging-api.example.com" }
    },
    "production": {
      "env": { "API_URL": "https://api.example.com" }
    }
  }
}
```

### Rules:
- NEVER commit API keys or secrets to eas.json. Use EAS Secrets for sensitive values.
- Use app.config.ts (not app.json) for dynamic configuration.
- Environment variables flow through EAS Build, not through .env files in production.

## 8. TESTING ACROSS PLATFORMS

### Testing Strategy:

| Layer | Tool | What It Tests |
|-------|------|---------------|
| Unit | Jest | Utilities, hooks, services, stores |
| Component | React Native Testing Library | Component rendering, interactions |
| Integration | Detox or Maestro | Full app flows on real devices/emulators |
| Web | Playwright or Cypress | Web-specific flows |

### Rules:
- Test shared logic once (unit tests cover all platforms)
- Test platform-specific components on their target platform
- Run integration tests on both iOS simulator and Android emulator
- Web tests run in the CI pipeline with Playwright
- Snapshot tests catch unintentional UI changes

## IMPLEMENTATION REQUIREMENT
Every feature starts as shared code. Platform-specific code is the exception, not the default. If you find yourself writing the same logic in platform-specific files, refactor it into a shared module. The app must build and run on all three platforms before any PR is merged.

## RELATED SKILLS

- `standard-mobile-app-design`: platform-native UI patterns.
- `standard-mobile-app-architecture`: navigation, state, offline, push, deep links.
- `standard-native-device-apis`: camera, location, biometrics, storage.
- `standard-app-store-deployment`: shipping the builds.
- `standard-real-time-sync`: keeping the platforms in sync.
