// --- State Management ---

export const state = {
    currentDomain: window.location.hostname,
    masterNodeName: 'Master',
    hosts: JSON.parse(localStorage.getItem('hosts')) || [
        { name: 'Master', url: `http://${window.location.hostname}:8196` }
    ],
    currentHost: null,
    API_BASE: '',
    hostAvailability: {}, // { url: boolean | 'checking' }
    allUnits: [], // { id, type: 'normal' | 'testing', detail: null }
    selectedIds: new Set(),
    focusId: null,
    anchorId: null,
    currentView: 'units', // 'units', 'settings', 'logs', 'test', or 'tool'
    scriptInfo: {}, // { script_name: { path, status } }
    logAbortController: null,
    logReader: null,
    selectedMethod: null,
    currentScriptForMethod: null,
    allMethodsForCurrentScript: [],
    methodFocusIndex: -1,
    isSearchRegex: false,
    isSearchCaseSensitive: false,
    isUnitSearchRegex: false,
    isUnitSearchCaseSensitive: false,
    isFetchingLogs: false,
    lastLogSelection: '', // Serialized selectedIds
    lastMouseMoveTime: Date.now(),
    currentRefreshState: 'active', // 'active', 'idle', 'hidden'
    unitsInterval: null,
    scriptsInterval: null,
    missingNormalUnitSince: new Map(), // { ecid -> timestamp when first missing from both lists }
    unitsRequestSeq: 0,
    scriptViewMode: localStorage.getItem('scriptViewMode') || 'list',
    _lastArrowTime: 0
};

// Initialize currentHost and API_BASE
state.currentHost = JSON.parse(localStorage.getItem('currentHost')) || state.hosts[0];
state.API_BASE = state.currentHost.url;

export function saveHosts() {
    localStorage.setItem('hosts', JSON.stringify(state.hosts));
    localStorage.setItem('currentHost', JSON.stringify(state.currentHost));
}

export function updateAPI() {
    state.API_BASE = state.currentHost.url;
}
