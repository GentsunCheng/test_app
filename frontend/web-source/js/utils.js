import { state } from './store.js';

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
    btnScanScript: document.getElementById('btn_scan_script')
};

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

export function addScriptEntry(name, path) {
    const entry = document.createElement('div');
    entry.className = 'script-entry';

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
    removeBtn.onclick = () => {
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
