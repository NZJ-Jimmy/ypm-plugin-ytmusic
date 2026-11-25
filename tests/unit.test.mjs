import test from "node:test";
import assert from "node:assert/strict";
import { createMockHost } from "./mock-host.mjs";

// Install mock host before importing plugin modules.
globalThis.host = createMockHost();

const { sha1Hex } = await import("../src/sha1.js");
const { buildAuthHeaders, toNetscapeCookies } = await import("../src/auth.js");
const {
  bestThumbnail,
  parseDurationMs,
  parseYear,
  mapAlbumKind,
  parseTrackFromResponsiveItem,
  parseAlbumFromResponsiveItem,
  parseTwoRowItem,
  parsePlaylistPanelItem,
  encodeBrowsePage,
  decodeBrowsePage,
} = await import("../src/parsers.js");
const { stream, mapAudioType, pickAudioFormat } = await import("../src/stream.js");
const { trackMenu, menuAction } = await import("../src/library.js");

test("sha1Hex matches FIPS 180-4 test vectors", () => {
  assert.equal(sha1Hex(""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
  assert.equal(sha1Hex("abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
  assert.equal(
    sha1Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "84983e441c3bd26ebaae4aa1f95129e5e54670f1",
  );
});

test("buildAuthHeaders computes SAPISIDHASH and Netscape cookies.txt", () => {
  const cookie = "SID=abc; SAPISID=test_sapisid_123; HSID=xyz";
  const headers = buildAuthHeaders(cookie, "https://music.youtube.com", 1700000000);
  const expected = sha1Hex("1700000000 test_sapisid_123 https://music.youtube.com");
  assert.equal(headers.Authorization, `SAPISIDHASH 1700000000_${expected}`);
  assert.equal(headers.Cookie, cookie);
  assert.equal(headers["X-Origin"], "https://music.youtube.com");

  const netscape = toNetscapeCookies(cookie);
  assert.match(netscape, /^# Netscape HTTP Cookie File/);
  assert.match(netscape, /\.youtube\.com\tTRUE\t\/\tTRUE\t\d+\tSAPISID\ttest_sapisid_123/);
});

test("parsers helpers normalize thumbnails, duration, year, and album kinds", () => {
  assert.equal(
    bestThumbnail([{ url: "https://lh3.googleusercontent.com/abc=w60-h60-l90-rj", width: 60 }], 544),
    "https://lh3.googleusercontent.com/abc=w544-h544-l90-rj",
  );
  assert.equal(parseDurationMs("4:30"), 270000);
  assert.equal(parseDurationMs("1:02:03"), 3723000);
  assert.equal(parseDurationMs("invalid"), 0);
  assert.equal(parseYear("2026年"), "2026");
  assert.equal(mapAlbumKind("单曲"), "single");
  assert.equal(mapAlbumKind("EP"), "ep");
  assert.equal(mapAlbumKind("专辑"), "album");

  const encoded = encodeBrowsePage("FEmusic_moods_and_genres_category", "ggMPOg1uX1JOQWZFeDByc2Jm");
  assert.deepEqual(decodeBrowsePage(encoded), {
    browseId: "FEmusic_moods_and_genres_category",
    params: "ggMPOg1uX1JOQWZFeDByc2Jm",
  });
});

test("parseTrackFromResponsiveItem parses real YTM song item shape", () => {
  const sample = {
    playlistItemData: { videoId: "SJKoWAd5ySo" },
    thumbnail: {
      musicThumbnailRenderer: {
        thumbnail: {
          thumbnails: [{ url: "https://lh3.googleusercontent.com/cover=w120-h120-l90-rj", width: 120 }],
        },
      },
    },
    flexColumns: [
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: "晴天", navigationEndpoint: { watchEndpoint: { videoId: "SJKoWAd5ySo" } } }] },
        },
      },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: {
            runs: [
              { text: "周杰倫", navigationEndpoint: { browseEndpoint: { browseId: "UCL2MDNdwEtV6aYUgNjFQGZA" } } },
              { text: " • " },
              { text: "葉惠美", navigationEndpoint: { browseEndpoint: { browseId: "MPREb_nqKuADavt3c" } } },
              { text: " • " },
              { text: "4:30" },
            ],
          },
        },
      },
    ],
  };

  const track = parseTrackFromResponsiveItem(sample);
  assert.equal(track.id, "SJKoWAd5ySo");
  assert.equal(track.name, "晴天");
  assert.deepEqual(track.artists, [{ id: "UCL2MDNdwEtV6aYUgNjFQGZA", name: "周杰倫" }]);
  assert.equal(track.album.id, "MPREb_nqKuADavt3c");
  assert.equal(track.album.name, "葉惠美");
  assert.equal(track.album.imageUrl, "https://lh3.googleusercontent.com/cover=w544-h544-l90-rj");
  assert.equal(track.duration, 270000);
  assert.equal(track.url, "https://music.youtube.com/watch?v=SJKoWAd5ySo");
});

test("parseAlbumFromResponsiveItem & parseTwoRowItem & parsePlaylistPanelItem", () => {
  const alb = parseAlbumFromResponsiveItem({
    navigationEndpoint: { browseEndpoint: { browseId: "MPREb_yBTLlVG2D4V" } },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "太陽之子" }] } } },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: {
            runs: [
              { text: "专辑" },
              { text: " • " },
              { text: "周杰倫", navigationEndpoint: { browseEndpoint: { browseId: "UCL2MDNdwEtV6aYUgNjFQGZA" } } },
              { text: " • " },
              { text: "2026年" },
            ],
          },
        },
      },
    ],
  });
  assert.equal(alb.id, "MPREb_yBTLlVG2D4V");
  assert.equal(alb.released, "2026");
  assert.equal(alb.kind, "album");
  assert.equal(alb.artists[0].name, "周杰倫");

  const twoRow = parseTwoRowItem({
    title: { runs: [{ text: "Top Hits" }] },
    subtitle: { runs: [{ text: "YouTube Music" }] },
    navigationEndpoint: {
      browseEndpoint: {
        browseId: "VLPL123",
        browseEndpointContextSupportedConfigs: {
          browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_PLAYLIST" },
        },
      },
    },
  });
  assert.equal(twoRow.kind, "playlist");
  assert.equal(twoRow.item.id, "VLPL123");

  const panel = parsePlaylistPanelItem({
    playlistPanelVideoRenderer: {
      videoId: "abc12345678",
      title: { runs: [{ text: "Test Song" }] },
      lengthText: { runs: [{ text: "3:15" }] },
      longBylineText: {
        runs: [{ text: "Artist A", navigationEndpoint: { browseEndpoint: { browseId: "UC123" } } }],
      },
    },
  });
  assert.equal(panel.id, "abc12345678");
  assert.equal(panel.duration, 195000);
});

test("stream resolves via yt-dlp when permitted and formats AudioStream", async () => {
  let calledArgs = null;
  globalThis.host = createMockHost({
    settings: { streamMode: "ytdlp", cookiesFromBrowser: "edge" },
    spawnImpl: (cmd, args) => {
      assert.equal(cmd, "yt-dlp");
      calledArgs = args;
      const lines = [
        JSON.stringify({
          url: "https://rr1---sn-test.googlevideo.com/videoplayback?expire=2000000000",
          ext: "webm",
          acodec: "opus",
          abr: 156.4,
          filesize: 4200000,
          http_headers: { "User-Agent": "TestUA" },
        }),
      ];
      let idx = 0;
      return {
        readLine: async () => (idx < lines.length ? lines[idx++] : null),
        wait: async () => 0,
        errorOutput: () => "",
      };
    },
  });

  const res = await stream({ id: "dQw4w9WgXcQ", quality: "high" });
  assert.equal(res.type, "webm");
  assert.equal(res.bitRate, 156400);
  assert.equal(res.size, 4200000);
  assert.equal(res.headers["User-Agent"], "TestUA");
  assert.ok(calledArgs.includes("--cookies-from-browser"));
  assert.ok(calledArgs.includes("edge"));
});

test("stream throws setup error when yt-dlp is blocked and streamMode=ytdlp", async () => {
  globalThis.host = createMockHost({ settings: { streamMode: "ytdlp" } });
  await assert.rejects(() => stream({ id: "blocked12345", quality: "high" }), (err) => {
    assert.equal(err.code, "setup");
    return true;
  });
});

test("pickAudioFormat & mapAudioType & trackMenu/menuAction", async () => {
  assert.equal(mapAudioType("m4a", "mp4a.40.2"), "m4a");
  assert.equal(mapAudioType("", 'audio/webm; codecs="opus"'), "webm");

  const formats = [
    { itag: 249, bitrate: 60000, mimeType: 'audio/webm; codecs="opus"', url: "https://a" },
    { itag: 140, bitrate: 130000, mimeType: 'audio/mp4; codecs="mp4a.40.2"', url: "https://b" },
    { itag: 251, bitrate: 160000, mimeType: 'audio/webm; codecs="opus"', url: "https://c" },
  ];
  assert.equal(pickAudioFormat(formats, "high").itag, 251);
  assert.equal(pickAudioFormat(formats, "standard").itag, 140);

  const items = trackMenu({ track: { id: "SJKoWAd5ySo" } });
  assert.equal(items.length, 2);
  const radioRes = await menuAction({ id: "radio", track: { id: "SJKoWAd5ySo" } });
  assert.deepEqual(radioRes, { station: { id: "radio", seed: "SJKoWAd5ySo" } });
  const copyRes = await menuAction({ id: "copyLink", track: { id: "SJKoWAd5ySo" } });
  assert.equal(copyRes.copy, "https://music.youtube.com/watch?v=SJKoWAd5ySo");
});
