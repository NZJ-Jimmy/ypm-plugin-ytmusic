import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

test("plugin.json matches YesPlayMusic PluginManifest rules", () => {
  const raw = fs.readFileSync(path.join(ROOT, "plugin.json"), "utf8");
  const m = JSON.parse(raw);

  assert.match(m.id, /^[a-z0-9][a-z0-9._-]{0,63}$/);
  assert.notEqual(m.id, "local");
  assert.ok(m.name && m.name.length > 0);
  assert.match(m.main, /\.(m?js)$/);
  assert.ok(fs.existsSync(path.join(ROOT, m.main)));
  assert.match(m.icon, /\.(png|jpe?g|webp)$/i);
  assert.ok(fs.existsSync(path.join(ROOT, m.icon)));
  // Verify PNG signature
  const iconBuf = fs.readFileSync(path.join(ROOT, m.icon));
  assert.deepEqual([...iconBuf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  assert.ok(Array.isArray(m.permissions?.network) && m.permissions.network.length > 0);
  assert.ok(Array.isArray(m.permissions?.process) && m.permissions.process.includes("yt-dlp"));
  assert.ok(Array.isArray(m.settings) && m.settings.length > 0);
  assert.ok(Array.isArray(m.navigation) && m.navigation.length > 0);
});

test("locales JSON files are valid and cover manifest keys", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "plugin.json"), "utf8"));
  const zhCN = JSON.parse(fs.readFileSync(path.join(ROOT, "locales/zh-CN.json"), "utf8"));
  const zhTW = JSON.parse(fs.readFileSync(path.join(ROOT, "locales/zh-TW.json"), "utf8"));
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, "locales/en.json"), "utf8"));

  assert.ok(zhCN[manifest.description]);
  assert.ok(zhTW[manifest.description]);
  assert.ok(en[manifest.description]);
  for (const s of manifest.settings) {
    assert.ok(zhCN[s.label], `Missing zh-CN translation for setting label: ${s.label}`);
  }
});

test("index.js static exports are detected by YesPlayMusic installer regex", () => {
  const src = fs.readFileSync(path.join(ROOT, "index.js"), "utf8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*/gm, "$1");

  const names = new Set();
  for (const m of code.matchAll(/export\s*\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g)) {
    for (const part of m[1].split(",")) {
      const w = part.trim().split(/\s+as\s+/);
      if (w.at(-1)?.trim()) names.add(w.at(-1).trim());
    }
  }

  for (const required of [
    "account",
    "signIn",
    "signOut",
    "testConnection",
    "home",
    "browse",
    "search",
    "suggest",
    "hotSearches",
    "album",
    "artist",
    "playlist",
    "lyrics",
    "similar",
    "station",
    "liked",
    "isLiked",
    "like",
    "savedAlbums",
    "saveAlbum",
    "followArtist",
    "recent",
    "playlists",
    "savePlaylist",
    "createPlaylist",
    "renamePlaylist",
    "deletePlaylist",
    "addToPlaylist",
    "removeFromPlaylist",
    "profile",
    "trackMenu",
    "menuAction",
    "stream",
  ]) {
    assert.ok(names.has(required), `Missing static export in index.js: ${required}`);
  }
});

test("plugin source files do not use Node.js-only globals or imports (QuickJS-ng safe)", () => {
  const files = [
    path.join(ROOT, "index.js"),
    ...fs.readdirSync(path.join(ROOT, "src")).map((f) => path.join(ROOT, "src", f)),
  ];

  const forbidden = [
    /\brequire\s*\(/,
    /from\s+["']node:/,
    /\bprocess\.env\b/,
    /\bBuffer\./,
    /\b__dirname\b/,
    /\b__filename\b/,
  ];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    for (const re of forbidden) {
      assert.doesNotMatch(content, re, `Forbidden Node.js API ${re} found in ${path.basename(file)}`);
    }
  }
});
