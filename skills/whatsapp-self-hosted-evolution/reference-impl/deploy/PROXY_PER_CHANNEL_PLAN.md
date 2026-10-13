# Proxy-per-channel - MVP DONE + PROVEN LIVE (2026-09-01)

> **Provider knowledge (IPRoyal API, gotchas, costs, the single-source `403`, per-order
> auto-renew, fraud screening, Bright Data) is consolidated in the `iproyal-proxies` skill
> (`.claude/skills/iproyal-proxies/SKILL.md`).** This file is the build log for our pool.

> STATUS: **T1-T5 COMPLETE and VERIFIED LIVE (2026-09-01).** Each Evolution
> channel now claims its own dedicated IPRoyal ISP IP at connect and egresses
> through it. Proven end to end: one test channel claimed proxy 203.0.113.10, and
> IPRoyal's DATA USAGE for that IP shows traffic to **web.whatsapp.com** starting
> the moment it connected - i.e. WhatsApp is egressing through the per-channel
> proxy, not the shared Render host IP. `EVOLUTION_PROXY_MODE=required` is SET on
> the `app-server-test-clone` Render service.
>
> Still DEFERRED (optional, post-MVP): T6 health cron, T7 superadmin pool view,
> T8 backfill-on-reconnect, and the auto-buy adapter (groundwork in
> scripts/iproyal_import.py). Original design context below.

## Why (the ban-risk reason, verified)
All Evolution sessions egress from the Evolution host's single Render IP by
default. At 1-5 numbers (test) that's fine + `billing-server/src/whapi/safety.ts`
caps are the real protection. But once MANY merchants share one IP, WhatsApp can
flag the IP and take down MULTIPLE merchants at once. Fix: each channel gets its
own STATIC (sticky) residential/mobile IP.

## Cost (so the trigger-to-buy is informed)
- Correct product = **static residential/mobile, sticky 1-IP-per-session**
  (NOT datacenter - WhatsApp flags those; NOT rotating - breaks the companion link).
- ~$2-6 / IP / month. Still far below WHAPI's ~$25/channel/mo, so per-channel
  proxy is cheaper than WHAPI at every scale.
- Reputable providers: IPRoyal, Bright Data, Oxylabs, Proxy-Cheap. Provider choice
  changes the URL format + auth, so it must be known before building assignment.

## What's ALREADY built (do not rebuild)
- Column `whatsapp_channels.evolution_proxy_url` (migration 20260820_100000).
- `evoCreateInstance({ proxyUrl })` in `whatsapp/evolution/evolutionClient.ts`
  already passes `proxy: { url }` to Evolution at instance create.
- So a channel with a non-null `evolution_proxy_url` ALREADY egresses through it
  on (re)create. The only missing piece is ASSIGNMENT (which URL per channel).

## TASKS for the proxy phase (execute in order when triggered)
- [x] T1. DONE 2026-09-01. Owner chose **IPRoyal ISP Dedicated** (static ISP,
      Premium/zero-fraud-score = IPQS, US, 30-day, "Fresh IPs every renewal" OFF so
      the IP stays STABLE). Bought **2 IPs** (order <order-id>): 203.0.113.10 +
      203.0.113.11, HTTP port 12323. Imported into `evolution_proxies` via the
      IPRoyal reseller API (X-Access-Token) with `scripts/iproyal_import.py` (reads
      IPROYAL_API_TOKEN from .env.local; product_id 9 = ISP Dedicated; reads
      proxy_data.proxies[].{ip,username,password} + ports["http|https"]). No manual
      paste; passwords never printed. `scripts/iproyal_discover.py` is the read-only
      shape-discovery helper. These two scripts are the basis for the auto-buy adapter.
- [x] T2. DB: table `evolution_proxies` created
        (migration `supabase/migrations/20260831_120000_evolution_proxies_pool.sql`):
        id, proxy_url (full, incl auth), label, status ('available'|'assigned'|'dead'),
        assigned_channel_id (FK whatsapp_channels.id, ON DELETE SET NULL),
        health ('ok'|'failing'|null), provider + provider_order_id (auto-buy seam),
        last_checked_at, assigned_at, notes, created_at, updated_at. Index on status,
        unique(assigned_channel_id). RLS ON, service-role only (no anon/authenticated
        grants or policies - proxy URLs carry credentials).
- [x] T3. Assignment logic in `provision.ts` (createEvolutionChannel): after the
        row insert, `claimProxyForChannel()` (billing-server/src/whatsapp/evolution/
        proxyPool.ts) atomically claims one 'available' proxy (conditional UPDATE ...
        WHERE status='available', race-safe via the row lock), writes it to
        whatsapp_channels.evolution_proxy_url, and passes it into evoCreateInstance.
        No free proxy + mode='required' -> reportError('eng_alert:critical') + roll
        back the row + 503 code:'no_proxy_capacity' (never falls back to shared IP).
        NB: also FIXED the transport - evoCreateInstance was sending the proxy as
        `{ proxy: { url } }`, which Evolution's v2 InstanceDto IGNORES; it wants
        TOP-LEVEL proxyHost/proxyPort/proxyProtocol/proxyUsername/proxyPassword.
        Now parsed via parseProxyUrl() in evolutionClient.ts. (Without this the
        proxy silently never applied.)
- [x] T4. Release on delete: deleteEvolutionChannel + the vanish-reconcile block
        both call releaseProxy* (status back to 'available', assigned_channel_id
        null). Deliberately NOT released on logout - a logout keeps the channel row
        and reconnect reuses the same instance+proxy, keeping the egress IP stable
        (churning it would force an avoidable re-pair).
- [x] T5. Feature flag `EVOLUTION_PROXY_MODE` ('off' default | 'required') added to
        config/env.ts (config.evolutionProxyMode). 'off' = current test behavior.
        Set it to 'required' on the Evolution Render service once the pool has real
        IPs, before a second/real merchant connects.

### Remaining before flipping to 'required'
- [x] Populate `evolution_proxies` with the IPRoyal IP(s). DONE (2 rows, order <order-id>).
- [x] Set `EVOLUTION_PROXY_MODE=required` on the Evolution Render service. DONE + verified.
- [x] Auto-buy BUILT (2026-09-01): `acquireNewProxy()` in proxyPool.ts buys a fresh
  IPRoyal ISP IP when the pool is empty, via the reseller API (iproyalClient.ts:
  POST /orders product 9 / plan 22 (30-day) / location 16 (US), then poll
  /orders/{id} for the proxy). OFF by default - enable with env
  `EVOLUTION_PROXY_AUTOBUY=on` + `IPROYAL_API_TOKEN` on the Evolution Render
  service. Guardrails: hard cap `EVOLUTION_PROXY_MAX_POOL` (default 10), reuse-first
  (only runs when no 'available' proxy), in-process serialized (one order at a
  time), fails-null on error so 'required' fails loudly. Bought IPs join the pool
  and are reused on release (IPRoyal auto-extends them, so no expiry handling yet).
  Cheap test: set `IPROYAL_PLAN_ID=23` (1-day, $2).

  PAYMENT SOURCE (how the auto-buy order gets paid): `IPROYAL_CARD_ID` env.
    - unset / '' (default) => pay from the IPRoyal account BALANCE. If the balance
      is empty the order comes back `unpaid`, never provisions, and the connect
      FAILS (proven 2026-09-01). IPRoyal has NO balance auto-recharge - only
      per-order auto-EXTEND (renew via card), which does not fund new buys.
    - a numeric card id => charge that saved card DIRECTLY (no balance needed).
    - 'auto' => charge the first card on file (resolved via GET /reseller/cards).
  ### HOW TO SWITCH AUTO-BUY FROM BALANCE TO CARD (owner asked to note this):
  On the Evolution Render service `app-server-test-clone`, set
  env `IPROYAL_CARD_ID=<your-card-id>` (the owner's saved card on file; confirm
  the current id via GET https://apid.iproyal.com/v1/reseller/cards with the
  X-Access-Token) and redeploy. Then auto-buy charges the card instead of the
  balance, so a merchant connect never fails for empty funds. Use `auto` instead
  of the id to always use the first card on file. Set back to '' to return to balance.
  NOTE (Premium / zero-fraud-score): auto-bought IPs are STANDARD fraud score.
  IPRoyal support CONFIRMED (2026-09-03) the reseller API does NOT support Premium
  for ISP Dedicated: the dashboard's proxy_risk_type/proxy_score_type must NOT be
  sent to /v1/reseller/orders (they're dashboard-only, 401 with the reseller
  token), and it would only be settable via a fraud-score product_question - which
  product 9 does not expose (its questions are only Extra-requirements /
  Multi-device / Fresh-IPs).
  UPDATE (2026-09-07, tested): Premium is NOT actually needed. A REAL fresh
  standard auto-buy (order <order-id>, IP 203.0.113.12) IPQS-scored 0 / clean /
  residential ISP immediately at purchase. The earlier "standard = dirty" scare
  came from an IP that scored 94 only AFTER we released it (post-recycle abuse by
  the next renter), not at purchase. So standard auto-buy is fine; the T6 IPQS
  screen catches the RARE recycled-dirty buy and any IP that drifts dirty with age.
  A manual Premium buffer is now optional insurance, no longer the primary supply.
  The behavioral anti-block caps in billing-server/src/whapi/safety.ts still apply
  regardless of fraud score.
- (Superseded) original auto-buy note: implement `acquireNewProxy()` in proxyPool.ts against
  IPRoyal's order API (availability + orders endpoints) so an exhausted pool
  self-provisions a fresh IP - reuse-first, hard max-pool cap, idempotent, so one
  connect can't buy a runaway number of IPs. Uses the provider/provider_order_id
  columns to cancel/return an IP on release.
- [x] T6. IP fraud SCREEN (DONE 2026-09-07, IPQualityScore). Screened at TWO
        points, deliberately NOT on a timer.
        WHY IPQS not ip-api: ip-api only knows IP *type* and is unreliable
        (proven: it called a fraud-94 recycled IP "clean" and a clean fresh IP a
        "proxy" - backwards). IPQS fraud_score + recent_abuse tracks real ban risk.
        WHY no periodic cron: these are DEDICATED IPs only we use, so a clean-at-buy
        IP stays clean while we hold it, and a banned number is already caught by
        whatsapp_ban_sweep. The one moment cleanliness can change on the reuse path
        is when a released IP is handed to a NEW merchant - so we screen THERE, not
        on a clock.
        Config: IPQS_API_KEY (screening skipped/fail-open if unset),
        EVOLUTION_PROXY_FRAUD_THRESHOLD (default 75; clean fresh buys = 0, huge
        margin), EVOLUTION_PROXY_MAX_DIRTY_BUYS (now default 1 = one dirty IPRoyal IP
        switches to Bright Data; the breaker is now per-provider, see T6d).
        (a) BUY-TIME SCREEN in proxyPool.acquireNewProxy: every fresh auto-buy is
            IPQS-checked before assignment; a dirty one is recorded 'dead' (audit,
            never claimed) and another is bought. A PROCESS-WIDE circuit breaker
            (consecutiveDirtyBuys) caps CONSECUTIVE dirty buys at
            EVOLUTION_PROXY_MAX_DIRTY_BUYS across ALL calls (not per-connect), so a
            batch of already-flagged IPs handed out in a row can't run up a bill.
            On trip: auto-buy DISABLED (returns null + critical alert); connects fall
            back to the manual pool, and adding a clean IP via iproyal_import.py
            restores service. Re-enables on a clean buy, a restart, OR self-heals
            after EVOLUTION_PROXY_DIRTY_BREAKER_RESET_MINUTES (default 120 = 2h; 0
            disables the timer) so a transient bad batch recovers without babysitting.
        (b) CLAIM-TIME SCREEN in proxyPool.screenClaimedProxy: when reuse-first
            claims an existing 'available' pool IP, re-check before use. TWO checks,
            in this ORDER: (i) LEASE not expired (iproyalGetOrderStatus) - a pooled
            IP's auto-extend is off (decision A), so its lease can lapse while idle;
            expired -> retire 'dead', try next. Done FIRST because IPQS has a monthly
            quota and IPRoyal's status endpoint doesn't - never waste an IPQS lookup
            on a dead lease. (ii) FRAUD (IPQS) - the prior holder may have gotten it
            flagged; dirty -> retire 'dead' + release binding, next candidate /
            auto-buy.
        Both stamp health + last_checked_at. Failed/absent lookup fails OPEN
        (assign + silent note). Helper scripts (repo root scripts/): ipqs_check.py,
        ipapi_check.py, iproyal_account.py, iproyal_testbuy.py (--confirm-buy gated).
- [x] T6d. SECOND PROVIDER: Bright Data + bounded two-provider switching (DONE
        2026-09-10, commit <commit>). Auto-buy is no longer IPRoyal-only. New
        brightdataClient.ts: buy one dedicated ISP IP = create a PER-IP zone with
        ips:1 (allocates immediately); release = DELETE the zone (BD bills PRORATED
        until deleted); getBalance. acquireNewProxy is now a bounded state machine
        over both providers (config.evolutionProxyProvider sets the start, default
        'iproyal'):
          - CLEAN -> assign; reset that provider's dirty counter.
          - DIRTY on IPRoyal -> record 'dead' (lease already paid); at
            EVOLUTION_PROXY_MAX_DIRTY_BUYS (default 1) SWITCH to Bright Data (each
            IPRoyal dirty wastes a full ~$4 lease, so switch fast).
          - DIRTY on Bright Data -> DELETE the zone + record 'dead'; STAY on BD
            retrying up to EVOLUTION_PROXY_BD_MAX_DIRTY_BUYS (default 20, ~$1 via
            proration) then TRIP + critical alert. A dirty IP never switches BD->IPRoyal.
          - ERROR (create/poll/provision fail, e.g. provider API down or empty BD
            balance) -> SWITCH to the other provider, bounded by
            EVOLUTION_PROXY_MAX_ERROR_SWITCHES (default 2) so an error ping-pong can
            never loop; exhausted -> critical alert.
        This SUPERSEDES T6(a)'s single-provider consecutiveDirtyBuys breaker: it is
        now PER PROVIDER (dirtyByProvider), persists across calls, and self-heals
        after EVOLUTION_PROXY_DIRTY_BREAKER_RESET_MINUTES.
        BD LIFECYCLE differs from IPRoyal: BD IPs never expire but bill until deleted,
        so a released / retired / dirty / not-routable BD IP is DELETED (never parked
        'available'); the IPRoyal expiry + auto-renew heal passes (which filter
        provider='iproyal') correctly ignore BD rows. BD is screened at buy on the
        EGRESS ip (the connection host is the shared gateway brd.superproxy.io:<your-account-port>,
        NOT the IP). VERIFIED live: WhatsApp connected + sent through a clean BD IP via
        the no-QR swap (2026-09-10). To enable: BRIGHTDATA_API_TOKEN +
        BRIGHTDATA_CUSTOMER_ID + a funded BD balance with auto-recharge (works on
        Pay-As-You-Go, no commitment; BD support confirmed 2026-09-10). Scripts:
        brightdata_testbuy.py (buy/screen/route/delete), proxy_yield.py (per-provider
        yield-per-dollar scoreboard). STILL TODO: a BD low-balance monitor (alert
        before the balance runs dry, the one unattended failure mode).
- [x] T6b. AUTO-RENEW driven by connection state (DONE 2026-09-07). IPRoyal ISP
        orders are 30-day leases; letting one lapse forces a rebuy + a WhatsApp
        RE-PAIR (QR rescan). So we keep the lease auto-extending - but ONLY while the
        IP is serving a live WhatsApp, never on a dead/idle one.
        API (verified): POST /orders/toggle-auto-extend {order_id, product_plan_id,
        is_enabled, payment_type:'card'|'balance', card_id?} - iproyalToggleAutoExtend
        in iproyalClient.ts. Toggling never charges; the charge is the renewal itself,
        which only fires while enabled. Pays from IPROYAL_CARD_ID (card) else balance.
        Driver: proxyPool.setProxyAutoExtendForChannel(channelDbId, enabled), called
        from the Evolution connection handler (routes/evolution/inbound.ts
        handleConnectionUpdate): connected -> enable; needs_qr/disconnected/banned ->
        disable. A never-paired IP never reaches 'connected', so renewal never turns
        on for a dead one. No config master switch - purely connection-driven.
        RELEASE (decision A): releaseProxiesForChannels disables auto-extend on each
        released order first (stop paying for an idle IP); the IP keeps its remaining
        lease + stays reusable, and a later reuse + connect re-enables it.
- [x] T6c. AUTO-HEAL driven by ORDER STATUS, not downtime (DONE 2026-09-07). Gated
        EVOLUTION_PROXY_AUTOHEAL=on. Cron jobs/evolutionProxyHeal.ts HOURLY (:22).
        The IPRoyal order status IS the signal and it's immune to transient blips (a
        blip doesn't expire an order), so there is NO sustained-down timer and NO
        systemic-down guard (a mass infra outage doesn't expire orders -> ignored
        automatically).
        (1) ONE bulk iproyalListOrders() sweep gives every lease's status (no
        per-proxy call; targeted iproyalGetOrderStatus only for an order missing from
        the bulk list). Then, from that one list:
        - AVAILABLE (pooled) + expired -> mark 'dead' (cleanup ONLY, never renew/buy -
          idle IPs are meant to lapse). Done here so a CONNECT never has to
          claim-then-discover a dead pooled IP one-by-one (each is an API round-trip
          on the latency path). NOT counted toward mass-expiry.
        - ASSIGNED to a CONNECTED channel: expired -> heal (renew/swap). We spend
          ONLY to keep a LIVE number's IP up; a disconnected/logged-out channel is
          left to lapse (auto-renew was turned off on disconnect - healing it would
          pay for an IP nobody's using). (2) ACTIVE = IGNORE (their outage/transient;
        we already paid; merchant disconnect notice is the separate existing path).
        (3) EXPIRED (auto-renew failed) = the only spend: renew same IP first
        (iproyalExtendOrder + evoRestartInstance, no QR - also fires PROACTIVELY for
        an in-grace order while still connected), else SWAP to a fresh IP. (4)
        MASS-EXPIRY guard: >3 or >50% expired at once = a card/payment failure, alert
        (fix the card), don't mass-act. (5) per-run fix cap (2) + stop-on-failure
        canary. Mechanism: SEAMLESS SWAP without QR via proxyPool.swapProxyForChannel
        = retire old (dead + auto-extend off) -> claimProxyForChannel (reuse-first /
        auto-buy w/ screen+breaker) -> evoSetProxy (POST /proxy/set/{instance},
        verified body proxyHost/proxyPort/proxyProtocol/proxyUsername/proxyPassword) +
        evoRestartInstance (POST /instance/restart, reconnects on stored creds).
        Auto-renew re-enables for the NEW IP on reconnect (T6b). Only a genuinely
        EXPIRED lease heals; a live IP gone DIRTY is the merchant's own behavior (we
        screen at connect, not during usage). All alerts INTERNAL.
        RECONCILER (expanded 2026-09-08): the bulk list is RICH - each order carries
        auto_extend_settings.is_enabled AND full proxy_data (ip/user/pass/ports), so
        the whole reconcile runs with ~no extra IPRoyal calls. Extra passes:
        - ORPHAN IMPORT: an ACTIVE order with NO DB row (paid but the insert was lost)
          -> import its IP(s) as 'available' from the list's creds. Recovers spend.
        - REVIVE DEAD-BUT-ALIVE: a 'dead' row whose lease is ACTIVE + ROUTES
          (probeProxyRoutable) + IPQS-clean -> back to 'available' (undoes a wrongly/
          transiently-dead row; expired or still-dirty stays dead). Capped, recent-dead only.
        - RECONCILE AUTO-RENEW: auto-extend should be ON for a CONNECTED channel's IP,
          OFF for disconnected/logged-out/banned; checked FREE from the list, toggled
          only on a genuine mismatch (self-heals a missed connect/disconnect edge;
          skips transient connecting/unknown). Caps: ORPHAN/REVIVE/RECONCILE per run.
        Also: fresh-buy ROUTABILITY gate (proxyPool.waitProxyRoutable) - a bought IP
        must actually route THROUGH itself (axios probe, ~30s warm-up) before being
        assigned, since IPRoyal IPs aren't auth-ready the instant they're bought and
        Evolution's create-time testProxy 407s an unready one. Not-yet-routable -> parked
        'available' to warm, connect fails that once. IPQS score now also stored as a
        queryable numeric column (fraud_score); health is the enum 'ok'|'failing'|null.
- [ ] T7. Superadmin visibility (optional, later): a small read-only view of
        proxy pool usage (assigned/available/dead counts). NOT the operator UI.
- [ ] T8. Backfill: when flipping to 'required', existing Evolution channels
        (there will be few at cutover) need a proxy assigned + a re-pair, since a
        live session's IP can't change without re-linking. Plan a gentle migration
        (assign on next reconnect) rather than forcing all at once.
- [ ] T9. FUTURE cost optimization (revisit once merchant volume is CONSISTENT):
        buy IPs in small batches (2 at a time) for the volume price. IPRoyal 2-pack
        is ~$6 vs $8 for two singles, ~$2/pair/mo saved, gap widens with scale.
        TRADEOFF (verified 2026-09-07): a MULTI-IP order auto-renews ALL-OR-NOTHING
        - toggle-auto-extend is per-ORDER with no per-IP subset, so you can't
        auto-renew just some IPs in a pack (manual POST /orders/{id}/extend CAN do a
        subset via its `proxies` array, but auto-extend cannot). Fine when demand is
        steady (you'd keep both anyway); costly under churn (you'd renew an IP no one
        needs, or let a needed one lapse with its pack-mate). So: CURRENT default =
        single-IP orders (quantity 1) for max per-IP flexibility (each is its own
        renewable/cancelable order, and our connection-driven auto-renew toggles each
        independently). SWITCH to quantity-2 batches only once steady multi-merchant
        usage means both IPs in a pack will reliably stay in use. Demand-driven, not
        yet. Also buy the manual Premium buffer as single-IP orders for the same
        reason (note in scripts/iproyal_import.py workflow).
        CONSOLIDATION / DEFRAG (pairs with T9 batch-buying + the seamless no-QR swap
        swapProxyForChannel): because auto-renew is per-ORDER all-or-nothing, a
        half-used pack wastes the idle IP's cost. Fix by bin-packing users onto full
        packs. Example: two 2-packs, each with only ONE IP in use (pack A: IP1 used,
        IP2 idle; pack B: IP3 used, IP4 idle) = auto-renew on both packs renews 4 IPs
        for 2 users. Instead, seamlessly SWAP the user on pack B's IP3 onto pack A's
        idle IP2 (no re-pair) so pack A is fully used (IP1+IP2) and pack B is empty,
        then turn auto-renew OFF on pack B so it lapses. Rule: keep at most ONE
        partially-filled pack at any time, so wasted paid-but-idle IPs is <= pack_size
        - 1 (<=1 for 2-packs). Only relevant with multi-IP packs; single-IP orders
        don't fragment. Run this as a periodic "defrag" pass (or at release time)
        once batch-buying is live.

## Trigger condition
Do T1-T5 (minimum viable) the moment we go from "owner testing" to "a second,
real merchant connects via Evolution." T6-T8 can follow shortly after.

## Guardrail
Once EVOLUTION_PROXY_MODE='required', a connect with no available proxy MUST fail
loudly, never fall back to the shared IP. The shared-IP path is test-only.
