# YouTube Music Plugin for YesPlayMusic

[中文文档](./README.zh-CN.md)

A **YouTube Music** source plugin for [YesPlayMusic 3.0+](https://github.com/qier222/YesPlayMusic), running natively in YesPlayMusic's QuickJS-ng plugin runtime with zero build steps.

## Features

- **No Login Required to Listen & Search**:
  - Search songs, albums, artists, and community playlists (with pagination & search suggestions)
  - Home recommendations, Explore (new releases, moods & genres), and Charts
  - Full Album, Artist (top songs, albums, singles/EPs, related artists), and Playlist pages
  - Multi-source synced lyrics (inspired by InnerTune / OuterTune: uses YouTube Music official timed lyrics and automatically falls back to **LRCLIB** and **KuGou** for scrolling time-synced lyrics; provider priority is configurable in plugin settings)
  - Similar tracks, Quick Radio, and right-click **Start Radio** / **Copy YouTube Music Link**
- **Optional Account Sign-In**:
  - Sign in via embedded browser window on macOS, or paste your `music.youtube.com` Cookie in settings on Windows/Linux
  - Sync Liked Music, Saved Albums, Recently Played, Playlists (create / rename / delete / add / remove), Like/Unlike, Follow Artist, and personalized Home feed
- **Reliable Audio Streaming**:
  - Uses local `yt-dlp` (`host.spawn`) as the primary stream resolver (inherits YesPlayMusic's system proxy, supports `--cookies-from-browser` for bot-check bypass and Premium 256kbps audio)
  - Automatic fallback to verified InnerTube direct streams when `yt-dlp` is not configured

## Installation

1. Open **YesPlayMusic 3.0+ → Settings → Plugins → Install Plugin**.
2. Paste the repository link:
   ```text
   NZJ-Jimmy/ypm-plugin-ytmusic
   ```
   Or choose **Install from local folder…** and select this repository folder.
3. Switch your **Music Source** to **YouTube Music**.

## Recommended Playback Setup (`yt-dlp`)

YouTube enforces JS challenge / PO token checks on raw audio streams, so installing `yt-dlp` is strongly recommended for smooth playback:

1. Install [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and ensure `yt-dlp` is in your system `PATH` (e.g. `winget install yt-dlp.yt-dlp`, `brew install yt-dlp`, or `pip install -U "yt-dlp[default]"`).
2. In YesPlayMusic **Settings → Plugins**, open the `⋯` menu on the **YouTube Music** card and enable **"Allow running local programs"**.
3. *(Optional)* If you encounter YouTube bot checks or want YouTube Music Premium 256kbps audio, select your browser under **yt-dlp Browser Cookies** in plugin settings.

## Optional Account Sign-In & How to Get Cookies

> Searching, browsing, lyrics, radio, and playback work without signing in. Signing in unlocks Liked Music, Saved Albums, Playlist CRUD, and personalized Home recommendations.

- **macOS**: Click **Sign In** on the YouTube Music source to sign in via the built-in browser window.
- **Windows / Linux (Step-by-step Cookie Guide)**:
  1. Open [https://music.youtube.com](https://music.youtube.com/) in Chrome / Edge / Firefox and sign in to your Google account.
  2. Press `F12` to open DevTools, switch to the **Network** tab, and filter by **Fetch/XHR**.
  3. Click **Home** or **Explore** on the page (or type `browse` in the filter box), then click any `browse?prettyPrint=false` POST request.
  4. Open the **Headers** tab → scroll down to **Request Headers** → find the **`cookie`** header.
  5. Right-click its value and choose **Copy value** (make sure it does not include the `cookie:` prefix, and contains `SAPISID=` or `__Secure-3PAPISID=`).
  6. In YesPlayMusic, open **Settings → Plugins → YouTube Music → Settings**, paste it into **Cookie**, save, and click **Test Connection** — seeing `Signed in as: <your name>` confirms it works.

> Note: Keep your Cookie private and never share it publicly. If it expires later, simply repeat the steps above.

## Development & Testing

```bash
# Run manifest, QuickJS compatibility & unit tests
npm test

# Run live integration test against music.youtube.com
npm run test:live
```

## Disclaimer

- This project is an **unofficial**, independent third-party plugin and is **not affiliated with, endorsed by, sponsored by, or connected to YouTube, YouTube Music, Google LLC, LRCLIB, KuGou, or YesPlayMusic**.
- All product names, logos, and trademarks are the property of their respective owners.
- This plugin does not host, store, or distribute any copyrighted audio or lyrics; it is intended for personal and educational use only. Please comply with applicable laws and the terms of service of the respective platforms.

## License

MIT
