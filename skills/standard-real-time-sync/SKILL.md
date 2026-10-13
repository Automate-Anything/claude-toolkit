---
name: standard-real-time-sync
description: "Standard 37 of the engineering standards library: keeping web, iOS and Android clients in sync through one backend. Covers the shared-API architecture, backend options, real-time patterns (server push over WebSocket or SSE, polling with smart refetch), the offline operation queue, conflict resolution strategies per entity type, the sync status UI, handling different app versions in the wild (minimum version enforcement, API versioning), background sync, and feature flags for cross-platform parity. Read it BEFORE building anything that must appear on another device or platform without a reload, before adding WebSockets, realtime subscriptions, an offline queue, or conflict handling, and when the user says \"real-time\", \"realtime\", \"WebSocket\", \"SSE\", \"live updates\", \"sync\", \"offline queue\", \"conflict resolution\", \"last write wins\", \"background sync\", \"force update\", or \"it does not show up on the other device\"."
---

# Real-Time Sync: shared backend across platforms

## PHILOSOPHY
When a user posts a status on their phone, it should appear on the website instantly. When they update their profile on the web, their tablet app should reflect it within seconds. This is not optional for a multi-platform app: it is the core promise.

## 1. ARCHITECTURE OVERVIEW

```
Android App  --+
iOS App      --+-- Shared API -- Database -- Real-time Layer
Web App      --+                              (WebSocket/SSE)
APK (direct) --+
```

### Core Principle:
- ONE backend API serves ALL platforms
- Platforms share the same data models, validation rules, and business logic
- Real-time layer pushes changes to all connected clients
- Offline-capable clients sync when connectivity returns

## 2. BACKEND OPTIONS

| Option | Best For | Complexity | Cost |
|--------|----------|------------|------|
| Supabase | Full-stack with real-time, auth, storage | Low | Free tier, then $25/mo |
| Firebase/Firestore | Document-based, Google ecosystem | Low | Free tier, then pay-per-use |
| Custom API + WebSocket | Full control, complex business logic | High | VPS cost |
| Convex | Real-time-first, reactive queries | Medium | Free tier, then $25/mo |

### Recommended: Supabase
- PostgreSQL (real database, not document store)
- Built-in real-time subscriptions
- Row-level security policies
- Auth, storage, edge functions included
- Works with Expo out of the box

## 3. REAL-TIME SYNC PATTERNS

### Pattern A: Server Push (WebSocket/SSE)
```typescript
// Client subscribes to changes
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Subscribe to new statuses
const channel = supabase
  .channel('statuses')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'statuses' },
    (payload) => {
      queryClient.setQueryData(['statuses'], (old) => [payload.new, ...old]);
    }
  )
  .on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'statuses' },
    (payload) => {
      queryClient.setQueryData(['statuses'], (old) =>
        old.map(s => s.id === payload.new.id ? payload.new : s)
      );
    }
  )
  .subscribe();

// Cleanup on unmount
return () => supabase.removeChannel(channel);
```

### Pattern B: Polling (Simple Fallback)
```typescript
// TanStack Query with refetch interval
const { data } = useQuery({
  queryKey: ['statuses'],
  queryFn: () => api.get('/statuses'),
  refetchInterval: 30000,           // Every 30 seconds
  refetchIntervalInBackground: false, // Only when app is active
  refetchOnWindowFocus: true,        // Refetch when user returns to app
});
```

### Pattern C: Hybrid (Recommended)
- Use WebSocket for real-time when connected
- Fall back to polling when WebSocket disconnects
- Use optimistic updates for instant UI feedback
- Background sync for offline changes

## 4. OFFLINE-FIRST SYNC

### Local-First Architecture:
```
User Action -> Write to Local DB -> Update UI -> Queue for Server
                                                      |
                                         Network Available?
                                         Yes: Sync immediately
                                         No: Queue, sync later
```

### Sync Queue Implementation:
```typescript
// src/services/sync-queue.ts
interface SyncOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  table: string;
  data: any;
  createdAt: number;
  retryCount: number;
}

class SyncQueue {
  private queue: SyncOperation[] = [];

  async add(op: SyncOperation) {
    this.queue.push(op);
    await this.persist();
    this.processIfOnline();
  }

  async processIfOnline() {
    if (!navigator.onLine) return;

    for (const op of this.queue) {
      try {
        await this.execute(op);
        this.queue = this.queue.filter(o => o.id !== op.id);
      } catch (error) {
        op.retryCount++;
        if (op.retryCount > 5) {
          // Move to dead letter queue, notify user
          this.handleFailedSync(op);
        }
      }
    }
    await this.persist();
  }
}
```

### Database Options for Offline-First:

| Library | Approach | Best For |
|---------|----------|----------|
| expo-sqlite | Manual sync logic | Full control, simple schemas |
| WatermelonDB | Built-in sync protocol | Complex offline-first apps |
| PowerSync | Postgres sync to SQLite | Supabase/Postgres backends |
| ElectricSQL | Active-active sync | Real-time collaborative apps |

## 5. CONFLICT RESOLUTION

### When Conflicts Happen:
- User A edits profile on phone (offline)
- User A edits same profile on web (online)
- Phone comes online: which edit wins?

### Strategies:

| Strategy | How | Best For |
|----------|-----|----------|
| Last-Write-Wins (LWW) | Timestamp comparison, latest wins | Simple data, low conflict risk |
| Server Wins | Server version always overrides | Admin-managed data |
| Client Wins | Client version always overrides | User preferences |
| Field-Level Merge | Merge non-conflicting field changes | Profile updates |
| Manual Resolution | Show both versions, user picks | Collaborative editing |

### Implementation (LWW with field-level merge):
```typescript
function resolveConflict(serverVersion: any, clientVersion: any): any {
  const merged = { ...serverVersion };

  for (const [key, value] of Object.entries(clientVersion)) {
    if (clientVersion.updatedAt > serverVersion.updatedAt) {
      // Client changed this field more recently
      merged[key] = value;
    }
  }

  return merged;
}
```

### Rules:
- Choose a strategy per entity type (not one global strategy)
- Statuses: last-write-wins (simple, low conflict risk)
- Profile: field-level merge (different fields edited on different devices)
- Messages: server-ordered (append-only, no conflicts)
- Always keep both versions in audit log before resolving

## 6. SYNC STATUS UI

### Show Users What Is Happening:
```typescript
// Sync status indicator component
function SyncIndicator() {
  const { isOnline, pendingChanges, lastSynced } = useSyncStatus();

  if (!isOnline) {
    return <Banner type="warning" text="Offline - changes will sync when connected" />;
  }
  if (pendingChanges > 0) {
    return <Banner type="info" text={`Syncing ${pendingChanges} changes...`} />;
  }
  return null; // Hide when everything is synced
}
```

### Rules:
- Show offline banner when no connectivity
- Show sync progress for pending changes
- Show "Last synced: X minutes ago" in settings/profile
- Never show sync internals to users (no "conflict detected" modals)
- Auto-resolve silently when possible, manual only as last resort

## 7. HANDLING DIFFERENT APP VERSIONS

### Problem:
Users on v1.2 and v2.0 hit the same API. Breaking changes break old clients.

### Solution: API Versioning + Minimum Version Enforcement
```typescript
// Backend: check client version header
app.use((req, res, next) => {
  const clientVersion = req.headers['x-app-version'];
  const minVersion = getMinimumVersion(); // From config/DB

  if (clientVersion && semver.lt(clientVersion, minVersion)) {
    return res.status(426).json({
      error: 'UPDATE_REQUIRED',
      message: 'Please update your app to continue',
      storeUrl: Platform.select({
        ios: 'https://apps.apple.com/app/id123',
        android: 'https://play.google.com/store/apps/details?id=com.app',
      }),
    });
  }
  next();
});

// Client: send version with every request
const headers = {
  'X-App-Version': Application.nativeApplicationVersion,
  'X-Platform': Platform.OS,
};
```

### Rules:
- Every API request includes app version and platform headers
- Backend supports N-1 versions minimum (current + one prior)
- Force update only for breaking/security changes
- Soft prompt for minor updates
- OTA updates handle JS-level changes without store updates

## 8. BACKGROUND SYNC

```typescript
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

// Define background task
TaskManager.defineTask('BACKGROUND_SYNC', async () => {
  try {
    await syncQueue.processAll();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Register (runs every ~15 min, OS controls exact timing)
await BackgroundFetch.registerTaskAsync('BACKGROUND_SYNC', {
  minimumInterval: 15 * 60,  // 15 minutes
  stopOnTerminate: false,
  startOnBoot: true,
});
```

### Also Sync On:
- App comes to foreground (AppState change)
- Network state changes from offline to online
- User triggers pull-to-refresh
- After successful push notification receipt

## 9. FEATURE FLAGS FOR CROSS-PLATFORM PARITY

```typescript
// Server returns flags based on platform and version
const flags = await api.get('/feature-flags', {
  headers: {
    'X-Platform': Platform.OS,
    'X-App-Version': Application.nativeApplicationVersion,
  },
});

// Example: new editor only enabled after all platforms have it
if (flags.newStatusEditor) {
  return <NewEditor />;
}
```

### Rollout Process:
1. Deploy code to all platforms (feature disabled)
2. Wait for App Store + Play Store approval
3. Verify all platforms have the code via analytics
4. Enable feature flag server-side (instant activation everywhere)
5. Monitor for issues, kill switch if needed

## IMPLEMENTATION REQUIREMENT
One API. Real-time push for instant updates. Offline queue for reliability. Conflict resolution per entity type. Background sync for eventual consistency. Version enforcement for API compatibility. Feature flags for coordinated rollouts. The user should never think about sync: it just works.

## RELATED SKILLS

- `standard-mobile-app-architecture`: offline-first storage and state on the client.
- `standard-api-design`: the API conventions and versioning the clients share.
- `standard-scalability-patterns`: scaling the real-time layer.
- `standard-app-store-deployment`: feature flags and OTA updates for rollouts.
