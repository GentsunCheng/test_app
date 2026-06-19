import { state } from './store.js';
import { getRefreshRates } from './utils.js';
import { fetchUnits, fetchScriptInfo, checkHostAvailability } from './services.js';
import { updateHostDisplay, renderUnits, updateMainView, renderSettingsView, renderTestView } from './views.js';
import { initEventListeners, initNavToolbar, handleUnitClick } from './controller.js';
import { refreshAllTTLs } from './detailCache.js';

function updateIntervals() {
    const rates = getRefreshRates();

    // 非 test 页面时，后台轮询降为 60s
    const isTestPage = state.navPage === 'test';
    if (!isTestPage) {
        rates.units = 60000;
        rates.scripts = 60000;
        rates.state = 'nav_background';
    }

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
// 阻止浏览器默认右键菜单（空白区域），不影响输入框等表单元素和自定义右键
document.addEventListener('contextmenu', (e) => {
    const tag = e.target.tagName;
    // 放行输入框、文本域、可编辑元素的选择/编辑相关右键菜单
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) {
        return;
    }
    e.preventDefault();
});

document.addEventListener('DOMContentLoaded', () => {
    // 导航页面切换时重新计算轮询频率（需在 initNavToolbar 之前注册）
    window.addEventListener('navpagechange', updateIntervals);

    updateHostDisplay();
    initEventListeners();
    
    checkHostAvailability(state.currentHost.url).then(available => {
        state.hostAvailability[state.currentHost.url] = available;
        updateHostDisplay();
    });

    window.addEventListener('hostavailabilitychange', updateHostDisplay);

    fetchUnits(() => {
        renderUnits(handleUnitClick);
        updateMainView();
    });
    fetchScriptInfo();

    // 先建立初始轮询，再初始化导航栏（navpagechange 事件会自动纠正非 test 页面的频率）
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

    // 导航栏初始化（会触发 navpagechange，非 test 页面会将频率降为 60s）
    initNavToolbar();

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

    setInterval(refreshAllTTLs, 60000);
});
