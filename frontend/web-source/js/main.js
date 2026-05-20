import { state } from './store.js';
import { getRefreshRates } from './utils.js';
import { fetchUnits, fetchScriptInfo, checkHostAvailability } from './services.js';
import { updateHostDisplay, renderUnits, updateMainView, renderSettingsView, renderTestView } from './views.js';
import { initEventListeners, handleUnitClick } from './controller.js';
import { refreshAllTTLs } from './detailCache.js';

function updateIntervals() {
    const rates = getRefreshRates();
    if (rates.state === state.currentRefreshState) return;
    
    state.currentRefreshState = rates.state;
    console.log(`Switching to ${rates.state} mode. Rates: Units ${rates.units}ms, Scripts ${rates.scripts}ms`);

    if (state.unitsInterval) { clearInterval(state.unitsInterval); state.unitsInterval = null; }
    if (state.scriptsInterval) { clearInterval(state.scriptsInterval); state.scriptsInterval = null; }

    if (rates.units > 0) {
        state.unitsInterval = setInterval(() => {
            fetchUnits(() => {
                renderUnits(handleUnitClick);
                updateMainView();
            });
        }, rates.units);
    }

    if (rates.scripts > 0) {
        state.scriptsInterval = setInterval(() => {
            if (state.currentView === 'settings') fetchScriptInfo(renderSettingsView);
            if (state.currentView === 'test') fetchScriptInfo(renderTestView);
        }, rates.scripts);
    }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    updateHostDisplay();
    initEventListeners();
    
    checkHostAvailability(state.currentHost.url).then(available => {
        state.hostAvailability[state.currentHost.url] = available;
        updateHostDisplay();
    });

    fetchUnits(() => {
        renderUnits(handleUnitClick);
        updateMainView();
    });
    fetchScriptInfo();

    // Listeners for user activity
    window.addEventListener('mousemove', () => {
        state.lastMouseMoveTime = Date.now();
        if (state.currentRefreshState !== 'active') updateIntervals();
    });

    document.addEventListener('visibilitychange', updateIntervals);

    // Check for idle state transition periodically
    setInterval(() => {
        if (state.currentRefreshState === 'active') {
            const idleTime = Date.now() - state.lastMouseMoveTime;
            if (idleTime > 60000) updateIntervals();
        }
    }, 5000);

    // Start with initial intervals
    const initialRates = getRefreshRates();
    state.unitsInterval = setInterval(() => {
        fetchUnits(() => {
            renderUnits(handleUnitClick);
            updateMainView();
        });
    }, initialRates.units);

    state.scriptsInterval = setInterval(() => {
        if (state.currentView === 'settings') fetchScriptInfo(renderSettingsView);
        if (state.currentView === 'test') fetchScriptInfo(renderTestView);
    }, initialRates.scripts);

    setInterval(refreshAllTTLs, 60000);
});
