# danmu_api 接入说明

本 fork 支持在原生 Bilibili 弹幕与自建 `danmu_api` 之间切换，并在 `danmu_api` 模式下使用多平台剧集匹配与弹幕获取能力。

## 使用方式

1. 打开扩展 Popup，点击右下角 **弹幕源**。
2. 选择 **danmu_api（剧集 / 多平台弹幕）**。
3. 填写 API 根地址，例如 `https://danmu.example.com`，或带 TOKEN 路径的 `http://192.168.1.10:9321/87654321`。
4. 点击 **测试连接**，允许浏览器访问该 API Origin。
5. 保存。

如果 `danmu_api` 配置了路径 TOKEN，请直接把 TOKEN 放进根地址；扩展会在其后拼接 `/api/v2/...`。

## 重要：danmu_api 不是“全平台视频全文搜索”

`danmu_api` 的 `/match`、`/search/anime`、`/search/episodes` 都以剧名、季、集为中心。它擅长处理：

```text
赴山海 S01E28
生万物 第12集
Blood.River.S01E05
```

但类似普通 YouTube 剪辑标题、明星片段、花絮、采访标题，并不能像 Bilibili 的全站视频搜索一样直接在爱优腾等平台做全文检索。

因此本 fork 会：

- 先清理 `[ENG SUB]`、`FULL`、`1080P`、`预告`、`花絮` 等常见标题噪声；
- 尝试多个标题变体调用 `/api/v2/match`；
- 未命中时使用 `/api/v2/search/episodes` 做单请求剧集搜索；
- 仅在新接口不可用时兼容旧的 `/search/anime -> /bangumi` 两段式流程；
- 如果开启 **未匹配/请求失败时用 B 站搜索兜底**，则回到 B2Y 原有 Bilibili 搜索，并在结果中明确标记 `B站搜索回退`。

## 匹配与弹幕流程

优先流程：

```text
YouTube / Quark 标题
    -> 标题清理与候选生成
    -> POST /api/v2/match
    -> episodeId
    -> GET /api/v2/comment/:episodeId?format=json&duration=true
    -> B2Y DanmakuEngine
```

`/match` 没有结果时，会继续尝试：

```text
GET /api/v2/search/episodes?anime=...&episode=...
    -> 候选剧集
```

相比旧的：

```text
GET /api/v2/search/anime
    -> GET /api/v2/bangumi/:animeId
```

新的 `/search/episodes` 能在同一次请求里完成搜索和剧集解析，对 Vercel、Cloudflare、EdgeOne 等可能跨请求丢内存缓存的部署更稳定。旧两段式接口仍作为兼容兜底。

## B 站搜索兜底

开启 **未匹配/请求失败时用 B 站搜索兜底** 后：

- danmu_api 无法匹配普通剪辑标题时，会使用 Bilibili 搜索；
- 搜索结果会显示 `B站搜索回退 · UP主名`，不再伪装成 danmu_api 多平台结果；
- 选中真实 BV 后，仍会优先通过 danmu_api 的 `/comment?url=...` 获取弹幕；
- 如果 danmu_api 返回错误或 0 条弹幕，再按设置回退到 B2Y 原生 Bilibili 弹幕下载。

由 danmu_api 匹配产生的 `DMAPI_...` 内部 token 不是 BV 号，因此其弹幕下载失败时不会错误回退给 B 站接口。

## 权限

扩展不会默认获得所有站点的访问权。Manifest 仅把 `http://*/*` 和 `https://*/*` 声明为可选主机权限：MV3 使用 `optional_host_permissions`，MV2 使用 `optional_permissions`。测试或保存 API 地址时，只向浏览器申请你填写的具体 Origin。

## 上游兼容方式

为降低未来同步上游时的冲突，本 fork 不直接大改巨大的 `entrypoints/background/index.js` 与 `entrypoints/popup/popup.js`。`wxt.config.js` 中的 Vite 插件会在构建时注入 danmu_api 路由和设置 UI。

如果上游未来重构了关键函数，构建会明确报出 `[danmu_api integration]` 错误，而不是静默生成一个实际没有接入成功的扩展。
