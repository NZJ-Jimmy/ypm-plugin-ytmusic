// Mock YesPlayMusic QuickJS-ng host global for Node.js tests.

export function createMockHost({
  platform = "windows",
  language = "zh-CN",
  settings = {},
  spawnImpl = null,
  webSignInImpl = null,
} = {}) {
  const storage = new Map();
  const files = new Map();
  const settingMap = { ...settings };

  return {
    platform,
    arch: "amd64",
    dir: "e:/repos/ypm-plugin-ytmusic",
    dataDir: "C:/Users/test/AppData/Roaming/YesPlayMusic/plugin-data/ytmusic",
    pid: 12345,
    storage: {
      get: (k) => (storage.has(k) ? structuredClone(storage.get(k)) : null),
      set: (k, v) => storage.set(k, structuredClone(v)),
      remove: (k) => storage.delete(k),
    },
    files: {
      write: (name, data) => {
        files.set(name, data);
        return `file:///mock/files/${name}`;
      },
      read: (name) => files.get(name) ?? null,
      readText: (name) => (typeof files.get(name) === "string" ? files.get(name) : null),
      url: (name) => (files.has(name) ? `file:///mock/files/${name}` : null),
      remove: (name) => files.delete(name),
    },
    language: () => language,
    t: (text) => text,
    setting: (key) => String(settingMap[key] ?? ""),
    _setSetting: (key, val) => {
      settingMap[key] = val;
    },
    _files: files,
    openURL: () => {},
    crypto: {
      md5: () => "00000000000000000000000000000000",
      aesEcbEncrypt: () => "",
    },
    signInPrompt: () => {},
    webSignIn: async (opts) => {
      if (webSignInImpl) return webSignInImpl(opts);
      throw new Error("webSignIn is not supported on this platform");
    },
    spawn: (cmd, args) => {
      if (spawnImpl) return spawnImpl(cmd, args);
      throw new Error("Running local programs is not permitted");
    },
  };
}
