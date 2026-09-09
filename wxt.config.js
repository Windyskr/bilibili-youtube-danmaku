import { defineConfig } from 'wxt';

const permissions = ['storage', 'activeTab', 'unlimitedStorage'];
const hostPermissions = [
    'https://api.bilibili.com/*',
    'https://www.bilibili.com/*',
    'https://www.youtube.com/oembed*',
    'https://raw.githubusercontent.com/*',
    'https://pan.quark.cn/*'
];

function replaceRequired(code, search, replacement, label) {
    if (!code.includes(search)) {
        throw new Error(`[danmu_api integration] 无法注入 ${label}：上游代码结构可能已变化`);
    }
    return code.replace(search, replacement);
}

function createDanmuApiIntegrationPlugin() {
    return {
        name: 'b2y-danmu-api-integration',
        enforce: 'pre',
        transform(code, id) {
            const cleanId = id.split('?')[0].replace(/\\/g, '/');
            code = code.replace(/\r\n/g, '\n');

            if (cleanId.endsWith('/entrypoints/popup/popup.js')) {
                if (code.includes("./danmu-api-settings.js")) return null;
                return { code: `import './danmu-api-settings.js';\n${code}`, map: null };
            }

            if (!cleanId.endsWith('/entrypoints/background/index.js')) return null;

            let transformed = code;
            if (!transformed.includes("./danmu-api-router.js")) {
                transformed = `import { downloadDanmuApi, isDanmuApiEnabled, searchDanmuApi, shouldFallbackToBilibili } from './danmu-api-router.js';\n${transformed}`;
            }

            transformed = replaceRequired(
                transformed,
                `    async function downloadAllDanmaku(bvid, youtubeVideoDuration) {\n        try {`,
                `    async function downloadAllDanmaku(bvid, youtubeVideoDuration) {\n        if (await isDanmuApiEnabled()) {\n            try {\n                return await downloadDanmuApi(bvid, youtubeVideoDuration);\n            } catch (error) {\n                console.error('[danmu_api] 下载失败:', error);\n                if (\n                    String(bvid || '').startsWith('DMAPI_') ||\n                    !(await shouldFallbackToBilibili())\n                ) {\n                    throw error;\n                }\n                console.warn('[danmu_api] 回退到原生 Bilibili 弹幕下载');\n            }\n        }\n\n        try {`,
                'downloadAllDanmaku'
            );

            transformed = replaceRequired(
                transformed,
                `    async function searchBilibiliVideoAllV2(keyword, options = {}) {\n        try {`,
                `    async function searchBilibiliVideoAllV2(keyword, options = {}) {\n        try {\n            if (await isDanmuApiEnabled()) {\n                const danmuApiResult = await searchDanmuApi(keyword);\n                if (danmuApiResult.success) return danmuApiResult;\n                if (!(await shouldFallbackToBilibili())) return danmuApiResult;\n                console.warn('[danmu_api] 搜索失败，回退到原生 Bilibili 搜索:', danmuApiResult.error);\n            }`,
                'searchBilibiliVideoAllV2'
            );

            const storageBlock = `                            bvid: request.bvid,\n                            bilibili_url: \`https://www.bilibili.com/video/\${request.bvid}\`,`;
            const storageReplacement = `                            bvid: data.bvid || request.bvid,\n                            bilibili_url:\n                                data.sourceUrl ||\n                                \`https://www.bilibili.com/video/\${data.bvid || request.bvid}\`,`;
            if (!transformed.includes(storageBlock)) {
                throw new Error('[danmu_api integration] 无法注入弹幕来源 URL：上游代码结构可能已变化');
            }
            transformed = transformed.replaceAll(storageBlock, storageReplacement);
            transformed = transformed.replaceAll(
                `                            matchSource: matchInfo.source || 'manual',`,
                `                            matchSource: data.sourceType || matchInfo.source || 'manual',`
            );
            transformed = transformed.replaceAll(
                `                            matchSource: matchInfo.source || 'search',`,
                `                            matchSource: data.sourceType || matchInfo.source || 'search',`
            );

            const bangumiBlock = `                            bilibili_url: \`https://www.bilibili.com/video/\${bvid}\`,`;
            transformed = transformed.replaceAll(
                bangumiBlock,
                `                            bilibili_url:\n                                data.sourceUrl || \`https://www.bilibili.com/video/\${bvid}\`,`
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
