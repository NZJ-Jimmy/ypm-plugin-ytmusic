# YesPlayMusic YouTube Music 插件

[English README](./README.md)

适用于 [YesPlayMusic 3.0+](https://github.com/qier222/YesPlayMusic) 的 **YouTube Music** 音源插件。纯原生 ESM 零构建设计，直接运行在 YesPlayMusic 内置的 QuickJS-ng 引擎中。

## 功能特性

- **免登录即搜即听**：
  - 搜索歌曲、专辑、音乐人与社区歌单（支持分页加载与搜索联想、热搜词）
  - 首页推荐、探索页（新专辑与单曲、心情与流派、时下流行）与全球排行榜
  - 完整专辑页、歌手页（热门歌曲、专辑/单曲、相似歌手）与歌单页
  - 歌词显示（支持时间戳歌词与纯文本歌词）
  - 相似歌曲推荐、首页「随心电台」、歌曲右键「开启相似电台」与「复制链接」
- **可选账号登录同步**：
  - macOS 支持弹窗直接登录；Windows / Linux 支持在插件设置中粘贴 Cookie 登录
  - 同步「我喜欢的音乐」、收藏专辑、最近播放、个人歌单管理（新建 / 重命名 / 删除 / 增删歌曲）、喜欢/取消喜欢与关注歌手
- **稳定音频流解析**：
  - 默认优先调用本机 `yt-dlp` 解析音频流（自动继承 YesPlayMusic 系统代理，支持 `--cookies-from-browser` 绕过 Bot 校验与解锁 Premium 256kbps 音质）
  - 未启用 `yt-dlp` 时自动尝试 InnerTube 直连回退

## 安装方法

1. 打开 **YesPlayMusic 3.0+ → 设置 → 插件 → 安装插件**。
2. 粘贴 GitHub 仓库地址：
   ```text
   NZJ-Jimmy/ypm-plugin-ytmusic
   ```
   或者点击 **「从本地文件夹安装…」** 选择本项目目录。
3. 在「音乐来源」中切换到 **YouTube Music** 即可使用。

## 推荐播放配置（安装 `yt-dlp`）

由于 YouTube 当前对原始音频流实施严格的 JS 挑战与 PO Token 校验，强烈建议配置 `yt-dlp` 以获得稳定无 403 中断的播放体验：

1. 安装 [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) 并确保在系统 `PATH` 中可执行：
   - Windows: `winget install yt-dlp.yt-dlp`
   - macOS: `brew install yt-dlp`
   - 通用 Python: `pip install -U "yt-dlp[default]"`
2. 在 YesPlayMusic **设置 → 插件** 中，点击 **YouTube Music** 卡片右上角 `⋯` 菜单，勾选 **「允许运行本机程序」**。
3. *（可选）* 如遇 YouTube Bot 校验或需要解锁 Premium 高音质，可在插件设置的 **「yt-dlp 浏览器 Cookie」** 中选择已登录 YouTube 的浏览器。

## 可选账号登录

- **macOS**：直接点击登录按钮，在应用内置浏览器窗口登录 Google 账号即可。
- **Windows / Linux**：
  1. 在浏览器打开 [music.youtube.com](https://music.youtube.com/) 并登录账号。
  2. 打开开发者工具（F12）→ Network → 找到任意 `youtubei/v1/` 请求 → 复制请求头中的 `Cookie` 完整值。
  3. 粘贴到 **设置 → 插件 → YouTube Music → 设置 → Cookie** 中，点击「测试连接」验证。

## 开发与测试

```bash
# 运行清单规范、QuickJS 兼容性与单元测试
npm test

# 运行真实 YouTube Music 接口联调测试
npm run test:live
```

## 开源协议

MIT
