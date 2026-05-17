import { state } from './store.js';
import { elements, showToast, stopLogs, openModal, closeModal, closeMethodModal, clearLogs, showConfirmDialog } from './utils.js';
import { fetchScriptInfo, deleteScript, cleanDisabledScripts, fetchMethods, startLogStream } from './services.js';
import { renderToolView } from './tool.js';

export function updateHostDisplay() {
    elements.currentHostNameSpan.textContent = state.currentHost.name;
}

export function renderHostList(onSwitch, onDelete) {
    const existingElements = Array.from(elements.hostListContainer.querySelectorAll('.host-item'));
    const elementMap = new Map();
    existingElements.forEach(el => {
        const url = el.querySelector('.host-url')?.textContent;
        if (url) elementMap.set(url, el);
    });

    const currentUrls = new Set();
    state.hosts.forEach((host, index) => {
        currentUrls.add(host.url);
        let item = elementMap.get(host.url);
        const status = state.hostAvailability[host.url];
        const isOffline = status === false;
        const isChecking = status === 'checking';
        const isActive = host.url === state.currentHost.url;
        
        const currentClassName = `host-item ${isActive ? 'active' : ''} ${isOffline ? 'offline' : ''}`;
        let statusDotClass = isOffline ? 'offline' : (isChecking ? 'checking' : 'online');

        if (!item) {
            item = document.createElement('div');
            item.innerHTML = `
                <div class="host-info" style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="status-dot"></span>
                        <span class="host-name"></span>
                    </div>
                    <span class="host-url"></span>
                </div>
            `;
            elements.hostListContainer.appendChild(item);
        }

        if (item.className !== currentClassName) item.className = currentClassName;
        const dot = item.querySelector('.status-dot');
        if (dot.className !== `status-dot ${statusDotClass}`) dot.className = `status-dot ${statusDotClass}`;
        const nameEl = item.querySelector('.host-name');
        if (nameEl.textContent !== host.name) nameEl.textContent = host.name;
        const urlEl = item.querySelector('.host-url');
        if (urlEl.textContent !== host.url) urlEl.textContent = host.url;

        item.onclick = (e) => {
            if (e.target.classList.contains('btn-host-delete')) return;
            if (isOffline) {
                showToast(`Cannot connect to ${host.name}. Host is unreachable.`, 'error');
                return;
            }
            if (onSwitch) onSwitch(host);
        };

        let delBtn = item.querySelector('.btn-host-delete');
        if (host.name !== state.masterNodeName && !host.url.includes(state.currentDomain)) {
            if (!delBtn) {
                delBtn = document.createElement('button');
                delBtn.className = 'btn-host-delete';
                delBtn.textContent = 'Delete';
                item.appendChild(delBtn);
            }
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (onDelete) onDelete(host, index);
            };
        } else if (delBtn) delBtn.remove();

        if (elements.hostListContainer.children[index] !== item) {
            elements.hostListContainer.insertBefore(item, elements.hostListContainer.children[index]);
        }
    });

    existingElements.forEach(el => {
        if (!currentUrls.has(el.querySelector('.host-url')?.textContent)) el.remove();
    });
}

export function renderUnits(onUnitClick) {
    const existingElements = Array.from(elements.unitListContainer.querySelectorAll('.unit'));
    const elementMap = new Map();
    existingElements.forEach(el => elementMap.set(el.dataset.id, el));

    const currentIds = new Set();
    const searchQuery = elements.unitSearchInput?.value || '';
    let filteredUnits = state.allUnits;

    if (searchQuery) {
        try {
            const regex = state.isUnitSearchRegex ? 
                new RegExp(searchQuery, state.isUnitSearchCaseSensitive ? '' : 'i') : null;
            const lowerQuery = searchQuery.toLowerCase();

            filteredUnits = state.allUnits.filter(unit => {
                const detail = unit.detail || {};
                const fields = [detail.serial_number, detail.unit_number, detail.sw_vers, detail.config, detail.cg_vendor].map(f => f ? String(f) : '');
                if (regex) return fields.some(f => regex.test(f));
                return fields.some(f => state.isUnitSearchCaseSensitive ? f.includes(searchQuery) : f.toLowerCase().includes(lowerQuery));
            });
        } catch (e) { filteredUnits = []; }
    }

    filteredUnits.forEach((unit, index) => {
        currentIds.add(unit.id);
        let unitEl = elementMap.get(unit.id);
        const isSelected = state.selectedIds.has(unit.id);
        
        const getBatteryHtml = (level) => {
            let batteryClass = level <= 20 ? 'battery-low' : (level <= 50 ? 'battery-mid' : 'battery-high');
            return `
                <div class="battery-icon ${level === 100 ? 'battery-full' : ''}">
                    <div class="battery-level ${batteryClass}" style="width: ${level}%"></div>
                </div>
                <span class="battery-text">${level}</span>
            `;
        };

        const getTemperatureHtml = (temp) => {
            if (temp === undefined || temp === null) return '';
            const t = parseFloat(temp);
            let tempClass = t > 35 ? 'temp-high' : (t >= 30 ? 'temp-mid' : 'temp-low');
            return `
                <div class="temp-container ${tempClass}">
                    <div class="temp-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"></path>
                        </svg>
                    </div>
                    <span class="temp-text">${Math.round(t)}°</span>
                </div>
            `;
        };

        if (!unitEl) {
            unitEl = document.createElement('div');
            unitEl.className = 'unit';
            unitEl.dataset.id = unit.id;
            unitEl.innerHTML = `
                <div class="unit-info">
                    <div class="unit-top-row" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <span class="info-ecid unit-id-display"></span>
                        <span class="info-ecid unit-sn-display" style="margin-left: 10px; font-weight: 400;"></span>
                    </div>
                    <div class="info-detail">
                        <div class="detail-main" style="display: flex; align-items: center; gap: 10px;"></div>
                        <div class="detail-sub" style="font-size: 12px; color: inherit; opacity: 0.8; margin-top: 4px;"></div>
                    </div>
                </div>
                <div class="unit-icon"></div>
            `;
            unitEl.addEventListener('click', (e) => {
                e.stopPropagation();
                if (onUnitClick) onUnitClick(e, unit);
            });
            elements.unitListContainer.appendChild(unitEl);
        }

        const currentClassName = `unit ${isSelected ? 'selected' : ''}`;
        if (unitEl.className !== currentClassName) unitEl.className = currentClassName;
        unitEl.dataset.index = index;

        const idDisplay = unitEl.querySelector('.unit-id-display');
        if (idDisplay.textContent !== unit.id) idDisplay.textContent = unit.id;
        const snDisplay = unitEl.querySelector('.unit-sn-display');
        const snValue = (unit.detail && unit.detail.serial_number) ? unit.detail.serial_number : '';
        if (snDisplay.textContent !== snValue) snDisplay.textContent = snValue;

        const detailMain = unitEl.querySelector('.detail-main');
        const detailSub = unitEl.querySelector('.detail-sub');

        if (unit.type === 'testing') {
            if (unit.detail) {
                const { config, sw_vers, unit_number, cg_vendor } = unit.detail;
                const unitNumHtml = `<span style="font-weight: 700;">${unit_number || '---'}</span>`;
                const spinnerHtml = `<div class="spinner"></div>`;
                const newMainHtml = `${unitNumHtml}${spinnerHtml}`;
                if (detailMain.innerHTML !== newMainHtml) detailMain.innerHTML = newMainHtml;
                const newSubText = `${sw_vers || ''} ${config || ''} ${cg_vendor || ''}`;
                if (detailSub.textContent !== newSubText) detailSub.textContent = newSubText;
            } else {
                if (!detailMain.querySelector('.spinner')) {
                    detailMain.innerHTML = '<div class="spinner"></div>';
                    detailSub.textContent = '';
                }
            }
        } else if (unit.detail) {
            const { config, battery, sw_vers, unit_number, temperature, cg_vendor } = unit.detail;
            const unitNumHtml = `<span style="font-weight: 700;">${unit_number || '---'}</span>`;
            const batteryHtml = (battery !== undefined && battery !== null) ? `<div class="battery-container">${getBatteryHtml(parseInt(battery))}</div>` : '';
            const tempHtml = getTemperatureHtml(temperature);
            const newMainHtml = `${unitNumHtml}${batteryHtml}${tempHtml}`;
            if (detailMain.innerHTML !== newMainHtml) detailMain.innerHTML = newMainHtml;
            const newSubText = `${sw_vers || ''} ${config || ''} ${cg_vendor || ''}`;
            if (detailSub.textContent !== newSubText) detailSub.textContent = newSubText;
        } else {
            detailMain.innerHTML = '';
            detailSub.textContent = '';
        }

        if (elements.unitListContainer.children[index] !== unitEl) {
            elements.unitListContainer.insertBefore(unitEl, elements.unitListContainer.children[index]);
        }
    });

    existingElements.forEach(el => {
        if (!currentIds.has(el.dataset.id)) el.remove();
    });
}

export function renderSettingsView() {
    let header = elements.mainContent.querySelector('.settings-header');
    let table = elements.mainContent.querySelector('.script-table');
    const isCorrectView = header && header.querySelector('h1')?.textContent === 'Script Settings';

    if (!isCorrectView || !table) {
        elements.mainContent.innerHTML = `
            <div class="settings-header">
                <h1>Script Settings</h1>
                <div class="settings-header-actions">
                    <button class="btn-clean-disabled" id="btn_clean_disabled">Clean</button>
                    <button class="btn-add-primary" id="btn_open_modal">+ Add Script</button>
                </div>
            </div>
            <table class="script-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Path</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
        `;
        document.getElementById('btn_open_modal').onclick = openModal;
        document.getElementById('btn_clean_disabled').onclick = async () => {
            const disabledCount = Object.values(state.scriptInfo).filter(info => info.status === false).length;
            if (disabledCount === 0) {
                showToast('No disabled scripts to clean', 'info');
                return;
            }
            if (!await showConfirmDialog(`Are you sure you want to remove ${disabledCount} disabled script(s)?`, 'Clean')) return;
            const successCount = await cleanDisabledScripts();
            await fetchScriptInfo(renderSettingsView);
            showToast(`Removed ${successCount} disabled script(s)`, 'success');
        };
        table = elements.mainContent.querySelector('.script-table');
    }

    const tbody = table.querySelector('tbody');
    const existingRows = Array.from(tbody.querySelectorAll('tr'));
    const rowMap = new Map();
    existingRows.forEach(row => rowMap.set(row.dataset.name, row));

    const currentNames = new Set();
    const sortedEntries = Object.entries(state.scriptInfo)
        .sort(([, a], [, b]) => {
            if (a.status && !b.status) return -1;
            if (!a.status && b.status) return 1;
            return 0;
        });
    sortedEntries.forEach(([name, info], index) => {
        currentNames.add(name);
        let row = rowMap.get(name);
        const statusText = info.status ? 'Active' : 'Disabled';
        const rowClassName = !info.status ? 'script-item-disabled' : '';

        if (!row) {
            row = document.createElement('tr');
            row.dataset.name = name;
            row.innerHTML = `
                <td class="col-name"></td>
                <td class="col-path"></td>
                <td class="col-status">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="status-dot"></span>
                        <span class="status-text"></span>
                    </div>
                </td>
                <td class="col-action"><button class="btn-delete">Delete</button></td>
            `;
            tbody.appendChild(row);
        }

        if (row.className !== rowClassName) row.className = rowClassName;
        row.querySelector('.col-name').textContent = name;
        row.querySelector('.col-path').textContent = info.path;
        row.querySelector('.status-dot').className = `status-dot ${info.status ? 'online' : 'offline'}`;
        row.querySelector('.status-text').textContent = statusText;
        row.querySelector('.btn-delete').onclick = () => deleteScript(name, fetchScriptInfo);

        if (tbody.children[index] !== row) tbody.insertBefore(row, tbody.children[index]);
    });

    existingRows.forEach(row => {
        if (!currentNames.has(row.dataset.name)) row.remove();
    });
}

export function renderTestView() {
    const normalEcids = Array.from(state.selectedIds).filter(id => {
        const unit = state.allUnits.find(u => u.id === id);
        return unit && unit.type === 'normal';
    });

    let header = elements.mainContent.querySelector('.settings-header');
    const isCorrectView = header && (header.querySelector('h1')?.textContent.startsWith('Run Test') || header.querySelector('#test_view_title'));

    if (normalEcids.length === 0) {
        if (!isCorrectView || header.querySelector('h1')?.textContent !== 'Run Test') {
            elements.mainContent.innerHTML = `
                <div class="settings-header">
                    <h1>Run Test</h1>
                </div>
                <div class="no-units-msg" style="padding: 20px; color: var(--text-secondary);">
                    No normal units selected. Please select at least one unit that is not in testing state.
                </div>
            `;
        }
        return;
    }

    if (!isCorrectView || !elements.mainContent.querySelector('.script-selection-list')) {
        elements.mainContent.innerHTML = `
            <div class="settings-header">
                <h1 id="test_view_title"></h1>
            </div>
            <div class="script-selection-list"></div>
        `;
    }

    const titleEl = document.getElementById('test_view_title');
    if (titleEl) titleEl.textContent = `Run Test (${normalEcids.length} Units Selected)`;

    const listContainer = elements.mainContent.querySelector('.script-selection-list');
    const existingElements = Array.from(listContainer.querySelectorAll('.script-selection-item'));
    const elementMap = new Map();
    existingElements.forEach(el => elementMap.set(el.dataset.name, el));

    const currentNames = new Set();
    const sortedEntries = Object.entries(state.scriptInfo)
        .sort(([, a], [, b]) => {
            if (a.status && !b.status) return -1;
            if (!a.status && b.status) return 1;
            return 0;
        });
    sortedEntries.forEach(([name, info], index) => {
        currentNames.add(name);
        let item = elementMap.get(name);
        const currentClassName = `script-selection-item ${!info.status ? 'disabled' : ''}`;

        if (!item) {
            item = document.createElement('div');
            item.dataset.name = name;
            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="status-dot"></span>
                    <div class="script-name" style="font-weight: bold;"></div>
                </div>
                <div class="script-path" style="font-size: 0.85em; opacity: 0.8; margin-top: 4px; padding-left: 16px;"></div>
            `;
            listContainer.appendChild(item);
        }

        if (item.className !== currentClassName) item.className = currentClassName;
        item.querySelector('.status-dot').className = `status-dot ${info.status ? 'online' : 'offline'}`;
        item.querySelector('.script-name').textContent = name;
        item.querySelector('.script-path').textContent = info.path;
        item.onclick = info.status ? () => fetchMethods(name, renderMethodModal) : null;

        if (listContainer.children[index] !== item) listContainer.insertBefore(item, listContainer.children[index]);
    });

    existingElements.forEach(el => {
        if (!currentNames.has(el.dataset.name)) el.remove();
    });
}

export function renderMethodModal(scriptName, methods) {
    state.currentScriptForMethod = scriptName;
    state.allMethodsForCurrentScript = methods;
    state.selectedMethod = null;
    elements.methodModalTitle.textContent = `Select Method for ${scriptName}`;
    elements.btnMethodConfirm.disabled = true;
    elements.methodSearchInput.value = '';
    filterMethods();
    elements.methodModalOverlay.style.display = 'flex';
}

export function filterMethods() {
    const query = elements.methodSearchInput.value;
    let filteredMethods = state.allMethodsForCurrentScript;
    
    if (query) {
        try {
            if (state.isSearchRegex) {
                const regex = new RegExp(query, state.isSearchCaseSensitive ? '' : 'i');
                filteredMethods = state.allMethodsForCurrentScript.filter(m => regex.test(m));
            } else {
                const lowerQuery = query.toLowerCase();
                filteredMethods = state.allMethodsForCurrentScript.filter(m => state.isSearchCaseSensitive ? m.includes(query) : m.toLowerCase().includes(lowerQuery));
            }
        } catch (e) { filteredMethods = []; }
    }

    const existingElements = Array.from(elements.methodListContainer.querySelectorAll('.method-item'));
    const elementMap = new Map();
    existingElements.forEach(el => elementMap.set(el.dataset.method, el));

    if (filteredMethods.length === 0) {
        elements.methodListContainer.innerHTML = '<div id="no_methods_msg" style="padding: 20px; text-align: center; color: var(--text-secondary);">No methods found.</div>';
    } else {
        const msg = document.getElementById('no_methods_msg');
        if (msg) msg.remove();
        const currentMethods = new Set();
        filteredMethods.forEach((method, index) => {
            currentMethods.add(method);
            let item = elementMap.get(method);
            const isSelected = state.selectedMethod === method;
            const currentClassName = `method-item ${isSelected ? 'selected' : ''}`;

            if (!item) {
                item = document.createElement('div');
                item.className = 'method-item';
                item.dataset.method = method;
                item.textContent = method;
                item.onclick = () => {
                    const prev = elements.methodListContainer.querySelector('.method-item.selected');
                    if (prev) prev.classList.remove('selected');
                    item.classList.add('selected');
                    state.selectedMethod = method;
                    elements.btnMethodConfirm.disabled = false;
                };
                elements.methodListContainer.appendChild(item);
            }
            if (item.className !== currentClassName) item.className = currentClassName;
            if (elements.methodListContainer.children[index] !== item) elements.methodListContainer.insertBefore(item, elements.methodListContainer.children[index]);
        });
        existingElements.forEach(el => {
            if (!currentMethods.has(el.dataset.method)) el.remove();
        });
    }
}

export function updateMainView() {
    const navButtons = {
        'test': document.getElementById('btn_test'),
        'logs': document.getElementById('btn_log'),
        'settings': document.getElementById('btn_setting')
    };

    Object.entries(navButtons).forEach(([view, btn]) => {
        if (btn) btn.classList.toggle('active', state.currentView === view);
    });

    if (state.currentView === 'settings') return renderSettingsView();
    if (state.currentView === 'test') return renderTestView();
    if (state.currentView === 'logs') {
        const currentSelection = Array.from(state.selectedIds).sort().join(',');
        const isSameSelection = currentSelection === state.lastLogSelection;
        
        if (elements.mainContent.querySelector('.log-container')) {
            if (!isSameSelection) return renderLogView();
            return; 
        }
        return renderLogView();
    }

    if (state.selectedIds.size === 0) {
        if (!elements.mainContent.querySelector('#no_selection_msg')) {
            elements.mainContent.innerHTML = '<h1 id="no_selection_msg">StressRack Test</h1><p>Select a unit to see details or logs.</p>';
        }
    } else {
        renderSelectedUnitsTable();
    }

    const toolView = document.getElementById('tool_view');
    if (toolView) {
        toolView.style.display = 'block';
        renderToolView();
    }
}

export function renderSelectedUnitsTable() {
    const selectedList = Array.from(state.selectedIds);
    let header = elements.mainContent.querySelector('.settings-header');
    let table = elements.mainContent.querySelector('.detail-table');
    const isCorrectView = header && header.querySelector('h1')?.textContent.startsWith('Selected Units');

    if (!isCorrectView || !table) {
        elements.mainContent.innerHTML = `
            <div class="settings-header">
                <h1 id="selected_units_title"></h1>
            </div>
            <table class="script-table detail-table">
                <thead>
                    <tr><th>ECID</th><th>SN</th><th>Unit #</th><th>SW Version</th><th>Config</th></tr>
                </thead>
                <tbody></tbody>
            </table>
        `;
        table = elements.mainContent.querySelector('.detail-table');
    }

    const titleEl = document.getElementById('selected_units_title');
    if (titleEl) titleEl.textContent = `Selected Units (${selectedList.length})`;

    const tbody = table.querySelector('tbody');
    const newBodyHtml = selectedList.map(id => {
        const unit = state.allUnits.find(u => u.id === id);
        const detail = unit?.detail || {};
        return `<tr><td style="font-family: monospace;">${id}</td><td>${detail.serial_number || '---'}</td><td>${detail.unit_number || '---'}</td><td>${detail.sw_vers || '---'}</td><td>${detail.config || '---'}</td></tr>`;
    }).join('');

    if (tbody.innerHTML !== newBodyHtml) tbody.innerHTML = newBodyHtml;
}

export function renderLogView() {
    startLogStream(
        (count) => {
            elements.mainContent.innerHTML = `
                <div class="log-header">
                    <h1>Real-time Logs ${count > 0 ? `(${count})` : ''}</h1>
                    <button class="btn-clear-log" id="btn_clear_log">Clear</button>
                </div>
                <div id="log_output" class="log-container">${count > 0 ? 'Connecting...' : 'No units selected.'}</div>
            `;
            const clearBtn = document.getElementById('btn_clear_log');
            if (clearBtn) clearBtn.onclick = clearLogs;
        },
        (line, isError) => {
            const logOutput = document.getElementById('log_output');
            if (!logOutput) return;
            if (logOutput.textContent === 'Connecting...') logOutput.innerHTML = '';
            
            if (!line) return;
            
            const isAtBottom = logOutput.scrollHeight - logOutput.scrollTop <= logOutput.clientHeight + 25;
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            if (isError) entry.style.color = '#ff4d4f';
            entry.textContent = line;
            logOutput.appendChild(entry);
            if (isAtBottom) logOutput.scrollTop = logOutput.scrollHeight;
        }
    );
}
