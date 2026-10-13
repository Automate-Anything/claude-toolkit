---
name: local-seo-playbook
description: Complete, self-contained playbook for getting a LOCAL or DIRECTORY business found EVERYWHERE it can be found: Google "near me" organic, the Google Maps / local pack, AND every AI model (Google AI Overviews, Gemini, ChatGPT, Perplexity, Copilot, Claude). Covers local ranking factors, Google Business Profile, NAP/citations, multi-location and directory site architecture, LocalBusiness schema, the per-AI-model backend/crawler reality, and the AEO/GEO content-block patterns, so an agent that reads ONLY this skill can execute the entire local + AI discovery job end to end. Use when the user mentions local SEO, "near me", Google Business Profile / GBP / Google My Business, the map pack / local pack, Google Maps ranking, NAP consistency, local citations, multi-location SEO, a salon/restaurant/service directory, store locator or location landing pages, "find a business near me", getting cited by AI for local queries, AEO/GEO for a local business, ranking on ChatGPT/Perplexity/Gemini/Copilot/Claude for local, or building a directory/marketplace that ranks. For NON-local pages-at-scale see programmatic-seo; for generic (non-local) AI citation see ai-seo; for raw JSON-LD see schema; for URL/linking see site-architecture; for a post-build audit see seo-audit. This skill self-containedly covers the LOCAL + AI job so you do not need to also open those, but they remain the specialists for their own non-local domains.
metadata:
  version: 2.0.0
---

# Local + AI Search: the complete discovery playbook

You are an expert in getting a local business, or a directory/marketplace of
local businesses, found on every surface a consumer might use to discover it:
Google organic "near me" results, the Google Maps / local pack, and every AI
model that now answers "best X near me". This skill is deliberately self-
contained: it merges local SEO, multi-location/directory architecture, local
schema, AND per-AI-model ranking (GEO/AEO) into one job, because splitting them
is exactly what makes an agent read one, think it is done, and miss the rest.

Local + AI discovery is NOT general SEO with a city name pasted in. It has its
own ranking systems (the local pack + Maps), its own dominant factor (Google
Business Profile, not the website), its own AI reality (each model uses a
different search index), and its own failure mode (thin templated location
pages). All of it is below.

---

## PART 0: the four surfaces you must win (they rank differently)

1. **The local pack / Google Maps** (the map with 3 pins). Ranked mostly by
   Google Business Profile + proximity + reviews. Your WEBSITE barely ranks here;
   your GBP does. Highest commercial intent surface.
2. **Organic "near me" blue links** (your web pages). Normal SEO + on-page local
   relevance. Where a directory site or location page competes.
3. **AI answers** (Google AI Overviews, Gemini, ChatGPT, Perplexity, Copilot,
   Claude). Increasingly the first thing a user sees. Ranked by which model's
   INDEX you are in + extractable structure + authority + third-party presence.
4. **Voice assistants** (a subset of AI/answer, conversational). Short spoken
   answers.

A complete strategy wins all four. Most people optimize only the website and
lose the pack (highest intent) and the AI answers (fastest-growing). Do not.

---

## PART 1: local ranking factors, in priority order

Google local ranking is, in effect, **Relevance + Distance + Prominence**. What
you actually control, ranked by leverage:

1. **Google Business Profile (GBP), fully completed + active.** The single
   biggest local-pack factor. Claim, verify, fill EVERY field, keep it active. A
   dormant GBP loses to an active one.
2. **Reviews: volume, velocity, recency, rating, and responses.** A steady
   stream of recent, high-rated reviews that you REPLY to (velocity matters more
   than a one-time pile). Respond to every review, good and bad.
3. **Primary + secondary categories.** The most important GBP relevance field.
   Pick the most SPECIFIC primary category ("Barber shop", not "Beauty salon").
4. **NAP consistency** (Name, Address, Phone) identical across the entire web:
   GBP, website, every citation. One canonical NAP, enforced. Inconsistency
   suppresses ranking.
5. **Local citations** (NAP mentions on Yelp, Apple Maps, Bing Places, industry
   directories, data aggregators). Consistency > raw count.
6. **On-page local signals** (title/H1 with city + service, embedded map,
   address in footer, LocalBusiness schema, genuinely local content).
7. **Proximity to the searcher.** Uncontrollable; explains why one location
   cannot rank everywhere and why per-neighborhood relevance matters.
8. **Locally-relevant backlinks** (local news, blogs, chambers, partners). Local
   relevance of the linking site matters, not just its authority.
9. **Behavioral signals** (clicks, calls, direction requests, website taps from
   the GBP). A profile people engage with ranks better.

---

## PART 2: Google Business Profile, the complete checklist

For a single business, or every location you control in a chain/directory:

- [ ] Claim + VERIFY (required to rank).
- [ ] Exact canonical NAP (matches the website exactly).
- [ ] Most specific PRIMARY category; accurate secondary categories.
- [ ] Every applicable attribute (accessibility, appointment-required, etc.).
- [ ] Complete services/menu with descriptions + prices.
- [ ] Accurate hours + special/holiday hours (wrong hours kills trust + ranking).
- [ ] 10+ real photos (exterior, interior, work, team); refresh monthly.
- [ ] A natural, non-stuffed description.
- [ ] Website link to the SPECIFIC location page (not just the homepage).
- [ ] A booking link (Reserve with Google where supported).
- [ ] Ongoing: weekly Google Posts, answer Q&A, reply to all reviews, fresh
      photos. Activity IS a ranking signal.
- [ ] (Ecom/retail) keep Google Merchant Center feeds current: accurate
      inventory, pricing, attributes. Google pulls these for local+ecom AI
      answers.

---

## PART 3: multi-location and directory sites, the page pattern

Where local SEO and programmatic SEO meet, and where sites get penalized.

### URL structure (subfolders, never subdomains: consolidates authority)

```
/{service-or-category}/{city}/{business-slug}   ->  a single business (rich)
/{service-or-category}/{city}                    ->  city+category hub (list)
/{service-or-category}                            ->  category hub
/near/{city}                                      ->  all categories in a city
```

The entity/business slug goes LAST. Subdomains split authority; do not use them.

### The unique-value rule (the ONE thing between you and a penalty)

Google's 2024-2026 core updates devastated directory/multi-location sites that
shipped thousands of "[service] in [city]" pages where only the city changed. A
page MUST carry real, page-specific value or it must not be indexed. Real value:

- Real per-location data: actual address, hours, phone, staff, services, PRICES,
  real reviews, real photos, an embedded map of THAT location.
- Genuinely local content: neighborhoods served, parking, landmarks, what is
  specific to this place/city, NOT a templated paragraph with the city swapped.
- For a city+category HUB: a real, ranked list of real businesses + useful local
  context (price ranges, "what to know", FAQs), not a keyword paragraph.

### Tiered indexing (crawl budget + penalty avoidance)

- Rich pages (real data): `index, follow`.
- Thin pages (a name + map stub, or a small-city hub with 1-2 listings):
  `noindex, follow` until they cross a richness threshold, then flip to `index`.
- ONE canonical per business. If a business can appear under two URLs (a claimed
  rich page and an old stub), canonical to the rich one; never let both index
  (cannibalization + duplicate content).

### Internal linking (hub and spoke, no orphans)

Category hub -> city+category hub -> business page, cross-linking related nearby
businesses. Every page reachable from nav. Breadcrumbs with `BreadcrumbList`
schema. Partitioned XML sitemaps (split by page type, each under the 50k-URL
limit), referenced from robots.txt, submitted to Search Console + Bing Webmaster.

---

## PART 4: local schema (JSON-LD), on every location/business page

For exact JSON-LD authoring see the `schema` skill; the local types to emit:

- `LocalBusiness` or a SPECIFIC subtype (`HairSalon`, `HealthAndBeautyBusiness`,
  `Restaurant`, `DaySpa`, etc.). Include `name`, `address` (`PostalAddress`),
  `geo` (`GeoCoordinates`), `telephone`, `url`, `image`, `priceRange`, `areaServed`.
- `OpeningHoursSpecification` (real hours).
- `AggregateRating` + `Review` (REAL reviews only; fabricated review schema is a
  manual-action risk).
- `Service` / `OfferCatalog` for the menu + prices.
- `GeoCoordinates` matching the map + GBP.
- `BreadcrumbList` for the path.
- `FAQPage` on hubs (real local Q&A).

Schema does not directly rank you, but it earns rich results and is the single
biggest lever for AI extraction/citation (30-40% AI visibility boost).

---

## PART 5: ranking on EVERY AI model (the load-bearing part)

You cannot "rank on AI" as one thing. Each model uses a DIFFERENT search
backend index. To be citable you must be in EACH index and allow EACH crawler.

| Model | Search backend | What you must do |
|---|---|---|
| Google AI Overviews / Gemini | Google's own index | Google Search Console; allow `Google-Extended`. Only ~15% of AIO sources overlap the normal top 10, so strong schema can get you cited before you rank #1. |
| ChatGPT (search) | Bing-based index | Bing Webmaster + IndexNow; allow `GPTBot`, `ChatGPT-User`. |
| Microsoft Copilot | Bing index | Bing Webmaster + IndexNow; sub-2s load; LinkedIn/GitHub presence; allow `Bingbot`. |
| Perplexity | Own index + Google | allow `PerplexityBot`; FAQ schema; public PDFs; publishing velocity. |
| Claude (web search) | **Brave Search** (not Google/Bing) | verify you appear at search.brave.com; allow `ClaudeBot`, `anthropic-ai`; maximize factual density. |

Missing Bing = invisible to ChatGPT/Copilot. Missing Brave = invisible to Claude.
No Google rank fixes either. So: register + submit sitemaps to **Google Search
Console AND Bing Webmaster**, wire **IndexNow** (instant Bing/Copilot/Perplexity
pickup), and **verify Brave coverage**.

### robots.txt (allow every model's crawler) + llms.txt

```
User-agent: GPTBot           # OpenAI / ChatGPT
User-agent: ChatGPT-User     # ChatGPT browsing
User-agent: PerplexityBot    # Perplexity
User-agent: ClaudeBot        # Anthropic Claude
User-agent: anthropic-ai     # Anthropic Claude (alternate)
User-agent: Google-Extended  # Gemini + AI Overviews
User-agent: Bingbot          # Copilot (via Bing)
Allow: /
```
Block a bot and that model cannot cite you. You may block `CCBot` (training-only,
Common Crawl) without losing any AI-search citation. Ship an `llms.txt` at root
describing the site and linking key hubs. NEVER write separate "content for AI"
(scaled-content-abuse risk): one page serves humans and every model.

### The GEO authority levers (directional, NOT the quoted percentages)

These levers come from the Princeton GEO study. **Do the levers; do not quote the
percentages as fact.** That study measured re-ordering inside a context that
already contained the page, in a simulated prototype; later full-pipeline
benchmarks found most of its tactic-level numbers fail to replicate or reverse.
The *ordering and direction* survived (cite sources and add dated statistics help;
keyword stuffing measurably hurts); the exact "+40% / +37% / ~3.2x" figures did
not. Never put these numbers on a page or in a report (that breaks the master
`seo` skill's rule B1, never invent a number). The percentages below are shown
STRUCK THROUGH to mark them as not-to-be-cited, with the lever itself kept.

Layer the levers, strongest first, ignore the numbers:

| Lever | ~~claimed boost~~ | How |
|---|---|---|
| Cite sources | ~~+40%~~ | authoritative references with links |
| Add statistics | ~~+37%~~ | specific numbers WITH sources + dates |
| Add quotations | ~~+30%~~ | named expert, title, org |
| Authoritative tone | ~~+25%~~ | expertise, not sales |
| Improve clarity | ~~+20%~~ | simplify |
| Technical terms | ~~+18%~~ | correct domain vocabulary |
| Freshness | ~~~3.2x~~ | visible "last updated" < 30 days |
| ~~Keyword stuffing~~ | (negative, directionally real) | actively HURTS AI visibility. Never. |

### Per-model tuning for a LOCAL/directory case

- **Google AI Overviews:** schema is the biggest lever; target "what/how/best"
  local phrasings that trigger AIOs.
- **ChatGPT:** content-answer fit dominates citation (the widely quoted "~55%" is
  a single vendor figure, treat as directional not fact), so write hubs the way
  ChatGPT answers ("Here are the best barbershops in Jersey City: ..."), keep
  fresh, build domain authority.
- **Perplexity:** FAQ schema + a public PDF (e.g. a city price guide) +
  frequent publishing.
- **Copilot:** Bing + IndexNow + sub-2s edge render + brand on LinkedIn.
- **Claude:** verify Brave; maximize factual density (dated numbers, named
  sources); it is the most selective and rewards precision.

### Getting a LOCAL result cited (the intersection, the actual goal)

When a user asks any model "best barbershop near me in [city]", it assembles the
answer from its index of your hubs/profiles, third-party sources, and extractable
structure. To BE the cited source:

- Open every city+category hub with a 40-60 word self-contained, liftable answer
  naming real businesses with real numbers ("The top-rated barbershops in Jersey
  City are X (4.9, 320 reviews), Y..., Z..., based on N verified reviews. Average
  cut is $NN.").
- Real, dated LOCAL statistics on every hub (shop count, average price, average
  rating, price range).
- A comparison table per hub (business / rating / price / distance / open-now).
- `FAQPage` schema with REAL local questions ("How much is a haircut in [city]?",
  "Which are open Sunday?").
- Full `LocalBusiness` + `AggregateRating` + `Review` + `GeoCoordinates` on every
  profile so the model can extract the entity.
- Daily freshness (availability + reviews) so the "updated" stamp actually moves.
- Third-party presence over time (Yelp, Apple Maps, a brand Wikipedia entry,
  local subreddits, review sites): models cite third parties FAR more than your
  own domain, so seeding these is part of the AI plan, not optional.

---

## PART 6: reusable AEO/GEO content-block patterns

Drop these blocks into hubs/profiles. They win featured snippets, AI Overviews,
voice, and AI citation.

**Definition block** ("What is X / where is X"): `## What is [term]?` then a
1-sentence definition, 1-2 sentences of expansion, 1 of context.

**Step-by-step block** ("How to X"): `## How to [goal]`, one-line overview, then
numbered `1. **Step**: action`.

**Comparison table block** ("X vs Y", "best of"): a markdown table of
feature/option/option + a `**Bottom line**:` recommendation.

**Pros/cons block** ("is X worth it"): `### Pros` / `### Cons` bullet lists + a
`**Verdict**:`.

**FAQ block** (essential for FAQ schema): `### [question exactly as users search]?`
then a direct answer first sentence + 2-3 sentences context. Use natural phrasing,
question words, and mirror "People Also Ask". Answers 50-100 words.

**Listicle block** ("Best [N] X for Y"): intro with selection criteria, then
`### 1. [Item]` with 2-3 sentences of specific benefit each.

**Statistic citation block** (+15-30% citation): `[claim]. According to [source],
[number with timeframe]. [why it matters].`

**Expert quote block:** `"[quote]," says [Name], [Title] at [Org]. [context].`

**Self-contained answer block:** `**[topic]**: [complete standalone answer with
specific numbers/examples in 2-3 sentences].` (the passage AI lifts verbatim.)

**Voice:** lead with a direct answer under 30 words, conversational, local
context, single spoken response.

---

## PART 7: off-page local authority

- Local citations: submit to major aggregators + relevant directories (Yelp,
  Apple Business Connect, Bing Places, Facebook, industry dirs). NAP consistency
  matters more than count. (See `directory-submissions` if available.)
- Locally-relevant backlinks: local press, chambers of commerce, partners,
  sponsorships. Local relevance beats generic authority.
- If you run a directory of businesses you serve, the strongest white-hat, hard-
  to-copy backlink source is the LISTED businesses linking back to their profile
  ("Find us on [brand]") from their own site/email. Hundreds of merchants =
  hundreds of relevant backlinks you control.
- Third-party AI-cited surfaces (Yelp, Apple Maps, Wikipedia brand entry, local
  subreddits, review sites): seed these; AI cites them more than your domain.

---

## PART 8: realistic timeline (set expectations honestly)

- New domain indexes in days to weeks.
- Local terms with solid location pages + a verified active GBP: page one in
  ~2-4 months (faster than general SEO's 6+).
- Meaningful compounding organic traffic: ~4-8 months.
- Head/competitive terms: 12+ months.
- A "sandbox"/signal-gathering lag of 3-9 months for competitive terms is normal,
  not a penalty.
- Beware vanity spikes: AI/bot crawler hits are NOT human visits (a 300-page pSEO
  site logged 291 crawler requests in 24h), and an aged domain or paid launch can
  fake a fast curve. Measure humans in GSC/GA4. AI CITATION can arrive faster
  than blue-link rank (a schema-rich page can be cited from rank 2-3).

---

## PART 9: monitoring (all four surfaces)

- **Local pack + organic:** Google Search Console (queries, coverage, CWV) + a
  local rank check by location.
- **GBP:** the profile's own insights (calls, directions, website taps).
- **AI visibility (monthly):** pick the top ~20 local queries; run each through
  Google AI Overviews, ChatGPT, Perplexity, Gemini, Copilot, and Claude; log
  whether the brand/a listed business is cited and who is cited instead; track
  month over month. This is the AEO equivalent of rank tracking.
- There is NO AI-specific Search Console report; use GSC for Google and the
  manual all-model check for the rest.

---

## The hard rules (violating these is what gets local sites penalized)

- Never ship a location/city page whose only difference is the city or business
  name in an otherwise identical template. Real per-location value or `noindex`.
- Never fabricate reviews or review schema (manual-action risk).
- Never keyword-stuff the name, GBP, or page (hurts, incl. -10% on AI visibility).
- Never use inconsistent NAP. One canonical NAP everywhere.
- Never let two URLs for the same business both index. One canonical.
- Subfolders, never subdomains, for location/category pages.
- Never claim what a business does NOT offer (e.g. "does not take online
  bookings" when it might): a catchable lie that destroys trust. State only what
  is true and positive.
- Never write separate content "for AI". One page for humans and every model.
- Never block an AI crawler you want citations from.

---

## Common mistakes

- Optimizing the website but ignoring the GBP (losing the map pack, highest
  intent).
- Treating reviews as one-time instead of an ongoing velocity signal.
- Wrong or too-broad primary category.
- Thin templated location pages that get de-indexed or penalized.
- One page trying to rank for many cities (proximity means one location cannot
  rank everywhere).
- Being in Google's index but not Bing's or Brave's, then wondering why ChatGPT/
  Copilot/Claude never cite you.
- Blocking AI crawlers, then wondering why AI never cites you.
- Chasing citation count while ignoring NAP consistency.
- Counting crawler hits as human traffic.

---

## When to reach for a sibling skill (this one covers the LOCAL + AI job alone)

- **`seo` (the master playbook):** the whole non-local job in one place. It now
  absorbs what used to be separate ai-seo / seo-audit / programmatic-seo skills:
  how Google actually works crawl->render->index->serve + Search Console (its
  Part O), the full health audit (Part E), generated-pages quality gate (H4),
  technical-at-scale (M15), AI answer-engine visibility incl. query fan-out and
  agentic access (M17), and the programmatic playbook menu + data-defensibility
  test (M18). Open `seo` for anything not specifically local. Its honesty rules
  (B1: never invent a number; L5: the GEO percentages are unreplicated) govern
  this skill too, which is why the GEO table above is struck through.
- `schema`: exact JSON-LD authoring.
- `site-architecture`: URL + internal-linking + crawl-budget deep dives.
- `content-strategy`: planning genuinely-useful hub content.
- `directory-submissions`: citation/backlink submission (but read M7/L7 in `seo`
  first: bulk directory submission is largely spam now).

You do NOT need to open those to do the local + AI job; they are specialists for
their own non-local domains.

---

## Task-specific questions to ground the work

1. Single business, a multi-location chain, or a directory of businesses you do
   not own?
2. Do you control the Google Business Profile(s)? Claimed + verified?
3. What is the canonical NAP, and is it already consistent across the web?
4. What real per-location data exists (hours, services, prices, reviews, photos)?
   This decides which pages can be indexed.
5. Domain age/authority (sets the realistic timeline)?
6. Which AI models matter most to the audience (sets per-model priority: Bing for
   ChatGPT/Copilot, Brave for Claude, Google for AIO/Gemini)?
7. Who ranks the local pack + blue links + AI answers for the target terms now?
