const SETTINGS_KEY = 'danmuApiSettings';
const MATCH_CACHE_KEY = 'danmuApiMatchCache';
const MATCH_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const MATCH_CACHE_MAX = 200;

const DEFAULT_SETTINGS = {
    mode: 'bilibili',
    baseUrl: '',
    fallbackToBilibili: true,
    timeoutMs: 15000
};

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeSettings(raw = {}) {
    const timeoutMs = Number(raw.timeoutMs);
    return {
        ...DEFAULT_SETTINGS,
        ...raw,
        baseUrl: normalizeBaseUrl(raw.baseUrl),
        timeoutMs:
            Number.isFinite(timeoutMs) && timeoutMs >= 3000 && timeoutMs <= 60000
                ? timeoutMs
                : DEFAULT_SETTINGS.timeoutMs
    };
}

export async function getDanmuApiSettings() {
    const data = await browser.storage.local.get(SETTINGS_KEY);
    return normalizeSettings(data[SETTINGS_KEY]);
}

export async function isDanmuApiEnabled() {
    const settings = await getDanmuApiSettings();
    return settings.mode === 'danmuApi' && !!settings.baseUrl;
}

export async function shouldFallbackToBilibili() {
    const settings = await getDanmuApiSettings();
    return settings.fallbackToBilibili !== false;
}

function apiUrl(baseUrl, path) {
    const base = normalizeBaseUrl(baseUrl);
    if (!/^https?:\/\//i.test(base)) {
        throw new Error('danmu_api 地址必须以 http:// 或 https:// 开头');
    }
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function requestJson(path, options = {}, settings = null) {
    const current = settings || (await getDanmuApiSettings());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), current.timeoutMs);

    try {
        const response = await fetch(apiUrl(current.baseUrl, path), {
            ...options,
            cache: 'no-store',
            signal: controller.signal
        });
        if (!response.ok) {
            let detail = '';
            try {
                detail = (await response.text()).trim().slice(0, 240);
            } catch (_) {
                // ignore response body failures
            }
            throw new Error(`danmu_api HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
        }
        return await response.json();
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error(`danmu_api 请求超时（${current.timeoutMs}ms）`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function episodeNumberFromTitle(value) {
    const text = String(value || '');
    const patterns = [
        /S\d{1,2}E(\d{1,4})/i,
        /(?:^|[\s._-])E(\d{1,4})(?:$|[\s._-])/i,
        /第\s*(\d{1,4})\s*[集话期]/,
        /(?:EP|Episode)\s*[._ -]?(\d{1,4})/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return Number(match[1]) || null;
    }
    return null;
}

function sourceLabel(url, fallback = '') {
    const value = String(url || '').toLowerCase();
    if (value.includes('bilibili.com') || value.includes('b23.tv')) return 'Bilibili';
    if (value.includes('v.qq.com')) return '腾讯视频';
    if (value.includes('iqiyi.com')) return '爱奇艺';
    if (value.includes('youku.com')) return '优酷';
    if (value.includes('mgtv.com')) return '芒果TV';
    if (value.includes('miguvideo.com')) return '咪咕视频';
    if (value.includes('sohu.com')) return '搜狐视频';
    if (value.includes('le.com')) return '乐视视频';
    if (value.includes('ixigua.com') || value.includes('douyin.com')) return '西瓜视频';
    return fallback || 'danmu_api';
}

function displayTitle(candidate) {
    const anime = String(candidate?.animeTitle || '').trim();
    const episode = String(candidate?.episodeTitle || '').trim();
    if (!anime) return episode || 'danmu_api 匹配结果';
    if (!episode || anime === episode || anime.includes(episode)) return anime;
    return `${anime} - ${episode}`;
}

function safeTokenPart(value, fallback = '0') {
    return String(value ?? '')
        .trim()
        .replace(/[^a-zA-Z0-9-]/g, '') || fallback;
}

function createToken(episodeId, animeId) {
    return `DMAPI_${safeTokenPart(episodeId)}_${safeTokenPart(animeId)}`;
}

function episodeIdFromToken(token) {
    return String(token || '').match(/^DMAPI_([^_]+)_/)?.[1] || null;
}

async function readMatchCache() {
    const data = await browser.storage.local.get(MATCH_CACHE_KEY);
    return data[MATCH_CACHE_KEY] && typeof data[MATCH_CACHE_KEY] === 'object'
        ? data[MATCH_CACHE_KEY]
        : {};
}

async function saveMappings(mappings) {
    if (!mappings.length) return;
    const now = Date.now();
    const cache = await readMatchCache();

    for (const [key, value] of Object.entries(cache)) {
        if (!value?.timestamp || now - value.timestamp > MATCH_CACHE_TTL) delete cache[key];
    }
    for (const mapping of mappings) {
        cache[mapping.token] = { ...mapping, timestamp: now };
    }

    const limited = Object.fromEntries(
        Object.entries(cache)
            .sort((a, b) => (b[1]?.timestamp || 0) - (a[1]?.timestamp || 0))
            .slice(0, MATCH_CACHE_MAX)
    );
    await browser.storage.local.set({ [MATCH_CACHE_KEY]: limited });
}

function adaptCandidate(candidate, confidence = 1) {
    const episodeId = candidate?.episodeId ?? candidate?.id;
    if (episodeId === undefined || episodeId === null || episodeId === '') return null;

    const animeId = candidate?.animeId ?? 0;
    const token = createToken(episodeId, animeId);
    const sourceUrl = String(candidate?.url || '').trim();
    const label = sourceLabel(
        sourceUrl,
        candidate?.typeDescription || candidate?.type || candidate?.source || ''
    );
    const title = displayTitle(candidate);
    const pic = candidate?.imageUrl || '';
    const author = `danmu_api · ${label}`;

    return {
        result: {
            bvid: token,
            title,
            author,
            mid: 0,
            pic,
            play: 0,
            danmaku: 0,
            duration: '',
            pubdate: '',
            highlightRatio: confidence,
            danmuApi: true
        },
        mapping: {
            token,
            episodeId: String(episodeId),
            animeId: String(animeId || ''),
            title,
            pic,
            author,
            sourceUrl,
            sourceLabel: label
        }
    };
}

function chooseEpisodes(episodes, episodeNumber) {
    if (!episodes.length) return [];
    if (!episodeNumber) return episodes.slice(0, 5);

    const exact = episodes.find((episode) => {
        if (Number.parseInt(episode?.episodeNumber, 10) === episodeNumber) return true;
        const title = String(episode?.episodeTitle || '');
        const match = title.match(/(?:第\s*)?(\d{1,4})(?:\s*[集话期])?/);
        return match ? Number(match[1]) === episodeNumber : false;
    });
    if (exact) return [exact];
    return episodes[episodeNumber - 1] ? [episodes[episodeNumber - 1]] : [];
}

async function searchByAnime(keyword, settings) {
    const search = await requestJson(
        `/api/v2/search/anime?keyword=${encodeURIComponent(keyword)}`,
        {},
        settings
    );
    const animes = Array.isArray(search?.animes) ? search.animes.slice(0, 5) : [];
    const episodeNumber = episodeNumberFromTitle(keyword);
    const candidates = [];

    for (const anime of animes) {
        if (candidates.length >= 15) break;
        if (anime?.animeId === undefined || anime?.animeId === null) continue;
        try {
            const detail = await requestJson(
                `/api/v2/bangumi/${encodeURIComponent(anime.animeId)}`,
                {},
                settings
            );
            const bangumi = detail?.bangumi || {};
            const episodes = Array.isArray(bangumi.episodes) ? bangumi.episodes : [];
            for (const episode of chooseEpisodes(episodes, episodeNumber)) {
                candidates.push({
                    episodeId: episode.episodeId,
                    animeId: anime.animeId,
                    animeTitle: bangumi.animeTitle || anime.animeTitle,
                    episodeTitle: episode.episodeTitle || episode.episodeNumber || '',
                    url: episode.url || '',
                    imageUrl: bangumi.imageUrl || anime.imageUrl || '',
                    type: bangumi.type || anime.type || '',
                    typeDescription: bangumi.typeDescription || anime.typeDescription || ''
                });
                if (candidates.length >= 15) break;
            }
        } catch (error) {
            console.warn('[danmu_api] 获取候选详情失败:', anime?.animeTitle, error);
        }
    }
    return candidates;
}

export async function searchDanmuApi(keyword) {
    const query = String(keyword || '').trim();
    if (!query) return { success: false, error: '搜索关键词为空', danmuApi: true };

    const settings = await getDanmuApiSettings();
    if (settings.mode !== 'danmuApi' || !settings.baseUrl) {
        return { success: false, error: 'danmu_api 未启用', danmuApi: true };
    }

    let candidates = [];
    let matchError = null;
    let confidence = 1;

    try {
        const matched = await requestJson(
            '/api/v2/match',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileName: query })
            },
            settings
        );
        if (matched?.isMatched && Array.isArray(matched.matches)) {
            candidates = matched.matches;
        }
    } catch (error) {
        matchError = error;
        console.warn('[danmu_api] /match 失败，尝试 /search/anime:', error);
    }

    if (!candidates.length) {
        try {
            candidates = await searchByAnime(query, settings);
            confidence = 0.85;
        } catch (error) {
            return {
                success: false,
                error: (matchError || error)?.message || 'danmu_api 搜索失败',
                results: [],
                danmuApi: true
            };
        }
    }

    const adapted = candidates
        .slice(0, 15)
        .map((candidate) => adaptCandidate(candidate, confidence))
        .filter(Boolean);
    await saveMappings(adapted.map((item) => item.mapping));

    return {
        success: adapted.length > 0,
        error: adapted.length ? undefined : matchError?.message || 'danmu_api 未找到匹配结果',
        results: adapted.map((item) => item.result),
        searchUrl: `${settings.baseUrl}/api/v2/match`,
        danmuApi: true
    };
}

function colorToCss(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return '#ffffff';
    return `#${Math.min(Math.trunc(numeric), 0xffffff).toString(16).padStart(6, '0')}`;
}

function modeToEngine(value) {
    const mode = Number(value);
    if ([1, 2, 3, 6].includes(mode)) return 'rtl';
    if (mode === 4) return 'bottom';
    return 'top';
}

function convertComments(payload) {
    const comments = Array.isArray(payload?.comments)
        ? payload.comments
        : Array.isArray(payload?.data?.comments)
          ? payload.data.comments
          : Array.isArray(payload)
            ? payload
            : [];

    return comments
        .map((comment) => {
            const p = String(comment?.p || '').split(',');
            const time = Number(comment?.t ?? p[0]);
            const text = String(comment?.m ?? comment?.text ?? '').trim();
            if (!Number.isFinite(time) || time < 0 || !text) return null;
            return {
                time,
                text,
                color: colorToCss(comment?.color ?? p[2]),
                mode: modeToEngine(comment?.mode ?? p[1]),
                weight: Number.isFinite(Number(comment?.weight)) ? Number(comment.weight) : 5
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.time - b.time);
}

function resolveDuration(payload, fallback, danmakus) {
    for (const value of [
        payload?.videoDuration,
        payload?.duration,
        payload?.data?.videoDuration,
        payload?.data?.duration,
        fallback
    ]) {
        const duration = Number(value);
        if (Number.isFinite(duration) && duration > 0) return duration;
    }
    return danmakus.length ? danmakus[danmakus.length - 1].time : 0;
}

export async function downloadDanmuApi(target, youtubeVideoDuration) {
    const settings = await getDanmuApiSettings();
    if (settings.mode !== 'danmuApi' || !settings.baseUrl) {
        throw new Error('danmu_api 未启用或地址为空');
    }

    const value = String(target || '').trim();
    const isToken = value.startsWith('DMAPI_');
    let mapping = null;
    let sourceUrl = '';
    let path = '';

    if (isToken) {
        const cache = await readMatchCache();
        mapping = cache[value] || null;
        const episodeId = mapping?.episodeId || episodeIdFromToken(value);
        if (!episodeId) throw new Error('danmu_api 匹配信息已失效，请重新搜索');
        sourceUrl = mapping?.sourceUrl || '';
        path = `/api/v2/comment/${encodeURIComponent(episodeId)}?format=json&duration=true`;
    } else if (/^BV[0-9A-Za-z]+$/i.test(value)) {
        sourceUrl = `https://www.bilibili.com/video/${value}`;
        path = `/api/v2/comment?url=${encodeURIComponent(sourceUrl)}&format=json&duration=true`;
    } else {
        throw new Error(`无法识别的弹幕目标: ${value || '(empty)'}`);
    }

    const payload = await requestJson(path, {}, settings);
    if (payload?.success === false) {
        throw new Error(payload.errorMessage || payload.message || 'danmu_api 获取弹幕失败');
    }

    const danmakus = convertComments(payload);
    return {
        bvid: value,
        title: mapping?.title || value,
        pic: mapping?.pic || '',
        author: mapping?.author || 'danmu_api',
        sourceUrl,
        sourceType: 'danmu-api',
        danmakus,
        duration: resolveDuration(payload, youtubeVideoDuration, danmakus)
    };
}
