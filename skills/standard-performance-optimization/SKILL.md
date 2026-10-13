---
name: standard-performance-optimization
description: Performance standard for the parts not covered by page-performance and query-efficiency. Covers performance budgets (TTFB, LCP, INP, CLS, page weight, bundle size, API p95), the critical rendering path, image, JavaScript, CSS and font optimization, API and server settings such as compression, HTTP/2 and ETags, browser cache headers, application caching and invalidation, CDN use, performance monitoring and mobile performance. Read before setting up a build or server config, choosing cache headers, adding images, fonts or large scripts to a page, adding a cache layer or CDN, or defining performance targets, and when the user says "performance budget", "Lighthouse score", "Core Web Vitals", "cache headers", "CDN", "compress", "bundle size", "optimize images", "slow first load" or "TTFB". For React render jank read page-performance, and for slow queries read query-efficiency.
---

# Standard 18 - Performance Optimization

Speed is a feature, and it is measured, not guessed.

**Scope and related skills.** Two existing skills are the authority on their areas, and this
standard does not repeat them:

- `page-performance`: React rendering, scroll and event handler jank, loading states, optimistic
  updates, data-fetching patterns in the client.
- `query-efficiency`: database and network data access (N+1, indexes, EXPLAIN, RLS cost,
  measuring before and after).

This standard adds what they lack: budgets, the critical rendering path, asset optimization,
server and API transport settings, caching layers, CDN, monitoring and mobile network conditions.
The short Database list in section 3 is a summary only; `query-efficiency` governs.
Also see `seo` for how Core Web Vitals relate to search, and `mobile-view-optimization`.

## Philosophy
Every millisecond matters. A fast site converts better, ranks higher, and feels more professional. Performance is not an afterthought. It is designed in from the start.

## 1. Performance Budgets (Targets)

| Metric | Target | Unacceptable |
|--------|--------|-------------|
| Time to First Byte (TTFB) | < 200ms | > 600ms |
| Largest Contentful Paint (LCP) | < 2.5s | > 4.0s |
| Interaction to Next Paint (INP) | < 200ms | > 500ms |
| Cumulative Layout Shift (CLS) | < 0.1 | > 0.25 |
| Total Page Weight | < 1.5MB | > 3MB |
| JavaScript Bundle | < 200KB gzipped | > 500KB |
| API Response Time | < 200ms (p95) | > 1s |

## 2. Frontend Performance

### Critical Rendering Path
- Inline critical CSS in `<head>` (above-the-fold styles)
- Defer non-critical CSS: `<link rel="stylesheet" href="main.css" media="print" onload="this.media='all'">`
- Defer all JavaScript: `<script defer src="app.js">`
- Preload key resources: `<link rel="preload" href="font.woff2" as="font" type="font/woff2" crossorigin>`
- Preconnect to external origins: `<link rel="preconnect" href="https://fonts.googleapis.com">`

### Images
- Use WebP (or AVIF) format with fallbacks
- Responsive images via `srcset` and `sizes` attributes
- Lazy load all below-the-fold images: `loading="lazy"`
- Always set `width` and `height` attributes (prevents CLS)
- Compress: target < 100KB per image for web display
- Use CSS for decorative graphics instead of images when possible

### JavaScript
- Code split by route (dynamic imports)
- Tree-shake unused code (modern bundlers do this automatically)
- Avoid blocking the main thread (use Web Workers for heavy computation)
- Debounce scroll/resize handlers (minimum 16ms / 60fps)
- Use `requestAnimationFrame` for visual updates
- Remove unused dependencies regularly

### CSS
- Minify in production
- Remove unused CSS (PurgeCSS, Tailwind JIT)
- Avoid deeply nested selectors (3 levels max)
- Use CSS containment for complex layouts: `contain: layout style paint`
- Prefer `transform` and `opacity` for animations (GPU-accelerated)

### Fonts
- Self-host when possible (avoid external network requests)
- Use `font-display: swap` to prevent invisible text
- Subset fonts to only needed characters
- Preload the primary font file
- Limit to 2-3 font files maximum

## 3. Backend Performance

### Database
Summary only. Read `query-efficiency` before writing or tuning any query.
- Index all frequently queried columns
- Use EXPLAIN/ANALYZE on slow queries
- Avoid N+1 queries (use eager loading / joins)
- Paginate large result sets (never SELECT * without LIMIT)
- Use connection pooling
- Cache expensive queries (see caching section)
- Use read replicas for read-heavy workloads

### API
- Paginate all list endpoints
- Use field selection (only return needed fields)
- Compress responses (gzip/brotli)
- Set appropriate Cache-Control headers
- Use ETags for conditional requests
- Implement request batching for multiple related calls

### Server
- Enable HTTP/2 or HTTP/3
- Enable gzip/brotli compression for text-based responses
- Set Keep-Alive connections
- Use a reverse proxy (Nginx) in front of application servers
- Configure appropriate worker/thread counts

## 4. Caching Strategy

### Browser Caching
```
# Static assets (images, CSS, JS with hashed filenames)
Cache-Control: public, max-age=31536000, immutable

# HTML pages
Cache-Control: no-cache (or: public, max-age=0, must-revalidate)

# API responses (when appropriate)
Cache-Control: private, max-age=60
```

### Application Caching
- Cache database query results (Redis, Memcached, or in-memory)
- Cache API responses from external services
- Cache computed/aggregated data
- Set TTL (time to live) appropriate to data freshness needs
- Implement cache invalidation when source data changes

### CDN (Content Delivery Network)
- Serve static assets from CDN edge nodes
- Cache HTML at edge for public pages
- Use CDN for image optimization and format conversion
- Geographic distribution reduces latency globally

## 5. Monitoring & Measurement
- Use browser DevTools Lighthouse for lab testing
- Use Real User Monitoring (RUM) for field data
- Monitor Core Web Vitals in production
- Set up alerts for performance regressions
- Profile server-side performance (APM tools)
- Track database query performance

## 6. Mobile Performance
- Test on real mid-range devices (not just high-end)
- Test on 3G/4G network throttling
- Reduce JavaScript for mobile (code split aggressively)
- Use responsive images (smaller sizes for smaller screens)
- Consider offline capabilities (service worker, cache-first strategy)

## Implementation Requirement
Performance must be measured, not guessed. Every page scores 90+ on Lighthouse. Every API responds in under 200ms (p95). Every image is optimized. Every script is deferred. No exceptions.

## Additional Rules (measure the real thing)

From a production project's copy of this standard:

- **Give a measured number.** If you touched a critical path, report a real measurement (ms,
  KB, a Lighthouse or Web Vitals figure), with before and after when you changed it. "Should be
  fast" and "the code looks efficient" are not results.
- **Never do O(all-data) work per request.** No loading every row and then filtering, sorting or
  counting in application code. List endpoints paginate in the database (LIMIT/OFFSET or keyset)
  and return the total from the same query where possible. A `.filter()` or `.map()` over an
  unbounded fetch is a review finding.
- **Push, do not poll.** Live surfaces (boards, presence, status feeds) are driven by an event
  stream or subscription, not by refetching the whole view every second. If polling is
  unavoidable, bound it and say so.
- **Payload discipline.** Select only the fields the view needs. Never ship secrets or unused
  columns to the client.
- **Virtualize long lists.** If a table or list can exceed a few hundred visible rows, virtualize
  it and note the render cost.
- **Test against realistic volume.** Time an endpoint against a realistic row count (seeded
  data or a scratch database), not an empty table.
- **Fakes must not hide cost.** In-memory or mock data layers used in tests should not become
  accidental O(n^2); mirror the real repository's shape.
