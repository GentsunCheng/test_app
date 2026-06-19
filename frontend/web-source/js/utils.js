import { state } from './store.js';
import { fetchMoreDetailInfo } from './services.js';

const FIELD_LABELS = {
    ecid: 'ECID',
    serial_number: 'Serial Number',
    unit_number: 'Unit Number',
    sw_vers: 'Software Version',
    config: 'Config',
    cg_vendor: 'CG Vendor',
    battery: 'Battery',
    temperature: 'Temperature',
    check_timestamp: 'Check Timestamp'
};

const DETAIL_INFO_EXCLUDED_FIELDS = ['check_timestamp'];
const DETAIL_INFO_POLL_INTERVAL_MS = 2000;

let detailInfoPollTimer = null;
let detailInfoPollEcids = [];
let detailInfoCopySetup = false;

function getFieldLabel(field) {
    return FIELD_LABELS[field] || field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function renderDetailInfoContent(data, ecids) {
    const content = elements.detailInfoContent;
    let html = '';
    ecids.forEach(ecid => {
        const detail = data[ecid];
        if (!detail) {
            html += `
                <div class="detail-info-section">
                    <div class="detail-info-ecid">${ecid}</div>
                    <div class="detail-info-empty">No data available</div>
                </div>
            `;
            return;
        }
        html += `<div class="detail-info-section"><div class="detail-info-ecid">${ecid}</div><div class="detail-info-grid">`;
        for (const [key, value] of Object.entries(detail)) {
            if (DETAIL_INFO_EXCLUDED_FIELDS.includes(key)) continue;
            html += `<div class="detail-info-item"><span class="detail-info-label">${getFieldLabel(key)}</span><span class="detail-info-value" data-field="${key}">${value !== null && value !== undefined ? value : '-'}</span></div>`;
        }
        html += '</div></div>';
    });
    content.innerHTML = html;
}

function setupCopyOnDoubleClick() {
    if (detailInfoCopySetup) return;
    detailInfoCopySetup = true;

    elements.detailInfoContent.addEventListener('dblclick', (e) => {
        let target = e.target.closest('.detail-info-value, .detail-info-label');
        if (!target) {
            target = e.target.closest('.detail-info-item');
            if (!target) return;
            target = target.querySelector('.detail-info-value');
            if (!target) return;
        }
        if (target.classList.contains('detail-info-label')) {
            const item = target.closest('.detail-info-item');
            if (!item) return;
            const valueEl = item.querySelector('.detail-info-value');
            if (!valueEl) return;
            target = valueEl;
        }

        const text = target.textContent;
        if (!text || text === '-') return;

        navigator.clipboard.writeText(text).then(() => {
            showToast(`Copied: ${text}`, 'success');
        }).catch(() => {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(target);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('copy');
            sel.removeAllRanges();
            showToast(`Copied: ${text}`, 'success');
        });
    });
}

function updateDetailInfoContent(data) {
    const sections = elements.detailInfoContent.querySelectorAll('.detail-info-section');
    sections.forEach(section => {
        const ecidEl = section.querySelector('.detail-info-ecid');
        if (!ecidEl) return;
        const ecid = ecidEl.textContent;
        const detail = data[ecid];
        if (!detail) return;

        const valueCells = section.querySelectorAll('.detail-info-value[data-field]');
        valueCells.forEach(cell => {
            const fieldKey = cell.dataset.field;
            const rawValue = detail[fieldKey];
            if (rawValue !== undefined && rawValue !== null) {
                cell.textContent = String(rawValue);
            }
        });
    });
}

async function pollDetailInfo() {
    if (detailInfoPollEcids.length === 0) return;
    try {
        const data = await fetchMoreDetailInfo(detailInfoPollEcids);
        updateDetailInfoContent(data);
    } catch (e) {
        // silent
    }
}

export function showMoreDetailInfo() {
    const selectedIds = Array.from(state.selectedIds);
    if (selectedIds.length === 0) return;

    detailInfoPollEcids = selectedIds;

    const overlay = elements.detailInfoModalOverlay;
    const content = elements.detailInfoContent;
    content.innerHTML = '<div class="detail-info-loading">Loading...</div>';
    overlay.style.display = 'flex';

    fetchMoreDetailInfo(selectedIds)
        .then(data => {
            renderDetailInfoContent(data, selectedIds);
            setupCopyOnDoubleClick();
            if (detailInfoPollTimer) clearInterval(detailInfoPollTimer);
            detailInfoPollTimer = setInterval(pollDetailInfo, DETAIL_INFO_POLL_INTERVAL_MS);
        })
        .catch(() => {
            content.innerHTML = '<div class="detail-info-empty">Failed to load detail info</div>';
        });
}

export function closeMoreDetailInfo() {
    if (detailInfoPollTimer) {
        clearInterval(detailInfoPollTimer);
        detailInfoPollTimer = null;
    }
    detailInfoPollEcids = [];
    elements.detailInfoModalOverlay.style.display = 'none';
    elements.detailInfoContent.innerHTML = '';
}

export const elements = {
    hostModalOverlay: document.getElementById('host_modal_overlay'),
    hostListContainer: document.getElementById('host_list'),
    currentHostNameSpan: document.getElementById('current_host_name'),
    newHostNameInput: document.getElementById('new_host_name'),
    newHostUrlInput: document.getElementById('new_host_url'),
    unitListContainer: document.getElementById('unit_list'),
    controlButtonBar: document.getElementById('control_button_bar'),
    mainContent: document.getElementById('main_content'),
    modalOverlay: document.getElementById('modal_overlay'),
    methodModalOverlay: document.getElementById('method_modal_overlay'),
    methodListContainer: document.getElementById('method_list'),
    methodModalTitle: document.getElementById('method_modal_title'),
    toastContainer: document.getElementById('toast_container'),
    scriptEntryList: document.getElementById('script_entry_list'),
    btnAddEntry: document.getElementById('btn_add_entry'),
    unitSearchInput: document.getElementById('unit_search_input'),
    methodSearchInput: document.getElementById('method_search_input'),
    btnSearchRegex: document.getElementById('btn_search_regex'),
    btnSearchCase: document.getElementById('btn_search_case'),
    btnUnitRegex: document.getElementById('btn_unit_regex'),
    btnUnitCase: document.getElementById('btn_unit_case'),
    btnMethodConfirm: document.getElementById('btn_method_confirm'),
    btnHost: document.getElementById('btn_host'),
    btnHostCancel: document.getElementById('btn_host_cancel'),
    btnHostAdd: document.getElementById('btn_host_add'),
    btnModalCancel: document.getElementById('btn_modal_cancel'),
    btnMethodCancel: document.getElementById('btn_method_cancel'),
    btnModalAdd: document.getElementById('btn_modal_add'),
    btnScanScript: document.getElementById('btn_scan_script'),
    detailInfoModalOverlay: document.getElementById('detail_info_modal_overlay'),
    detailInfoContent: document.getElementById('detail_info_content'),
    btnDetailInfoClose: document.getElementById('btn_detail_info_close')
};

export function refreshElements() {
    elements.hostModalOverlay = document.getElementById('host_modal_overlay');
    elements.hostListContainer = document.getElementById('host_list');
    elements.currentHostNameSpan = document.getElementById('current_host_name');
    elements.newHostNameInput = document.getElementById('new_host_name');
    elements.newHostUrlInput = document.getElementById('new_host_url');
    elements.unitListContainer = document.getElementById('unit_list');
    elements.controlButtonBar = document.getElementById('control_button_bar');
    elements.mainContent = document.getElementById('main_content');
    elements.modalOverlay = document.getElementById('modal_overlay');
    elements.methodModalOverlay = document.getElementById('method_modal_overlay');
    elements.methodListContainer = document.getElementById('method_list');
    elements.methodModalTitle = document.getElementById('method_modal_title');
    elements.toastContainer = document.getElementById('toast_container');
    elements.scriptEntryList = document.getElementById('script_entry_list');
    elements.btnAddEntry = document.getElementById('btn_add_entry');
    elements.unitSearchInput = document.getElementById('unit_search_input');
    elements.methodSearchInput = document.getElementById('method_search_input');
    elements.btnSearchRegex = document.getElementById('btn_search_regex');
    elements.btnSearchCase = document.getElementById('btn_search_case');
    elements.btnUnitRegex = document.getElementById('btn_unit_regex');
    elements.btnUnitCase = document.getElementById('btn_unit_case');
    elements.btnMethodConfirm = document.getElementById('btn_method_confirm');
    elements.btnHost = document.getElementById('btn_host');
    elements.btnHostCancel = document.getElementById('btn_host_cancel');
    elements.btnHostAdd = document.getElementById('btn_host_add');
    elements.btnModalCancel = document.getElementById('btn_modal_cancel');
    elements.btnMethodCancel = document.getElementById('btn_method_cancel');
    elements.btnModalAdd = document.getElementById('btn_modal_add');
    elements.btnScanScript = document.getElementById('btn_scan_script');
    elements.detailInfoModalOverlay = document.getElementById('detail_info_modal_overlay');
    elements.detailInfoContent = document.getElementById('detail_info_content');
    elements.btnDetailInfoClose = document.getElementById('btn_detail_info_close');
}

export function showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

export function openModal() {
    elements.modalOverlay.style.display = 'flex';
    elements.scriptEntryList.innerHTML = '';
    addScriptEntry();
}

export function closeModal() {
    elements.modalOverlay.style.display = 'none';
}

export function addScriptEntry(name, path, selected = true) {
    const entry = document.createElement('div');
    entry.className = 'script-entry';
    if (selected) entry.classList.add('selected');
    entry.dataset.selected = String(selected);

    const nameField = document.createElement('div');
    nameField.className = 'entry-field';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'script-name-input';
    nameInput.placeholder = 'Script name';
    nameInput.value = name || '';
    const nameHint = document.createElement('span');
    nameHint.className = 'entry-hint';
    nameField.appendChild(nameInput);
    nameField.appendChild(nameHint);

    const pathField = document.createElement('div');
    pathField.className = 'entry-field';
    const pathInput = document.createElement('input');
    pathInput.type = 'text';
    pathInput.className = 'script-path-input';
    pathInput.placeholder = 'Script path';
    pathInput.value = path || '';
    const pathHint = document.createElement('span');
    pathHint.className = 'entry-hint';
    pathField.appendChild(pathInput);
    pathField.appendChild(pathHint);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-entry';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        if (elements.scriptEntryList.children.length > 1) {
            entry.remove();
        } else {
            nameInput.value = '';
            pathInput.value = '';
            validateScriptEntry(entry);
        }
    };

    entry.appendChild(nameField);
    entry.appendChild(pathField);
    entry.appendChild(removeBtn);

    entry.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-entry')) return;
        const isSelected = entry.dataset.selected === 'true';
        if (isSelected) {
            entry.dataset.selected = 'false';
            entry.classList.remove('selected');
        } else {
            entry.dataset.selected = 'true';
            entry.classList.add('selected');
        }
    });

    const onInput = () => validateScriptEntry(entry);
    nameInput.oninput = onInput;
    pathInput.oninput = onInput;

    elements.scriptEntryList.appendChild(entry);

    if (!name) nameInput.focus();
    if (name) validateScriptEntry(entry);
    return entry;
}

export function validateScriptEntry(entry) {
    const nameInput = entry.querySelector('.script-name-input');
    const pathInput = entry.querySelector('.script-path-input');
    const nameHint = entry.querySelector('.entry-field:first-child .entry-hint');
    const name = nameInput.value.trim();
    const path = pathInput.value.trim();

    nameInput.classList.remove('error', 'warning');
    nameHint.textContent = '';
    nameHint.className = 'entry-hint';
    pathInput.classList.remove('error');

    if (!name || !path) return false;

    const existing = state.scriptInfo[name];
    if (existing) {
        if (existing.status === false) {
            nameInput.classList.add('warning');
            nameHint.textContent = 'Name already exists (disabled). Will be overwritten.';
            nameHint.className = 'entry-hint warning';
        } else {
            nameInput.classList.add('error');
            nameHint.textContent = 'Name already exists';
            nameHint.className = 'entry-hint error';
            return false;
        }
    }

    const otherEntries = Array.from(elements.scriptEntryList.querySelectorAll('.script-entry'));
    const duplicate = otherEntries.some(other => {
        if (other === entry) return false;
        const otherName = other.querySelector('.script-name-input').value.trim();
        return otherName === name;
    });
    if (duplicate) {
        nameInput.classList.add('error');
        nameHint.textContent = 'Duplicate name in list';
        nameHint.className = 'entry-hint error';
        return false;
    }

    return true;
}

export function showConfirmDialog(message, title = 'Confirm') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm_modal_overlay');
        const titleEl = document.getElementById('confirm_modal_title');
        const messageEl = document.getElementById('confirm_modal_message');
        const btnOk = document.getElementById('btn_confirm_ok');
        const btnCancel = document.getElementById('btn_confirm_cancel');

        titleEl.textContent = title;
        messageEl.textContent = message;

        const cleanup = () => {
            overlay.style.display = 'none';
            btnOk.onclick = null;
            btnCancel.onclick = null;
        };

        btnOk.onclick = () => {
            cleanup();
            resolve(true);
        };
        btnCancel.onclick = () => {
            cleanup();
            resolve(false);
        };

        overlay.style.display = 'flex';
    });
}

export function closeMethodModal() {
    elements.methodModalOverlay.style.display = 'none';
}

export function stopLogs() {
    if (state.logAbortController) {
        try {
            state.logAbortController.abort();
        } catch (e) { /* ignore */ }
        state.logAbortController = null;
    }
    if (state.logReader) {
        try {
            state.logReader.cancel().catch(() => { /* Silent catch */ });
        } catch (e) { /* ignore */ }
        state.logReader = null;
    }
}

export function clearLogs() {
    const logOutput = document.getElementById('log_output');
    if (logOutput) logOutput.innerHTML = '';
}

export function getRefreshRates() {
    if (document.visibilityState === 'hidden') {
        return { units: 0, scripts: 0, state: 'hidden' };
    }
    const idleTime = Date.now() - state.lastMouseMoveTime;
    if (idleTime > 60000) {
        return { units: 1000, scripts: 10000, state: 'idle' };
    }
    return { units: 250, scripts: 250, state: 'active' };
}
