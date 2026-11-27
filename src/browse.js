// Discovery, search, suggestions, album/artist/playlist details, lyrics, similar & radio stations.

import { t } from "./auth.js";
import {
  clearContinuations,
  getContinuation,
  saveContinuation,
  ytmPost,
} from "./innertube.js";
import {
  bestThumbnail,
  decodeBrowsePage,
  extractArtistsAndAlbumFromRuns,
  extractBrowseId,
  extractContinuation,
  mapAlbumKind,
  parseAlbumFromResponsiveItem,
  parseArtistFromResponsiveItem,
  parsePlaylistFromResponsiveItem,
  parsePlaylistPanelItem,
  parseShelfToSection,
  parseTrackFromResponsiveItem,
  parseTwoRowItem,
  parseYear,
  runsText,
} from "./parsers.js";

const SEARCH_PARAMS = {
  tracks: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D",
  videos: "EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D",
  albums: "EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D",
  artists: "EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D",
  playlists: "EgeKAQQoAEABagoQAxAEEAoQCRAF",
};

let hotCache = null;

function extractSearchShelf(data) {
  // Initial response
  const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs || [];
  for (const tab of tabs) {
    const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    for (const sec of sections) {
      if (sec?.musicShelfRenderer) return sec.musicShelfRenderer;
    }
  }
  // Continuation response
  if (data?.continuationContents?.musicShelfContinuation) {
    return data.continuationContents.musicShelfContinuation;
  }
  return null;
}

function parseSearchItems(shelf, kind) {
  const out = [];
  for (const entry of shelf?.contents || []) {
    const item = entry?.musicResponsiveListItemRenderer;
    if (!item) continue;
    let parsed = null;
    if (kind === "tracks" || kind === "videos") parsed = parseTrackFromResponsiveItem(item);
    else if (kind === "albums") parsed = parseAlbumFromResponsiveItem(item);
    else if (kind === "artists") parsed = parseArtistFromResponsiveItem(item);
    else if (kind === "playlists") parsed = parsePlaylistFromResponsiveItem(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

export async function search({ query = "", kind = "tracks", offset = 0 } = {}) {
  const q = String(query || "").trim();
  if (!q) return { [kind]: [], more: false };

  const params = SEARCH_PARAMS[kind];
  if (!params) return { [kind]: [], more: false };

  const scope = `search:${kind}:${q}`;
  let data;

  if (offset > 0) {
    const token = getContinuation(scope, offset);
    if (!token) return { [kind]: [], more: false };
    data = await ytmPost("search", {}, { continuation: token });
  } else {
    clearContinuations(`${scope}:`);
    data = await ytmPost("search", { query: q, params });
  }

  const shelf = extractSearchShelf(data);
  const items = parseSearchItems(shelf, kind);
  const nextToken = extractContinuation(shelf);

  // Optional: supplement official song results with music videos when enabled and sparse.
  if (
    kind === "tracks" &&
    offset === 0 &&
    items.length < 5 &&
    host.setting("includeVideos") === "true"
  ) {
    try {
      const vData = await ytmPost("search", { query: q, params: SEARCH_PARAMS.videos });
      const vShelf = extractSearchShelf(vData);
      const seen = new Set(items.map((x) => x.id));
      for (const v of parseSearchItems(vShelf, "videos")) {
        if (!seen.has(v.id)) {
          seen.add(v.id);
          items.push(v);
        }
      }
    } catch {
      // Non-fatal fallback.
    }
  }

  const nextOffset = offset + items.length;
  if (nextToken) saveContinuation(scope, nextOffset, nextToken);

  return {
    [kind]: items,
    more: Boolean(nextToken),
  };
}

export async function suggest({ query = "" } = {}) {
  const input = String(query || "").trim();
  if (!input) return [];

  const data = await ytmPost("music/get_search_suggestions", { input });
  const contents = data?.contents?.[0]?.searchSuggestionsSectionRenderer?.contents || [];
  const seen = new Set();
  const out = [];

  for (const entry of contents) {
    const text = runsText(entry?.searchSuggestionRenderer?.suggestion).trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

export async function hotSearches() {
  if (hotCache && hotCache.until > Date.now()) return hotCache.value;
  try {
    const data = await ytmPost("browse", { browseId: "FEmusic_charts" });
    const rawSections =
      data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
        ?.contents || [];
    const seen = new Set();
    const out = [];

    for (const raw of rawSections) {
      const sec = parseShelfToSection(raw);
      if (!sec) continue;
      for (const tr of sec.tracks || []) {
        if (tr.name && !seen.has(tr.name)) {
          seen.add(tr.name);
          const artist = tr.artists?.[0]?.name || "";
          out.push(artist ? { word: tr.name, hint: artist } : { word: tr.name });
        }
        if (out.length >= 15) break;
      }
      if (out.length >= 15) break;
      for (const ar of sec.artists || []) {
        if (ar.name && !seen.has(ar.name)) {
          seen.add(ar.name);
          out.push({ word: ar.name, hint: t("Charts") });
        }
        if (out.length >= 15) break;
      }
      if (out.length >= 15) break;
    }

    hotCache = { value: out, until: Date.now() + 15 * 60 * 1000 };
    return out;
  } catch {
    return [];
  }
}

function getBrowseSections(data) {
  const single =
    data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
      ?.contents;
  if (Array.isArray(single)) return single;
  const twoCol = data?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents;
  if (Array.isArray(twoCol)) return twoCol;
  const plain = data?.contents?.sectionListRenderer?.contents;
  if (Array.isArray(plain)) return plain;
  return [];
}

export async function home() {
  const data = await ytmPost("browse", { browseId: "FEmusic_home" });
  const sections = [];

  sections.push({
    style: "modes",
    modes: [
      {
        title: t("Quick Radio"),
        subtitle: t("Endless mix tailored to YouTube Music"),
        station: "quick_mix",
      },
    ],
  });

  for (const raw of getBrowseSections(data)) {
    const sec = parseShelfToSection(raw);
    if (sec) sections.push(sec);
  }

  return {
    title: t("Home"),
    sections,
  };
}

export async function browse({ page = "" } = {}) {
  const p = String(page || "").trim();

  // Dynamic YTM browse page (moods/genres, "See all", etc.)
  const decoded = decodeBrowsePage(p);
  if (decoded) {
    const payload = { browseId: decoded.browseId };
    if (decoded.params) payload.params = decoded.params;
    const data = await ytmPost("browse", payload);
    const title =
      runsText(data?.header?.musicHeaderRenderer?.title) ||
      runsText(data?.header?.musicVisualHeaderRenderer?.title) ||
      "";
    const sections = [];
    for (const raw of getBrowseSections(data)) {
      const sec = parseShelfToSection(raw);
      if (sec) sections.push(sec);
    }
    return { title: title || undefined, sections };
  }

  const isCharts = p === "charts";
  const browseId = isCharts ? "FEmusic_charts" : "FEmusic_explore";
  const data = await ytmPost("browse", { browseId });

  const sections = [];
  for (const raw of getBrowseSections(data)) {
    const sec = parseShelfToSection(raw);
    if (!sec) continue;
    if (isCharts && sec.playlists?.length) {
      sec.style = "shelf";
    }
    sections.push(sec);
  }

  return {
    title: isCharts ? t("Charts") : t("Explore"),
    tabs: [
      { title: t("Explore"), page: "explore", selected: !isCharts },
      { title: t("Charts"), page: "charts", selected: isCharts },
    ],
    sections,
  };
}

export async function album({ id }) {
  const data = await ytmPost("browse", { browseId: String(id) });

  const twoCol = data?.contents?.twoColumnBrowseResultsRenderer;
  const responsiveHeader =
    twoCol?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicResponsiveHeaderRenderer;
  const legacyHeader = data?.header?.musicDetailHeaderRenderer;
  const hdr = responsiveHeader || legacyHeader || {};

  const name = runsText(hdr.title).trim();
  const imageUrl = bestThumbnail(
    hdr.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
      hdr.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails,
    600,
  );

  const strapRuns = hdr.straplineTextOne?.runs || hdr.subtitle?.runs || [];
  const subRuns = hdr.subtitle?.runs || [];
  const { artists } = extractArtistsAndAlbumFromRuns([...strapRuns, ...subRuns]);

  let kind = "";
  let released = "";
  for (const r of subRuns) {
    const text = String(r?.text || "").trim();
    if (!kind) kind = mapAlbumKind(text);
    if (!released) released = parseYear(text);
  }

  // Extract saved state from library toggle button if present.
  let saved = false;
  for (const b of hdr.buttons || []) {
    if (b?.toggleButtonRenderer?.isToggled) saved = true;
  }

  const secondarySections =
    twoCol?.secondaryContents?.sectionListRenderer?.contents ||
    data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
      ?.contents ||
    [];

  const albumInfo = {
    id: String(id),
    name,
    imageUrl,
    artists,
    released,
    kind: kind || "album",
    saved,
  };

  const tracks = [];
  for (const sec of secondarySections) {
    const shelf = sec?.musicShelfRenderer;
    if (!shelf) continue;
    for (const entry of shelf.contents || []) {
      const tr = parseTrackFromResponsiveItem(entry?.musicResponsiveListItemRenderer, albumInfo);
      if (tr) tracks.push(tr);
    }
  }

  albumInfo.trackCount = tracks.length;
  return { album: albumInfo, tracks };
}

export async function artist({ id }) {
  const data = await ytmPost("browse", { browseId: String(id) });
  const hdr =
    data?.header?.musicImmersiveHeaderRenderer ||
    data?.header?.musicVisualHeaderRenderer ||
    data?.header?.musicHeaderRenderer ||
    {};

  const name = runsText(hdr.title).trim();
  const imageUrl = bestThumbnail(hdr.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails, 600);
  const following = Boolean(hdr.subscriptionButton?.subscribeButtonRenderer?.subscribed);

  const rawSections = getBrowseSections(data);
  let tracks = [];
  let topSongsBrowseId = "";
  const albums = [];
  const related = [];
  const seenAlbums = new Set();
  const seenRelated = new Set();

  for (const raw of rawSections) {
    if (raw?.musicShelfRenderer) {
      if (!topSongsBrowseId) {
        topSongsBrowseId = extractBrowseId(raw.musicShelfRenderer.bottomEndpoint);
      }
      for (const entry of raw.musicShelfRenderer.contents || []) {
        const tr = parseTrackFromResponsiveItem(entry?.musicResponsiveListItemRenderer);
        if (tr) tracks.push(tr);
      }
      continue;
    }

    const carousel = raw?.musicCarouselShelfRenderer;
    if (!carousel) continue;
    for (const entry of carousel.contents || []) {
      if (entry?.musicTwoRowItemRenderer) {
        const parsed = parseTwoRowItem(entry.musicTwoRowItemRenderer);
        if (!parsed) continue;
        if (parsed.kind === "album" && !seenAlbums.has(parsed.item.id)) {
          seenAlbums.add(parsed.item.id);
          albums.push(parsed.item);
        } else if (parsed.kind === "artist" && parsed.item.id !== id && !seenRelated.has(parsed.item.id)) {
          seenRelated.add(parsed.item.id);
          related.push(parsed.item);
        }
      }
    }
  }

  // Enrich artist top songs with durations (and more top tracks) from the top-songs playlist.
  if (topSongsBrowseId) {
    try {
      const topData = await ytmPost("browse", { browseId: normalizePlaylistBrowseId(topSongsBrowseId) });
      const topSections =
        topData?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents ||
        topData?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
          ?.contents ||
        [];
      const topShelf = topSections.find((s) => s?.musicPlaylistShelfRenderer || s?.musicShelfRenderer);
      const topItems = (topShelf?.musicPlaylistShelfRenderer || topShelf?.musicShelfRenderer)?.contents || [];
      if (topItems.length) {
        const initialById = new Map(tracks.map((tr) => [tr.id, tr]));
        const enriched = [];
        for (const entry of topItems.slice(0, 50)) {
          const tr = parseTrackFromResponsiveItem(entry?.musicResponsiveListItemRenderer);
          if (!tr) continue;
          const orig = initialById.get(tr.id);
          if (orig?.album?.name && !tr.album?.name) {
            tr.album = { ...orig.album, imageUrl: tr.album?.imageUrl || orig.album.imageUrl };
          }
          enriched.push(tr);
        }
        if (enriched.length) tracks = enriched;
      }
    } catch {
      // Keep initial top songs if playlist fetch fails.
    }
  }

  return {
    artist: { id: String(id), name, imageUrl, following },
    tracks,
    albums,
    related,
  };
}

export function normalizePlaylistBrowseId(id) {
  const s = String(id || "").trim();
  if (!s) return "";
  if (s.startsWith("VL") || s.startsWith("FE") || s.startsWith("MPREb_")) return s;
  return `VL${s}`;
}

export function stripPlaylistPrefix(id) {
  const s = String(id || "").trim();
  return s.startsWith("VL") ? s.slice(2) : s;
}

export async function playlist({ id }) {
  const browseId = normalizePlaylistBrowseId(id);
  const data = await ytmPost("browse", { browseId });

  const twoCol = data?.contents?.twoColumnBrowseResultsRenderer;
  const headerContainer =
    twoCol?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0] || {};
  const editableHdr = headerContainer?.musicEditablePlaylistDetailHeaderRenderer;
  const hdr =
    editableHdr?.header?.musicResponsiveHeaderRenderer ||
    headerContainer?.musicResponsiveHeaderRenderer ||
    data?.header?.musicDetailHeaderRenderer ||
    data?.header?.musicEditablePlaylistDetailHeaderRenderer?.header?.musicDetailHeaderRenderer ||
    {};

  const name = runsText(hdr.title).trim();
  const description = runsText(hdr.description?.musicDescriptionShelfRenderer?.description || hdr.description).trim();
  const imageUrl = bestThumbnail(
    hdr.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
      hdr.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails,
    600,
  );
  const owner = runsText(hdr.straplineTextOne || hdr.subtitle).trim();
  const mine = Boolean(editableHdr || data?.header?.musicEditablePlaylistDetailHeaderRenderer);
  const fixed = browseId === "VLLM";

  const secondarySections =
    twoCol?.secondaryContents?.sectionListRenderer?.contents ||
    data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
      ?.contents ||
    [];

  let shelf = null;
  for (const sec of secondarySections) {
    shelf = sec?.musicPlaylistShelfRenderer || sec?.musicShelfRenderer;
    if (shelf) break;
  }

  const tracks = [];
  const collect = (items) => {
    for (const entry of items || []) {
      const tr = parseTrackFromResponsiveItem(entry?.musicResponsiveListItemRenderer);
      if (tr) tracks.push(tr);
    }
  };

  collect(shelf?.contents);
  let cont = extractContinuation(shelf);
  let pages = 0;
  while (cont && pages < 5 && tracks.length < 300) {
    pages += 1;
    const more = await ytmPost("browse", {}, { continuation: cont });
    const nextShelf =
      more?.continuationContents?.musicPlaylistShelfContinuation ||
      more?.continuationContents?.musicShelfContinuation ||
      more?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction;
    const nextItems = nextShelf?.contents || nextShelf?.continuationItems || [];
    collect(nextItems);
    cont = extractContinuation(nextShelf) || extractContinuation({ contents: nextItems });
  }

  return {
    id: String(id),
    name,
    imageUrl,
    description,
    owner,
    trackCount: tracks.length,
    mine,
    fixed,
    tracks,
  };
}

export { findTimedLyricsData, lyrics, parsePlainLyrics, parseTimedLyrics } from "./lyrics.js";

async function fetchRadioQueue(videoId) {
  const data = await ytmPost("next", {
    videoId: String(videoId),
    playlistId: `RDAMVM${videoId}`,
    isAudioOnly: true,
  });
  const tabs =
    data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer
      ?.tabs || [];
  const contents = tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents || [];
  const tracks = [];
  const seen = new Set();
  for (const entry of contents) {
    const tr = parsePlaylistPanelItem(entry);
    if (tr && !seen.has(tr.id)) {
      seen.add(tr.id);
      tracks.push(tr);
    }
  }
  return tracks;
}

export async function similar({ id }) {
  const queue = await fetchRadioQueue(id);
  return queue.filter((tr) => tr.id !== String(id)).slice(0, 25);
}

export async function station({ id = "quick_mix", seed = "" } = {}) {
  let seedId = String(seed || "").trim();

  if (!seedId) {
    // Pick a seed track from Home or Charts when launching Quick Radio without a seed.
    const page = await home();
    for (const sec of page.sections || []) {
      if (sec.tracks?.length) {
        const pick = sec.tracks[Math.floor(Math.random() * Math.min(sec.tracks.length, 10))];
        if (pick?.id) {
          seedId = pick.id;
          break;
        }
      }
    }
  }

  if (!seedId) return { tracks: [], more: false };
  const queue = await fetchRadioQueue(seedId);
  const tracks = seed ? queue.filter((tr) => tr.id !== seedId) : queue;
  return { tracks, more: tracks.length > 0 };
}
