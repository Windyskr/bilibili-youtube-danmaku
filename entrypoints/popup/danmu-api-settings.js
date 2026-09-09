import './danmu-api-settings.css';

const SETTINGS_KEY = 'danmuApiSettings';
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

async function loadSettings() {
    const data = await browser.storage.local.get(SETTINGS_KEY);
    return normalizeSettings(data[SETTINGS_KEY]);
}

function originPattern(baseUrl) {
    const parsed = new URL(normalizeBaseUrl(baseUrl));
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('地址必须以 http:// 或 https:// 开头');
    }
    return `${parsed.protocol}//${parsed.host}/*`;
}

async function requestOriginPermission(baseUrl) {
    if (!browser.permissions?.request) return true;
    return browser.permissions.request({ origins: [originPattern(baseUrl)] });
}

function setStatus(message, type = '') {
    const status = document.getElementById('danmu-api-settings-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.type = type;
}

function applyLabels(settings) {
    const enabled = settings.mode === 'danmuApi';
    const title = document.querySelector('#main-container > h1');
    if (title) title.textContent = enabled ? '全平台弹幕 → YouTube' : 'B站弹幕 → YouTube';

    const searchTitle = document.querySelector('#search-results .youtube-search-header h3');
    if (searchTitle) searchTitle.textContent = enabled ? '全平台弹幕' : 'B站弹幕';

    const searchInput = document.getElementById('youtube-search-input');
    if (searchInput) {
        searchInput.placeholder = enabled ? '输入标题 / 剧集名搜索' : '输入视频标题搜索';
    }

    for (const id of ['youtube-view-bilibili-btn', 'quark-view-bilibili-btn']) {
        const button = document.getElementById(id);
        if (button) button.textContent = enabled ? '查看来源' : '在 B 站查看';
    }

    const badge = document.getElementById('danmu-api-mode-badge');
    if (badge) {
        badge.textContent = enabled ? 'danmu_api' : 'Bilibili';
        badge.dataset.mode = enabled ? 'danmuApi' : 'bilibili';
    }
}

async function testConnection(baseUrl, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const url = `${normalizeBaseUrl(baseUrl)}/api/v2/search/anime?keyword=${encodeURIComponent('B2Y')}`;
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.json();
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error(`连接超时（${timeoutMs}ms）`);
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function createUi() {
    if (document.getElementById('danmu-api-settings-toggle')) return;

    const toggle = document.createElement('button');
    toggle.id = 'danmu-api-settings-toggle';
    toggle.type = 'button';
    toggle.innerHTML = '<span id="danmu-api-mode-badge">Bilibili</span><span>弹幕源</span>';
    document.body.appendChild(toggle);

    const modal = document.createElement('div');
    modal.id = 'danmu-api-settings-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="danmu-api-settings-card" role="dialog" aria-modal="true" aria-label="弹幕源设置">
            <div class="danmu-api-settings-header">
                <div><h3>弹幕源设置</h3><p>原生 Bilibili 或自建 danmu_api</p></div>
                <button type="button" id="danmu-api-settings-close" aria-label="关闭">×</button>
            </div>
            <label class="danmu-api-field">
                <span>弹幕来源</span>
                <select id="danmu-api-mode">
                    <option value="bilibili">原生 Bilibili</option>
                    <option value="danmuApi">danmu_api（全平台）</option>
                </select>
            </label>
            <label class="danmu-api-field" id="danmu-api-url-field">
                <span>danmu_api 地址</span>
                <input id="danmu-api-base-url" type="url" spellcheck="false" placeholder="https://danmu.example.com/87654321" />
                <small>启用了 TOKEN 时，把 token 路径一起填入。</small>
            </label>
            <label class="danmu-api-field danmu-api-inline-field" id="danmu-api-fallback-field">
                <span>API 失败时回退原生 B 站</span>
                <input id="danmu-api-fallback" type="checkbox" checked />
            </label>
            <label class="danmu-api-field" id="danmu-api-timeout-field">
                <span>请求超时</span>
                <select id="danmu-api-timeout">
                    <option value="8000">8 秒</option>
                    <option value="15000">15 秒</option>
                    <option value="30000">30 秒</option>
                    <option value="60000">60 秒</option>
                </select>
            </label>
            <div id="danmu-api-settings-status" aria-live="polite"></div>
            <div class="danmu-api-settings-actions">
                <button type="button" id="danmu-api-test">测试连接</button>
                <button type="button" id="danmu-api-save" class="primary">保存</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const mode = document.getElementById('danmu-api-mode');
    const baseUrl = document.getElementById('danmu-api-base-url');
    const fallback = document.getElementById('danmu-api-fallback');
    const timeout = document.getElementById('danmu-api-timeout');
    const testButton = document.getElementById('danmu-api-test');

    const updateFields = () => {
        const enabled = mode.value === 'danmuApi';
        for (const id of ['danmu-api-url-field', 'danmu-api-fallback-field', 'danmu-api-timeout-field']) {
            document.getElementById(id)?.classList.toggle('disabled', !enabled);
        }
        baseUrl.disabled = !enabled;
        fallback.disabled = !enabled;
        timeout.disabled = !enabled;
        testButton.disabled = !enabled;
    };

    const open = async () => {
        const settings = await loadSettings();
        mode.value = settings.mode;
        baseUrl.value = settings.baseUrl;
        fallback.checked = settings.fallbackToBilibili !== false;
        timeout.value = String(settings.timeoutMs);
        if (![...timeout.options].some((option) => option.value === timeout.value)) timeout.value = '15000';
        updateFields();
        setStatus('');
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
    };

    const close = () => {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
    };

    toggle.addEventListener('click', open);
    document.getElementById('danmu-api-settings-close').addEventListener('click', close);
    modal.addEventListener('click', (event) => event.target === modal && close());
    mode.addEventListener('change', updateFields);

    testButton.addEventListener('click', async () => {
        const value = normalizeBaseUrl(baseUrl.value);
        const timeoutMs = Number(timeout.value) || 15000;
        if (!value) return setStatus('请先填写 danmu_api 地址', 'error');
        try {
            const granted = await requestOriginPermission(value);
            if (!granted) return setStatus('未授予该 API 地址的访问权限', 'error');
            setStatus('正在测试连接…', 'loading');
            await testConnection(value, timeoutMs);
            setStatus('连接成功', 'success');
        } catch (error) {
            setStatus(`连接失败：${error.message}`, 'error');
        }
    });

    document.getElementById('danmu-api-save').addEventListener('click', async () => {
        const settings = normalizeSettings({
            mode: mode.value,
            baseUrl: baseUrl.value,
            fallbackToBilibili: fallback.checked,
            timeoutMs: Number(timeout.value)
        });
        if (settings.mode === 'danmuApi') {
            if (!settings.baseUrl) return setStatus('请填写 danmu_api 地址', 'error');
            try {
                const granted = await requestOriginPermission(settings.baseUrl);
                if (!granted) return setStatus('未授予该 API 地址的访问权限，无法启用', 'error');
            } catch (error) {
                return setStatus(`地址无效：${error.message}`, 'error');
            }
        }
        await browser.storage.local.set({ [SETTINGS_KEY]: settings });
        applyLabels(settings);
        setStatus('已保存', 'success');
        setTimeout(close, 350);
    });

    loadSettings().then(applyLabels).catch((error) => console.warn('[danmu_api] 加载设置失败:', error));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUi, { once: true });
} else {
    createUi();
}

browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[SETTINGS_KEY]?.newValue) {
        applyLabels(normalizeSettings(changes[SETTINGS_KEY].newValue));
    }
});
