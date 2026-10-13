/**
 * IPRoyal reseller API client - the SINGLE place that talks to IPRoyal, used by
 * the proxy auto-buy adapter (proxyPool.acquireNewProxy). Transport-only: no DB,
 * no policy. Auth is the X-Access-Token header (config.iproyalApiToken).
 *
 * ⚠️ Creating an order SPENDS MONEY on the merchant's IPRoyal account. Callers
 * MUST gate this behind config.evolutionProxyAutobuy === 'on' and the max-pool
 * cap. This module just performs the HTTP calls.
 */
import { config } from '../../config/env.js';

const BASE = 'https://apid.iproyal.com/v1/reseller';
const TIMEOUT_MS = 30_000;

export interface IproyalResult<T = unknown> {
  ok: boolean;
  status: number | null;
  body: T | null;
  error?: string;
}

/** Loose shapes we read off IPRoyal JSON responses (all fields optional; the API
 *  is external). IPRoyal sometimes wraps a payload in `{ data }` and sometimes
 *  returns it flat, so `unwrapIproyal` pulls the inner value either way. */
interface IproyalRawProxy { ip?: unknown; username?: unknown; password?: unknown }
interface IproyalRawOrder {
  id?: number | string;
  status?: unknown;
  expire_date?: unknown;
  expires_at?: unknown;
  auto_extend_settings?: { is_enabled?: unknown } | null;
  proxy_data?: { ports?: Record<string, unknown> | null; proxies?: IproyalRawProxy[] } | null;
}
interface IproyalCard { id?: number | string }
function unwrapIproyal<T>(body: { data?: T } | T | null | undefined): T | null {
  if (body == null) return null;
  if (typeof body === 'object' && !Array.isArray(body) && 'data' in body && (body as { data?: T }).data != null) {
    return (body as { data?: T }).data as T;
  }
  return body as T;
}

export function isIproyalConfigured(): boolean {
  return !!config.iproyalApiToken;
}

async function iproyalFetch<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  bodyObj?: unknown,
): Promise<IproyalResult<T>> {
  if (!config.iproyalApiToken) {
    return { ok: false, status: null, body: null, error: 'IPROYAL_API_TOKEN not set' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'X-Access-Token': config.iproyalApiToken,
        Accept: 'application/json',
        ...(bodyObj != null ? { 'Content-Type': 'application/json' } : {}),
      },
      body: bodyObj != null ? JSON.stringify(bodyObj) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    let body: T | null = null;
    try { body = (await resp.json()) as T; } catch { body = null; }
    if (!resp.ok) {
      const msg = (body && typeof body === 'object' && 'error' in (body as Record<string, unknown>))
        ? JSON.stringify((body as Record<string, unknown>).error)
        : `IPRoyal ${resp.status}`;
      return { ok: false, status: resp.status, body, error: msg };
    }
    return { ok: true, status: resp.status, body };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: null, body: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resolve which payment source a buy uses, from config.iproyalCardId:
 *   '' -> null (pay from BALANCE, the safe default).
 *   numeric id -> that saved card id (charge it directly, no balance needed).
 *   'auto' -> the first card on file (GET /cards), cached for the process.
 */
let cachedAutoCardId: number | null | undefined; // undefined = not yet resolved
export async function resolveIproyalCardId(): Promise<number | null> {
  const cfg = (config.iproyalCardId || '').trim();
  if (!cfg) return null;
  if (/^\d+$/.test(cfg)) return Number(cfg);
  if (cfg.toLowerCase() === 'auto') {
    if (cachedAutoCardId !== undefined) return cachedAutoCardId;
    const res = await iproyalFetch<{ data?: IproyalCard[] } | IproyalCard[]>('GET', '/cards');
    const cards = res.ok ? unwrapIproyal<IproyalCard[]>(res.body) : null;
    cachedAutoCardId = Array.isArray(cards) && cards[0]?.id != null ? Number(cards[0].id) : null;
    return cachedAutoCardId;
  }
  return null;
}

/**
 * Place a new ISP Dedicated order. Returns the created order id (IPRoyal charges
 * the account here - the balance, or the saved card when IPROYAL_CARD_ID is set).
 * The proxies may not be attached instantly - poll getOrderProxies until
 * status='confirmed' with proxy_data.
 */
export async function iproyalCreateOrder(args: {
  productId: number;
  planId: number;
  locationId: number;
  quantity: number;
}): Promise<IproyalResult<{ orderId: number | null; raw: unknown }>> {
  const cardId = await resolveIproyalCardId();
  const orderBody: Record<string, unknown> = {
    product_id: args.productId,
    product_plan_id: args.planId,
    product_location_id: args.locationId,
    quantity: args.quantity,
  };
  // When set, charge the saved card directly so the order never depends on (or
  // fails for) an empty account balance.
  if (cardId != null) orderBody.card_id = cardId;
  // NOTE: Premium / zero-fraud-score is NOT settable on the reseller order API for
  // ISP Dedicated. IPRoyal support confirmed (2026-09-03): the dashboard's
  // proxy_risk_type/proxy_score_type must NOT be sent here, and product 9 exposes
  // no fraud-score product_question. So auto-bought IPs are STANDARD fraud score.
  // For Premium IPs, buy them in the dashboard and import via
  // scripts/iproyal_import.py (reuse-first means those get used before any auto-buy).
  const res = await iproyalFetch<{ data?: IproyalRawOrder | IproyalRawOrder[] } | IproyalRawOrder | IproyalRawOrder[]>('POST', '/orders', orderBody);
  if (!res.ok) return res as IproyalResult<{ orderId: number | null; raw: unknown }>;
  const raw = res.body;
  // The create response may nest the order under data, or return it flat.
  const order = unwrapIproyal<IproyalRawOrder | IproyalRawOrder[]>(raw);
  const single = order && !Array.isArray(order) ? order : null;
  const first = Array.isArray(order) ? order[0] : null;
  const orderId = typeof single?.id === 'number' ? single.id : (typeof first?.id === 'number' ? first.id : null);
  return { ok: true, status: res.status, body: { orderId, raw } };
}

/**
 * Turn auto-extend (auto-renew) ON or OFF for an existing order. IPRoyal then
 * auto-renews the lease before it expires (a 30-day order extends by 30 days),
 * so the IP - and the merchant's WhatsApp pairing on it - survives past 30 days
 * without a rebuy + re-pair. Toggling does NOT charge; the charge is the renewal
 * itself, which only fires while enabled. When enabling, pays from the same source
 * as buys (saved card if IPROYAL_CARD_ID is set, else balance).
 */
export async function iproyalToggleAutoExtend(args: {
  orderId: string | number;
  planId: number;
  enabled: boolean;
}): Promise<IproyalResult> {
  const body: Record<string, unknown> = {
    order_id: Number(args.orderId),
    product_plan_id: args.planId,
    is_enabled: args.enabled,
  };
  if (args.enabled) {
    // payment_type is required only when enabling.
    const cardId = await resolveIproyalCardId();
    if (cardId != null) {
      body.payment_type = 'card';
      body.card_id = cardId;
    } else {
      body.payment_type = 'balance';
    }
  }
  return iproyalFetch('POST', '/orders/toggle-auto-extend', body);
}

export interface IproyalProxy {
  ip: string;
  username: string;
  password: string;
}

/**
 * Fetch an order's proxies (host/port/user/pass). Returns the connection parts
 * once the order is provisioned. `pending: true` means the order exists but the
 * proxies aren't attached yet - the caller should poll again.
 */
export async function iproyalGetOrderProxies(
  orderId: number,
  productId: number,
): Promise<IproyalResult<{ pending: boolean; httpPort: number | null; proxies: IproyalProxy[] }>> {
  const res = await iproyalFetch<{ data?: IproyalRawOrder } | IproyalRawOrder>('GET', `/orders/${orderId}?product_id=${productId}`);
  if (!res.ok) return res as IproyalResult<{ pending: boolean; httpPort: number | null; proxies: IproyalProxy[] }>;
  const order = unwrapIproyal<IproyalRawOrder>(res.body);
  const pdata: { ports?: Record<string, unknown> | null; proxies?: IproyalRawProxy[] } = order?.proxy_data ?? {};
  const ports: Record<string, unknown> = pdata.ports ?? {};
  const httpPort: number | null =
    typeof ports['http|https'] === 'number' ? ports['http|https'] :
    typeof ports.http === 'number' ? ports.http :
    typeof ports.https === 'number' ? ports.https : null;
  const proxies: IproyalProxy[] = Array.isArray(pdata.proxies)
    ? pdata.proxies
        .filter((p: IproyalRawProxy) => p && p.ip && p.username && p.password)
        .map((p: IproyalRawProxy) => ({ ip: String(p.ip), username: String(p.username), password: String(p.password) }))
    : [];
  const confirmed = order?.status === 'confirmed';
  return {
    ok: true,
    status: res.status,
    body: { pending: !confirmed || proxies.length === 0 || httpPort == null, httpPort, proxies },
  };
}

/** Shared expiry verdict: proven-lapsed only (past expire_date, or a terminal
 *  status). Ambiguous/unreadable is NOT expired (safe side - never spend on doubt). */
function computeOrderExpired(status: string | null, expireDate: string | null): boolean {
  let expired = false;
  if (expireDate) {
    const t = Date.parse(expireDate.replace(' ', 'T'));
    if (!Number.isNaN(t) && t < Date.now()) expired = true;
  }
  if (status && ['expired', 'cancelled', 'canceled', 'refunded', 'terminated'].includes(status.toLowerCase())) {
    expired = true;
  }
  return expired;
}

/**
 * Read ONE order's lifecycle status. Used at claim time (before the IPQS fraud
 * check, since IPQS has a monthly quota and IPRoyal's status endpoint does not) and
 * as the auto-heal cron's fallback for an order missing from the bulk list.
 * Decides: OUR problem (lease expired -> renew/replace) vs IPRoyal's (still active
 * -> they owe us the IP; wait, never buy a dup).
 */
export async function iproyalGetOrderStatus(
  orderId: number | string,
  productId: number,
): Promise<IproyalResult<{ status: string | null; expireDate: string | null; expired: boolean }>> {
  const res = await iproyalFetch<{ data?: IproyalRawOrder } | IproyalRawOrder>('GET', `/orders/${orderId}?product_id=${productId}`);
  if (!res.ok) return res as IproyalResult<{ status: string | null; expireDate: string | null; expired: boolean }>;
  const order = unwrapIproyal<IproyalRawOrder>(res.body);
  const status: string | null = typeof order?.status === 'string' ? order.status : null;
  const expireDate: string | null =
    typeof order?.expire_date === 'string' ? order.expire_date :
    typeof order?.expires_at === 'string' ? order.expires_at : null;
  return { ok: true, status: res.status, body: { status, expireDate, expired: computeOrderExpired(status, expireDate) } };
}

export interface IproyalOrderSummary {
  orderId: string;
  status: string | null;
  expireDate: string | null;
  expired: boolean;
  /** auto_extend_settings.is_enabled from the list (null if absent). */
  autoExtendEnabled: boolean | null;
  /** proxy_data.ports['http|https'] (or http/https fallback). */
  httpPort: number | null;
  /** proxy_data.proxies with credentials - the list already includes these, so
   *  orphan-import + revive need NO per-order API call. */
  proxies: IproyalProxy[];
}

/**
 * List ALL of our orders for a product in ONE (paginated) sweep. The list is rich:
 * each order carries status, expire_date, auto_extend_settings, AND full proxy_data
 * (ip/user/pass/ports) - so the auto-heal cron can check lease status, auto-renew
 * state, and rebuild proxy URLs for every order without a single per-proxy API call.
 * Pages until a short page (last), capped for safety.
 */
/** Parse one raw IPRoyal order into our summary. Shared by the bulk list and the
 *  single-order read so the two can never disagree about status / expiry / renewal. */
function summarizeIproyalOrder(o: IproyalRawOrder | null | undefined): IproyalOrderSummary | null {
  const orderId = o?.id != null ? String(o.id) : null;
  if (!orderId) return null;
  const status: string | null = typeof o?.status === 'string' ? o.status : null;
  const expireDate: string | null =
    typeof o?.expire_date === 'string' ? o.expire_date :
    typeof o?.expires_at === 'string' ? o.expires_at : null;
  const ae = o?.auto_extend_settings;
  const autoExtendEnabled: boolean | null =
    ae && typeof ae === 'object' && typeof ae.is_enabled === 'boolean' ? ae.is_enabled : null;
  const pdata: { ports?: Record<string, unknown> | null; proxies?: IproyalRawProxy[] } = o?.proxy_data ?? {};
  const ports: Record<string, unknown> = pdata.ports ?? {};
  const httpPort: number | null =
    typeof ports['http|https'] === 'number' ? ports['http|https'] :
    typeof ports.http === 'number' ? ports.http :
    typeof ports.https === 'number' ? ports.https : null;
  const proxies: IproyalProxy[] = Array.isArray(pdata.proxies)
    ? pdata.proxies
        .filter((p: IproyalRawProxy) => p && p.ip && p.username && p.password)
        .map((p: IproyalRawProxy) => ({ ip: String(p.ip), username: String(p.username), password: String(p.password) }))
    : [];
  return { orderId, status, expireDate, expired: computeOrderExpired(status, expireDate), autoExtendEnabled, httpPort, proxies };
}

export async function iproyalListOrders(productId: number): Promise<IproyalResult<IproyalOrderSummary[]>> {
  const all: IproyalOrderSummary[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await iproyalFetch<{ data?: IproyalRawOrder[] } | IproyalRawOrder[]>('GET', `/orders?product_id=${productId}&page=${page}&per_page=50`);
    if (!res.ok) return res as IproyalResult<IproyalOrderSummary[]>;
    const listRaw = unwrapIproyal<IproyalRawOrder[]>(res.body);
    const list: IproyalRawOrder[] = Array.isArray(listRaw) ? listRaw : [];
    for (const o of list) {
      const summary = summarizeIproyalOrder(o);
      if (summary) all.push(summary);
    }
    if (list.length < 50) break; // last page
  }
  return { ok: true, status: 200, body: all };
}

/**
 * Read ONE order's live summary (status, expiry, auto-renew on/off). Used right after
 * we switch an order's auto-renew, to record what IPRoyal ACTUALLY has instead of what
 * we asked for (the switch can fail, and auto-renew is per ORDER, so it covers every IP
 * in a multi-IP package).
 */
export async function iproyalGetOrderSummary(
  orderId: number | string,
  productId: number,
): Promise<IproyalResult<IproyalOrderSummary>> {
  const res = await iproyalFetch<{ data?: IproyalRawOrder } | IproyalRawOrder>('GET', `/orders/${orderId}?product_id=${productId}`);
  if (!res.ok) return res as IproyalResult<IproyalOrderSummary>;
  const summary = summarizeIproyalOrder(unwrapIproyal<IproyalRawOrder>(res.body));
  if (!summary) return { ok: false, status: res.status, body: null, error: `order ${orderId}: unreadable response` };
  return { ok: true, status: res.status, body: summary };
}

/**
 * Manually extend (renew) an order - used by auto-heal to recover an expired lease
 * WITHOUT buying a new IP (keeps the same IP + its WhatsApp pairing). Pass
 * `proxies` to extend only specific IPs in a multi-IP order; empty/omitted extends
 * all. Pays from the saved card (IPROYAL_CARD_ID) when set, else balance. SPENDS
 * MONEY (the renewal price), but far cheaper than a fresh buy + re-pair.
 */
export async function iproyalExtendOrder(args: {
  orderId: number | string;
  planId: number;
  proxies?: string[];
}): Promise<IproyalResult> {
  const cardId = await resolveIproyalCardId();
  const body: Record<string, unknown> = {
    product_plan_id: args.planId,
    proxies: args.proxies ?? [],
  };
  if (cardId != null) body.card_id = cardId;
  return iproyalFetch('POST', `/orders/${args.orderId}/extend`, body);
}
