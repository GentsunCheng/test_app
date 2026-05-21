const CACHE_KEY = 'detailCache';
const EXCLUDED_FIELDS = ['battery', 'temperature', 'check_timestamp'];
const TTL_MS = 3 * 24 * 60 * 60 * 1000;

function loadCache() {
    try {
        return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    } catch { return {}; }
}

function saveCache(cache) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.error('Failed to save detail cache:', e);
    }
}

function stripExcluded(detail) {
    if (!detail) return null;
    const result = {};
    for (const key of Object.keys(detail)) {
        if (!EXCLUDED_FIELDS.includes(key)) {
            result[key] = detail[key];
        }
    }
    return Object.keys(result).length > 0 ? result : null;
}

function areDetailsEqual(a, b) {
    const aKeys = a ? Object.keys(a).sort() : [];
    const bKeys = b ? Object.keys(b).sort() : [];
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

export function getCachedDetail(ecid) {
    const cache = loadCache();
    const entry = cache[ecid];
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > TTL_MS) {
        delete cache[ecid];
        saveCache(cache);
        return null;
    }
    return entry.detail || null;
}

export function setCachedDetail(ecid, detail) {
    const cacheable = stripExcluded(detail);
    if (!cacheable) return;
    const cache = loadCache();
    cache[ecid] = { detail: cacheable, cachedAt: Date.now() };
    saveCache(cache);
}

export function hasMeaningfulDetail(detail) {
    return stripExcluded(detail) !== null;
}

export function hasCachedDetailChanged(ecid, newDetail) {
    const cache = loadCache();
    const entry = cache[ecid];
    if (!entry) return true;
    const newCacheable = stripExcluded(newDetail);
    return !areDetailsEqual(entry.detail, newCacheable);
}

export function refreshTTL(ecid) {
    const cache = loadCache();
    if (cache[ecid]) {
        cache[ecid].cachedAt = Date.now();
        saveCache(cache);
    }
}

export function refreshAllTTLs() {
    const cache = loadCache();
    const now = Date.now();
    let changed = false;
    for (const ecid of Object.keys(cache)) {
        if (now - cache[ecid].cachedAt <= TTL_MS) {
            cache[ecid].cachedAt = now;
            changed = true;
        } else {
            delete cache[ecid];
            changed = true;
        }
    }
    if (changed) saveCache(cache);
}

export function updateCachedDetail(ecid, detail) {
    const cacheable = stripExcluded(detail);
    if (!cacheable) return false;
    const cache = loadCache();
    const existing = cache[ecid] ? cache[ecid].detail : null;
    if (areDetailsEqual(existing, cacheable)) {
        cache[ecid] = { detail: cacheable, cachedAt: Date.now() };
        saveCache(cache);
        return false;
    }
    cache[ecid] = { detail: cacheable, cachedAt: Date.now() };
    saveCache(cache);
    return true;
}
