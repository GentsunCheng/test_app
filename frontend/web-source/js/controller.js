import { state, saveHosts, updateAPI } from './store.js';
import { elements, showToast, stopLogs, closeMethodModal, closeModal, addScriptEntry, validateScriptEntry } from './utils.js';
import { checkHostAvailability, fetchUnits, fetchScriptInfo, addScript, runTest, scanTestScript } from './services.js';
import { 
    renderHostList, 
    renderUnits, 
    updateMainView, 
    updateHostDisplay, 
    filterMethods,
    renderSettingsView,
    renderTestView
} from './views.js';
import { hideToolView } from './tool.js';

function getUnitIndex(id) {
    return state.allUnits.findIndex(u => u.id === id);
}

function selectRange(fromId, toId) {
    const fromIdx = getUnitIndex(fromId);
    const toIdx = getUnitIndex(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);
    for (let i = start; i <= end; i++) {
        state.selectedIds.add(state.allUnits[i].id);
    }
}

export function handleUnitClick(e, unit) {
    stopLogs();
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    if (shift) {
        if (state.anchorId !== null) {
            selectRange(state.anchorId, unit.id);
        } else {
            state.selectedIds.add(unit.id);
        }
        state.focusId = unit.id;
    } else if (ctrl) {
        if (state.selectedIds.has(unit.id)) {
            state.selectedIds.delete(unit.id);
        } else {
            state.selectedIds.add(unit.id);
        }
        state.anchorId = unit.id;
        state.focusId = unit.id;
    } else {
        state.selectedIds.clear();
        state.selectedIds.add(unit.id);
        state.anchorId = unit.id;
        state.focusId = unit.id;
    }

    renderUnits(handleUnitClick);
    updateMainView();
}

export async function updateAllHostStatus() {
    const checks = state.hosts.map(async (host) => {
        state.hostAvailability[host.url] = 'checking';
        const isAvailable = await checkHostAvailability(host.url);
        state.hostAvailability[host.url] = isAvailable;
        renderHostList(onHostSwitch, onHostDelete);
    });
    await Promise.all(checks);
}

function onHostSwitch(host) {
    state.currentHost = host;
    saveHosts();
    updateAPI();
    updateHostDisplay();
    renderHostList(onHostSwitch, onHostDelete);
    showToast(`Switched to ${host.name}`, 'success');
    fetchUnits(() => renderUnits(handleUnitClick));
    fetchScriptInfo();
}

function onHostDelete(host, index) {
    if (host.url === state.currentHost.url) {
        state.currentHost = state.hosts[0];
        updateAPI();
        updateHostDisplay();
    }
    state.hosts.splice(index, 1);
    saveHosts();
    renderHostList(onHostSwitch, onHostDelete);
    showToast('Host removed', 'success');
}

export function initEventListeners() {
    elements.btnHost.onclick = () => {
        elements.hostModalOverlay.style.display = 'flex';
        renderHostList(onHostSwitch, onHostDelete);
        updateAllHostStatus();
    };

    elements.btnHostCancel.onclick = () => elements.hostModalOverlay.style.display = 'none';

    elements.btnHostAdd.onclick = async () => {
        const name = elements.newHostNameInput.value.trim();
        const url = elements.newHostUrlInput.value.trim();
        if (name && url) {
            if (!url.startsWith('http')) {
                showToast('URL must start with http:// or https://', 'error');
                return;
            }
            state.hosts.push({ name, url });
            state.hostAvailability[url] = 'checking';
            saveHosts();
            renderHostList(onHostSwitch, onHostDelete);
            elements.newHostNameInput.value = '';
            elements.newHostUrlInput.value = '';
            const isAvailable = await checkHostAvailability(url);
            state.hostAvailability[url] = isAvailable;
            renderHostList(onHostSwitch, onHostDelete);
            showToast(isAvailable ? 'Host added and online!' : 'Host added but seems offline.', isAvailable ? 'success' : 'error');
        } else showToast('Please enter both name and URL', 'error');
    };

    elements.unitListContainer.onclick = (e) => {
        if (e.target === elements.unitListContainer) {
            state.selectedIds.clear();
            state.focusId = null;
            state.anchorId = null;
            renderUnits(handleUnitClick);
            updateMainView();
        }
    };

    elements.unitListContainer.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
            e.preventDefault();
            state.allUnits.forEach(unit => state.selectedIds.add(unit.id));
            if (state.allUnits.length > 0) {
                const lastUnit = state.allUnits[state.allUnits.length - 1];
                state.anchorId = lastUnit.id;
                state.focusId = lastUnit.id;
            }
            renderUnits(handleUnitClick);
            updateMainView();
        }
    });

    elements.controlButtonBar.onclick = (e) => {
        if (e.target === elements.controlButtonBar) {
            state.currentView = 'units';
            hideToolView();
            updateMainView();
        }
    };

    document.getElementById('btn_test').onclick = async () => {
        stopLogs();
        state.currentView = 'test';
        hideToolView();
        updateMainView();
        await fetchScriptInfo(renderTestView);
    };

    document.getElementById('btn_log').onclick = () => {
        stopLogs();
        state.currentView = 'logs';
        hideToolView();
        state.lastLogSelection = ''; // Force log stream restart
        updateMainView();
    };

    document.getElementById('btn_setting').onclick = () => {
        stopLogs();
        state.currentView = 'settings';
        hideToolView();
        fetchScriptInfo(renderSettingsView);
        updateMainView();
    };

    elements.btnModalCancel.onclick = closeModal;
    elements.btnMethodCancel.onclick = closeMethodModal;
    elements.btnMethodConfirm.onclick = () => {
        if (state.currentScriptForMethod && state.selectedMethod) {
            runTest(state.currentScriptForMethod, state.selectedMethod, closeMethodModal);
        }
    };

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && elements.methodModalOverlay.style.display === 'flex' && !elements.btnMethodConfirm.disabled && document.activeElement !== elements.methodSearchInput) {
            e.preventDefault();
            elements.btnMethodConfirm.click();
        }
    });

    elements.methodSearchInput.oninput = filterMethods;
    elements.btnSearchRegex.onclick = function() {
        state.isSearchRegex = !state.isSearchRegex;
        this.classList.toggle('active', state.isSearchRegex);
        filterMethods();
    };
    elements.btnSearchCase.onclick = function() {
        state.isSearchCaseSensitive = !state.isSearchCaseSensitive;
        this.classList.toggle('active', state.isSearchCaseSensitive);
        filterMethods();
    };

    elements.unitSearchInput.oninput = () => renderUnits(handleUnitClick);
    elements.btnUnitRegex.onclick = function() {
        state.isUnitSearchRegex = !state.isUnitSearchRegex;
        this.classList.toggle('active', state.isUnitSearchRegex);
        renderUnits(handleUnitClick);
    };
    elements.btnUnitCase.onclick = function() {
        state.isUnitSearchCaseSensitive = !state.isUnitSearchCaseSensitive;
        this.classList.toggle('active', state.isUnitSearchCaseSensitive);
        renderUnits(handleUnitClick);
    };

    elements.btnModalAdd.onclick = async () => {
        const entries = elements.scriptEntryList.querySelectorAll('.script-entry');
        let allValid = true;

        entries.forEach(entry => {
            if (!validateScriptEntry(entry)) allValid = false;
        });

        if (!allValid) {
            showToast('Please fix the errors before adding scripts.', 'error');
            return;
        }

        const entryData = [];
        entries.forEach(entry => {
            const name = entry.querySelector('.script-name-input').value.trim();
            const path = entry.querySelector('.script-path-input').value.trim();
            if (name && path) entryData.push({ name, path });
        });

        if (entryData.length === 0) {
            showToast('Please fill in at least one script name and path.', 'error');
            return;
        }

        let successCount = 0;
        let failCount = 0;

        for (const { name, path } of entryData) {
            await addScript(name, path, (success) => {
                if (success) successCount++;
                else failCount++;
            });
        }

        if (successCount > 0) {
            closeModal();
            fetchScriptInfo(renderSettingsView);
            if (failCount === 0) {
                showToast(`Added ${successCount} script(s) successfully`, 'success');
            } else {
                showToast(`Added ${successCount} script(s), ${failCount} failed`, 'error');
            }
        } else {
            showToast('Failed to add scripts', 'error');
        }
    };

    elements.btnAddEntry.onclick = () => addScriptEntry();

    elements.btnScanScript.onclick = async () => {
        const btn = elements.btnScanScript;
        btn.disabled = true;
        btn.textContent = 'Scanning...';
        try {
            const data = await scanTestScript();
            elements.scriptEntryList.innerHTML = '';
            for (const [name, paths] of Object.entries(data)) {
                for (const path of paths) {
                    addScriptEntry(name, path);
                }
            }
            showToast(`Scanned ${Object.keys(data).length} script(s)`, 'success');
        } catch (error) {
            showToast('Failed to scan scripts: ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Scan';
        }
    };

    elements.modalOverlay.ondragover = (e) => { e.preventDefault(); };
    elements.modalOverlay.ondrop = (e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        files.forEach(file => {
            const path = file.path || file.name;
            const suggestedName = file.name.split('.')[0];
            addScriptEntry(suggestedName, path);
        });
        const entries = elements.scriptEntryList.querySelectorAll('.script-entry');
        entries.forEach(entry => {
            const name = entry.querySelector('.script-name-input').value.trim();
            const path = entry.querySelector('.script-path-input').value.trim();
            if (!name && !path) entry.remove();
        });
    };
}
