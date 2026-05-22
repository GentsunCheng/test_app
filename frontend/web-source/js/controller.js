import { state, saveHosts, updateAPI } from './store.js';
import { elements, showToast, stopLogs, closeMethodModal, closeModal, addScriptEntry, validateScriptEntry, closeMoreDetailInfo, showMoreDetailInfo } from './utils.js';
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
    updateHostDisplay();
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
        const isMethodModalOpen = elements.methodModalOverlay.style.display === 'flex';
        if (!isMethodModalOpen) return;

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (document.activeElement === elements.methodSearchInput) return;
            const now = Date.now();
            if (state._lastArrowTime && now - state._lastArrowTime < 100) return;
            state._lastArrowTime = now;
            e.preventDefault();
            const items = elements.methodListContainer.querySelectorAll('.method-item');
            if (items.length === 0) return;

            const delta = e.key === 'ArrowDown' ? 1 : -1;
            let newIndex = state.methodFocusIndex + delta;
            if (newIndex < 0) newIndex = 0;
            if (newIndex >= items.length) newIndex = items.length - 1;
            if (newIndex === state.methodFocusIndex) return;

            state.methodFocusIndex = newIndex;
            const targetMethod = items[newIndex].dataset.method;
            state.selectedMethod = targetMethod;
            elements.btnMethodConfirm.disabled = false;
            filterMethods();
        }

        if (e.key === 'Home' || e.key === 'End') {
            if (document.activeElement === elements.methodSearchInput) return;
            e.preventDefault();
            const items = elements.methodListContainer.querySelectorAll('.method-item');
            if (items.length === 0) return;

            const newIndex = e.key === 'Home' ? 0 : items.length - 1;
            state.methodFocusIndex = newIndex;
            state.selectedMethod = items[newIndex].dataset.method;
            elements.btnMethodConfirm.disabled = false;
            filterMethods();
        }

        if (e.key === 'Enter' && !elements.btnMethodConfirm.disabled && document.activeElement !== elements.methodSearchInput) {
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
                    addScriptEntry(name, path, false);
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

    // Detail Info Modal
    elements.btnDetailInfoClose.onclick = closeMoreDetailInfo;
    elements.detailInfoModalOverlay.onclick = (e) => {
        if (e.target === elements.detailInfoModalOverlay) {
            closeMoreDetailInfo();
        }
    };

    // Spacebar: long press = show immediately on press, close on release; short press = toggle
    // Also prevent default space scrolling on the unit list element
    elements.unitListContainer.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
        }
    });

    let spaceTimer = null;
    let spaceLongPress = false;
    let wasModalOpenBeforePress = false;
    const SPACE_LONG_PRESS_MS = 250;

    document.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.code === 'Space') {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
            if (state.selectedIds.size === 0) return;
            if (spaceTimer !== null) return;

            e.preventDefault();

            wasModalOpenBeforePress = elements.detailInfoModalOverlay.style.display === 'flex';
            spaceLongPress = false;

            if (!wasModalOpenBeforePress) {
                showMoreDetailInfo();
            }

            spaceTimer = setTimeout(() => {
                spaceLongPress = true;
                spaceTimer = null;
            }, SPACE_LONG_PRESS_MS);
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.code === 'Space') {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

            e.preventDefault();

            if (spaceTimer !== null) {
                clearTimeout(spaceTimer);
                spaceTimer = null;
            }

            if (spaceLongPress) {
                closeMoreDetailInfo();
            } else if (wasModalOpenBeforePress) {
                closeMoreDetailInfo();
            }
        }
    });

    // ESC to close detail info modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.detailInfoModalOverlay.style.display === 'flex') {
            closeMoreDetailInfo();
        }
    });

    // Global text/input context menu
    const textCtxMenu = document.createElement('div');
    textCtxMenu.id = 'text_context_menu';
    textCtxMenu.className = 'context-menu';
    textCtxMenu.innerHTML = '<div class="ctx-inner"></div>';
    document.body.appendChild(textCtxMenu);

    function hideTextCtxMenu() {
        textCtxMenu.classList.remove('visible');
    }

    function updateTextCtxMenu(e) {
        const inner = textCtxMenu.querySelector('.ctx-inner');
        inner.innerHTML = '';
        const target = e.target;
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        const selection = window.getSelection();
        const hasSelection = selection && !selection.isCollapsed && selection.toString().trim().length > 0;
        let hasInputSelection = false;

        if (isInput) {
            hasInputSelection = target.selectionStart !== undefined && target.selectionStart !== target.selectionEnd;
        }

        if (hasInputSelection) {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'ctx-btn';
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', () => {
                document.execCommand('copy');
                showToast('Copied', 'success');
                hideTextCtxMenu();
            });
            inner.appendChild(copyBtn);

            const cutBtn = document.createElement('button');
            cutBtn.className = 'ctx-btn';
            cutBtn.textContent = 'Cut';
            cutBtn.addEventListener('click', () => {
                document.execCommand('cut');
                showToast('Cut', 'success');
                hideTextCtxMenu();
            });
            inner.appendChild(cutBtn);
        } else if (hasSelection) {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'ctx-btn';
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', () => {
                document.execCommand('copy');
                showToast('Copied', 'success');
                hideTextCtxMenu();
            });
            inner.appendChild(copyBtn);
        }

        if (isInput) {
            const pasteBtn = document.createElement('button');
            pasteBtn.className = 'ctx-btn';
            pasteBtn.textContent = 'Paste';
            pasteBtn.addEventListener('click', async () => {
                hideTextCtxMenu();
                const prev = target.value;
                target.focus();

                let pasted = '';
                try {
                    pasted = await navigator.clipboard.readText();
                } catch {
                    const temp = document.createElement('textarea');
                    temp.style.position = 'fixed';
                    temp.style.left = '-9999px';
                    temp.style.top = '-9999px';
                    document.body.appendChild(temp);
                    temp.focus();
                    if (document.execCommand('paste')) {
                        pasted = temp.value;
                    }
                    document.body.removeChild(temp);
                }

                if (pasted) {
                    const start = target.selectionStart;
                    const end = target.selectionEnd;
                    target.value = prev.substring(0, start) + pasted + prev.substring(end);
                    target.selectionStart = target.selectionEnd = start + pasted.length;
                    target.dispatchEvent(new Event('input', { bubbles: true }));
                    showToast('Pasted', 'success');
                } else {
                    target.value = prev;
                    showToast('Paste failed', 'error');
                }
            });
            inner.appendChild(pasteBtn);
        }

        if (inner.children.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            textCtxMenu.style.left = e.clientX + 'px';
            textCtxMenu.style.top = e.clientY + 'px';
            textCtxMenu.classList.add('visible');
        }
    }

    document.addEventListener('contextmenu', (e) => {
        if (e.defaultPrevented) return;
        const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
        const selection = window.getSelection();
        const hasSelection = selection && !selection.isCollapsed && selection.toString().trim().length > 0;
        if (isInput || hasSelection) {
            updateTextCtxMenu(e);
        }
    });

    document.addEventListener('click', (e) => {
        if (!textCtxMenu.contains(e.target)) {
            hideTextCtxMenu();
        }
    });
}
