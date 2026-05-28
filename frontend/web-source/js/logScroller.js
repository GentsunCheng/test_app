const SAMPLE_TEXT = 'M';
const SCROLL_TOLERANCE = 40;
const DEFAULT_ROW_HEIGHT = 25;

export class LogVirtualScroller {
    constructor(container) {
        this.container = container;
        this.data = [];
        this._cachedHeights = [];
        this._positions = [0];
        this._defaultHeight = DEFAULT_ROW_HEIGHT;
        this._bufferSize = 10;
        this._lastStart = -1;
        this._lastEnd = -1;
        this._ticking = false;

        this._setupDOM();
        this._measureDefaultHeight();
        this._boundOnScroll = () => this._onScroll();
        this.container.addEventListener('scroll', this._boundOnScroll, { passive: true });
    }

    _setupDOM() {
        this.container.style.position = 'relative';
        this.container.style.overflowY = 'auto';

        this._spacer = document.createElement('div');
        this._spacer.className = 'log-vs-spacer';
        this.container.appendChild(this._spacer);

        this._viewport = document.createElement('div');
        this._viewport.className = 'log-vs-viewport';
        this._viewport.style.cssText = 'position:absolute;left:0;right:0;top:0;will-change:transform;pointer-events:none;';
        this.container.appendChild(this._viewport);
    }

    _measureDefaultHeight() {
        const el = document.createElement('div');
        el.className = 'log-entry';
        el.textContent = SAMPLE_TEXT;
        el.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0;';
        this.container.appendChild(el);
        const h = el.offsetHeight;
        if (h > 0) this._defaultHeight = h;
        this.container.removeChild(el);
    }

    push(text, isError = false) {
        const idx = this.data.length;
        this.data.push({ text, isError });
        this._cachedHeights[idx] = this._defaultHeight;
        this._positions[idx + 1] = this._positions[idx] + this._defaultHeight;

        const wasAtBottom = this._isAtBottom();
        this._updateSpacer();

        if (wasAtBottom) {
            this._scrollToBottom();
            this._render();
            if (!this._isAtBottom()) {
                this._scrollToBottom();
            }
        } else {
            const range = this._getVisibleRange();
            if (idx >= range.start && idx < range.end) {
                this._render();
            }
        }
    }

    clear() {
        this.data = [];
        this._cachedHeights = [];
        this._positions = [0];
        this._lastStart = -1;
        this._lastEnd = -1;
        this._viewport.innerHTML = '';
        this._updateSpacer();
        this.container.scrollTop = 0;
    }

    getAllText() {
        return this.data.map(d => d.text).join('\n');
    }

    destroy() {
        this.container.removeEventListener('scroll', this._boundOnScroll);
        const spacer = this.container.querySelector('.log-vs-spacer');
        if (spacer) spacer.remove();
        const vp = this.container.querySelector('.log-vs-viewport');
        if (vp) vp.remove();
    }

    _isAtBottom() {
        const totalHeight = this.data.length > 0 ? this._positions[this.data.length] : 0;
        return totalHeight - this.container.scrollTop <= this.container.clientHeight + SCROLL_TOLERANCE;
    }

    _scrollToBottom() {
        this.container.scrollTop = this.container.scrollHeight;
    }

    _getVisibleRange() {
        const total = this.data.length;
        if (total === 0) return { start: 0, end: 0 };

        const scrollTop = this.container.scrollTop;

        let lo = 0, hi = total;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this._positions[mid + 1] <= scrollTop) lo = mid + 1;
            else hi = mid;
        }
        const start = Math.max(0, lo - this._bufferSize);

        const limit = scrollTop + this.container.clientHeight;
        lo = start;
        hi = total - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >>> 1;
            if (this._positions[mid] < limit) lo = mid;
            else hi = mid - 1;
        }
        const end = Math.min(total, lo + 1 + this._bufferSize);

        return { start, end };
    }

    _updateSpacer() {
        const total = this.data.length;
        const h = total > 0 ? this._positions[total] : 0;
        this._spacer.style.height = h + 'px';
    }

    _onScroll() {
        if (!this._ticking) {
            this._ticking = true;
            requestAnimationFrame(() => {
                this._ticking = false;
                this._render();
            });
        }
    }

    _render() {
        const range = this._getVisibleRange();
        if (range.start === this._lastStart && range.end === this._lastEnd) return;
        this._lastStart = range.start;
        this._lastEnd = range.end;

        const top = range.start > 0 ? this._positions[range.start] : 0;
        this._viewport.style.transform = `translateY(${top}px)`;

        let html = '';
        for (let i = range.start; i < range.end; i++) {
            const d = this.data[i];
            const colorStyle = d.isError ? ' style="color:#ff4d4f"' : '';
            html += `<div class="log-entry" data-idx="${i}"${colorStyle}>${this._escape(d.text)}</div>`;
        }
        this._viewport.innerHTML = html;

        this._remeasureHeights();
    }

    _remeasureHeights() {
        const children = this._viewport.children;
        let changed = false;

        for (let i = 0; i < children.length; i++) {
            const el = children[i];
            const idx = parseInt(el.dataset.idx, 10);
            const actualHeight = el.offsetHeight;

            if (actualHeight > 0 && Math.abs(actualHeight - this._cachedHeights[idx]) > 0.5) {
                const diff = actualHeight - this._cachedHeights[idx];
                this._cachedHeights[idx] = actualHeight;

                for (let j = idx + 1; j <= this.data.length; j++) {
                    this._positions[j] += diff;
                }
                changed = true;
            }
        }

        if (changed) {
            this._updateSpacer();
            this._lastStart = -1;
            this._lastEnd = -1;
            const newRange = this._getVisibleRange();
            const newTop = newRange.start > 0 ? this._positions[newRange.start] : 0;
            this._viewport.style.transform = `translateY(${newTop}px)`;
            if (this._isAtBottom()) {
                this._scrollToBottom();
            }
        }
    }

    _escape(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
