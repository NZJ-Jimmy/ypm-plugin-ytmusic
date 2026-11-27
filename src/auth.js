// Authentication, account state, SAPISIDHASH signing, profile, and connection test.

import { sha1Hex } from "./sha1.js";
import { ytmPost, YTM_ORIGIN } from "./innertube.js";
import { bestThumbnail, runsText } from "./parsers.js";

const COOKIE_KEY = "auth.cookie";
const ACCOUNT_KEY = "auth.account";
const ACCOUNT_TTL_MS = 10 * 60 * 1000;
export const MACOS_SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15";
export const GOOGLE_YTM_SIGNIN_URL =
  "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F";

export function t(text) {
  return typeof host !== "undefined" && host?.t ? host.t(text) : text;
}

export function fail(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

export function getCookie(cookieOverride) {
  if (cookieOverride !== undefined) return String(cookieOverride || "").trim();
  const fromSetting = String(host.setting("cookie") || "").trim();
  if (fromSetting) return fromSetting;
  const fromStorage = host.storage.get(COOKIE_KEY);
  return typeof fromStorage === "string" ? fromStorage.trim() : "";
}

export function parseCookieMap(cookieStr) {
  const map = {};
  for (const part of String(cookieStr || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) map[key] = val;
  }
  return map;
}

export function buildAuthHeaders(cookieStr, origin = YTM_ORIGIN, nowSec = Math.floor(Date.now() / 1000)) {
  const map = parseCookieMap(cookieStr);
  const sapisid = map["SAPISID"] || map["__Secure-3PAPISID"] || map["__Secure-1PAPISID"] || "";
  const headers = {
    Cookie: cookieStr,
    "X-Origin": origin,
    "X-Goog-AuthUser": "0",
  };
  if (sapisid) {
    const hash = sha1Hex(`${nowSec} ${sapisid} ${origin}`);
    headers.Authorization = `SAPISIDHASH ${nowSec}_${hash}`;
  }
  return headers;
}

export function toNetscapeCookies(cookieStr) {
  const map = parseCookieMap(cookieStr);
  const entries = Object.entries(map);
  if (!entries.length) return "";
  const lines = ["# Netscape HTTP Cookie File"];
  const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  for (const [name, value] of entries) {
    if (!name || value.includes("\n") || value.includes("\r")) continue;
    lines.push(`.youtube.com\tTRUE\t/\tTRUE\t${expiry}\t${name}\t${value}`);
  }
  return lines.join("\n") + "\n";
}

function extractAccountFromMenu(data) {
  const header =
    data?.actions?.[0]?.openPopupAction?.popup?.multiPageMenuRenderer?.header?.activeAccountHeaderRenderer;
  if (!header) return null;
  const name = runsText(header.accountName) || runsText(header.channelHandle) || t("YouTube Music User");
  const handle = runsText(header.channelHandle) || runsText(header.email) || name;
  const imageUrl = bestThumbnail(header.accountPhoto?.thumbnails, 256);
  return {
    id: handle || "ytmusic-user",
    name,
    imageUrl,
  };
}

export async function fetchAccountInfo(cookieOverride) {
  const cookie = getCookie(cookieOverride);
  if (!cookie) return null;
  const data = await ytmPost("account/account_menu", {}, { cookieOverride: cookie, requireAuth: true });
  return extractAccountFromMenu(data);
}

export async function account() {
  const cookie = getCookie();
  if (!cookie) return null;

  const cached = host.storage.get(ACCOUNT_KEY);
  if (cached && cached.cookie === cookie && cached.until > Date.now() && cached.account) {
    return cached.account;
  }

  try {
    const info = await fetchAccountInfo(cookie);
    if (!info) return null;
    host.storage.set(ACCOUNT_KEY, {
      cookie,
      account: info,
      until: Date.now() + ACCOUNT_TTL_MS,
    });
    return info;
  } catch {
    return null;
  }
}

export async function signIn() {
  // 1. If user already pasted Cookie in plugin settings, verify it directly.
  const settingCookie = String(host.setting("cookie") || "").trim();
  if (settingCookie) {
    const info = await fetchAccountInfo(settingCookie);
    if (!info) throw fail("signIn", t("Invalid or expired YouTube Music Cookie"));
    host.storage.set(COOKIE_KEY, settingCookie);
    host.storage.set(ACCOUNT_KEY, {
      cookie: settingCookie,
      account: info,
      until: Date.now() + ACCOUNT_TTL_MS,
    });
    return info;
  }

  // 2. On macOS, YesPlayMusic supports embedded webSignIn.
  if (host.platform === "darwin" && typeof host.webSignIn === "function") {
    const res = await host.webSignIn({
      url: GOOGLE_YTM_SIGNIN_URL,
      cookiesOf: `${YTM_ORIGIN}/`,
      until: ["SAPISID", "SID"],
      userAgent: MACOS_SAFARI_UA,
    });
    const cookie = String(res?.cookie || "").trim();
    if (!cookie) throw fail("signIn", t("Invalid or expired YouTube Music Cookie"));
    const info = await fetchAccountInfo(cookie);
    if (!info) throw fail("signIn", t("Invalid or expired YouTube Music Cookie"));
    host.storage.set(COOKIE_KEY, cookie);
    host.storage.set(ACCOUNT_KEY, {
      cookie,
      account: info,
      until: Date.now() + ACCOUNT_TTL_MS,
    });
    return info;
  }

  // 3. On Windows / Linux, guide user to paste Cookie in plugin settings.
  throw fail(
    "setup",
    t(
      "Paste your music.youtube.com Cookie in plugin settings to sign in on this platform (browsing and searching also work without signing in).",
    ),
  );
}

export async function signOut() {
  host.storage.remove(COOKIE_KEY);
  host.storage.remove(ACCOUNT_KEY);
  try {
    host.files?.remove?.("cookies.txt");
  } catch {
    // Ignore on 3.0.0 where host.files is unavailable.
  }
}

export async function testConnection({ settings = {} } = {}) {
  const parts = [];
  // 1. Verify InnerTube WEB_REMIX API reachability.
  await ytmPost(
    "music/get_search_suggestions",
    { input: "music" },
    { cookieOverride: settings.cookie || "", regionOverride: settings.region || "" },
  );
  parts.push(t("YouTube Music API is reachable"));

  // 2. Verify optional cookie auth.
  const cookie = String(settings.cookie || getCookie() || "").trim();
  if (cookie) {
    const info = await fetchAccountInfo(cookie);
    if (!info) throw fail("signIn", t("Invalid or expired YouTube Music Cookie"));
    parts.push(`${t("Signed in as")}: ${info.name}`);
  } else {
    parts.push(t("Guest mode (not signed in)"));
  }

  // 3. Check yt-dlp availability if allowed.
  try {
    const proc = host.spawn("yt-dlp", ["--version"]);
    const ver = (await proc.readLine()) || "";
    const code = await proc.wait();
    if (code === 0 && ver.trim()) {
      parts.push(`${t("yt-dlp available")} (${ver.trim()})`);
    } else {
      parts.push(t("yt-dlp unavailable or not permitted"));
    }
  } catch {
    parts.push(t("yt-dlp unavailable or not permitted"));
  }

  return parts.join(" · ");
}
