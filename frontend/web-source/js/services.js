import { state } from './store.js';
import { showToast, stopLogs } from './utils.js';
import { getCachedDetail, updateCachedDetail, hasMeaningfulDetail } from './detailCache.js';

const NORMAL_UNIT_REMOVAL_GRACE_MS = 300;

export async function checkHostAvailability(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    try {
        await fetch(`${url}/api/ecids`, { 
            method: 'GET',
            signal: controller.signal,
            mode: 'no-cors'
        });
        clearTimeout(timeoutId);
        return true;
    } catch (e) {
        clearTimeout(timeoutId);
        return false;
    }
}

export async function fetchUnits(renderCallback) {
    const requestSeq = ++state.unitsRequestSeq;

    try {
        const [ecidsRes, testingEcidsRes] = await Promise.all([
            fetch(`${state.API_BASE}/api/ecids`),
            fetch(`${state.API_BASE}/api/testing_ecids`)
        ]);

        if (requestSeq !== state.unitsRequestSeq) return;

        const ecidsData = await ecidsRes.json();
        const testingEcidsData = await testingEcidsRes.json();

        const ecids = ecidsData || [];
        const testingEcids = testingEcidsData || [];
        const now = Date.now();

        const testingSet = new Set(testingEcids);
        const normalSet = new Set(ecids.filter(id => !testingSet.has(id)));
        const previousUnits = state.allUnits;
        const previousUnitsById = new Map(previousUnits.map(unit => [unit.id, unit]));

        const newUnits = [];
        const normalToFetchDetails = [];

        ecids.forEach(id => {
            state.missingNormalUnitSince.delete(id);
            if (!testingSet.has(id)) {
                const existing = previousUnitsById.get(id);
                newUnits.push({ id, type: 'normal', detail: existing ? existing.detail : null });
                normalToFetchDetails.push(id);
            }
        });

        testingEcids.forEach(id => {
            state.missingNormalUnitSince.delete(id);
            const existing = previousUnitsById.get(id);
            newUnits.push({ id, type: 'testing', detail: existing ? existing.detail : null });
        });

        const updatedSelectedIds = new Set(state.selectedIds);
        const unitsToRemoveFromSelection = new Set();
        
        state.selectedIds.forEach(id => {
            const oldUnit = previousUnitsById.get(id);
            if (!oldUnit) return;

            const isNowNormal = normalSet.has(id);
            const isNowTesting = testingSet.has(id);
            const isGone = !isNowNormal && !isNowTesting;

            if (oldUnit.type === 'normal') {
                if (isGone) unitsToRemoveFromSelection.add(id);
            } else if (oldUnit.type === 'testing') {
                if (isGone) {
                    if (!newUnits.find(u => u.id === id)) newUnits.push(oldUnit);
                }
            }
        });

        previousUnits.forEach(oldUnit => {
            if (oldUnit.type !== 'normal') return;
            if (normalSet.has(oldUnit.id) || testingSet.has(oldUnit.id)) return;
            if (newUnits.find(unit => unit.id === oldUnit.id)) return;

            const missingSince = state.missingNormalUnitSince.get(oldUnit.id) ?? now;
            state.missingNormalUnitSince.set(oldUnit.id, missingSince);

            if (now - missingSince < NORMAL_UNIT_REMOVAL_GRACE_MS) {
                newUnits.push(oldUnit);
                unitsToRemoveFromSelection.delete(oldUnit.id);
            }
        });

        unitsToRemoveFromSelection.forEach(id => updatedSelectedIds.delete(id));
        state.selectedIds = updatedSelectedIds;
        state.allUnits = newUnits;

        if (normalToFetchDetails.length > 0) {
            normalToFetchDetails.forEach(id => {
                const unit = state.allUnits.find(u => u.id === id);
                if (unit && !unit.detail) {
                    const cached = getCachedDetail(id);
                    if (cached) unit.detail = cached;
                }
            });
        }

        if (state.hostAvailability[state.currentHost.url] !== true) {
            state.hostAvailability[state.currentHost.url] = true;
            window.dispatchEvent(new CustomEvent('hostavailabilitychange'));
        }

        if (renderCallback) renderCallback();

        if (normalToFetchDetails.length > 0) {
            const didApplyDetails = await fetchDetails(normalToFetchDetails, requestSeq);
            if (didApplyDetails && renderCallback) renderCallback();
        }
    } catch (error) {
        console.error('Error fetching units:', error);
        if (state.hostAvailability[state.currentHost.url] !== false) {
            state.hostAvailability[state.currentHost.url] = false;
            window.dispatchEvent(new CustomEvent('hostavailabilitychange'));
        }
    }
}

export async function fetchDetails(ecids, requestSeq = state.unitsRequestSeq) {
    try {
        const response = await fetch(`${state.API_BASE}/api/detail_info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ecids })
        });
        const data = await response.json();
        const details = data || {};

        if (requestSeq !== state.unitsRequestSeq) return false;

        let changed = false;
        state.allUnits.forEach(unit => {
            if (unit.type !== 'normal') return;
            const rawDetail = details[unit.id];
            if (!rawDetail || !hasMeaningfulDetail(rawDetail)) return;

            const newDetail = rawDetail;
            const oldDetail = unit.detail;
            const cacheUpdated = updateCachedDetail(unit.id, newDetail);
            unit.detail = newDetail;
            if (cacheUpdated) changed = true;
            else if (!oldDetail) changed = true;
            else {
                for (const key of Object.keys(newDetail)) {
                    if (newDetail[key] !== oldDetail[key]) {
                        changed = true;
                        break;
                    }
                }
            }
        });
        return changed;
    } catch (error) {
        console.error('Error fetching details:', error);
        return false;
    }
}

export async function scanTestScript() {
    try {
        const response = await fetch(`${state.API_BASE}/api/scan_test_script`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error scanning test scripts:', error);
        throw error;
    }
}

export async function fetchScriptInfo(callback) {
    try {
        const response = await fetch(`${state.API_BASE}/api/script_info`);
        state.scriptInfo = await response.json();
        if (callback) callback();
    } catch (error) {
        console.error('Error fetching script info:', error);
    }
}

export async function addScript(name, path, callback) {
    try {
        const response = await fetch(`${state.API_BASE}/api/add_test_script`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ script_name: name, script_path: path })
        });
        const result = await response.json();
        if (result.status === 'success') {
            if (callback) callback(true, null);
        } else {
            if (callback) callback(false, result.message || 'Unknown error');
        }
    } catch (error) {
        if (callback) callback(false, error.message);
    }
}

export async function deleteScript(name, callback) {
    try {
        const response = await fetch(`${state.API_BASE}/api/remove_test_script`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ script_name: name })
        });
        const result = await response.json();
        if (result.status === 'success') {
            showToast('Script removed successfully', 'success');
            if (callback) callback();
        } else {
            showToast('Failed to remove script', 'error');
        }
    } catch (error) {
        showToast('Error removing script', 'error');
    }
}

export async function cleanDisabledScripts() {
    const disabledNames = Object.entries(state.scriptInfo)
        .filter(([, info]) => info.status === false)
        .map(([name]) => name);

    if (disabledNames.length === 0) {
        showToast('No disabled scripts to clean', 'info');
        return 0;
    }

    let successCount = 0;
    for (const name of disabledNames) {
        try {
            const response = await fetch(`${state.API_BASE}/api/remove_test_script`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ script_name: name })
            });
            const result = await response.json();
            if (result.status === 'success') {
                successCount++;
            }
        } catch (error) {
            console.error(`Error removing disabled script "${name}":`, error);
        }
    }
    return successCount;
}

export async function runTest(scriptName, method, callback) {
    const normalEcids = Array.from(state.selectedIds).filter(id => {
        const unit = state.allUnits.find(u => u.id === id);
        return unit && unit.type === 'normal';
    });

    try {
        const response = await fetch(`${state.API_BASE}/api/run_test_script`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                script_name: scriptName,
                test_method: method,
                units: normalEcids
            })
        });
        const result = await response.json();
        if (result.status === 'success') {
            showToast(`Started ${method} on ${scriptName}`, 'success');
            if (callback) callback();
            fetchUnits();
        } else {
            showToast('Failed to start test: ' + (result.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        showToast('Error running test: ' + error.message, 'error');
    }
}

export async function fetchMethods(scriptName, callback) {
    try {
        const head_methods = ["results"];
        const response = await fetch(`${state.API_BASE}/api/script_methods`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ script_name: scriptName })
        });
        const data = await response.json();
        if (data.status === 'success') {
            let methods = [];
            if (Array.isArray(data.methods)) methods = data.methods;
            else if (data.methods && data.methods[scriptName]) methods = data.methods[scriptName];
            else if (data.data && Array.isArray(data.data)) methods = data.data;

            head_methods.forEach(head_method => {
                if (methods.includes(head_method)) {
                    methods = methods.filter(str => str !== head_method);
                    methods.unshift(head_method);
                }
            });
            if (callback) callback(scriptName, methods);
        } else {
            showToast('Failed to fetch methods', 'error');
        }
    } catch (error) {
        showToast('Error fetching methods: ' + error.message, 'error');
    }
}

export async function startLogStream(renderHeaderCallback, logLineCallback) {
    if (state.isFetchingLogs) stopLogs();

    state.isFetchingLogs = true;
    state.logAbortController = new AbortController();
    const selectedList = Array.from(state.selectedIds);
    state.lastLogSelection = selectedList.sort().join(',');

    if (selectedList.length === 0) {
        if (renderHeaderCallback) renderHeaderCallback(0);
        state.isFetchingLogs = false;
        return;
    }

    if (renderHeaderCallback) renderHeaderCallback(selectedList.length);

    try {
        const response = await fetch(`${state.API_BASE}/api/logs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ecids: selectedList }),
            signal: state.logAbortController.signal
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        if (!response.body) throw new Error('Response body is null');

        const reader = response.body.getReader();
        state.logReader = reader;
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done || !state.logReader) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            lines.forEach(line => {
                const trimmed = line.trim();
                if (trimmed && logLineCallback) logLineCallback(trimmed);
            });
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Error fetching logs:', error);
            if (logLineCallback) logLineCallback(`Error: ${error.message}`, true);
        }
    } finally {
        state.logReader = null;
        state.logAbortController = null;
        state.isFetchingLogs = false;
    }
}

export async function fetchMoreDetailInfo(ecids) {
    try {
        const response = await fetch(`${state.API_BASE}/api/detail_info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ecids, more_info: true })
        });
        const data = await response.json();
        return data || {};
    } catch (error) {
        console.error('Error fetching more detail info:', error);
        throw error;
    }
}
