// Audio stream resolver: yt-dlp primary via host.spawn + verified InnerTube direct fallback.

import { buildAuthHeaders, fail, getCookie, t, toNetscapeCookies } from "./auth.js";
import { getCachedVisitorData, WEB_USER_AGENT, YT_ORIGIN, YTM_ORIGIN } from "./innertube.js";

const STREAM_CACHE_MAX = 20;
const streamCache = new Map();

function getCachedStream(cacheKey) {
  const hit = streamCache.get(cacheKey);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    streamCache.delete(cacheKey);
    return null;
  }
  return hit.value;
}

function setCachedStream(cacheKey, value, ttlMs = 30 * 60 * 1000) {
  if (streamCache.size >= STREAM_CACHE_MAX) {
    const oldest = streamCache.keys().next().value;
    if (oldest !== undefined) streamCache.delete(oldest);
  }
  let expiresAt = Date.now() + ttlMs;
  try {
    const u = new URL(value.url);
    const exp = Number(u.searchParams.get("expire") || 0);
    if (exp > 0) {
      // Refresh 10 minutes before YouTube URL expiry.
      expiresAt = Math.min(expiresAt, exp * 1000 - 10 * 60 * 1000);
    }
  } catch {
    // Ignore malformed URLs.
  }
  if (expiresAt > Date.now() + 30 * 1000) {
    streamCache.set(cacheKey, { value, expiresAt });
  }
}

export function mapAudioType(ext, codec = "") {
  const e = String(ext || "").toLowerCase();
  const c = String(codec || "").toLowerCase();
  if (e === "m4a" || e === "mp4" || c.includes("mp4a")) return "m4a";
  if (e === "webm" || e === "opus" || c.includes("opus")) return "webm";
  if (e === "mp3") return "mp3";
  if (e === "ogg") return "ogg";
  return e || "m4a";
}

export function formatSelectorForQuality(quality) {
  if (quality === "standard") {
    return "bestaudio[abr<=135][ext=m4a]/bestaudio[abr<=135]/bestaudio";
  }
  return "bestaudio[ext=webm][acodec=opus]/bestaudio[ext=m4a]/bestaudio";
}

function writeCookieFileIfAvailable() {
  const cookie = getCookie();
  if (!cookie || !host.files?.write || !host.dataDir) return "";
  try {
    const netscape = toNetscapeCookies(cookie);
    if (!netscape) return "";
    host.files.write("cookies.txt", netscape);
    const sep = host.platform === "windows" ? "\\" : "/";
    return `${host.dataDir}${sep}files${sep}cookies.txt`;
  } catch {
    return "";
  }
}

export async function resolveViaYtDlp(id, quality) {
  const args = [
    "--no-playlist",
    "--no-warnings",
    "-J",
    "-f",
    formatSelectorForQuality(quality),
  ];

  const browser = String(host.setting("cookiesFromBrowser") || "").trim();
  if (browser) {
    args.push("--cookies-from-browser", browser);
  } else {
    const cookiePath = writeCookieFileIfAvailable();
    if (cookiePath) args.push("--cookies", cookiePath);
  }

  args.push(`${YTM_ORIGIN}/watch?v=${id}`);

  let proc;
  try {
    proc = host.spawn("yt-dlp", args);
  } catch (e) {
    const err = new Error(e?.message || String(e));
    err.ytdlpBlocked = true;
    throw err;
  }

  const lines = [];
  let line;
  while ((line = await proc.readLine()) !== null) {
    lines.push(line);
  }
  const code = await proc.wait();
  const stderr = proc.errorOutput?.() || "";

  if (code !== 0) {
    if (/unavailable|private video|removed|copyright|members-only/i.test(stderr)) {
      throw fail("unavailable", t("This track is unavailable on YouTube Music"));
    }
    throw new Error(`yt-dlp exited with ${code}: ${stderr.trim().slice(0, 240)}`);
  }

  const raw = lines.join("\n").trim();
  if (!raw) throw new Error("yt-dlp returned empty output");

  const info = JSON.parse(raw);
  const chosen =
    (Array.isArray(info.requested_formats) &&
      info.requested_formats.find((f) => f.vcodec === "none" && f.url)) ||
    (info.url ? info : null) ||
    (Array.isArray(info.formats) &&
      info.formats
        .filter((f) => f.vcodec === "none" && f.acodec && f.acodec !== "none" && f.url)
        .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0]);

  if (!chosen?.url) {
    throw fail("unavailable", t("This track is unavailable on YouTube Music"));
  }

  const result = {
    url: chosen.url,
    type: mapAudioType(chosen.ext, chosen.acodec),
    quality,
    bitRate: chosen.abr ? Math.round(Number(chosen.abr) * 1000) : undefined,
    size: Number(chosen.filesize || chosen.filesize_approx || 0) || undefined,
    headers: chosen.http_headers || undefined,
  };
  return result;
}

const INNERTUBE_PLAYER_CLIENTS = [
  {
    name: "ANDROID_VR",
    endpoint: `${YT_ORIGIN}/youtubei/v1/player?prettyPrint=false`,
    client: {
      clientName: "ANDROID_VR",
      clientVersion: "1.61.48",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      osName: "Android",
      osVersion: "12L",
      androidSdkVersion: 32,
      hl: "en",
      gl: "US",
    },
    ua: "com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  },
  {
    name: "IOS",
    endpoint: `${YT_ORIGIN}/youtubei/v1/player?prettyPrint=false`,
    client: {
      clientName: "IOS",
      clientVersion: "20.10.4",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "18.3.2.22D82",
      hl: "en",
      gl: "US",
    },
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  },
  {
    name: "WEB_REMIX",
    endpoint: `${YTM_ORIGIN}/youtubei/v1/player?prettyPrint=false`,
    client: {
      clientName: "WEB_REMIX",
      clientVersion: "1.20260201.01.00",
      hl: "en",
      gl: "US",
    },
    ua: WEB_USER_AGENT,
  },
];

export function pickAudioFormat(adaptiveFormats, quality) {
  const audios = (adaptiveFormats || []).filter(
    (f) => f && f.url && typeof f.mimeType === "string" && f.mimeType.startsWith("audio/"),
  );
  if (!audios.length) return null;

  audios.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  if (quality === "standard") {
    const mid = audios.find((f) => (f.bitrate || 0) <= 145000);
    if (mid) return mid;
  }
  return audios[0];
}

async function verifyStreamReachable(url, headers, contentLength) {
  const cl = Number(contentLength || 0);
  const range = cl > 2048 ? `bytes=${cl - 1024}-${cl - 1}` : "bytes=0-1023";
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { ...headers, Range: range },
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
    });
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  }
}

export async function resolveViaInnerTube(id, quality) {
  const visitorData = getCachedVisitorData();
  const cookie = getCookie();
  let sawUnavailable = false;

  for (const profile of INNERTUBE_PLAYER_CLIENTS) {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": profile.ua,
    };
    if (visitorData) headers["X-Goog-Visitor-Id"] = visitorData;
    if (cookie && profile.name === "WEB_REMIX") {
      Object.assign(headers, buildAuthHeaders(cookie, YTM_ORIGIN));
    }

    let data;
    try {
      const res = await fetch(profile.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          context: {
            client: { ...profile.client, ...(visitorData ? { visitorData } : {}) },
          },
          videoId: String(id),
          contentCheckOk: true,
          racyCheckOk: true,
        }),
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
      });
      if (!res.ok) continue;
      data = await res.json();
    } catch {
      continue;
    }

    const status = data?.playabilityStatus?.status;
    if (status === "UNPLAYABLE" || status === "ERROR") {
      const reason = String(data?.playabilityStatus?.reason || "");
      if (/unavailable|private|removed|region|country/i.test(reason)) {
        sawUnavailable = true;
      }
      continue;
    }
    if (status !== "OK") continue;

    const chosen = pickAudioFormat(data?.streamingData?.adaptiveFormats, quality);
    if (!chosen) continue;

    const streamHeaders = { "User-Agent": profile.ua };
    const ok = await verifyStreamReachable(chosen.url, streamHeaders, chosen.contentLength);
    if (!ok) continue;

    const loudnessDb = Number(data?.playerConfig?.audioConfig?.loudnessDb);
    const gain = Number.isFinite(loudnessDb) ? Math.max(-18, Math.min(6, -loudnessDb)) : undefined;

    return {
      url: chosen.url,
      type: mapAudioType("", chosen.mimeType),
      quality,
      bitRate: Number(chosen.bitrate || 0) || undefined,
      size: Number(chosen.contentLength || 0) || undefined,
      headers: streamHeaders,
      gain,
    };
  }

  if (sawUnavailable) {
    throw fail("unavailable", t("This track is unavailable on YouTube Music"));
  }
  return null;
}

export async function stream({ id, quality = "high" } = {}) {
  const videoId = String(id || "").trim();
  if (!videoId) throw fail("unavailable", t("This track is unavailable on YouTube Music"));

  const mode = String(host.setting("streamMode") || "").trim();
  const cacheKey = `${mode}:${quality}:${videoId}`;
  const cached = getCachedStream(cacheKey);
  if (cached) return cached;

  let ytdlpErr = null;

  if (mode !== "innertube") {
    try {
      const res = await resolveViaYtDlp(videoId, quality);
      setCachedStream(cacheKey, res);
      return res;
    } catch (e) {
      if (e?.code === "unavailable") throw e;
      ytdlpErr = e;
      if (mode === "ytdlp") {
        throw fail(
          "setup",
          `${t("Unable to resolve playable audio stream. Install yt-dlp and enable 'Allow running local programs' in YesPlayMusic plugin settings.")} (${e.message || e})`,
        );
      }
    }
  }

  const direct = await resolveViaInnerTube(videoId, quality);
  if (direct) {
    setCachedStream(cacheKey, direct);
    return direct;
  }

  const detail = ytdlpErr ? ` (${ytdlpErr.message || ytdlpErr})` : "";
  throw fail(
    "setup",
    `${t("Unable to resolve playable audio stream. Install yt-dlp and enable 'Allow running local programs' in YesPlayMusic plugin settings.")}${detail}`,
  );
}
