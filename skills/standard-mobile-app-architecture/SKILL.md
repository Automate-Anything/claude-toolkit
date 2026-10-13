---
name: standard-mobile-app-architecture
description: "Standard 35 of the engineering standards library: the architecture of a React Native or Expo app. Covers file-based navigation with Expo Router, state management by kind (server state with TanStack Query and optimistic updates, client state with Zustand, form state, persistent state), offline-first architecture with a local database and sync queue, push notifications (permission, token registration, handling taps), deep linking and universal links, data persistence options, error boundaries and crash reporting, and the authentication flow with secure token storage and biometric unlock. Read it BEFORE structuring a mobile app, choosing state management, adding offline support, push notifications, deep links or auth to a mobile app, and when the user says \"Expo Router\", \"navigation structure\", \"state management\", \"TanStack Query\", \"Zustand\", \"offline-first\", \"push notifications\", \"deep link\", \"universal link\", \"crash reporting\", or \"mobile login flow\"."
---

# Mobile App Architecture: navigation, state, offline-first

## PHILOSOPHY
Mobile apps live in a hostile environment: flaky networks, background kills, limited memory, users who rotate their phone mid-action. Architecture must handle all of this gracefully. Design for the worst case, optimize for the common case.

## 1. NAVIGATION ARCHITECTURE

### Expo Router (File-Based Routing):
```
app/
  _layout.tsx                 # Root layout (providers, fonts, splash)
  (tabs)/
    _layout.tsx               # Tab bar configuration
    index.tsx                 # Home tab
    explore.tsx               # Explore tab
    profile.tsx               # Profile tab
  (auth)/
    _layout.tsx               # Auth stack (no tabs)
    login.tsx
    register.tsx
    forgot-password.tsx
  status/
    [id].tsx                  # Dynamic route: /status/123
    create.tsx                # Create new status
  settings/
    index.tsx
    notifications.tsx
    language.tsx
  +not-found.tsx              # 404 fallback
```

### Navigation Rules:
- Tabs for top-level destinations (3-5 max)
- Stack for drill-down flows (list -> detail -> edit)
- Modal for creation flows and confirmations
- Deep links map directly to file routes: `myapp://status/123`
- Never nest more than 3 stack levels deep
- Preserve scroll position when navigating back

## 2. STATE MANAGEMENT

### Three Layers of State:

| Layer | Tool | Purpose | Examples |
|-------|------|---------|---------|
| Server state | TanStack Query | Data from API, cached + synced | User profile, status list, comments |
| Client state | Zustand | App-level UI state | Auth token, theme, locale, filters |
| Local state | useState/useReducer | Component-level | Form inputs, modal open/close, loading |

### TanStack Query (Server State):
```typescript
// src/hooks/useStatuses.ts
export function useStatuses() {
  return useQuery({
    queryKey: ['statuses'],
    queryFn: () => api.get('/statuses'),
    staleTime: 1000 * 60 * 5,  // Fresh for 5 minutes
    gcTime: 1000 * 60 * 30,    // Keep in cache 30 minutes
  });
}

// Mutation with optimistic update
export function useLikeStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (statusId: string) => api.post(`/statuses/${statusId}/like`),
    onMutate: async (statusId) => {
      await queryClient.cancelQueries({ queryKey: ['statuses'] });
      const prev = queryClient.getQueryData(['statuses']);
      queryClient.setQueryData(['statuses'], (old) =>
        old.map(s => s.id === statusId ? { ...s, liked: true, likes: s.likes + 1 } : s)
      );
      return { prev };
    },
    onError: (err, statusId, context) => {
      queryClient.setQueryData(['statuses'], context.prev); // Rollback
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses'] }); // Refetch
    },
  });
}
```

### Zustand (Client State):
```typescript
// src/stores/auth.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      setAuth: (user, token) => set({ user, token }),
      logout: () => set({ user: null, token: null }),
    }),
    { name: 'auth-storage', storage: createJSONStorage(() => AsyncStorage) }
  )
);
```

## 3. OFFLINE-FIRST ARCHITECTURE

### Strategy:
```
User action -> Update local DB -> Update UI -> Queue sync -> Sync when online
```

### Implementation with expo-sqlite:
```typescript
// Local database as source of truth
import * as SQLite from 'expo-sqlite';

const db = await SQLite.openDatabaseAsync('app.db');

// Read from local DB (instant, works offline)
const statuses = await db.getAllAsync('SELECT * FROM statuses ORDER BY created_at DESC');

// Write to local DB + queue for sync
await db.runAsync('INSERT INTO statuses (id, content, synced) VALUES (?, ?, 0)', [uuid(), content]);
await syncQueue.add({ type: 'create_status', data: { content } });
```

### Sync Queue:
- Queue operations when offline
- Process queue when network returns
- Handle conflicts (server wins, client wins, or merge)
- Show sync status in UI (syncing indicator, "Last synced: 2 min ago")
- Retry failed syncs with exponential backoff

## 4. PUSH NOTIFICATIONS

### Setup with Expo:
```typescript
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

async function registerForPushNotifications() {
  if (!Device.isDevice) return; // No push on simulator

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return; // User denied

  const token = await Notifications.getExpoPushTokenAsync({
    projectId: Constants.expoConfig?.extra?.eas?.projectId,
  });

  // Send token to your backend
  await api.post('/users/push-token', { token: token.data });

  // Android notification channel
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}
```

### Notification Handling:
```typescript
// Handle notification when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Handle notification tap (navigate to relevant screen)
const subscription = Notifications.addNotificationResponseReceivedListener(response => {
  const data = response.notification.request.content.data;
  if (data.statusId) {
    router.push(`/status/${data.statusId}`);
  }
});
```

## 5. DEEP LINKING

### Expo Router Deep Links:
```typescript
// app.config.ts
{
  scheme: 'myapp',   // myapp://status/123
  web: {
    bundler: 'metro',
  },
}

// Universal links (HTTPS)
// iOS: apple-app-site-association on your domain
// Android: assetlinks.json on your domain
```

### Deep Link Handling:
- Expo Router handles deep links automatically via file-based routes
- `myapp://status/123` maps to `app/status/[id].tsx`
- `https://yourapp.com/status/123` works the same way (universal links)
- Handle unauthenticated deep links: redirect to login, then to target

## 6. DATA PERSISTENCE

| Storage | Use Case | Library |
|---------|----------|---------|
| Key-value (fast) | Settings, preferences, small cache | MMKV (react-native-mmkv) |
| Key-value (simple) | Async storage, simple state | @react-native-async-storage |
| Structured data | Offline DB, complex queries | expo-sqlite |
| Secure secrets | Auth tokens, API keys | expo-secure-store |
| Files | Downloaded media, cached images | expo-file-system |

### Rules:
- NEVER store tokens in AsyncStorage (not encrypted). Use expo-secure-store.
- Use MMKV for high-frequency reads (10x faster than AsyncStorage)
- Use SQLite for anything you need to query (lists, search, relationships)
- Clean up file cache periodically (set max cache size)

## 7. ERROR HANDLING AND CRASH REPORTING

### Error Boundary:
```typescript
// src/components/ErrorBoundary.tsx
export function ErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <RNErrorBoundary
      FallbackComponent={({ error, resetError }) => (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{error.message}</Text>
          <Button title="Try Again" onPress={resetError} />
        </View>
      )}
      onError={(error, stackTrace) => {
        // Report to Sentry
        Sentry.captureException(error, { extra: { stackTrace } });
      }}
    >
      {children}
    </RNErrorBoundary>
  );
}
```

### Crash Reporting (Sentry):
```typescript
// app/_layout.tsx
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.2,
  environment: process.env.APP_ENV,
});
```

### Rules:
- Wrap root layout in ErrorBoundary
- Catch and report ALL unhandled errors
- Network errors: show retry, not crash
- Never show raw error messages to users
- Log user ID and app version with every crash report

## 8. AUTHENTICATION FLOW

```
App Launch -> Check stored token -> Valid? -> Home Screen
                                 -> Expired? -> Refresh token -> Home Screen
                                 -> No token? -> Auth Screen (Login/Register)
```

### Secure Token Storage:
```typescript
import * as SecureStore from 'expo-secure-store';

// Store token securely (Keychain on iOS, EncryptedSharedPreferences on Android)
await SecureStore.setItemAsync('auth_token', token);
await SecureStore.setItemAsync('refresh_token', refreshToken);

// Retrieve
const token = await SecureStore.getItemAsync('auth_token');
```

### Biometric Unlock:
```typescript
import * as LocalAuthentication from 'expo-local-authentication';

const hasHardware = await LocalAuthentication.hasHardwareAsync();
const isEnrolled = await LocalAuthentication.isEnrolledAsync();

if (hasHardware && isEnrolled) {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock app',
    fallbackLabel: 'Use passcode',
  });
  if (result.success) {
    // Retrieve stored credentials and auto-login
  }
}
```

## IMPLEMENTATION REQUIREMENT
Every screen handles offline gracefully. Every API call has error handling. Every navigation path is testable via deep link. Server state and client state are cleanly separated. Tokens are stored securely. The app never crashes: it catches, reports, and recovers.

## RELATED SKILLS

- `standard-cross-platform-development`: project and monorepo setup.
- `standard-real-time-sync`: the sync and conflict resolution layer in depth.
- `standard-native-device-apis`: secure storage, biometrics, local notifications.
- `standard-mobile-app-design`: the navigation patterns from the UI side.
- `apple-app-store-submission`: Apple's rules for login, account deletion and permission prompts.
