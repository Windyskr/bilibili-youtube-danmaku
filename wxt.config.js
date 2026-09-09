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
    if (!pattern.test(code)) {
        throw new Error(`[danmu_api integration] 无法注入 ${label}：上游代码结构可能已变化`);
    }
    pattern.lastIndex = 0;
    return code.replace(pattern, replacement);
}

function createDanmuApiIntegrationPlugin() {
    return {
        name: 'b2y-danmu-api-integration',
        enforce: 'pre',
        transform(code, id) {
            const cleanId = id.split('?')[0].replace(/\\/g, '/');

            if (cleanId.endsWith('/entrypoints/popup/popup.js')) {
                // `wxt prepare` may expose only an entrypoint stub. Inject only into the real source.
                if (!code.includes('channelAssociation') || !code.includes('getCurrentTab')) return null;

                let transformed = code;
                if (!transformed.includes("./danmu-api-settings.js")) {
                    transformed = `import './danmu-api-settings.js';

async function getDanmuApiSearchStatusText() {
    const data = await browser.storage.local.get('danmuApiSettings');
    const settings = data.danmuApiSettings || {};
    const enabled = settings.mode === 'danmuApi' && Boolean(settings.baseUrl);
    if (!enabled) return '正在搜索B站视频...';
    return settings.fallbackToBilibili !== false
        ? '正在通过 danmu_api 匹配剧集（未命中时将回退 B 站）...'
        : '正在通过 danmu_api 匹配剧集...';
}

function getDanmuApiResultStatusText(searchResponse, count) {
    if (searchResponse?.danmuApiFallback) {
        return 'danmu_api 未匹配，已回退 B 站，找到 ' + count + ' 个相关视频';
    }
    if (searchResponse?.danmuApi) {
        return 'danmu_api 找到 ' + count + ' 个剧集候选';
    }
    return '找到 ' + count + ' 个相关视频';
}

${transformed}`;
                }

                transformed = replaceRegexRequired(
                    transformed,
                    /if \(!silent\) showStatus\('正在搜索B站视频\.\.\.', 'loading'\);(?=\s*const searchResponse = await browser\.runtime\.sendMessage\(\{\s*type:\s*'searchBilibiliVideoAllV2')/g,
                    "if (!silent) showStatus(await getDanmuApiSearchStatusText(), 'loading');",
                    'Popup danmu_api search status'
                );

                transformed = replaceRegexRequired(
                    transformed,
                    /if \(!silent\) showStatus\(`找到 \$\{results\.length\} 个相关视频`, 'info'\);/g,
                    "if (!silent) showStatus(getDanmuApiResultStatusText(searchResponse, results.length), 'info');",
                    'Popup danmu_api result status'
                );

                return { code: transformed, map: null };
            }

            if (!cleanId.endsWith('/entrypoints/background/index.js')) return null;

            // During `wxt prepare`, WXT replaces the actual background body with
            // `export default defineBackground();`. It is not a build failure: the real
            // source is presented during `wxt build`, where we perform the integration.
            if (!code.includes('downloadAllDanmaku') || !code.includes('searchBilibiliVideoAllV2')) {
                return null;
            }

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
                `async function searchBilibiliVideoAllV2(keyword, options = {}) {\n        try {\n            if (!options.__skipDanmuApi && (await isDanmuApiEnabled())) {\n                const danmuApiResult = await searchDanmuApi(keyword);\n                if (danmuApiResult.success) return danmuApiResult;\n                if (!(await shouldFallbackToBilibili())) return danmuApiResult;\n\n                console.warn(\n                    '[danmu_api] 未匹配，使用 Bilibili 搜索兜底:',\n                    danmuApiResult.error\n                );\n                const fallbackResult = await searchBilibiliVideoAllV2(keyword, {\n                    ...options,\n                    __skipDanmuApi: true\n                });\n\n                if (!fallbackResult?.success) return fallbackResult;\n                return {\n                    ...fallbackResult,\n                    danmuApiFallback: true,\n                    danmuApiError: danmuApiResult.error,\n                    results: (fallbackResult.results || []).map((item) => ({\n                        ...item,\n                        danmuApiFallback: true,\n                        danmuApiFallbackReason: danmuApiResult.error,\n                        author: item.author\n                            ? \`B站搜索回退 · \${item.author}\`\n                            : 'B站搜索回退'\n                    }))\n                };\n            }`,
                'searchBilibiliVideoAllV2'
            );

            transformed = replaceRegexRequired(
                transformed,
                /return\s+searchBilibiliVideoAllV2\(fallbackKeyword,\s*\{\s*skipBracketFallback:\s*true,\s*matchKeyword:\s*matchKeyword\s*\}\);/,
                `return searchBilibiliVideoAllV2(fallbackKeyword, {\n                        skipBracketFallback: true,\n                        matchKeyword: matchKeyword,\n                        __skipDanmuApi: options.__skipDanmuApi\n                    });`,
                'Bilibili bracket fallback'
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
