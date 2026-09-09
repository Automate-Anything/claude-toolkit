---
name: page-performance
description: Guide for ALL page, component, and UI performance work - both new development AND optimization. Written for React + React Query; the principles apply to any component framework. Use this skill BEFORE building or editing any React page/component; whenever you touch scroll, drag, zoom, wheel, touch, or other high-frequency handlers; whenever you add data fetching, loading states, optimistic updates, memoization, or event listeners; and whenever the UI freezes, jumps, stutters, flashes a skeleton, or re-renders too often. It encodes hard rules: refs (not useState) for >5x/sec values, memoize every computed prop, never setState inside a scroll handler, useCallback every callback prop, React Query (v5) for all fetching with placeholderData to avoid skeleton flash, optimistic updates for every user action, and CSS-variable positioning for zoom/scale. Also use when the user mentions performance, jank, freezing, re-renders, useMemo, useCallback, useRef, scroll/drag/zoom performance, virtualization, skeletons, stale data, optimistic updates, React Query, or "the page is slow/janky."
---

# Page Performance Standards

> **Editing note:** `.claude/hooks/pretooluse_code.py` blocks the literal strings this doc
> *describes* as anti-patterns (the all-properties transition class, a wildcard `select`, and a
> raw tooltip-provider tag) in ANY file, including this one. That is why those anti-patterns are
> referred to descriptively below rather than written out verbatim. If you need to re-save this
> file and a write is denied, you are quoting one of those literals - reword it.

**When this applies:** Any task involving pages, components, or features - both new development AND optimization. Follow these rules to prevent freezing, jumping, and unresponsive UI.

---

> **Slow because of DATA, not rendering?** This skill covers the REACT side
> (re-renders, refs, memoization, scroll handlers, skeletons). If the page is slow
> because of the QUERY - an N+1 loop, fetching too many rows, a per-row RLS cost,
> a missing index, an RPC taking seconds - read the **`query-efficiency` skill**
> instead. Diagnose which side you are on before optimizing.

## THE GOLDEN RULE: Never Freeze the User's Browser

If a user interaction (scroll, drag, zoom, click, type) causes the page to freeze, the mouse to jump, or the UI to become unresponsive for even 100ms, something is fundamentally wrong. The most common causes, in order of impact:

1. **React state updates in hot loops** (mousemove, scroll, touchmove) - 60+ re-renders/sec
2. **Unstable references** defeating `useMemo` - expensive calculations run on every render
3. **`getComputedStyle()` or DOM reads during render** - forced layout recalculation
4. **Unthrottled event handlers** - scroll/wheel handlers running 60+ times/sec
5. **Unbounded DOM growth** - thousands of elements with no virtualization or capping

---

## Hook-Enforced Rules (you physically cannot violate these)

Several performance rules are enforced by `.claude/hooks/pretooluse_code.py` - edits that violate them are denied at write time. Know them so you don't waste a round trip:

| Blocked pattern | Why | Do instead |
|-----------------|-----|------------|
| The all-properties transition utility (the Tailwind `transition` class that animates every property) | Transitions every property including layout = jank | Name exact props: `transition-[top,height]` or `transition: opacity 0.2s ease` |
| `getComputedStyle(` (in `src/`) | Forces synchronous layout recalculation | Cache the value in a ref |
| `supabase.auth.getUser()` (in `src/`) | Network request every call | `useSession()` from SessionContext (cached) |
| Wildcard column select (`select` with `*`) | Over-fetches columns | Select only needed columns, e.g. `id, name, status` |
| Adding a tooltip-provider element | A global one already wraps the app in `src/App.tsx` | Use the existing provider; just render the tooltip |
| Overriding tooltip `delayDuration` | The global provider sets the standard | Leave it at the global default |

The hook is the source of truth for the exact regexes - see `.claude/hooks/pretooluse_code.py`.

---

## RENDERING PERFORMANCE

### Never use `useState` for high-frequency updates

Any value that changes at 30-60fps (drag position, scroll position, zoom level during gesture, animation progress) must use `useRef`, NOT `useState`. React re-renders the entire component tree on every `setState`.

```typescript
// ❌ CATASTROPHIC - 60 full re-renders per second during drag
const [dragY, setDragY] = useState(0);
const handleMouseMove = (e) => setDragY(e.clientY); // Re-renders 2,700 lines of JSX

// ✅ CORRECT - Zero re-renders, update DOM directly
const dragYRef = useRef(0);
const handleMouseMove = (e) => {
  dragYRef.current = e.clientY;
  // Update the element directly via DOM manipulation
  const el = document.querySelector(`[data-drag-id="${id}"]`);
  if (el) el.style.transform = `translateY(${offset}px)`;
};
```

**Rule:** If a value changes more than ~5 times per second, it MUST be a ref.

### Memoize ALL computed arrays and objects passed as props

Any `.filter()`, `.map()`, `.sort()`, or object creation that happens during render creates a new reference. When passed as a prop, the child component re-renders even if the data is identical.

```typescript
// ❌ BAD - New array on every render, defeats child's useMemo
<ChildComponent items={data.filter(d => d.active)} />
<ChildComponent config={{ theme: 'dark', size: 'lg' }} />

// ✅ GOOD - Stable reference, child only re-renders when data changes
const activeItems = useMemo(() => data.filter(d => d.active), [data]);
const config = useMemo(() => ({ theme: 'dark', size: 'lg' }), []);
<ChildComponent items={activeItems} />
<ChildComponent config={config} />
```

**Rule:** NEVER put `.filter()`, `.map()`, `.sort()`, `[...spread]`, or `{ ...spread }` directly in JSX props. Always wrap in `useMemo`.

### Protect `useMemo` dependency chains

A `useMemo` is only effective if ALL its dependencies are stable. If even one dependency creates a new reference on every render, the memo is defeated and the expensive calculation runs every time.

```typescript
// ❌ BAD - displayedItems is new array every render, defeats blocks memo
const displayedItems = items.filter(i => !i.canceled);
const blocks = useMemo(() => expensiveCalculation(displayedItems), [displayedItems]); // Runs EVERY render!

// ✅ GOOD - displayedItems is memoized, blocks only recalculates when items change
const displayedItems = useMemo(() => items.filter(i => !i.canceled), [items]);
const blocks = useMemo(() => expensiveCalculation(displayedItems), [displayedItems]); // Runs only when items change
```

**Rule:** Before adding a `useMemo`, verify every dependency is itself memoized or a primitive.

### Move pure functions outside components

Functions defined inside a component are recreated on every render. Pure functions (no dependency on component state/props) should be at module level.

```typescript
// ❌ BAD - Recreated on every render (GC pressure)
function MyComponent() {
  const formatTime = (h, m) => `${h}:${m.toString().padStart(2, '0')}`;
  // ...
}

// ✅ GOOD - Created once at module level
const formatTime = (h: number, m: number) => `${h}:${m.toString().padStart(2, '0')}`;
function MyComponent() {
  // Uses formatTime without recreating it
}
```

---

## SCROLL & EVENT HANDLER PERFORMANCE (the #1 source of jank)

### Throttle scroll handlers with `requestAnimationFrame`

Scroll events can fire 100+ times per second. Always gate with rAF.

```typescript
// ❌ BAD - Runs on every scroll event (~100/sec)
scrollContainer.addEventListener('scroll', handleScroll);

// ✅ GOOD - Runs max once per frame (~60/sec)
let rafId = 0;
const throttledScroll = () => {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    handleScroll();
  });
};
scrollContainer.addEventListener('scroll', throttledScroll, { passive: true });
// Don't forget to cancelAnimationFrame(rafId) in cleanup
```

### NEVER call `setState` inside a scroll / wheel / touch handler

Even if the handler is throttled with `requestAnimationFrame`, calling `setState` from inside it triggers a React re-render during the scroll. The browser cannot paint the scroll frame until React finishes reconciling, causing visible stutter.

This applies to ALL setState calls: direct, debounced, or in a setTimeout triggered by the handler. If the state update causes a re-render of a large component tree (100+ lines of JSX), the user WILL see it.

```typescript
// ❌ BAD - setState inside scroll handler, even throttled with rAF
const handleScroll = () => {
  requestAnimationFrame(() => {
    if (nearEdge) setBuffer(prev => [...newItems, ...prev]); // Full re-render during scroll!
    setVisibleItem(currentItem); // Another re-render during scroll!
  });
};

// ✅ GOOD - Only update refs during scroll, debounce state updates until scroll stops
const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
const handleScroll = () => {
  requestAnimationFrame(() => {
    visibleItemRef.current = currentItem;
    headerEl.textContent = currentItem.name; // Direct DOM update

    // Debounce state updates until scrolling stops (200ms pause)
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      setBuffer(prev => [...newItems, ...prev]); // Re-render happens AFTER scroll stops
    }, 200);
  });
};
```

**The test:** If you can scroll continuously for 30 seconds and the component NEVER re-renders during that time (only refs and DOM updates), you've built it correctly. React re-renders should only happen when scrolling STOPS.

### Never put changing state in event-listener effect dependencies

If an effect adds/removes event listeners and its dependency array includes state that changes during the event (e.g., drag position), the listeners are torn down and re-added on every change.

```typescript
// ❌ CATASTROPHIC - Listeners re-attached 60x/sec during drag
useEffect(() => {
  window.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleUp);
  return () => { /* remove */ };
}, [dragX, dragY, isDragging]); // These change on every mouse move!

// ✅ GOOD - Listeners attached once, read state from refs
const dragRef = useRef({ x: 0, y: 0 });
const handleMove = useCallback((e) => {
  dragRef.current = { x: e.clientX, y: e.clientY };
  // Update DOM directly
}, []);

useEffect(() => {
  if (!dragging) return;
  window.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleUp);
  return () => { /* remove */ };
}, [dragging]); // Only depends on start/stop, not position
```

### Use a ref mirror to avoid recreating effect handlers

When a scroll/resize handler needs to read state that changes often (like a buffer array), use a ref mirror instead of putting the state in the dependency array.

```typescript
// ❌ BAD - Scroll listener torn down and re-added when buffer changes (during scrolling!)
useEffect(() => {
  const handleScroll = () => { /* uses dayBuffer */ };
  el.addEventListener('scroll', handleScroll);
  return () => el.removeEventListener('scroll', handleScroll);
}, [dayBuffer]); // dayBuffer changes DURING scrolling

// ✅ GOOD - Listener stays attached, reads current buffer from ref
const bufferRef = useRef(dayBuffer);
bufferRef.current = dayBuffer;

useEffect(() => {
  const handleScroll = () => {
    const buffer = bufferRef.current; // Always current, no dependency needed
  };
  el.addEventListener('scroll', handleScroll);
  return () => el.removeEventListener('scroll', handleScroll);
}, []); // Never re-attaches
```

### Memoize ALL callback props with `useCallback`

When a parent passes an inline function as a prop, the child receives a new function reference on every parent render. If the child uses that function in a `useEffect` dependency array, the effect re-runs on every parent render - tearing down and re-attaching event listeners, re-running subscriptions, etc. This is especially dangerous for scroll/resize handlers where the effect manages event listeners.

```typescript
// ❌ BAD - Inline function = new reference every render
// If ChildComponent has useEffect([onDateChange, ...]), it re-runs on EVERY parent render
<ChildComponent onDateChange={(date) => setSelectedDate(date)} />
<ChildComponent onFilter={(items) => items.filter(i => i.active)} />

// ✅ GOOD - Stable reference, child effect only runs once
const handleDateChange = useCallback((date: Date) => {
  setSelectedDate(date);
}, []); // setSelectedDate is stable (React guarantees useState setters are stable)

<ChildComponent onDateChange={handleDateChange} />
```

**Rule:** EVERY function passed as a prop MUST be wrapped in `useCallback`. No exceptions. Inline arrow functions in JSX props are only acceptable for simple onClick handlers on leaf elements (buttons, links) that don't end up in any `useEffect` dependency array.

**How to check:** Search the child component for `useEffect` or `useMemo` that includes the callback prop in its dependency array. If found, the callback MUST be memoized in the parent.

### Never let useEffect dependencies trigger scroll repositioning during user scroll

When a `useEffect` repositions scroll (sets `scrollTop`), its dependency array must ONLY contain values that change from **explicit user actions** (clicking a button, picking a date, pressing an arrow key). It must NOT contain values that change as a **side effect** of scrolling (buffer expansion, data refetching, hour range recalculation).

If a dependency changes as a side effect of scrolling and the effect repositions scroll, you get an oscillation loop: scroll triggers side effect, side effect triggers reposition, reposition triggers scroll handler again.

```typescript
// ❌ DANGEROUS - startHour changes when new day's data extends the hour range
// This causes scroll repositioning during active scrolling
useEffect(() => {
  if (dateChangedFromUI) {
    scrollContainer.scrollTop = calculatePosition(startHour); // Jumps during scroll!
  }
}, [selectedDate, startHour, dayBuffer]); // startHour and dayBuffer change DURING scrolling

// ✅ SAFE - Guard against side-effect-triggered re-runs with a value stamp
const scrollOriginRef = useRef<Date | null>(null); // Stores which date was set BY scrolling

// In scroll handler:
scrollOriginRef.current = dateToReport; // Mark this date as scroll-originated

// In effect:
useEffect(() => {
  // If this date was set by scrolling, skip repositioning no matter which dep triggered re-run
  if (scrollOriginRef.current && isSameDay(scrollOriginRef.current, selectedDate)) {
    return; // Don't reposition - user is scrolling
  }
  scrollOriginRef.current = null; // Clear for UI-originated changes
  scrollContainer.scrollTop = calculatePosition(startHour);
}, [selectedDate, startHour, dayBuffer]);
```

**The danger pattern:** Boolean flags (like `isScrolling = true/false`) are NOT safe for this because they get reset after the first effect run, but the effect can re-run again when another dependency changes later. Use a **date/value stamp** instead of a boolean - it persists until a genuinely different value is set.

### Never programmatically set `scrollTop` during active user scroll

Any code that sets `scrollContainer.scrollTop` while the user is actively scrolling will cause visible jumping. This includes useEffect cleanup/re-runs triggered by state changes during scroll, useLayoutEffect for buffer adjustments, setTimeout callbacks scheduled during scroll, and zoom handlers that fire during scroll.

```typescript
// ❌ BAD - Sets scrollTop without checking if user is scrolling
useEffect(() => {
  scrollContainer.scrollTop = savedPosition;
}, [someDependency]); // someDependency might change during scroll

// ✅ GOOD - Skip if user is actively scrolling
const userScrollingRef = useRef(false);
const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

// In scroll handler: mark as scrolling, clear after 150ms of no scroll
const handleScroll = () => {
  userScrollingRef.current = true;
  if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
  scrollEndTimerRef.current = setTimeout(() => {
    userScrollingRef.current = false;
  }, 150);
};

// In any effect that sets scrollTop:
useEffect(() => {
  if (userScrollingRef.current) return; // Don't fight the user's scroll
  scrollContainer.scrollTop = savedPosition;
}, [someDependency]);
```

### Cap unbounded growth

Any array/buffer that grows during user interaction (infinite scroll buffers, undo stacks, chat messages) MUST have a maximum size.

```typescript
// ❌ BAD - Buffer grows forever as user scrolls
setBuffer(prev => [...newDays, ...prev]); // Can reach 500+ days

// ✅ GOOD - Cap at reasonable limit, trim opposite end
const MAX_BUFFER = 42;
setBuffer(prev => {
  const result = [...newDays, ...prev];
  return result.length > MAX_BUFFER ? result.slice(0, MAX_BUFFER) : result;
});
```

---

## LOADING STATES & USER EXPERIENCE

### Prefer stale data over skeletons

Showing a skeleton that gets replaced by content after a brief flash feels buggy - "is it working? is it not working?" Users prefer seeing the previous data while new data loads in the background.

**Loading state hierarchy (best to worst):**
1. **Show cached/stale data** while refreshing in background (best - user sees content instantly)
2. **Show previous page data** with a subtle loading indicator (good - no blank screen)
3. **Wait briefly for data** before rendering anything (acceptable for fast queries <200ms)
4. **Show skeleton placeholders** (last resort - only for cold starts with no cached data)

```typescript
// ❌ AVOID - Skeleton flash on every navigation
{isLoading ? <Skeleton /> : <ActualContent />}

// ✅ PREFERRED - Show stale data while refreshing (React Query v5 API)
import { useQuery, keepPreviousData } from '@tanstack/react-query';

const { data, isLoading, isFetching } = useQuery({
  queryKey: ['appointments', date],
  queryFn: fetchAppointments,
  staleTime: 2 * 60 * 1000,        // Data stays "fresh" for 2 minutes
  placeholderData: keepPreviousData, // Show old data while fetching new
});

// Content always renders (with potentially stale data)
// Only show a subtle indicator that fresh data is loading
<div className="relative">
  {isFetching && <div className="absolute top-0 right-0 h-1 w-8 bg-primary animate-pulse" />}
  <ActualContent data={data} />
</div>
```

> **React Query v5.** The old v4 boolean option for keeping previous data was REMOVED in v5. Use `placeholderData: keepPreviousData` (import the `keepPreviousData` sentinel) or `placeholderData: (prev) => prev` to keep showing previous data while fetching. Do not pass the removed v4 boolean - it silently does nothing in v5.

**When skeletons ARE appropriate:**
- First-ever page load (no cached data exists at all)
- After clearing cache (logout/login)
- Lazy-loaded route components (the page shell itself hasn't loaded)

**When skeletons are NOT appropriate:**
- Tab switches (keep previous tab data visible until new tab loads)
- Date navigation (keep previous date visible until new date loads)
- Filter changes (keep previous results visible while filtering)

### Never swap entire page structure based on loading

The page layout (header, sidebar, tabs) must ALWAYS render. Only the inner content area can change.

```typescript
// ❌ BAD - Entire page unmounts and remounts
{isLoading ? <FullPageSkeleton /> : <EntirePage />}

// ✅ GOOD - Structure stays, only content area updates
<PageLayout>
  <Header />    {/* Always visible, never loading */}
  <Sidebar />   {/* Always visible */}
  <ContentArea>
    {/* Only this part can show loading state */}
    <ActualContent data={data} />
  </ContentArea>
</PageLayout>
```

---

## DATA FETCHING

### Use React Query for ALL data fetching

Never use `useState` + `useEffect` for fetching. React Query provides caching, deduplication, background refresh, and request cancellation for free.

```typescript
// ❌ BAD - No caching, no dedup, no cancellation, triggers re-renders on every fetch
const [data, setData] = useState([]);
useEffect(() => {
  const fetch = async () => {
    const { data } = await supabase.from('table').select('id, name, status');
    setData(data);
  };
  fetch();
}, [selectedDate]);

// ✅ GOOD - Cached, deduped, cancellable, shows stale data while refreshing
const { data } = useQuery({
  queryKey: ['table', selectedDate],
  queryFn: () => supabase.from('table').select('id, name, status'),
  staleTime: 5 * 60 * 1000,
});
```

### Never fetch data inside child components when the parent has it

If a parent component already fetches data (technicians, locations, schedules), pass it as props. Don't fetch it again inside the child.

```typescript
// ❌ BAD - Child makes its own DB queries for data parent already has
function CalendarDayView({ technicians }) {
  useEffect(() => {
    // Fetches schedule data directly from Supabase inside the component
    const { data } = await supabase.from('schedules').select('id, technician_id, start, end')...
  }, [technicians]); // Fires on every parent re-render if technicians is new reference!
}

// ✅ GOOD - Parent fetches via React Query, passes cached data as prop
function Dashboard() {
  const schedules = useCalendarSchedules(date, locationId);
  return <CalendarDayView schedules={schedules} />;
}
```

### Stabilize array/object references in setState

When fetching data and calling `setState`, compare the new data with the existing state before updating. Creating a new array reference when the data hasn't changed triggers unnecessary downstream effects and re-renders.

```typescript
// ❌ BAD - Creates new reference even if data is identical
const { data } = await supabase.from('technicians').select('id, name');
setTechnicians(data); // New reference every time

// ✅ GOOD - Only update if data actually changed
setTechnicians(prev => {
  const newIds = data.map(d => d.id).join(',');
  const oldIds = prev.map(d => d.id).join(',');
  return newIds === oldIds ? prev : data;
});
```

### The rest of the data-fetching rules

- **No `supabase.auth.getUser()`** (hook-blocked) - use `useSession()` from SessionContext.
- **No wildcard column selects** (hook-blocked) - select only the columns you need, e.g. `id, name, status`.
- **Parallel fetches** for independent queries: `const [a, b] = await Promise.all([queryA(), queryB()]);`
- **Batch queries - never fetch in loops:** `const { data } = await supabase.from('t').select('id, name').in('id', ids);`
- **Invalidate cache after mutations:** `queryClient.invalidateQueries({ queryKey: ['resource'] });`

---

## INSTANT FEEDBACK (Optimistic Updates)

When the user does something (drag, click, toggle, submit, reorder), the UI must update **instantly**. The database save happens in the background. If the save fails, revert. The user should NEVER see "loading" or "refetching" after an action they just took.

### Always use optimistic updates for user actions

```typescript
// ❌ BAD - User drags item, sees loading spinner, then sees result
const handleDragEnd = async (result) => {
  await supabase.from('items').update({ order: newOrder });
  await refetch(); // User waits, then sees the list jump to new order
};

// ✅ GOOD - User drags item, it stays where they dropped it instantly
const handleDragEnd = (result) => {
  // 1. Update cache immediately (user sees result instantly)
  queryClient.setQueryData(['items'], (old) => reorder(old, result));

  // 2. Persist in background
  supabase.from('items').update({ order: newOrder })
    .then(() => {}) // Success - cache already correct
    .catch(() => {
      // 3. Revert on failure
      queryClient.invalidateQueries({ queryKey: ['items'] });
      toast.error('Failed to save order');
    });
};
```

### Never show loading after a user action

After a mutation (create, update, delete, reorder), NEVER show a loading spinner or skeleton. The cache should already have the correct data from the optimistic update.

```typescript
// ❌ BAD - After saving, refetch shows loading state
await mutation.mutateAsync(data);
await queryClient.invalidateQueries(['items']); // Shows loading while refetching

// ✅ GOOD - After saving, update cache directly
mutation.mutate(data, {
  onSuccess: (newItem) => {
    queryClient.setQueryData(['items'], (old) => [...old, newItem]);
  },
});
```

### Drag-and-drop must always be optimistic

Every drag-and-drop reorder in the app must:
1. Update React Query cache immediately on drop
2. Persist the new order to the database in the background
3. On error: revert the cache and show a toast
4. NEVER call `refetch()` or `invalidateQueries()` after a successful drop

**Reference pattern:** any list reorder uses the drag library's `handleDragEnd` to call
`queryClient.setQueryData` (optimistic), persists in the background, and reverts on error - it
never `refetch()`s after a successful drop. Once your repo has a canonical example, link it here.

---

## ZOOM / GESTURE PERFORMANCE

### Debounce expensive recalculations during continuous input

When zoom, resize, or continuous input changes require expensive recalculations (repositioning all elements, re-sorting arrays), debounce the recalculation so it only runs after the user stops.

```typescript
// ❌ BAD - Recalculates ALL appointment positions on every zoom tick
window.addEventListener('zoom-changed', () => {
  setRecalcTrigger(prev => prev + 1); // Immediate state update = immediate re-render
});

// ✅ GOOD - Debounce recalculation, only run after zooming stops
const timerRef = useRef(null);
window.addEventListener('zoom-changed', () => {
  if (timerRef.current) clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => {
    setRecalcTrigger(prev => prev + 1); // Only after 200ms of no zoom changes
  }, 200);
});
```

### CSS-variable-based positioning (zoom, scale, dynamic sizing)

When element positions or sizes depend on a value that changes continuously (zoom level, scale factor, dynamic row height), **never store pre-computed pixel values in React state or useMemo**. This forces a full re-render and recalculation of every element when the value changes.

Instead, store **multipliers** (time-based, slot-based, ratio-based) and let CSS `calc()` with a CSS variable handle the pixel conversion. The browser's CSS engine reflows natively in ~5ms - no React involvement.

```typescript
// BAD - pixel values in useMemo, re-renders on every zoom change
const blocks = useMemo(() => items.map(item => ({
  top: item.startSlot * getSlotHeight(),    // pixels - zoom-dependent
  height: item.slots * getSlotHeight(),      // pixels - zoom-dependent
})), [items, zoomTrigger]);                  // re-renders when zoom changes

// GOOD - multipliers in useMemo, CSS handles zoom
const blocks = useMemo(() => items.map(item => ({
  topSlots: item.startSlot,                  // pure number - zoom-independent
  heightSlots: item.slots,                   // pure number - zoom-independent
})), [items]);                               // never re-renders on zoom

// In JSX (real CSS var name is --calendar-slot-height):
<div style={{
  top: `calc(${block.topSlots} * var(--calendar-slot-height))`,
  height: `calc(${block.heightSlots} * var(--calendar-slot-height))`,
}} />
```

When the CSS variable changes (via `element.style.setProperty`), the browser reflows all elements that reference it - zero React re-renders.

**When to apply:** zoom controls that scale element heights; dynamic row/column sizing; any value that changes during a user gesture (pinch, scroll-wheel, slider).

**When restructuring is necessary:** if a performance fix requires changing from pre-computed pixels to CSS-variable multipliers, that is a structural change - not a quick patch. Do not try to optimize around a fundamentally wrong architecture (e.g., adding debouncing to a re-render that shouldn't exist). Fix the root cause: remove the re-render dependency entirely.

**Reference pattern** (e.g. a zoomable calendar/timeline): store slot-multipliers (`topSlots` /
`heightSlots`) in `useMemo`, and set the pixel size through one CSS variable
(`--slot-height`) that a ref-driven zoom handler updates via
`container.style.setProperty(...)` - no React state for the zoom level, so a zoom gesture triggers
zero re-renders. Debounce rapid zoom clicks so only the final level triggers re-centering.

---

## CLEANUP & TIMER MANAGEMENT

Every `setTimeout`, `setInterval`, and `requestAnimationFrame` must be tracked and cancelled in cleanup.

```typescript
// ❌ BAD - Timer leaks, can set state on unmounted component
setTimeout(() => setAnimation(null), 300);
requestAnimationFrame(() => { setFlag(false); });

// ✅ GOOD - Tracked and cancelled
const timerRef = useRef<ReturnType<typeof setTimeout>>();
const rafRef = useRef<number>();

timerRef.current = setTimeout(() => setAnimation(null), 300);
rafRef.current = requestAnimationFrame(() => { setFlag(false); });

// In cleanup:
return () => {
  if (timerRef.current) clearTimeout(timerRef.current);
  if (rafRef.current) cancelAnimationFrame(rafRef.current);
};
```

---

## TAB SWITCHING & PAGE STABILITY

1. **NEVER re-query context data that a shared context/provider already holds** (the current user, the current location/tenant, feature flags) - read it from the context instead of fetching it again per page.
2. **Page position must NEVER change when switching tabs.**
3. **Never swap the entire component tree based on loading state** - only the inner content area changes.

---

## APP LOADING CHAIN

> ⚠️ **Adapt to this repo's provider stack.** The principle is stack-agnostic; the provider names
> are examples.

Providers usually nest in a dependency chain: **auth/session** (who is the user) →
**account/subscription gating** → **routing/layout** → **page content**. Each layer depends on the
previous. When a hook depends on data from a parent context, always check the parent's loading
state before setting your own `loading = false`, or you flash an empty state the parent could have
filled.

### Session / auth caching

Cache session data (user id, account id, role, flags) in `localStorage` so return visits render
instantly from the cached snapshot (marked stale) while it revalidates in the background. Expose it
through one `useSession()`-style hook and read auth from there - never a network `getUser()` per
call (the bundled code hook blocks that shape).

---

## PWA SERVICE WORKER (if the app is a PWA)

If the app ships a service worker, prefer `skipWaiting: true`, `clientsClaim: true`, and
`NetworkFirst` for navigation, and don't churn those settings - changing them causes stale-bundle
and update-loop bugs that are hard to reproduce.

---

## INVESTIGATION CHECKLIST

Before finishing any page work:

**Rendering:**
- [ ] No `useState` for values that change at 30-60fps? (use refs + DOM manipulation)
- [ ] All computed arrays/objects passed as props are wrapped in `useMemo`?
- [ ] No `.filter()`, `.map()`, `{...spread}` directly in JSX props?
- [ ] No `getComputedStyle()` in scroll handlers or render path? (blocked by hook)
- [ ] No all-properties transition utility on elements? (blocked by hook - name exact props)
- [ ] Pure functions defined outside component body?
- [ ] Array references stabilized before calling setState?
- [ ] Zoom/scale-dependent positions use CSS `calc()` with CSS variables, not pre-computed pixels in useMemo?

**Scroll/Event Handlers (CRITICAL - causes freezing and jumping):**
- [ ] Scroll/wheel handlers throttled with `requestAnimationFrame`?
- [ ] ZERO `setState` calls inside scroll/wheel/touch handlers? (use refs + debounce until scroll stops)
- [ ] No changing state in event listener effect dependency arrays?
- [ ] ALL callback props (onDateChange, onFilter, etc.) wrapped in `useCallback` in the parent?
- [ ] No inline arrow functions passed as props to components that use them in `useEffect` deps?
- [ ] No `scrollTop =` assignments in effects that can re-trigger during active user scrolling?
- [ ] Effects that reposition scroll are guarded with a scroll-origin value stamp (not a boolean flag)?
- [ ] Unbounded buffers/arrays have a max cap?

**Data Fetching:**
- [ ] Data fetching uses React Query (not useState + useEffect)?
- [ ] Loading states show stale/cached data instead of skeletons where possible? (`placeholderData`, not the removed v4 option)
- [ ] Page structure stays stable during loading (no full-page skeleton swap)?
- [ ] No `supabase.auth.getUser()` calls? (blocked by hook - use SessionContext)
- [ ] Only needed columns selected? (blocked by hook - no wildcard select)
- [ ] Independent queries run in parallel?
- [ ] No fetch-in-loop patterns?

**Optimistic updates:**
- [ ] Every user action (drag, toggle, submit) updates the cache optimistically, persists in background, reverts on error?
- [ ] No `refetch()` / `invalidateQueries()` after a successful drag-and-drop?

**Cleanup:**
- [ ] All timers and animation frames tracked and cancelled in cleanup?
- [ ] PWA service worker config unchanged?
