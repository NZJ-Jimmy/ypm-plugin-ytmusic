// YouTube Music source plugin for YesPlayMusic 3.0+
// Entry module: explicitly exports all plugin capabilities for static export scanning.

export { account, signIn, signOut, testConnection } from "./src/auth.js";

export {
  home,
  browse,
  search,
  suggest,
  hotSearches,
  album,
  artist,
  playlist,
  lyrics,
  similar,
  station,
} from "./src/browse.js";

export {
  liked,
  isLiked,
  like,
  savedAlbums,
  saveAlbum,
  followArtist,
  recent,
  playlists,
  savePlaylist,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  addToPlaylist,
  removeFromPlaylist,
  profile,
  trackMenu,
  menuAction,
} from "./src/library.js";

export { stream } from "./src/stream.js";
