// Multi-provider synced lyrics resolver (inspired by InnerTune / OuterTune):
// Supports YouTube Music official timed lyrics, LRCLIB, and KuGou Music,
// with plain-text fallback when no synchronized lyrics are available.

import { ytmAndroidPost, ytmPost } from "./innertube.js";
import { extractBrowseId, parsePlaylistPanelItem, runsText } from "./parsers.js";

const LRCLIB_BASE = "https://lrclib.net/api";
const LRCLIB_USER_AGENT = "ypm-plugin-ytmusic/0.1.2 (https://github.com/NZJ-Jimmy/ypm-plugin-ytmusic)";
const KUGOU_SEARCH_URL = "https://lyrics.kugou.com/search";
const KUGOU_DOWNLOAD_URL = "https://lyrics.kugou.com/download";
const KUGOU_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < BASE64_ALPHABET.length; i++) {
  BASE64_LOOKUP[BASE64_ALPHABET.charCodeAt(i)] = i;
}

// Pure-JS Base64 -> UTF-8 string decoder (QuickJS-ng safe, no Buffer/atob/TextDecoder needed).
export function decodeBase64Utf8(input) {
  const str = String(input || "").replace(/[\r\n\s]+/g, "");
  if (!str) return "";

  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    if (ch === 61 /* '=' */) break;
    if (ch >= 128) continue;
    const val = BASE64_LOOKUP[ch];
    if (val < 0) continue;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  // Decode UTF-8 byte array to JS UTF-16 string.
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if ((b0 & 0xe0) === 0xc0 && i < bytes.length) {
      const b1 = bytes[i++];
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
    } else if ((b0 & 0xf0) === 0xe0 && i + 1 < bytes.length) {
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
    } else if ((b0 & 0xf8) === 0xf0 && i + 2 < bytes.length) {
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      let cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      out += "\ufffd";
    }
  }
  return out;
}

export function cleanTrackTitle(title) {
  return String(title || "")
    .replace(/\[[^\]]*(?:official|mv|music\s*video|lyric|audio|hd|4k|hq|live|remaster|ver\.?|version)[^\]]*\]/gi, " ")
    .replace(/\([^)]*(?:official|mv|music\s*video|lyric|audio|hd|4k|hq|remaster|feat\.?|ft\.?)[^)]*\)/gi, " ")
    .replace(/【[^】]*(?:官方|完整|高音质|高清|mv|歌词|纯享|现场)[^】]*】/gi, " ")
    .replace(/\s+(?:feat\.?|ft\.?)\s+.+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanArtistName(artist) {
  return String(artist || "")
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForCompare(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[\s\-_.,'"`!?()[\]【】（）・•/\\]+/g, "");
}

export function findTimedLyricsData(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 20) return null;
  if (Array.isArray(node.timedLyricsData) && node.timedLyricsData.length) {
    return node.timedLyricsData;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findTimedLyricsData(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const val of Object.values(node)) {
    if (val && typeof val === "object") {
      const found = findTimedLyricsData(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function parseTimedLyrics(timed) {
  if (!Array.isArray(timed) || !timed.length) return [];
  const lines = [];
  for (const entry of timed) {
    const rawStart = entry?.cueRange?.startTimeMilliseconds;
    const start = Number(rawStart);
    if (!Number.isFinite(start) || start < 0) continue;
    const rawEnd = Number(entry?.cueRange?.endTimeMilliseconds);
    const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : undefined;
    const text = String(entry?.lyricLine ?? "").trim();
    lines.push({ start, ...(end !== undefined ? { end } : {}), text });
  }
  lines.sort((a, b) => a.start - b.start);
  return lines;
}

export function parseLrc(lrcText) {
  const cleaned = String(lrcText || "").replace(/^\uFEFF/, "");
  if (!cleaned.trim()) return [];

  let offsetMs = 0;
  const offsetMatch = cleaned.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  if (offsetMatch) {
    const parsed = Number(offsetMatch[1]);
    if (Number.isFinite(parsed)) offsetMs = parsed;
  }

  const timeTagRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const lines = [];

  for (const rawLine of cleaned.split(/\r?\n/)) {
    const timestamps = [];
    timeTagRe.lastIndex = 0;
    let m;
    while ((m = timeTagRe.exec(rawLine)) !== null) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const fracStr = m[3] || "";
      let ms = 0;
      if (fracStr.length === 1) ms = Number(fracStr) * 100;
      else if (fracStr.length === 2) ms = Number(fracStr) * 10;
      else if (fracStr.length >= 3) ms = Number(fracStr.slice(0, 3));
      const start = Math.max(0, min * 60000 + sec * 1000 + ms - offsetMs);
      timestamps.push(start);
    }
    if (!timestamps.length) continue;

    const text = rawLine.replace(timeTagRe, "").trim();
    for (const start of timestamps) {
      lines.push({ start, text });
    }
  }

  lines.sort((a, b) => a.start - b.start);
  // Drop leading/trailing empty spacer lines while keeping internal instrumental breaks.
  while (lines.length && !lines[0].text) lines.shift();
  while (lines.length && !lines[lines.length - 1].text) lines.pop();
  return lines;
}

export function isValidSyncedLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) return false;
  let nonZeroCount = 0;
  for (const l of lines) {
    if (Number.isFinite(l?.start) && l.start > 0 && l.text) nonZeroCount++;
  }
  return nonZeroCount >= 1;
}

export function parsePlainLyrics(text) {
  const rows = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && idx < arr.length - 1));
  if (!rows.length) return [];
  // Keep only the first line at start=0; setting all untimed lines to start=0 causes
  // YesPlayMusic's binary-search lineAt() to jump immediately to the very last line.
  const UNTIMED_FUTURE_MS = 24 * 60 * 60 * 1000;
  return rows.map((line, i) => ({ start: i === 0 ? 0 : UNTIMED_FUTURE_MS, text: line }));
}

function extractTrackMetaFromNext(nextData, videoId) {
  const tabs =
    nextData?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer
      ?.tabs || [];

  let lyricsBrowseId = "";
  for (const tab of tabs) {
    const bid = extractBrowseId(tab?.tabRenderer?.endpoint);
    if (bid && bid.startsWith("MPLYt_")) {
      lyricsBrowseId = bid;
      break;
    }
  }

  const queueContents =
    tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents || [];
  let matched = null;
  for (const entry of queueContents) {
    const tr = parsePlaylistPanelItem(entry);
    if (!tr) continue;
    if (!matched) matched = tr;
    if (tr.id === String(videoId)) {
      matched = tr;
      break;
    }
  }

  const title = matched?.name || "";
  const artists = (matched?.artists || []).map((a) => cleanArtistName(a.name)).filter(Boolean);
  const artist = artists[0] || "";
  const album = matched?.album?.name || "";
  const durationMs = Number(matched?.duration) || 0;

  return {
    lyricsBrowseId,
    meta: { title, artist, artists, album, durationMs },
  };
}

export function pickBestLrcLibCandidate(candidates, meta) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const targetSec = meta.durationMs > 0 ? meta.durationMs / 1000 : 0;
  const normTitle = normalizeForCompare(cleanTrackTitle(meta.title) || meta.title);
  const normArtist = normalizeForCompare(meta.artist);

  let best = null;
  let bestScore = -Infinity;

  for (const item of candidates) {
    if (!item || !item.syncedLyrics) continue;
    let score = 0;

    if (targetSec > 0 && Number.isFinite(item.duration) && item.duration > 0) {
      const diff = Math.abs(item.duration - targetSec);
      if (diff <= 2) score += 60;
      else if (diff <= 5) score += 45;
      else if (diff <= 10) score += 20;
      else if (diff <= 20) score -= 10;
      else continue; // Duration mismatch too large; avoid wrong song/version.
    }

    const candTitle = normalizeForCompare(item.trackName || item.name);
    const candArtist = normalizeForCompare(item.artistName);
    if (normTitle && candTitle) {
      if (candTitle === normTitle) score += 35;
      else if (candTitle.includes(normTitle) || normTitle.includes(candTitle)) score += 18;
    }
    if (normArtist && candArtist) {
      if (candArtist === normArtist) score += 25;
      else if (candArtist.includes(normArtist) || normArtist.includes(candArtist)) score += 12;
    }

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

export function pickBestKuGouCandidate(candidates, meta) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const targetMs = meta.durationMs > 0 ? meta.durationMs : 0;
  const normTitle = normalizeForCompare(cleanTrackTitle(meta.title) || meta.title);
  const normArtist = normalizeForCompare(meta.artist);

  let best = null;
  let bestScore = -Infinity;

  for (const cand of candidates) {
    if (!cand || !cand.id || !cand.accesskey) continue;
    let score = Number(cand.score) || 0;

    if (targetMs > 0 && Number.isFinite(cand.duration) && cand.duration > 0) {
      const diff = Math.abs(cand.duration - targetMs);
      if (diff <= 2000) score += 60;
      else if (diff <= 5000) score += 45;
      else if (diff <= 10000) score += 20;
      else if (diff <= 18000) score -= 15;
      else continue;
    }

    const candSong = normalizeForCompare(cand.song);
    const candSinger = normalizeForCompare(cand.singer);
    if (normTitle && candSong) {
      if (candSong === normTitle) score += 30;
      else if (candSong.includes(normTitle) || normTitle.includes(candSong)) score += 15;
    }
    if (normArtist && candSinger) {
      if (candSinger === normArtist) score += 25;
      else if (candSinger.includes(normArtist) || normArtist.includes(candSinger)) score += 12;
    }

    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

async function httpGetJson(url, headers = {}, timeoutMs = 8000) {
  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchLrcLibLyrics(meta) {
  if (!meta?.title) return { synced: null, plain: "" };
  const headers = { "User-Agent": LRCLIB_USER_AGENT, Accept: "application/json" };
  const cleanTitle = cleanTrackTitle(meta.title) || meta.title;
  const durationSec = meta.durationMs > 0 ? Math.round(meta.durationMs / 1000) : 0;
  let plainFallback = "";

  // 1. Exact lookup via /api/get when artist is known.
  if (meta.artist) {
    const qs = new URLSearchParams({
      track_name: cleanTitle,
      artist_name: meta.artist,
    });
    if (meta.album) qs.set("album_name", meta.album);
    if (durationSec > 0) qs.set("duration", String(durationSec));
    const exact = await httpGetJson(`${LRCLIB_BASE}/get?${qs.toString()}`, headers);
    if (exact?.syncedLyrics) {
      const lines = parseLrc(exact.syncedLyrics);
      if (isValidSyncedLines(lines)) return { synced: lines, plain: exact.plainLyrics || "" };
    }
    if (exact?.plainLyrics && !plainFallback) plainFallback = exact.plainLyrics;
  }

  // 2. Fuzzy search via /api/search.
  const searchQueries = [];
  if (meta.artist) {
    const qs1 = new URLSearchParams({ track_name: cleanTitle, artist_name: meta.artist });
    searchQueries.push(qs1.toString());
  }
  const combined = meta.artist ? `${meta.artist} ${cleanTitle}` : cleanTitle;
  searchQueries.push(new URLSearchParams({ q: combined }).toString());

  for (const qsStr of searchQueries) {
    const list = await httpGetJson(`${LRCLIB_BASE}/search?${qsStr}`, headers);
    if (!Array.isArray(list) || !list.length) continue;

    const best = pickBestLrcLibCandidate(list, meta);
    if (best?.syncedLyrics) {
      const lines = parseLrc(best.syncedLyrics);
      if (isValidSyncedLines(lines)) return { synced: lines, plain: best.plainLyrics || "" };
    }
    if (!plainFallback) {
      const withPlain = list.find((it) => it?.plainLyrics);
      if (withPlain) plainFallback = withPlain.plainLyrics;
    }
  }

  return { synced: null, plain: plainFallback };
}

export async function fetchKuGouLyrics(meta) {
  if (!meta?.title) return null;
  const headers = { "User-Agent": KUGOU_USER_AGENT, Accept: "application/json" };
  const cleanTitle = cleanTrackTitle(meta.title) || meta.title;
  const keywords = meta.artist ? [`${meta.artist} - ${cleanTitle}`, cleanTitle] : [cleanTitle];

  for (const keyword of keywords) {
    const qs = new URLSearchParams({
      ver: "1",
      man: "yes",
      client: "pc",
      keyword,
    });
    if (meta.durationMs > 0) qs.set("duration", String(meta.durationMs));

    const searchData = await httpGetJson(`${KUGOU_SEARCH_URL}?${qs.toString()}`, headers);
    const best = pickBestKuGouCandidate(searchData?.candidates, meta);
    if (!best) continue;

    const dlQs = new URLSearchParams({
      ver: "1",
      client: "pc",
      id: String(best.id),
      accesskey: String(best.accesskey),
      fmt: "lrc",
      charset: "utf8",
    });
    const dlData = await httpGetJson(`${KUGOU_DOWNLOAD_URL}?${dlQs.toString()}`, headers);
    if (!dlData?.content) continue;

    const lrcText = decodeBase64Utf8(dlData.content);
    const lines = parseLrc(lrcText);
    if (isValidSyncedLines(lines)) return lines;
  }

  return null;
}

async function fetchYtmSyncedLyrics(lyricsBrowseId) {
  if (!lyricsBrowseId) return null;
  try {
    const androidData = await ytmAndroidPost("browse", { browseId: lyricsBrowseId });
    const timed = findTimedLyricsData(androidData);
    const syncedLines = parseTimedLyrics(timed);
    if (isValidSyncedLines(syncedLines)) return syncedLines;
  } catch {
    // Ignore and let other providers or WEB_REMIX fallback handle it.
  }
  return null;
}

async function fetchYtmWebLyrics(lyricsBrowseId) {
  if (!lyricsBrowseId) return { synced: null, plain: "" };
  try {
    const lyrData = await ytmPost("browse", { browseId: lyricsBrowseId });
    const webTimed = findTimedLyricsData(lyrData);
    const webSynced = parseTimedLyrics(webTimed);
    if (isValidSyncedLines(webSynced)) return { synced: webSynced, plain: "" };

    const desc =
      lyrData?.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer?.description;
    return { synced: null, plain: runsText(desc).trim() };
  } catch {
    return { synced: null, plain: "" };
  }
}

export function resolveProviderOrder(settingValue) {
  const mode = String(settingValue || "").trim().toLowerCase();
  if (mode === "ytmusic") return ["ytmusic"];
  if (mode === "lrclib") return ["lrclib", "kugou", "ytmusic"];
  if (mode === "kugou") return ["kugou", "lrclib", "ytmusic"];
  // Default "auto": prefer official YouTube Music synced lyrics, then LRCLIB, then KuGou.
  return ["ytmusic", "lrclib", "kugou"];
}

export async function lyrics({ id }) {
  const nextData = await ytmPost("next", { videoId: String(id), isAudioOnly: true });
  const { lyricsBrowseId, meta } = extractTrackMetaFromNext(nextData, id);
  const order = resolveProviderOrder(host.setting("lyricsProvider"));

  let lrcLibPlain = "";

  for (const provider of order) {
    try {
      if (provider === "ytmusic") {
        const ytmSynced = await fetchYtmSyncedLyrics(lyricsBrowseId);
        if (ytmSynced) return { lines: ytmSynced };
      } else if (provider === "lrclib") {
        const res = await fetchLrcLibLyrics(meta);
        if (res.synced) return { lines: res.synced };
        if (res.plain && !lrcLibPlain) lrcLibPlain = res.plain;
      } else if (provider === "kugou") {
        const kgSynced = await fetchKuGouLyrics(meta);
        if (kgSynced) return { lines: kgSynced };
      }
    } catch {
      // One provider failing (network error, permission, timeout) should never block fallback providers.
    }
  }

  // Final fallback: YouTube Music WEB_REMIX (timed if present, otherwise plain text), then LRCLIB plain text.
  const webRes = await fetchYtmWebLyrics(lyricsBrowseId);
  if (webRes.synced) return { lines: webRes.synced };
  if (webRes.plain) return { lines: parsePlainLyrics(webRes.plain) };
  if (lrcLibPlain) return { lines: parsePlainLyrics(lrcLibPlain) };

  return {};
}
