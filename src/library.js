// Personal library, likes, saved albums, playlist CRUD, profile, and track context menu.

import { account, fail, getCookie, t } from "./auth.js";
import { stripPlaylistPrefix, normalizePlaylistBrowseId } from "./browse.js";
import {
  clearContinuations,
  getContinuation,
  saveContinuation,
  ytmPost,
  YTM_ORIGIN,
} from "./innertube.js";
import {
  extractContinuation,
  parseAlbumFromResponsiveItem,
  parsePlaylistFromResponsiveItem,
  parseTrackFromResponsiveItem,
  parseTwoRowItem,
} from "./parsers.js";

let likedIdCache = null;

function requireSignedIn() {
  if (!getCookie()) {
    throw fail("signIn", t("Please sign in to YouTube Music first"));
  }
}

function findBrowseSections(data) {
  return (
    data?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents ||
    data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
      ?.contents ||
    data?.contents?.sectionListRenderer?.contents ||
    []
  );
}

export async function liked({ offset = 0 } = {}) {
  requireSignedIn();
  const scope = "library:liked";
  let data;

  if (offset > 0) {
    const token = getContinuation(scope, offset);
    if (!token) return { tracks: [], more: false };
    data = await ytmPost("browse", {}, { requireAuth: true, continuation: token });
  } else {
    clearContinuations(`${scope}:`);
    data = await ytmPost("browse", { browseId: "VLLM" }, { requireAuth: true });
  }

  let shelf =
    data?.continuationContents?.musicPlaylistShelfContinuation ||
    data?.continuationContents?.musicShelfContinuation ||
    data?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction;

  if (!shelf) {
    for (const sec of findBrowseSections(data)) {
      shelf = sec?.musicPlaylistShelfRenderer || sec?.musicShelfRenderer;
      if (shelf) break;
    }
  }

  const items = shelf?.contents || shelf?.continuationItems || [];
  const tracks = [];
  for (const entry of items) {
    const tr = parseTrackFromResponsiveItem(entry?.musicResponsiveListItemRenderer);
    if (tr) tracks.push(tr);
  }

  const nextToken = extractContinuation(shelf) || extractContinuation({ contents: items });
  if (nextToken) saveContinuation(scope, offset + tracks.length, nextToken);

  return { tracks, more: Boolean(nextToken) };
}

async function loadLikedIdSet() {
  if (likedIdCache && likedIdCache.until > Date.now()) return likedIdCache.set;
  const page = await liked({ offset: 0 });
  const set = new Set((page.tracks || []).map((tr) => tr.id));
  likedIdCache = { set, until: Date.now() + 60 * 1000 };
  return set;
}

export async function isLiked({ ids = [] } = {}) {
  if (!getCookie() || !ids.length) {
    return Object.fromEntries(ids.map((id) => [id, false]));
  }
  try {
    const set = await loadLikedIdSet();
    return Object.fromEntries(ids.map((id) => [id, set.has(String(id))]));
  } catch {
    return Object.fromEntries(ids.map((id) => [id, false]));
  }
}

export async function like({ id, on }) {
  requireSignedIn();
  await ytmPost(on ? "like/like" : "like/removelike", { target: { videoId: String(id) } }, { requireAuth: true });
  likedIdCache = null;
}

export async function savedAlbums({ offset = 0 } = {}) {
  requireSignedIn();
  if (offset > 0) return { albums: [], more: false };

  const data = await ytmPost("browse", { browseId: "FEmusic_liked_albums" }, { requireAuth: true });
  const albums = [];
  const seen = new Set();

  for (const sec of findBrowseSections(data)) {
    const grid = sec?.gridRenderer;
    if (grid) {
      for (const entry of grid.items || []) {
        const parsed = parseTwoRowItem(entry?.musicTwoRowItemRenderer);
        if (parsed?.kind === "album" && !seen.has(parsed.item.id)) {
          seen.add(parsed.item.id);
          albums.push({ ...parsed.item, saved: true });
        }
      }
    }
    const shelf = sec?.musicShelfRenderer;
    if (shelf) {
      for (const entry of shelf.contents || []) {
        const alb = parseAlbumFromResponsiveItem(entry?.musicResponsiveListItemRenderer);
        if (alb && !seen.has(alb.id)) {
          seen.add(alb.id);
          albums.push({ ...alb, saved: true });
        }
      }
    }
  }

  return { albums, more: false };
}

export async function saveAlbum({ id, on }) {
  requireSignedIn();
  // Resolve album's backing audioPlaylistId (OLAK5uy_...) for like/removelike.
  const data = await ytmPost("browse", { browseId: String(id) }, { requireAuth: true });
  const raw = JSON.stringify(data);
  const m = raw.match(/"playlistId":"(OLAK5uy_[^"]+)"/);
  const playlistId = m?.[1];
  if (!playlistId) throw fail("unsupported", t("This track is unavailable on YouTube Music"));
  await ytmPost(on ? "like/like" : "like/removelike", { target: { playlistId } }, { requireAuth: true });
}

export async function followArtist({ id, on }) {
  requireSignedIn();
  await ytmPost(
    on ? "subscription/subscribe" : "subscription/unsubscribe",
    { channelIds: [String(id)] },
    { requireAuth: true },
  );
}

export async function recent() {
  requireSignedIn();
  const data = await ytmPost("browse", { browseId: "FEmusic_history" }, { requireAuth: true });
  const tracks = [];
  const seen = new Set();

  for (const sec of findBrowseSections(data)) {
    const shelf = sec?.musicShelfRenderer;
    if (!shelf) continue;
    for (const entry of shelf.contents || []) {
      const tr = parseTrackFromResponsiveItem(entry?.musicResponsiveListItemRenderer);
      if (tr && !seen.has(tr.id)) {
        seen.add(tr.id);
        tracks.push(tr);
      }
    }
  }
  return tracks;
}

export async function playlists() {
  requireSignedIn();
  const data = await ytmPost("browse", { browseId: "FEmusic_liked_playlists" }, { requireAuth: true });
  const out = [];
  const seen = new Set();

  for (const sec of findBrowseSections(data)) {
    const grid = sec?.gridRenderer;
    if (grid) {
      for (const entry of grid.items || []) {
        const parsed = parseTwoRowItem(entry?.musicTwoRowItemRenderer);
        if (parsed?.kind === "playlist" && parsed.item.id && !seen.has(parsed.item.id)) {
          seen.add(parsed.item.id);
          const isLikedList = parsed.item.id === "VLLM" || parsed.item.id === "LM";
          out.push({
            ...parsed.item,
            fixed: isLikedList,
            mine: !isLikedList,
            saved: true,
          });
        }
      }
    }
    const shelf = sec?.musicShelfRenderer;
    if (shelf) {
      for (const entry of shelf.contents || []) {
        const pl = parsePlaylistFromResponsiveItem(entry?.musicResponsiveListItemRenderer);
        if (pl && !seen.has(pl.id)) {
          seen.add(pl.id);
          out.push({ ...pl, saved: true });
        }
      }
    }
  }
  return out;
}

export async function savePlaylist({ id, on }) {
  requireSignedIn();
  const playlistId = stripPlaylistPrefix(id);
  await ytmPost(on ? "like/like" : "like/removelike", { target: { playlistId } }, { requireAuth: true });
}

export async function createPlaylist({ name }) {
  requireSignedIn();
  const res = await ytmPost(
    "playlist/create",
    { title: String(name || ""), privacyStatus: "PRIVATE" },
    { requireAuth: true },
  );
  const pid = res?.playlistId || "";
  return {
    id: pid ? `VL${pid}` : "",
    name: String(name || ""),
    mine: true,
    saved: true,
    trackCount: 0,
  };
}

export async function renamePlaylist({ id, name }) {
  requireSignedIn();
  await ytmPost(
    "browse/edit_playlist",
    {
      playlistId: stripPlaylistPrefix(id),
      actions: [{ action: "ACTION_SET_PLAYLIST_NAME", playlistName: String(name || "") }],
    },
    { requireAuth: true },
  );
}

export async function deletePlaylist({ id }) {
  requireSignedIn();
  await ytmPost("playlist/delete", { playlistId: stripPlaylistPrefix(id) }, { requireAuth: true });
}

export async function addToPlaylist({ id, trackIds = [] }) {
  requireSignedIn();
  if (!trackIds.length) return;
  await ytmPost(
    "browse/edit_playlist",
    {
      playlistId: stripPlaylistPrefix(id),
      actions: trackIds.map((vid) => ({ action: "ACTION_ADD_VIDEO", addedVideoId: String(vid) })),
    },
    { requireAuth: true },
  );
}

export async function removeFromPlaylist({ id, trackIds = [] }) {
  requireSignedIn();
  if (!trackIds.length) return;
  const targetIds = new Set(trackIds.map(String));
  const data = await ytmPost("browse", { browseId: normalizePlaylistBrowseId(id) }, { requireAuth: true });
  const actions = [];

  for (const sec of findBrowseSections(data)) {
    const shelf = sec?.musicPlaylistShelfRenderer || sec?.musicShelfRenderer;
    if (!shelf) continue;
    for (const entry of shelf.contents || []) {
      const item = entry?.musicResponsiveListItemRenderer;
      const vid = item?.playlistItemData?.videoId;
      const setVideoId = item?.playlistItemData?.playlistSetVideoId;
      if (vid && setVideoId && targetIds.has(String(vid))) {
        actions.push({ action: "ACTION_REMOVE_VIDEO", removedVideoId: String(vid), setVideoId });
      }
    }
  }

  if (actions.length) {
    await ytmPost(
      "browse/edit_playlist",
      { playlistId: stripPlaylistPrefix(id), actions },
      { requireAuth: true },
    );
  }
}

export async function profile() {
  const acc = await account();
  if (!acc) throw fail("signIn", t("Please sign in to YouTube Music first"));

  const [pls, rec] = await Promise.all([
    playlists().catch(() => []),
    recent().catch(() => []),
  ]);

  return {
    name: acc.name,
    imageUrl: acc.imageUrl,
    stats: [{ label: t("Playlists"), value: pls.length, link: "playlists" }],
    topTracks: rec.length ? { title: t("Recently Played"), tracks: rec.slice(0, 12) } : undefined,
    playlists: pls.filter((p) => !p.fixed),
  };
}

export function trackMenu({ track }) {
  if (!track?.id) return [];
  return [
    { id: "radio", title: t("Start Radio"), icon: "radio" },
    { id: "copyLink", title: t("Copy YouTube Music Link") },
  ];
}

export async function menuAction({ id, track }) {
  if (!track?.id) return {};
  if (id === "radio") {
    return { station: { id: "radio", seed: String(track.id) } };
  }
  if (id === "copyLink") {
    return {
      copy: `${YTM_ORIGIN}/watch?v=${track.id}`,
      toast: t("Link copied"),
    };
  }
  return {};
}
