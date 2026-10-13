---
name: timezone-handling
description: The owner's convention for every time-related operation in an app where things happen at a real place (appointments, classes, shifts, opening hours, deliveries, check-ins): use the timezone of WHERE the thing happens (the location, branch or venue), NOT the timezone of the browser or the server. Read it BEFORE displaying a time, computing "now" or "today", validating that a time is in the past or future, scheduling or rescheduling anything, comparing two times, building a date range for a report, writing a cron job or reminder that fires "at 9 AM", or saving a time picked in a form. It gives the default rule, why it matters, the implementation pattern, the narrow exceptions where browser-local time is correct, and the traps (the server's timezone, "today" boundaries, daylight saving, date-only values). Use when the owner mentions timezone, time zone, "times are off by N hours", "it shows the wrong day", "the appointment moved", UTC, daylight saving, DST, "today's bookings", or anything scheduled.
---

# Timezone Handling

> ## Adapt before use
> This describes how time handling SHOULD be wired in any app tied to physical places. The
> helper names below (`DEFAULT_TIMEZONE`, a `getTimezoneForLocation()` helper, a `timezone`
> column on the location) are EXAMPLES of the shape, and the snippets use the `date-fns-tz`
> library. Grep the repo before citing any of them. Once the repo has its own timezone module,
> update this file with the real file path, the real helper names and the real default.

## The default rule: the place's timezone

**All time-related operations MUST use the timezone of the LOCATION where the thing happens, not
the user's browser timezone and not the server's timezone.**

Unless explicitly stated otherwise, this applies to:
- displaying times,
- calculating "the current time" or "today",
- validating whether a time is in the past or the future,
- scheduling and rescheduling,
- comparing times,
- date-range filters in lists and reports.

You MUST:
1. Get the timezone from the location record (an IANA name such as `America/New_York`, stored on
   the location).
2. Use timezone-aware functions for every conversion and every format. Never do arithmetic on
   hour offsets by hand.
3. Fall back to ONE shared default constant when no location is selected. Never a per-file
   literal.

## Why this matters

Users are often in a different timezone than the place.

- A customer in one state books an appointment at a business in another.
- An admin travelling abroad manages the schedule for their business at home.
- Staff open the app on a laptop whose clock is set to the wrong zone.

The appointment time must always be in the context of WHERE the service happens, not where the
person looking at it currently is. If the app uses the browser's zone, the same appointment
shows as 2:00 to one person and 5:00 to another, and somebody arrives three hours wrong. The
classic report is "times show 2 hours off": that is this bug.

## Implementation pattern

```typescript
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { DEFAULT_TIMEZONE } from '@/lib/timezone';   // one shared constant

// The location's timezone
const selectedLocation = locations.find(l => l.id === locationId);
const locationTimezone = selectedLocation?.timezone || DEFAULT_TIMEZONE;

// "Now" in the location's timezone
const now = new Date();
const nowInLocationTz = toZonedTime(now, locationTimezone);

// Formatting for display, in the location's timezone
const displayTime = formatInTimeZone(now, locationTimezone, 'HH:mm');
const displayDate = formatInTimeZone(now, locationTimezone, 'yyyy-MM-dd');

// Comparing: compare the location-zone strings, not raw local getters
const nowDateStr = formatInTimeZone(now, locationTimezone, 'yyyy-MM-dd');
const nowTimeStr = formatInTimeZone(now, locationTimezone, 'HH:mm');
```

**Put it in ONE module and reuse it.** A timezone module should own the default constant and the
helpers that resolve the zone ("timezone for this location", "timezone for this appointment",
which follows the appointment's own location even when the picker shows another). Every screen
and every server job imports from there. A date helper re-implemented in a component is how two
screens disagree about what day it is. (See `working-agreements`, reuse before writing.)

The pieces that must all agree:
- the timezone module (the default plus the resolvers),
- the create and edit dialogs (what the user sees while picking),
- the save logic (what instant is actually stored),
- the time picker component (what "now" and "past" mean while picking),
- every server job that sends something "at a time".

## Exceptions

Use the browser's local time ONLY when:
1. the owner explicitly asks for it,
2. you are showing the user's own local time for reference, **clearly labeled as such**,
3. it is for system logging or debugging.

In every other case, default to the location's timezone.

## Traps

- **The server has a timezone too, and it is usually UTC.** A job that says "send reminders at
  9 AM" or "mark invoices overdue at midnight" must compute 9 AM and midnight PER LOCATION. A
  single UTC cron expression sends the 9 AM reminder at 4 AM or 5 AM local, and "midnight" rolls
  the day over hours early or late.
- **"Today" is a range, and the range depends on the zone.** "Today's bookings" means from local
  midnight to local midnight at the location, converted to instants for the query. Filtering on
  the UTC date silently drops or adds the evening's records.
- **A raw `new Date()` and its local getters (`getHours()`, `getDate()`) use the machine's
  zone.** That is the browser's zone on the client and the server's zone on the server. Both are
  wrong by default here.
- **Store instants, display in the place's zone.** Save an unambiguous instant (a timestamp with
  time zone). Convert at the edges: on input, interpret what the user picked AS location time;
  on output, format IN location time.
- **Do not hardcode an offset.** Offsets change twice a year. Use the IANA zone name and let the
  library do it.
- **Daylight-saving days are 23 or 25 hours long.** Adding "24 hours" to get "the same time
  tomorrow" is wrong twice a year. Add calendar days in the location's zone. Recurring items
  (every Tuesday at 10:00) must stay at 10:00 local across the change.
- **A date-only value is not a timestamp.** A birthday or a due date has no timezone. Parsing
  `2026-03-10` as a timestamp makes it midnight UTC, which displays as March 9 west of UTC. Keep
  date-only values as dates end to end.
- **An appointment belongs to ITS location.** When the picker shows location A and the user
  opens an appointment at location B, the times follow B.
- **Exports and emails are displays too.** A CSV, a PDF, a confirmation email and a calendar
  invite must all show location time, and should name the zone when the reader may be elsewhere.
- **No location selected** is a real state (an "all locations" view). Decide what it shows: the
  shared default, or each row in its own location's zone with the zone labeled. Do not fall back
  to the browser silently.

## How to verify

- Set your machine or browser to a different timezone than the location and repeat the flow.
  Every time on screen must be unchanged.
- Create something near local midnight at the location. Confirm it lands on the right day in the
  list, in the report, and in the reminder.
- Check one record in the database: the stored instant must equal the picked location time,
  converted.
- If the repo has locations in more than one zone, test with two of them side by side.

## The checklist

- [ ] Every displayed time is formatted in the location's zone, through the shared helper?
- [ ] "Now", "today", past and future checks are computed in the location's zone?
- [ ] The saved value is an unambiguous instant, built from location time?
- [ ] No hardcoded offsets, no bare local getters, no per-file default zone?
- [ ] Server jobs compute their trigger time per location?
- [ ] Date-only values are never passed through a timestamp?
- [ ] Any browser-local time shown is one of the three exceptions and is labeled?
- [ ] Verified with the browser set to a different zone?

## Related

- `working-agreements`: reuse the shared helper; do not write a new date utility.
- `report-verification`: date-range filters in reports.
- `verify-before-done`: test the edge case that breaks it.
