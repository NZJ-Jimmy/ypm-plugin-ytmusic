// YouTube Music InnerTube (WEB_REMIX) HTTP client and pagination continuation store.

import { buildAuthHeaders, fail, getCookie, t } from "./auth.js";

export const YTM_ORIGIN = "https://music.youtube.com";
export const YT_ORIGIN = "https://www.youtube.com";
export const WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

const CLIENT_VERSION = "1.20260201.01.00";
const VISITOR_KEY = "visitorData";
const VISITOR_TTL_MS = 24 * 60 * 60 * 1000;

let memVisitor = null;

// In-memory continuation tokens keyed by "<scope>:<offset>".
const continuations = new Map();
const MAX_CONTINUATIONS = 100;

export function saveContinuation(scope, nextOffset, token) {
  if (!token) return;
  if (continuations.size >= MAX_CONTINUATIONS) {
    const firstKey = continuations.keys().next().value;
    if (firstKey !== undefined) continuations.delete(firstKey);
  }
  continuations.set(`${scope}:${nextOffset}`, token);
}

export function getContinuation(scope, offset) {
  return continuations.get(`${scope}:${offset}`) || null;
}

export function clearContinuations(prefix) {
  for (const key of Array.from(continuations.keys())) {
    if (key.startsWith(prefix)) continuations.delete(key);
  }
}

export function resolveLanguage() {
  const raw = String(host.language?.() || "en").trim();
  const lower = raw.toLowerCase();
  if (lower.startsWith("zh-tw") || lower.startsWith("zh-hk") || lower.startsWith("zh-hant")) {
    return "zh-TW";
  }
  if (lower.startsWith("zh")) return "zh-CN";
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("de")) return "de";
  if (lower.startsWith("fr")) return "fr";
  if (lower.startsWith("es")) return "es";
  if (lower.startsWith("ru")) return "ru";
  return "en";
}

export function resolveRegion(regionOverride) {
  const r = String(regionOverride !== undefined ? regionOverride : host.setting("region") || "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(r) ? r : "US";
}

export function getCachedVisitorData() {
  if (memVisitor && memVisitor.until > Date.now()) return memVisitor.value;
  try {
    const stored = host.storage.get(VISITOR_KEY);
    if (stored && stored.value && stored.until > Date.now()) {
      memVisitor = stored;
      return stored.value;
    }
  } catch {
    // Ignore storage read issues.
  }
  return "";
}

export function setCachedVisitorData(value) {
  if (!value || typeof value !== "string") return;
  memVisitor = { value, until: Date.now() + VISITOR_TTL_MS };
  try {
    host.storage.set(VISITOR_KEY, memVisitor);
  } catch {
    // Ignore storage write issues.
  }
}

export function buildWebRemixContext({ regionOverride } = {}) {
  const client = {
    clientName: "WEB_REMIX",
    clientVersion: CLIENT_VERSION,
    hl: resolveLanguage(),
    gl: resolveRegion(regionOverride),
  };
  const visitorData = getCachedVisitorData();
  if (visitorData) client.visitorData = visitorData;
  return { client };
}

export async function ytmPost(
  endpoint,
  payload = {},
  { cookieOverride, regionOverride, requireAuth = false, timeoutMs = 20000, continuation } = {},
) {
  const cookie = getCookie(cookieOverride);
  if (requireAuth && !cookie) {
    throw fail("signIn", t("Please sign in to YouTube Music first"));
  }

  const qs = new URLSearchParams({ prettyPrint: "false" });
  if (continuation) {
    qs.set("ctoken", continuation);
    qs.set("continuation", continuation);
    qs.set("type", "next");
  }

  const headers = {
    "Content-Type": "application/json",
    Origin: YTM_ORIGIN,
    Referer: `${YTM_ORIGIN}/`,
    "User-Agent": WEB_USER_AGENT,
    "X-YouTube-Client-Name": "67",
    "X-YouTube-Client-Version": CLIENT_VERSION,
  };

  const visitorData = getCachedVisitorData();
  if (visitorData) headers["X-Goog-Visitor-Id"] = visitorData;

  if (cookie) {
    Object.assign(headers, buildAuthHeaders(cookie, YTM_ORIGIN));
  }

  let res;
  try {
    res = await fetch(`${YTM_ORIGIN}/youtubei/v1/${endpoint}?${qs}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        context: buildWebRemixContext({ regionOverride }),
        ...payload,
      }),
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (e) {
    throw new Error(`YouTube Music ${endpoint}: ${e.message || e}`);
  }

  if (res.status === 401 || res.status === 403) {
    if (requireAuth || cookie) {
      throw fail("signIn", t("Invalid or expired YouTube Music Cookie"));
    }
    throw new Error(`YouTube Music ${endpoint}: HTTP ${res.status}`);
  }

  if (!res.ok) {
    throw new Error(`YouTube Music ${endpoint}: HTTP ${res.status}`);
  }

  const data = await res.json();
  const nextVisitor = data?.responseContext?.visitorData;
  if (nextVisitor && nextVisitor !== visitorData) {
    setCachedVisitorData(nextVisitor);
  }
  return data;
}
