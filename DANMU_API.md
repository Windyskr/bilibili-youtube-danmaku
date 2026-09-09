# danmu_api 接入说明

本 fork 支持在原生 Bilibili 弹幕与自建 `danmu_api` 之间切换，并在 `danmu_api` 模式下使用多平台匹配能力。

## 使用方式

1. 打开扩展 Popup，点击右下角 **弹幕源**。
2. 选择 **danmu_api（全平台）**。
3. 填写 API 根地址，例如 `https://danmu.example.com`，或带 TOKEN 路径的 `http://192.168.1.10:9321/87654321`。
4. 点击 **测试连接**，允许浏览器访问该 API Origin。
5. 保存。

如果 `danmu_api` 配置了路径 TOKEN，请直接把 TOKEN 放进根地址；扩展会在其后拼接 `/api/v2/...`。

## 匹配与弹幕流程

优先流程：

```text
YouTube / Quark 标题
    -> POST /api/v2/match
    -> episodeId
    -> GET /api/v2/comment/:episodeId?format=json&duration=true
    -> B2Y DanmakuEngine
```

`/match` 没有结果时，会继续尝试：

```text
GET /api/v2/search/anime
    -> GET /api/v2/bangumi/:animeId
    -> 候选剧集
```

开启 **API 失败时回退原生 B 站** 后，danmu_api 的搜索失败可以回到 B2Y 原有 Bilibili 搜索；手动输入真实 BV 链接时，danmu_api 获取失败也可以回到原生 B 站下载。由 danmu_api 匹配产生的内部 token 不是 BV 号，因此其弹幕下载失败时不会错误回退给 B 站接口。

## 权限

扩展不会默认获得所有站点的访问权。Manifest 仅把 `http://*/*` 和 `https://*/*` 声明为可选主机权限：MV3 使用 `optional_host_permissions`，MV2 使用 `optional_permissions`。测试或保存 API 地址时，只向浏览器申请你填写的具体 Origin。

## 上游兼容方式

为降低未来同步上游时的冲突，本 fork 不直接大改巨大的 `entrypoints/background/index.js` 与 `entrypoints/popup/popup.js`。`wxt.config.js` 中的 Vite 插件会在构建时注入 danmu_api 路由和设置 UI。

如果上游未来重构了关键函数，构建会明确报出 `[danmu_api integration]` 错误，而不是静默生成一个实际没有接入成功的扩展。
