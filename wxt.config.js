import { defineConfig } from 'wxt';

const permissions = ['storage', 'activeTab', 'unlimitedStorage'];
const hostPermissions = [
    'https://api.bilibili.com/*',
    'https://www.bilibili.com/*',
    'https://www.youtube.com/oembed*',
    'https://raw.githubusercontent.com/*',
    'https://pan.quark.cn/*'
];

function replaceRegexRequired(code, pattern, replacement, label) {
    const matches = code.match(pattern);
    if (!matches?.length) {
        const index = code.indexOf(label);
        const snippet = (index >= 0 ? code.slice(Math.max(0, index - 160), index + 320) : code.slice(0, 480))
            .replace(/\s+/g, ' ')
            .slice(0, 480);
        throw new Error(
            `[danmu_api integration] 无法注入 ${label}：index=${index}; snippet=${snippet}`
        );
    }
    return code.replace(pattern, replacement);
}

function createDanmuApiIntegrationPlugin() {
    return {
        name: 'b2y-danmu-api-integration',
        enforce: 'pre',
        transform(code, id) {
            const cleanId = id.split('?')[0].replace(/\\/g, '/');

            if (cleanId.endsWith('/entrypoints/popup/popup.js')) {
                if (code.includes("./danmu-api-settings.js")) return null;
                return { code: `import './danmu-api-settings.js';\n${code}`, map: null };
            }

            if (!cleanId.endsWith('/entrypoints/background/index.js')) return null;

            let transformed = code;
            if (!transformed.includes("./danmu-api-router.js")) {
                transformed = `import { downloadDanmuApi, isDanmuApiEnabled, searchDanmuApi, shouldFallbackToBilibili } from './danmu-api-router.js';\n${transformed}`;
            }

            transformed = replaceRegexRequired(
                transformed,
                /async\s+function\s+downloadAllDanmaku\s*\(\s*bvid\s*,\s*youtubeVideoDuration\s*\)\s*\{\s*try\s*\{/,
                `async function downloadAllDanmaku(bvid, youtubeVideoDuration) {\n        if (await isDanmuApiEnabled()) {\n            try {\n                return await downloadDanmuApi(bvid, youtubeVideoDuration);\n            } catch (error) {\n                console.error('[danmu_api] 下载失败:', error);\n                if (\n                    String(bvid || '').startsWith('DMAPI_') ||\n                    !(await shouldFallbackToBilibili())\n                ) {\n                    throw error;\n                }\n                console.warn('[danmu_api] 回退到原生 Bilibili 弹幕下载');\n            }\n        }\n\n        try {`,
                'downloadAllDanmaku'
            );

            transformed = replaceRegexRequired(
                transformed,
                /async\s+function\s+searchBilibiliVideoAllV2\s*\(\s*keyword\s*,\s*options\s*=\s*\{\s*\}\s*\)\s*\{\s*try\s*\{/,
                `async function searchBilibiliVideoAllV2(keyword, options = {}) {\n        try {\n            if (await isDanmuApiEnabled()) {\n                const danmuApiResult = await searchDanmuApi(keyword);\n                if (danmuApiResult.success) return danmuApiResult;\n                if (!(await shouldFallbackToBilibili())) return danmuApiResult;\n                console.warn('[danmu_api] 搜索失败，回退到原生 Bilibili 搜索:', danmuApiResult.error);\n            }`,
                'searchBilibiliVideoAllV2'
            );

            transformed = replaceRegexRequired(
                transformed,
                /bvid:\s*request\.bvid,\s*bilibili_url:\s*`https:\/\/www\.bilibili\.com\/video\/\$\{request\.bvid\}`,/g,
                `bvid: data.bvid || request.bvid,\n                            bilibili_url:\n                                data.sourceUrl ||\n                                \`https://www.bilibili.com/video/\${data.bvid || request.bvid}\`,` ,
                'download result source URL'
            );

            transformed = transformed.replace(
                /matchSource:\s*matchInfo\.source\s*\|\|\s*'manual',/g,
                `matchSource: data.sourceType || matchInfo.source || 'manual',`
            );
            transformed = transformed.replace(
                /matchSource:\s*matchInfo\.source\s*\|\|\s*'search',/g,
                `matchSource: data.sourceType || matchInfo.source || 'search',`
            );
            transformed = transformed.replace(
                /bilibili_url:\s*`https:\/\/www\.bilibili\.com\/video\/\$\{bvid\}`,/g,
                `bilibili_url:\n                                data.sourceUrl || \`https://www.bilibili.com/video/\${bvid}\`,`
            );

            return { code: transformed, map: null };
        }
    };
}

export default defineConfig({
    vite: () => ({ plugins: [createDanmuApiIntegrationPlugin()] }),
    manifest: ({ browser, manifestVersion }) => ({
        permissions,
        host_permissions: hostPermissions,
        ...(manifestVersion === 2
            ? { optional_permissions: ['http://*/*', 'https://*/*'] }
            : { optional_host_permissions: ['http://*/*', 'https://*/*'] }),
        ...(browser === 'firefox'
            ? {
                  browser_specific_settings: {
                      gecko: {
                          data_collection_permissions: {
                              required: ['browsingActivity', 'searchTerms', 'websiteContent']
                          }
                      }
                  }
              }
            : {})
    })
});
