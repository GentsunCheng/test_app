import { state } from './store.js';
import { showToast } from './utils.js';

const toolState = {
    loopCommands: [],
    loopRunning: false,
    loopInterval: null,
    loopResults: {},
    ecidCmdProgress: {},
    processedEcids: new Set(),
    cmdSequence: 0,
    _initialized: false,
    _lastCommandsSnapshot: '',
    _lastResultsSnapshot: '',
};

let AVAILABLE_COMMANDS = [];
let _fetchRetryCount = 0;
const MAX_FETCH_RETRIES = 5;

async function fetchAvailableCommands() {
    while (_fetchRetryCount < MAX_FETCH_RETRIES) {
        try {
            const response = await fetch(`${state.API_BASE}/api/get_cmd_list`);
            const data = await response.json();
            if (Array.isArray(data)) {
                AVAILABLE_COMMANDS.length = 0;
                AVAILABLE_COMMANDS.push(...data);
                if (!AVAILABLE_COMMANDS.includes('discharge')) {
                    AVAILABLE_COMMANDS.push('discharge');
                }
            }
            _fetchRetryCount = 0;
            return true;
        } catch (error) {
            _fetchRetryCount++;
            console.error(`Error fetching available commands (${_fetchRetryCount}/${MAX_FETCH_RETRIES}):`, error);
            if (_fetchRetryCount < MAX_FETCH_RETRIES) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }
    _fetchRetryCount = 0;
    return false;
}

export function refreshToolResults() {
    const toolView = document.getElementById('tool_view');
    if (toolView) toolView.style.removeProperty('display');
    renderLoopResults();
}

export async function renderToolView() {
    const toolView = document.getElementById('tool_view');
    if (!toolView) return;
    toolView.style.removeProperty('display');

    const mainContent = document.getElementById('main_content');
    if (mainContent) {
        const selectedCount = state.selectedIds.size;
        const title = mainContent.querySelector('h1');
        if (title) {
            title.textContent = `Selected Units (${selectedCount})`;
        }
    }

    if (!toolState._initialized) {
        const ok = await fetchAvailableCommands();
        toolState._initialized = ok;
        if (!ok) {
            showToast('Failed to load available commands after retries', 'error');
        }
        setupCmdButtons();
        setupdischargeButton();
        setupLoopListDragDrop();
        setupLoopToggle();
    }
    renderLoopList();
    renderLoopResults();
}

function getSelectedNormalEcids() {
    return Array.from(state.selectedIds).filter(id => {
        const unit = state.allUnits.find(u => u.id === id);
        return unit && unit.type === 'normal';
    });
}

function getAllNormalEcids() {
    return state.allUnits
        .filter(unit => unit.type === 'normal')
        .map(unit => unit.id);
}

async function sendCmd(ecids, cmd) {
    try {
        const response = await fetch(`${state.API_BASE}/api/send_ssh_cmd`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ecids, cmd })
        });
        const result = await response.json();
        return { success: result.status === 'success', message: result.cmd || result.discharge_result || '' };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function senddischarge(ecids, targetPower) {
    try {
        const response = await fetch(`${state.API_BASE}/api/discharge_battery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ecids, target_power: targetPower })
        });
        const result = await response.json();
        return { success: result.status === 'success', message: result.discharge_result || '' };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

function setupCmdButtons() {
    const cmdContainer = document.querySelector('.unit-tool');
    if (!cmdContainer) return;

    cmdContainer.querySelectorAll('.cmd-btn[data-cmd]').forEach(btn => btn.remove());

    AVAILABLE_COMMANDS.forEach(cmd => {
        if (cmd === 'discharge') return;
        const btn = document.createElement('button');
        btn.className = 'cmd-btn';
        btn.dataset.cmd = cmd;
        btn.textContent = cmd;
        cmdContainer.appendChild(btn);
    });

    const btns = cmdContainer.querySelectorAll('.cmd-btn[data-cmd]');
    btns.forEach(btn => {
        btn.onclick = async () => {
            const cmd = btn.dataset.cmd;
            const ecids = getSelectedNormalEcids();
            if (ecids.length === 0) {
                showToast('No normal units selected', 'error');
                return;
            }
            btn.classList.remove('error', 'success');
            btn.classList.add('sending');
            btn.disabled = true;
            const result = await sendCmd(ecids, cmd);
            btn.classList.remove('sending');
            btn.disabled = false;
            if (result.success) {
                btn.classList.add('success');
                showToast(`${cmd}: ${result.message || 'Success'}`, 'success');
            } else {
                btn.classList.add('error');
                showToast(`${cmd}: ${result.message || 'Failed'}`, 'error');
            }
            setTimeout(() => {
                btn.classList.remove('success', 'error');
            }, 2000);
        };
    });
}

function setupdischargeButton() {
    const dischargeBtn = document.getElementById('btn_discharge');
    const dischargeInput = document.getElementById('discharge_power_input');
    if (!dischargeBtn || !dischargeInput) return;

    dischargeInput.oninput = () => {
        let val = parseInt(dischargeInput.value);
        if (isNaN(val)) {
            dischargeInput.value = '';
            return;
        }
        if (val < 0) dischargeInput.value = 0;
        else if (val > 100) dischargeInput.value = 100;
    };

    dischargeInput.addEventListener('wheel', (e) => {
        e.preventDefault();
        let val = parseInt(dischargeInput.value) || 0;
        val += e.deltaY > 0 ? -1 : 1;
        val = Math.max(0, Math.min(100, val));
        dischargeInput.value = val;
    }, { passive: false });

    dischargeBtn.onclick = async () => {
        const ecids = getSelectedNormalEcids();
        if (ecids.length === 0) {
            showToast('No normal units selected', 'error');
            return;
        }
        const targetPower = parseInt(dischargeInput.value);
        if (isNaN(targetPower) || targetPower < 0 || targetPower > 100) {
            showToast('Please enter a valid power value (0-100)', 'error');
            return;
        }
        dischargeBtn.classList.remove('error', 'success');
        dischargeBtn.classList.add('sending');
        dischargeBtn.disabled = true;
        const result = await senddischarge(ecids, targetPower);
        dischargeBtn.classList.remove('sending');
        dischargeBtn.disabled = false;
        if (result.success) {
            dischargeBtn.classList.add('success');
            showToast(`discharge: ${result.message || 'Success'}`, 'success');
        } else {
            dischargeBtn.classList.add('error');
            showToast(`discharge: ${result.message || 'Failed'}`, 'error');
        }
        setTimeout(() => {
            dischargeBtn.classList.remove('success', 'error');
        }, 2000);
    };
}

function setupLoopListDragDrop() {
    const loopList = document.getElementById('loop_list');
    if (!loopList) return;

    loopList.addEventListener('dragover', (e) => {
        e.preventDefault();
        loopList.classList.add('drag-over');
    });

    loopList.addEventListener('dragleave', () => {
        loopList.classList.remove('drag-over');
    });

    loopList.addEventListener('drop', (e) => {
        e.preventDefault();
        loopList.classList.remove('drag-over');
        const cmd = e.dataTransfer.getData('text/cmd');
        if (cmd && AVAILABLE_COMMANDS.includes(cmd) && !toolState.loopCommands.includes(cmd)) {
            if (toolState.loopRunning) {
                stopLoop();
                toolState.ecidCmdProgress = {};
                toolState.loopResults = {};
                showToast('Loop stopped due to command list change', 'info');
            }
            toolState.loopCommands.push(cmd);
            renderLoopList();
            renderLoopResults();
        }
    });

    document.querySelectorAll('.unit-tool .cmd-btn[data-cmd]').forEach(btn => {
        btn.draggable = true;
        btn.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/cmd', btn.dataset.cmd);
        });
    });

    const dischargeBtn = document.getElementById('btn_discharge');
    if (dischargeBtn) {
        dischargeBtn.draggable = true;
        dischargeBtn.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/cmd', 'discharge');
        });
    }
}

function renderLoopList() {
    const loopList = document.getElementById('loop_list');
    if (!loopList) return;

    const commandsSnapshot = JSON.stringify(toolState.loopCommands);
    if (commandsSnapshot === toolState._lastCommandsSnapshot) return;
    toolState._lastCommandsSnapshot = commandsSnapshot;

    const placeholder = loopList.querySelector('.loop-list-placeholder');
    if (placeholder) placeholder.remove();

    const existingItems = loopList.querySelectorAll('.loop-list-item');
    existingItems.forEach(el => el.remove());

    if (toolState.loopCommands.length === 0) {
        const placeholderEl = document.createElement('span');
        placeholderEl.className = 'loop-list-placeholder';
        placeholderEl.textContent = 'Drag commands here';
        loopList.appendChild(placeholderEl);
        return;
    }

    toolState.loopCommands.forEach((cmd, index) => {
        const item = document.createElement('span');
        item.className = 'loop-list-item';
        item.draggable = true;
        item.dataset.index = index;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-item';
        removeBtn.textContent = 'x';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            toolState.loopCommands.splice(index, 1);
            if (toolState.loopRunning) {
                stopLoop();
                toolState.ecidCmdProgress = {};
                toolState.loopResults = {};
                showToast('Loop stopped due to command list change', 'info');
            }
            renderLoopList();
            renderLoopResults();
        };

        let dropHandled = false;

        item.addEventListener('dragstart', (e) => {
            dropHandled = false;
            item.classList.add('dragging');
            e.dataTransfer.setData('text/loop-index', index);
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            if (!dropHandled) {
                item.remove();
                toolState.loopCommands.splice(index, 1);
                if (toolState.loopRunning) {
                    stopLoop();
                    toolState.ecidCmdProgress = {};
                    toolState.loopResults = {};
                    showToast('Loop stopped due to command list change', 'info');
                }
                toolState._lastCommandsSnapshot = '';
                toolState._lastResultsSnapshot = '';
                renderLoopResults();
            }
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            dropHandled = true;
            const fromIndex = parseInt(e.dataTransfer.getData('text/loop-index'));
            if (isNaN(fromIndex)) return;
            if (toolState.loopRunning) {
                stopLoop();
                toolState.ecidCmdProgress = {};
                toolState.loopResults = {};
                showToast('Loop stopped due to command list change', 'info');
            }
            const cmdToMove = toolState.loopCommands.splice(fromIndex, 1)[0];
            const toIndex = fromIndex < index ? index - 1 : index;
            toolState.loopCommands.splice(toIndex, 0, cmdToMove);
            renderLoopList();
            renderLoopResults();
        });

        const textSpan = document.createElement('span');
        textSpan.textContent = cmd;
        item.appendChild(textSpan);
        item.appendChild(removeBtn);
        loopList.appendChild(item);
    });
}

function setupLoopToggle() {
    const loopBtn = document.getElementById('btn_loop_toggle');
    if (!loopBtn) return;
    loopBtn.onclick = () => {
        if (toolState.loopRunning) {
            stopLoop();
        } else {
            startLoop();
        }
    };
}

function startLoop() {
    const ecids = getAllNormalEcids();
    if (toolState.loopCommands.length === 0) {
        showToast('No commands in loop list. Drag commands first.', 'error');
        return;
    }

    toolState.loopRunning = true;
    toolState.cmdSequence++;

    const loopBtn = document.getElementById('btn_loop_toggle');
    if (loopBtn) {
        loopBtn.textContent = 'Stop';
        loopBtn.classList.add('active');
    }

    const currentEcids = getAllNormalEcids();
    currentEcids.forEach(ecid => {
        if (!(ecid in toolState.ecidCmdProgress)) {
            toolState.ecidCmdProgress[ecid] = 0;
        }
    });

    renderLoopResults();
    showToast('Loop started', 'success');
    executeLoopCycle();
}

function stopLoop() {
    toolState.loopRunning = false;
    if (toolState.loopInterval) {
        clearTimeout(toolState.loopInterval);
        toolState.loopInterval = null;
    }

    const loopBtn = document.getElementById('btn_loop_toggle');
    if (loopBtn) {
        loopBtn.textContent = 'Loop';
        loopBtn.classList.remove('active');
    }

    showToast('Loop stopped', 'info');
}

async function executeLoopCycle() {
    if (!toolState.loopRunning) return;

    const seq = toolState.cmdSequence;
    const ecids = getAllNormalEcids();

    ecids.forEach(ecid => {
        if (!(ecid in toolState.ecidCmdProgress)) {
            toolState.ecidCmdProgress[ecid] = 0;
        }
    });

    let hasWork = false;
    for (const ecid of ecids) {
        const progress = toolState.ecidCmdProgress[ecid];
        if (progress < toolState.loopCommands.length) {
            const prevKey = `${ecid}:${progress - 1}`;
            const prevResult = toolState.loopResults[prevKey];
            if (!prevResult || prevResult.status !== 'error') {
                hasWork = true;
                break;
            }
        }
    }

    if (!hasWork) {
        if (toolState.loopRunning) {
            toolState.loopInterval = setTimeout(() => executeLoopCycle(), 2000);
        }
        return;
    }

    for (let cmdIndex = 0; cmdIndex < toolState.loopCommands.length; cmdIndex++) {
        if (!toolState.loopRunning || seq !== toolState.cmdSequence) return;

        const cmd = toolState.loopCommands[cmdIndex];
        const targetEcids = ecids.filter(ecid => {
            const progress = toolState.ecidCmdProgress[ecid] ?? 0;
            const prevKey = `${ecid}:${progress - 1}`;
            const prevResult = toolState.loopResults[prevKey];
            const hasError = prevResult?.status === 'error';
            return progress === cmdIndex && !hasError;
        });

        if (targetEcids.length === 0) continue;

        targetEcids.forEach(ecid => {
            const k = `${ecid}:${cmdIndex}`;
            toolState.loopResults[k] = { status: 'running', message: '' };
        });
        renderLoopResults();

        let result;
        if (cmd === 'discharge') {
            const powerInput = document.getElementById('discharge_power_input');
            const targetPower = powerInput ? parseInt(powerInput.value) || 5 : 5;
            result = await senddischarge(targetEcids, targetPower);
        } else {
            result = await sendCmd(targetEcids, cmd);
        }

        if (!toolState.loopRunning || seq !== toolState.cmdSequence) return;

        targetEcids.forEach(ecid => {
            const k = `${ecid}:${cmdIndex}`;
            if (result.success) {
                toolState.loopResults[k] = { status: 'success', message: result.message };
                toolState.ecidCmdProgress[ecid] = cmdIndex + 1;
            } else {
                toolState.loopResults[k] = { status: 'error', message: result.message || 'Failed' };
            }
        });

        renderLoopResults();
    }

    if (toolState.loopRunning && seq === toolState.cmdSequence) {
        toolState.loopInterval = setTimeout(() => executeLoopCycle(), 1000);
    }
}

function renderLoopResults() {
    const headerEl = document.getElementById('loop_results_header');
    const bodyEl = document.getElementById('loop_results_body');
    if (!headerEl || !bodyEl) return;

    const commands = toolState.loopCommands;
    const ecids = getAllNormalEcids();

    function currentSnapshot() {
        return ecids.join(',') + '|' + commands.join(',') + '|' + JSON.stringify(toolState.loopResults) + '|' + JSON.stringify(toolState.ecidCmdProgress);
    }

    if (currentSnapshot() === toolState._lastResultsSnapshot) return;

    let headerHtml = '<tr><th>ECID</th>';
    commands.forEach(cmd => {
        headerHtml += `<th>${cmd}</th>`;
    });
    headerHtml += '</tr>';
    headerEl.innerHTML = headerHtml;

    if (ecids.length === 0) {
        bodyEl.innerHTML = '';
        toolState._lastResultsSnapshot = currentSnapshot();
        return;
    }

    let bodyHtml = '';
    ecids.forEach(ecid => {
        bodyHtml += `<tr><td style="font-family: monospace; font-size: 12px;">${ecid}</td>`;
        for (let cmdIndex = 0; cmdIndex < commands.length; cmdIndex++) {
            const key = `${ecid}:${cmdIndex}`;
            const result = toolState.loopResults[key];
            let statusClass = 'pending';
            let displayText = '-';

            if (result) {
                statusClass = result.status;
                if (result.status === 'running') {
                    displayText = '...';
                } else if (result.status === 'success') {
                    displayText = 'OK';
                } else if (result.status === 'error') {
                    displayText = 'ERR';
                } else if (result.status === 'pending' || result.status === 'skipped') {
                    displayText = result.status === 'skipped' ? 'SKIP' : '-';
                }
            } else if (toolState.ecidCmdProgress[ecid] !== undefined && cmdIndex < toolState.ecidCmdProgress[ecid]) {
                displayText = 'OK';
                statusClass = 'success';
                toolState.loopResults[key] = { status: 'success', message: '' };
            }

            const isRetryable = result?.status === 'error';
            const retryClass = isRetryable ? 'retryable' : '';

            bodyHtml += `<td class="result-cell ${statusClass} ${retryClass}" data-ecid="${ecid}" data-cmd-index="${cmdIndex}">${displayText}</td>`;
        }
        bodyHtml += '</tr>';
    });
    bodyEl.innerHTML = bodyHtml;

    bodyEl.querySelectorAll('.result-cell.retryable').forEach(cell => {
        cell.onclick = () => handleRetry(cell.dataset.ecid, parseInt(cell.dataset.cmdIndex));
    });

    toolState._lastResultsSnapshot = currentSnapshot();
}

function handleRetry(ecid, cmdIndex) {
    const ecids = getAllNormalEcids();
    if (!ecids.includes(ecid)) {
        showToast('ECID not a normal unit', 'error');
        return;
    }

    toolState.ecidCmdProgress[ecid] = cmdIndex;

    for (let i = cmdIndex; i < toolState.loopCommands.length; i++) {
        const key = `${ecid}:${i}`;
        delete toolState.loopResults[key];
    }

    showToast(`Retrying ${ecid} from command: ${toolState.loopCommands[cmdIndex]}`, 'info');
    renderLoopResults();

    if (!toolState.loopRunning) {
        startLoop();
    } else {
        if (toolState.loopInterval) {
            clearTimeout(toolState.loopInterval);
            toolState.loopInterval = null;
        }
        executeLoopCycle();
    }
}

export function hideToolView() {
    const toolView = document.getElementById('tool_view');
    if (toolView) {
        toolView.style.display = 'none';
    }
    if (toolState.loopRunning) {
        stopLoop();
    }
}

export function resetToolState() {
    if (toolState.loopRunning) {
        stopLoop();
    }
    toolState.loopCommands = [];
    toolState.loopResults = {};
    toolState.ecidCmdProgress = {};
    toolState.processedEcids.clear();
    renderLoopList();
    renderLoopResults();
}
