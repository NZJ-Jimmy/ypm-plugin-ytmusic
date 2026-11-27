import test from "node:test";
import assert from "node:assert/strict";
import { createMockHost } from "./mock-host.mjs";

// Install mock host before importing plugin modules.
globalThis.host = createMockHost();

const { sha1Hex } = await import("../src/sha1.js");
const { buildAuthHeaders, toNetscapeCookies, signIn, MACOS_SAFARI_UA, GOOGLE_YTM_SIGNIN_URL } = await import(
  "../src/auth.js"
);
const {
  findTimedLyricsData,
  parseTimedLyrics,
  parsePlainLyrics,
  parseLrc,
  decodeBase64Utf8,
  cleanTrackTitle,
  cleanArtistName,
  pickBestLrcLibCandidate,
  pickBestKuGouCandidate,
  resolveProviderOrder,
  lyrics,
} = await import("../src/lyrics.js");
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
const { trackMenu, menuAction, savedAlbums } = await import("../src/library.js");

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

test("savedAlbums returns a plain Album[] array for compatibility with all YesPlayMusic 3.0+ builds", async () => {
  const origFetch = globalThis.fetch;
  globalThis.host = createMockHost({ settings: { cookie: "SID=a; SAPISID=b" } });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        gridRenderer: {
                          items: [
                            {
                              musicTwoRowItemRenderer: {
                                title: { runs: [{ text: "葉惠美" }] },
                                subtitle: { runs: [{ text: "专辑" }, { text: " • " }, { text: "周杰倫" }] },
                                navigationEndpoint: {
                                  browseEndpoint: {
                                    browseId: "MPREb_nqKuADavt3c",
                                    browseEndpointContextSupportedConfigs: {
                                      browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ALBUM" },
                                    },
                                  },
                                },
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    }),
  });

  try {
    const res = await savedAlbums({ offset: 0 });
    assert.ok(Array.isArray(res), "savedAlbums() must return an Array");
    assert.equal(res.length, 1);
    assert.equal(res[0].id, "MPREb_nqKuADavt3c");
    assert.equal(res[0].saved, true);

    const page2 = await savedAlbums({ offset: 20 });
    assert.deepEqual(page2, []);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("macOS signIn passes desktop Safari userAgent and Google YouTube login URL to host.webSignIn", async () => {
  let receivedOpts = null;
  globalThis.host = createMockHost({
    platform: "darwin",
    webSignInImpl: async (opts) => {
      receivedOpts = opts;
      throw new Error("cancelled");
    },
  });

  await assert.rejects(() => signIn(), /cancelled/);
  assert.equal(receivedOpts.url, GOOGLE_YTM_SIGNIN_URL);
  assert.equal(receivedOpts.cookiesOf, "https://music.youtube.com/");
  assert.deepEqual(receivedOpts.until, ["SAPISID", "SID"]);
  assert.equal(receivedOpts.userAgent, MACOS_SAFARI_UA);
});

test("findTimedLyricsData, parseTimedLyrics, and parsePlainLyrics handle synced and untimed lyrics", () => {
  const nested = {
    contents: {
      elementRenderer: {
        newElement: {
          type: {
            componentType: {
              model: {
                timedLyricsModel: {
                  lyricsData: {
                    timedLyricsData: [
                      {
                        lyricLine: "Line 2",
                        cueRange: { startTimeMilliseconds: "36120", endTimeMilliseconds: "42000" },
                      },
                      {
                        lyricLine: "Line 1",
                        cueRange: { startTimeMilliseconds: "29250", endTimeMilliseconds: "36120" },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  const raw = findTimedLyricsData(nested);
  assert.equal(raw.length, 2);
  const parsed = parseTimedLyrics(raw);
  assert.deepEqual(parsed, [
    { start: 29250, end: 36120, text: "Line 1" },
    { start: 36120, end: 42000, text: "Line 2" },
  ]);

  const plain = parsePlainLyrics("First line\nSecond line\nThird line");
  assert.equal(plain.length, 3);
  assert.equal(plain[0].start, 0);
  assert.ok(plain[1].start > 60 * 60 * 1000);
  assert.ok(plain[2].start > 60 * 60 * 1000);
});

test("decodeBase64Utf8 decodes ASCII, CJK, and multi-byte UTF-8 without Buffer/atob", () => {
  const sample = "\uFEFF[00:12.34]故事的小黄花 🎵\n[00:16.50]Hello World";
  const b64 = Buffer.from(sample, "utf8").toString("base64");
  assert.equal(decodeBase64Utf8(b64), sample);
});

test("parseLrc parses timestamps, multi-timestamps, offsets, and skips metadata tags", () => {
  const lrc = [
    "\uFEFF[ar:周杰伦]",
    "[ti:晴天]",
    "[offset:500]",
    "[00:01.00]第一句",
    "[00:05.25][01:05.500]重复副歌",
    "[00:10.5]第三句",
  ].join("\n");

  const lines = parseLrc(lrc);
  assert.deepEqual(lines, [
    { start: 500, text: "第一句" },
    { start: 4750, text: "重复副歌" },
    { start: 10000, text: "第三句" },
    { start: 65000, text: "重复副歌" },
  ]);
});

test("cleanTrackTitle, cleanArtistName, candidate scoring, and provider order", () => {
  assert.equal(cleanTrackTitle("晴天 (Official Music Video) [HD]"), "晴天");
  assert.equal(cleanTrackTitle("Song Name (feat. Someone)"), "Song Name");
  assert.equal(cleanArtistName("Jay Chou - Topic"), "Jay Chou");

  assert.deepEqual(resolveProviderOrder(""), ["ytmusic", "lrclib", "kugou"]);
  assert.deepEqual(resolveProviderOrder("lrclib"), ["lrclib", "kugou", "ytmusic"]);
  assert.deepEqual(resolveProviderOrder("kugou"), ["kugou", "lrclib", "ytmusic"]);
  assert.deepEqual(resolveProviderOrder("ytmusic"), ["ytmusic"]);

  const lrcBest = pickBestLrcLibCandidate(
    [
      { trackName: "晴天", artistName: "周杰伦", duration: 120, syncedLyrics: "[00:01.00]wrong" },
      { trackName: "晴天", artistName: "周杰伦", duration: 270, syncedLyrics: "[00:01.00]right" },
    ],
    { title: "晴天", artist: "周杰伦", durationMs: 269000 },
  );
  assert.equal(lrcBest.duration, 270);

  const kgBest = pickBestKuGouCandidate(
    [
      { id: "1", accesskey: "a", song: "晴天", singer: "周杰伦", duration: 269000, score: 60 },
      { id: "2", accesskey: "b", song: "晴天", singer: "翻唱", duration: 200000, score: 80 },
    ],
    { title: "晴天", artist: "周杰伦", durationMs: 269000 },
  );
  assert.equal(kgBest.id, "1");
});

test("lyrics() falls back from YT Music to LRCLIB and KuGou when YT Music has no timed lyrics", async () => {
  const sampleNext = {
    contents: {
      singleColumnMusicWatchNextResultsRenderer: {
        tabbedRenderer: {
          watchNextTabbedResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    musicQueueRenderer: {
                      content: {
                        playlistPanelRenderer: {
                          contents: [
                            {
                              playlistPanelVideoRenderer: {
                                videoId: "vid12345678",
                                title: { runs: [{ text: "晴天 (Official Audio)" }] },
                                lengthText: { runs: [{ text: "4:29" }] },
                                longBylineText: {
                                  runs: [{ text: "周杰伦", navigationEndpoint: { browseEndpoint: { browseId: "UC1" } } }],
                                },
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
              {
                tabRenderer: {
                  endpoint: { browseEndpoint: { browseId: "MPLYt_test" } },
                },
              },
            ],
          },
        },
      },
    },
  };

  const kgLrcB64 = Buffer.from("[00:02.00]酷狗第一句\n[00:06.50]酷狗第二句", "utf8").toString("base64");
  const calledUrls = [];
  const origFetch = globalThis.fetch;

  globalThis.host = createMockHost({ settings: { lyricsProvider: "" } });
  globalThis.fetch = async (url) => {
    const u = String(url);
    calledUrls.push(u);
    const jsonRes = (obj, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => obj,
    });
    if (u.includes("/youtubei/v1/next")) return jsonRes(sampleNext);
    if (u.includes("/youtubei/v1/browse")) {
      // YT Music has only unsynced plain lyrics
      return jsonRes({
        contents: {
          sectionListRenderer: {
            contents: [{ musicDescriptionShelfRenderer: { description: { runs: [{ text: "Plain only" }] } } }],
          },
        },
      });
    }
    if (u.includes("lrclib.net")) return jsonRes({}, 404);
    if (u.includes("lyrics.kugou.com/search")) {
      return jsonRes({
        candidates: [{ id: "99", accesskey: "key99", song: "晴天", singer: "周杰伦", duration: 269000, score: 60 }],
      });
    }
    if (u.includes("lyrics.kugou.com/download")) {
      return jsonRes({ content: kgLrcB64 });
    }
    return jsonRes({}, 404);
  };

  try {
    const res = await lyrics({ id: "vid12345678" });
    assert.deepEqual(res.lines, [
      { start: 2000, text: "酷狗第一句" },
      { start: 6500, text: "酷狗第二句" },
    ]);
    assert.ok(calledUrls.some((u) => u.includes("lrclib.net")));
    assert.ok(calledUrls.some((u) => u.includes("lyrics.kugou.com/download")));
  } finally {
    globalThis.fetch = origFetch;
  }
});
