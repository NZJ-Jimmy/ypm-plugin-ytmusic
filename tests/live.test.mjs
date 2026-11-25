// End-to-end live integration test against music.youtube.com (anonymous mode).

import assert from "node:assert/strict";
import { createMockHost } from "./mock-host.mjs";

globalThis.host = createMockHost({ language: "zh-CN", settings: { region: "US" } });

const plugin = await import("../index.js");

async function step(name, fn) {
  const t0 = Date.now();
  const res = await fn();
  console.log(`✓ ${name} (${Date.now() - t0}ms)`);
  return res;
}

async function main() {
  // 1. testConnection
  const conn = await step("testConnection()", () => plugin.testConnection({ settings: {} }));
  console.log("  ->", conn);
  assert.ok(conn.length > 0);

  // 2. search tracks + pagination
  const tracksPage1 = await step("search(tracks, page 1)", () =>
    plugin.search({ query: "周杰伦 晴天", kind: "tracks", offset: 0 }),
  );
  assert.ok(tracksPage1.tracks.length > 0, "Expected tracks from search");
  const sampleTrack = tracksPage1.tracks[0];
  console.log(`  -> ${tracksPage1.tracks.length} tracks, first: "${sampleTrack.name}" (${sampleTrack.id}), more=${tracksPage1.more}`);

  if (tracksPage1.more) {
    const tracksPage2 = await step("search(tracks, page 2)", () =>
      plugin.search({ query: "周杰伦 晴天", kind: "tracks", offset: tracksPage1.tracks.length }),
    );
    assert.ok(tracksPage2.tracks.length > 0, "Expected page 2 tracks");
    console.log(`  -> page 2: ${tracksPage2.tracks.length} tracks`);
  }

  // 3. search albums / artists / playlists
  const albumsRes = await step("search(albums)", () => plugin.search({ query: "Jay Chou", kind: "albums", offset: 0 }));
  assert.ok(albumsRes.albums.length > 0);
  const sampleAlbum = albumsRes.albums[0];
  console.log(`  -> ${albumsRes.albums.length} albums, first: "${sampleAlbum.name}" (${sampleAlbum.id})`);

  const artistsRes = await step("search(artists)", () => plugin.search({ query: "Jay Chou", kind: "artists", offset: 0 }));
  assert.ok(artistsRes.artists.length > 0);
  const sampleArtist = artistsRes.artists[0];
  console.log(`  -> ${artistsRes.artists.length} artists, first: "${sampleArtist.name}" (${sampleArtist.id})`);

  const playlistsRes = await step("search(playlists)", () => plugin.search({ query: "Jay Chou", kind: "playlists", offset: 0 }));
  assert.ok(playlistsRes.playlists.length > 0);
  const samplePlaylist = playlistsRes.playlists[0];
  console.log(`  -> ${playlistsRes.playlists.length} playlists, first: "${samplePlaylist.name}" (${samplePlaylist.id})`);

  // 4. suggest & hotSearches
  const suggestions = await step("suggest()", () => plugin.suggest({ query: "周杰伦" }));
  assert.ok(suggestions.length > 0);
  console.log("  -> suggestions:", suggestions.slice(0, 4).join(", "));

  const hot = await step("hotSearches()", () => plugin.hotSearches());
  assert.ok(hot.length > 0, "Expected non-empty hot searches");
  console.log(`  -> ${hot.length} hot searches, first: ${hot[0]?.word}`);

  // 5. home, browse(explore), browse(charts)
  const homePage = await step("home()", () => plugin.home());
  assert.ok(homePage.sections.length >= 2);
  console.log(`  -> home sections: ${homePage.sections.length}`);

  const explorePage = await step("browse(explore)", () => plugin.browse({ page: "explore" }));
  assert.ok(explorePage.sections.length >= 2);
  console.log(`  -> explore sections: ${explorePage.sections.length}`);

  const chartsPage = await step("browse(charts)", () => plugin.browse({ page: "charts" }));
  assert.ok(chartsPage.sections.length >= 2, "Expected charts to include playlists and top artists");
  console.log(`  -> charts sections: ${chartsPage.sections.length}`);

  // 6. album / artist / playlist detail
  const albumDetail = await step("album()", () => plugin.album({ id: sampleAlbum.id }));
  assert.ok(albumDetail.album.name && albumDetail.tracks.length > 0);
  console.log(`  -> album "${albumDetail.album.name}": ${albumDetail.tracks.length} tracks`);

  const artistDetail = await step("artist()", () => plugin.artist({ id: sampleArtist.id }));
  assert.ok(artistDetail.artist.name && artistDetail.tracks.length > 0);
  console.log(`  -> artist "${artistDetail.artist.name}": ${artistDetail.tracks.length} tracks, ${artistDetail.albums.length} albums, ${artistDetail.related.length} related`);

  const playlistDetail = await step("playlist()", () => plugin.playlist({ id: samplePlaylist.id }));
  assert.ok(playlistDetail.name && playlistDetail.tracks.length > 0);
  console.log(`  -> playlist "${playlistDetail.name}": ${playlistDetail.tracks.length} tracks`);

  // 7. lyrics / similar / station
  const lyr = await step("lyrics()", () => plugin.lyrics({ id: sampleTrack.id }));
  console.log(`  -> lyrics lines: ${lyr.lines?.length || 0}`);

  const sim = await step("similar()", () => plugin.similar({ id: sampleTrack.id }));
  assert.ok(sim.length > 0);
  console.log(`  -> similar tracks: ${sim.length}`);

  const radio = await step("station()", () => plugin.station({ id: "quick_mix", seed: sampleTrack.id }));
  assert.ok(radio.tracks.length > 0);
  console.log(`  -> station tracks: ${radio.tracks.length}`);

  console.log("\nALL LIVE INTEGRATION TESTS PASSED!");
}

main().catch((e) => {
  console.error("LIVE TEST FAILED:", e);
  process.exit(1);
});
