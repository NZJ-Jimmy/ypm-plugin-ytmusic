// Parsers converting YouTube Music InnerTube renderers into YesPlayMusic data models.

import { YTM_ORIGIN } from "./innertube.js";

export function runsText(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (typeof obj.simpleText === "string") return obj.simpleText;
  if (Array.isArray(obj.runs)) return obj.runs.map((r) => r?.text || "").join("");
  return "";
}

export function bestThumbnail(thumbs, size = 544) {
  if (!Array.isArray(thumbs) || !thumbs.length) return "";
  let best = thumbs[thumbs.length - 1];
  for (const t of thumbs) {
    if ((t?.width || 0) >= (best?.width || 0)) best = t;
  }
  let url = String(best?.url || "").trim();
  if (!url) return "";
  if (url.startsWith("//")) url = `https:${url}`;
  // Upscale low-res lh3.googleusercontent.com thumbnails to crisp square art.
  if (url.includes("googleusercontent.com") && /=w\d+-h\d+/.test(url)) {
    url = url.replace(/=w\d+-h\d+[^&]*/, `=w${size}-h${size}-l90-rj`);
  }
  return url;
}

export function parseDurationMs(text) {
  const s = String(text || "").trim();
  if (!/^\d+(?::\d{2}){1,2}$/.test(s)) return 0;
  const parts = s.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
}

export function parseYear(text) {
  const m = String(text || "").match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[1] : "";
}

export function mapAlbumKind(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s) return "";
  if (s === "single" || s.includes("单曲") || s.includes("單曲")) return "single";
  if (s === "ep" || s.includes("迷你专辑") || s.includes("迷你專輯")) return "ep";
  if (s.includes("compilation") || s.includes("精选") || s.includes("精選")) return "compilation";
  if (s === "album" || s.includes("专辑") || s.includes("專輯")) return "album";
  return "";
}

export function isSeparatorRun(text) {
  const s = String(text || "").trim();
  return !s || s === "•" || s === "·" || s === "," || s === "&";
}

export function isMetaNoise(text) {
  const s = String(text || "").trim();
  if (!s) return true;
  if (/^\d+(?::\d{2}){1,2}$/.test(s)) return true;
  if (/^(19\d{2}|20\d{2})年?$/.test(s)) return true;
  if (
    /^(song|video|album|single|ep|artist|playlist|songs|videos|music|episode|podcast|歌曲|视频|影片|专辑|專輯|单曲|單曲|音乐人|音樂人|藝人|播放列表|播放清單|社区播放列表|社群播放清單)$/i.test(
      s,
    )
  ) {
    return true;
  }
  if (/plays|views|listeners|subscribers|songs|tracks|播放|观看|觀看|听众|聽眾|订阅|訂閱|首/i.test(s)) {
    return true;
  }
  return false;
}

export function extractPageType(endpoint) {
  return (
    endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || ""
  );
}

export function extractBrowseId(endpoint) {
  return endpoint?.browseEndpoint?.browseId || "";
}

export function extractVideoId(item) {
  return (
    item?.playlistItemData?.videoId ||
    item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
      ?.watchEndpoint?.videoId ||
    item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint
      ?.watchEndpoint?.videoId ||
    item?.navigationEndpoint?.watchEndpoint?.videoId ||
    ""
  );
}

export function extractContinuation(obj) {
  if (!obj) return null;
  const c1 = obj?.continuations?.[0]?.nextContinuationData?.continuation;
  if (c1) return c1;
  const c2 = obj?.continuations?.[0]?.nextRadioContinuationData?.continuation;
  if (c2) return c2;
  if (Array.isArray(obj.contents)) {
    for (let i = obj.contents.length - 1; i >= 0; i--) {
      const token =
        obj.contents[i]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (token) return token;
    }
  }
  return null;
}

function getFlexRuns(item, index) {
  return item?.flexColumns?.[index]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
}

function getFixedRuns(item, index) {
  return item?.fixedColumns?.[index]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs || [];
}

export function extractArtistsAndAlbumFromRuns(runs) {
  const artists = [];
  let album = null;
  let duration = 0;

  for (const run of runs) {
    const text = String(run?.text || "").trim();
    if (isSeparatorRun(text)) continue;

    const dur = parseDurationMs(text);
    if (dur > 0) {
      duration = dur;
      continue;
    }

    const ep = run?.navigationEndpoint;
    const browseId = extractBrowseId(ep);
    const pageType = extractPageType(ep);

    if (pageType === "MUSIC_PAGE_TYPE_ALBUM" || browseId.startsWith("MPREb_")) {
      if (!album) album = { id: browseId, name: text };
      continue;
    }
    if (
      pageType === "MUSIC_PAGE_TYPE_ARTIST" ||
      pageType === "MUSIC_PAGE_TYPE_USER_CHANNEL" ||
      browseId.startsWith("UC")
    ) {
      artists.push({ id: browseId, name: text });
      continue;
    }
  }

  // Fallback: if no linked artist runs, grab first non-noise text run before the first bullet.
  if (!artists.length) {
    for (const run of runs) {
      const text = String(run?.text || "").trim();
      if (isSeparatorRun(text)) continue;
      if (isMetaNoise(text)) continue;
      if (album && text === album.name) continue;
      artists.push({ id: "", name: text });
      break;
    }
  }

  return { artists, album, duration };
}

export function parseTrackFromResponsiveItem(item, fallbackAlbum) {
  if (!item) return null;
  const id = extractVideoId(item);
  if (!id) return null;

  const titleRuns = getFlexRuns(item, 0);
  const name = runsText({ runs: titleRuns }).trim();
  if (!name) return null;

  const subRuns = [];
  for (let i = 1; i < (item.flexColumns?.length || 0); i++) {
    subRuns.push(...getFlexRuns(item, i));
  }
  const { artists, album, duration: subDur } = extractArtistsAndAlbumFromRuns(subRuns);

  let duration = subDur;
  if (!duration) {
    for (let i = 0; i < (item.fixedColumns?.length || 0); i++) {
      duration = parseDurationMs(runsText({ runs: getFixedRuns(item, i) }));
      if (duration > 0) break;
    }
  }

  const thumb = bestThumbnail(item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails, 544);
  const resolvedAlbum = album
    ? { id: album.id, name: album.name, imageUrl: thumb || fallbackAlbum?.imageUrl || "" }
    : fallbackAlbum
      ? { id: fallbackAlbum.id || "", name: fallbackAlbum.name || "", imageUrl: thumb || fallbackAlbum.imageUrl || "" }
      : thumb
        ? { id: "", name: "", imageUrl: thumb }
        : undefined;

  const resolvedArtists = artists.length
    ? artists
    : fallbackAlbum?.artists?.length
      ? fallbackAlbum.artists
      : [];

  return {
    id,
    name,
    artists: resolvedArtists,
    album: resolvedAlbum,
    duration,
    url: `${YTM_ORIGIN}/watch?v=${id}`,
    unavailable: item.musicItemRendererDisplayPolicy === "MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT",
  };
}

export function parseAlbumFromResponsiveItem(item) {
  if (!item) return null;
  const id = extractBrowseId(item.navigationEndpoint);
  if (!id) return null;

  const name = runsText({ runs: getFlexRuns(item, 0) }).trim();
  if (!name) return null;

  const subRuns = getFlexRuns(item, 1);
  const { artists } = extractArtistsAndAlbumFromRuns(subRuns);
  let kind = "";
  let released = "";
  for (const r of subRuns) {
    const text = String(r?.text || "").trim();
    if (!kind) kind = mapAlbumKind(text);
    if (!released) released = parseYear(text);
  }

  return {
    id,
    name,
    imageUrl: bestThumbnail(item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails, 544),
    artists,
    released,
    kind: kind || undefined,
  };
}

export function parseArtistFromResponsiveItem(item) {
  if (!item) return null;
  const id = extractBrowseId(item.navigationEndpoint);
  if (!id) return null;

  const name = runsText({ runs: getFlexRuns(item, 0) }).trim();
  if (!name) return null;

  return {
    id,
    name,
    imageUrl: bestThumbnail(item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails, 544),
  };
}

export function parsePlaylistFromResponsiveItem(item) {
  if (!item) return null;
  const id = extractBrowseId(item.navigationEndpoint);
  if (!id) return null;

  const name = runsText({ runs: getFlexRuns(item, 0) }).trim();
  if (!name) return null;

  const subRuns = getFlexRuns(item, 1);
  let owner = "";
  for (const r of subRuns) {
    const text = String(r?.text || "").trim();
    if (isSeparatorRun(text) || isMetaNoise(text)) continue;
    owner = text;
    break;
  }

  return {
    id,
    name,
    imageUrl: bestThumbnail(item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails, 544),
    owner,
    subtitle: runsText({ runs: subRuns }),
  };
}

export function parseTwoRowItem(item) {
  if (!item) return null;
  const name = runsText(item.title).trim();
  if (!name) return null;

  const thumb = bestThumbnail(item.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails, 544);
  const ep = item.navigationEndpoint;
  const watchVid = ep?.watchEndpoint?.videoId;
  const browseId = extractBrowseId(ep);
  const pageType = extractPageType(ep);
  const subRuns = item.subtitle?.runs || [];
  const subtitle = runsText(item.subtitle);

  // Video / Song card
  if (watchVid && !browseId) {
    const { artists, album, duration } = extractArtistsAndAlbumFromRuns(subRuns);
    return {
      kind: "track",
      item: {
        id: watchVid,
        name,
        artists,
        album: album ? { ...album, imageUrl: thumb } : { id: "", name: "", imageUrl: thumb },
        duration,
        url: `${YTM_ORIGIN}/watch?v=${watchVid}`,
      },
    };
  }

  if (!browseId) return null;

  // Artist card
  if (pageType === "MUSIC_PAGE_TYPE_ARTIST" || pageType === "MUSIC_PAGE_TYPE_USER_CHANNEL" || browseId.startsWith("UC")) {
    return {
      kind: "artist",
      item: {
        id: browseId,
        name,
        imageUrl: thumb,
      },
    };
  }

  // Album / Single / EP card
  if (pageType === "MUSIC_PAGE_TYPE_ALBUM" || browseId.startsWith("MPREb_")) {
    const { artists } = extractArtistsAndAlbumFromRuns(subRuns);
    let kind = "";
    let released = "";
    for (const r of subRuns) {
      const text = String(r?.text || "").trim();
      if (!kind) kind = mapAlbumKind(text);
      if (!released) released = parseYear(text);
    }
    return {
      kind: "album",
      item: {
        id: browseId,
        name,
        imageUrl: thumb,
        artists,
        released,
        kind: kind || undefined,
      },
    };
  }

  // Playlist card
  if (
    pageType === "MUSIC_PAGE_TYPE_PLAYLIST" ||
    browseId.startsWith("VL") ||
    browseId.startsWith("PL") ||
    browseId.startsWith("RDCLAK") ||
    browseId.startsWith("OLAK")
  ) {
    let owner = "";
    for (const r of subRuns) {
      const text = String(r?.text || "").trim();
      if (isSeparatorRun(text) || isMetaNoise(text)) continue;
      owner = text;
      break;
    }
    return {
      kind: "playlist",
      item: {
        id: browseId,
        name,
        imageUrl: thumb,
        owner,
        subtitle,
      },
    };
  }

  return null;
}

export function parsePlaylistPanelItem(raw) {
  const renderer =
    raw?.playlistPanelVideoRenderer ||
    raw?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
  if (!renderer || !renderer.videoId) return null;

  const name = runsText(renderer.title).trim();
  if (!name) return null;

  const longRuns = renderer.longBylineText?.runs || renderer.shortBylineText?.runs || [];
  const { artists, album } = extractArtistsAndAlbumFromRuns(longRuns);
  const thumb = bestThumbnail(renderer.thumbnail?.thumbnails, 544);
  const duration = parseDurationMs(runsText(renderer.lengthText));

  return {
    id: renderer.videoId,
    name,
    artists,
    album: album ? { ...album, imageUrl: thumb } : { id: "", name: "", imageUrl: thumb },
    duration,
    url: `${YTM_ORIGIN}/watch?v=${renderer.videoId}`,
  };
}

export function encodeBrowsePage(browseId, params = "") {
  if (!browseId) return "";
  return params ? `ytm:${browseId}|${params}` : `ytm:${browseId}`;
}

export function decodeBrowsePage(page) {
  if (!page || !page.startsWith("ytm:")) return null;
  const rest = page.slice(4);
  const sep = rest.indexOf("|");
  if (sep < 0) return { browseId: rest, params: "" };
  return { browseId: rest.slice(0, sep), params: rest.slice(sep + 1) };
}

export function parseNavigationButton(btn) {
  if (!btn) return null;
  const title = runsText(btn.buttonText).trim();
  const ep = btn.clickCommand?.browseEndpoint;
  if (!title || !ep?.browseId) return null;
  return {
    title,
    page: encodeBrowsePage(ep.browseId, ep.params || ""),
  };
}

function pushResponsiveItem(r, { tracks, albums, artists, playlists }) {
  const tr = parseTrackFromResponsiveItem(r);
  if (tr) {
    tracks.push(tr);
    return;
  }
  const ep = r?.navigationEndpoint;
  const bid = extractBrowseId(ep);
  const pageType = extractPageType(ep);
  if (!bid) return;
  if (pageType === "MUSIC_PAGE_TYPE_ARTIST" || pageType === "MUSIC_PAGE_TYPE_USER_CHANNEL" || bid.startsWith("UC")) {
    const ar = parseArtistFromResponsiveItem(r);
    if (ar) artists.push(ar);
  } else if (pageType === "MUSIC_PAGE_TYPE_ALBUM" || bid.startsWith("MPREb_")) {
    const alb = parseAlbumFromResponsiveItem(r);
    if (alb) albums.push(alb);
  } else if (
    pageType === "MUSIC_PAGE_TYPE_PLAYLIST" ||
    bid.startsWith("VL") ||
    bid.startsWith("PL") ||
    bid.startsWith("RDCLAK")
  ) {
    const pl = parsePlaylistFromResponsiveItem(r);
    if (pl) playlists.push(pl);
  }
}

export function parseShelfToSection(raw) {
  if (!raw || typeof raw !== "object") return null;

  // 1. musicCarouselShelfRenderer
  const carousel = raw.musicCarouselShelfRenderer;
  if (carousel) {
    const header = carousel.header?.musicCarouselShelfBasicHeaderRenderer;
    const title = runsText(header?.title).trim();
    const subtitle = runsText(header?.strapline).trim();
    const moreEp = header?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint;
    const morePage = moreEp?.browseId ? encodeBrowsePage(moreEp.browseId, moreEp.params || "") : undefined;

    const tracks = [];
    const albums = [];
    const artists = [];
    const playlists = [];
    const links = [];

    for (const entry of carousel.contents || []) {
      if (entry.musicResponsiveListItemRenderer) {
        pushResponsiveItem(entry.musicResponsiveListItemRenderer, { tracks, albums, artists, playlists });
      } else if (entry.musicTwoRowItemRenderer) {
        const parsed = parseTwoRowItem(entry.musicTwoRowItemRenderer);
        if (!parsed) continue;
        if (parsed.kind === "track") tracks.push(parsed.item);
        else if (parsed.kind === "album") albums.push(parsed.item);
        else if (parsed.kind === "artist") artists.push(parsed.item);
        else if (parsed.kind === "playlist") playlists.push(parsed.item);
      } else if (entry.musicNavigationButtonRenderer) {
        const link = parseNavigationButton(entry.musicNavigationButtonRenderer);
        if (link) links.push(link);
      }
    }

    if (!tracks.length && !albums.length && !artists.length && !playlists.length && !links.length) {
      return null;
    }

    const section = { title: title || undefined, subtitle: subtitle || undefined, morePage };
    if (links.length) {
      section.links = links;
      section.style = "grid";
      return section;
    }
    if (tracks.length && !albums.length && !playlists.length && !artists.length) {
      section.tracks = tracks;
      section.style = "songs";
      return section;
    }
    section.style = "shelf";
    if (playlists.length) section.playlists = playlists;
    if (albums.length) section.albums = albums;
    if (artists.length) section.artists = artists;
    if (tracks.length) section.tracks = tracks;
    return section;
  }

  // 2. musicShelfRenderer
  const shelf = raw.musicShelfRenderer;
  if (shelf) {
    const title = runsText(shelf.title).trim();
    const moreEp = shelf.bottomEndpoint?.browseEndpoint;
    const morePage = moreEp?.browseId ? encodeBrowsePage(moreEp.browseId, moreEp.params || "") : undefined;
    const tracks = [];
    for (const entry of shelf.contents || []) {
      if (entry.musicResponsiveListItemRenderer) {
        const tr = parseTrackFromResponsiveItem(entry.musicResponsiveListItemRenderer);
        if (tr) tracks.push(tr);
      }
    }
    if (!tracks.length) return null;
    return {
      title: title || undefined,
      style: "songs",
      tracks,
      morePage,
    };
  }

  // 3. gridRenderer
  const grid = raw.gridRenderer;
  if (grid) {
    const title = runsText(grid.header?.gridHeaderRenderer?.title).trim();
    const albums = [];
    const artists = [];
    const playlists = [];
    const tracks = [];
    const links = [];

    for (const entry of grid.items || []) {
      if (entry.musicTwoRowItemRenderer) {
        const parsed = parseTwoRowItem(entry.musicTwoRowItemRenderer);
        if (!parsed) continue;
        if (parsed.kind === "album") albums.push(parsed.item);
        else if (parsed.kind === "artist") artists.push(parsed.item);
        else if (parsed.kind === "playlist") playlists.push(parsed.item);
        else if (parsed.kind === "track") tracks.push(parsed.item);
      } else if (entry.musicNavigationButtonRenderer) {
        const link = parseNavigationButton(entry.musicNavigationButtonRenderer);
        if (link) links.push(link);
      }
    }

    if (!tracks.length && !albums.length && !artists.length && !playlists.length && !links.length) {
      return null;
    }
    const section = { title: title || undefined, style: "grid" };
    if (links.length) section.links = links;
    if (albums.length) section.albums = albums;
    if (playlists.length) section.playlists = playlists;
    if (artists.length) section.artists = artists;
    if (tracks.length) section.tracks = tracks;
    return section;
  }

  return null;
}
