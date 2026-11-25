# YouTube Music Plugin for YesPlayMusic

[中文文档](./README.zh-CN.md)

A **YouTube Music** source plugin for [YesPlayMusic 3.0+](https://github.com/qier222/YesPlayMusic), running natively in YesPlayMusic's QuickJS-ng plugin runtime with zero build steps.

## Features

- **No Login Required to Listen & Search**:
  - Search songs, albums, artists, and community playlists (with pagination & search suggestions)
  - Home recommendations, Explore (new releases, moods & genres), and Charts
  - Full Album, Artist (top songs, albums, singles/EPs, related artists), and Playlist pages
  - Lyrics (synced timed lyrics when available, plus plain lyrics)
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

## Optional Account Sign-In

- **macOS**: Click **Sign In** on the YouTube Music source to sign in through the built-in browser window.
- **Windows / Linux**:
  1. Open [music.youtube.com](https://music.youtube.com/) in your browser and sign in.
  2. Open DevTools → Network → select any `youtubei/v1/` request → copy the `Cookie` request header.
  3. Paste it into **Settings → Plugins → YouTube Music → Settings → Cookie** and click **Test Connection**.

## Development & Testing

```bash
# Run manifest, QuickJS compatibility & unit tests
npm test

# Run live integration test against music.youtube.com
npm run test:live
```

## License

MIT
