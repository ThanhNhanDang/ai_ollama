/** @odoo-module **/

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { standardActionServiceProps } from "@web/webclient/actions/action_service";
import { Component, useState, onWillStart, onWillUnmount, useRef, onMounted } from "@odoo/owl";

const STORAGE_KEY = "ollama_pull_tasks";

// ── Chart config ──────────────────────────────────────────────────────────────
const CHART_MAX_POINTS = 30;   // 1 min @ 2s interval
const METRICS_INTERVAL = 2000; // ms

const MODEL_REQUIRED_RAM_GB = {
    "qwen2.5:0.5b": 0.5, "qwen2.5:1.5b": 1.2, "qwen2.5:3b": 2.4,
    "qwen2.5:7b": 5.6, "qwen2.5:14b": 10.8, "qwen2.5:32b": 24.0,
    "qwen2.5:72b": 54.0, "qwen2.5-coder:7b": 5.6,
    "llama3.1": 5.6, "llama3.1:70b": 50.0,
    "llama3.2:1b": 1.0, "llama3.2:3b": 2.4,
    "phi4-mini": 2.9, "phi4": 10.8,
    "gemma3:1b": 1.0, "gemma3:4b": 3.0, "gemma3:12b": 10.0,
    "mistral": 4.9, "mistral-small": 16.8,
    "deepseek-r1:1.5b": 1.2, "deepseek-r1:7b": 5.6,
    "deepseek-r1:14b": 10.8, "deepseek-r1:32b": 24.0, "deepseek-r1:70b": 50.0,
    "command-r": 24.0, "nomic-embed-text": 0.4,
};

const AVAILABLE_MODELS = [
    { id: "qwen2.5:0.5b", name: "Qwen 2.5 0.5B", size: "~0.4 GB" },
    { id: "qwen2.5:1.5b", name: "Qwen 2.5 1.5B", size: "~1.0 GB" },
    { id: "qwen2.5:3b", name: "Qwen 2.5 3B", size: "~2.0 GB" },
    { id: "qwen2.5:7b", name: "Qwen 2.5 7B", size: "~4.7 GB" },
    { id: "qwen2.5:14b", name: "Qwen 2.5 14B", size: "~9.0 GB" },
    { id: "qwen2.5:32b", name: "Qwen 2.5 32B", size: "~20 GB" },
    { id: "qwen2.5:72b", name: "Qwen 2.5 72B", size: "~45 GB" },
    { id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder 7B", size: "~4.7 GB" },
    { id: "llama3.1", name: "Llama 3.1 8B", size: "~4.7 GB" },
    { id: "llama3.1:70b", name: "Llama 3.1 70B", size: "~42 GB" },
    { id: "llama3.2:1b", name: "Llama 3.2 1B", size: "~0.8 GB" },
    { id: "llama3.2:3b", name: "Llama 3.2 3B", size: "~2.0 GB" },
    { id: "phi4-mini", name: "Phi-4 Mini 3.8B", size: "~2.4 GB" },
    { id: "phi4", name: "Phi-4 14B", size: "~9.0 GB" },
    { id: "gemma3:1b", name: "Gemma 3 1B", size: "~0.8 GB" },
    { id: "gemma3:4b", name: "Gemma 3 4B", size: "~2.5 GB" },
    { id: "gemma3:12b", name: "Gemma 3 12B", size: "~8.3 GB" },
    { id: "mistral", name: "Mistral 7B", size: "~4.1 GB" },
    { id: "mistral-small", name: "Mistral Small 24B", size: "~14 GB" },
    { id: "deepseek-r1:1.5b", name: "DeepSeek R1 1.5B", size: "~1.0 GB" },
    { id: "deepseek-r1:7b", name: "DeepSeek R1 7B", size: "~4.7 GB" },
    { id: "deepseek-r1:14b", name: "DeepSeek R1 14B", size: "~9.0 GB" },
    { id: "deepseek-r1:32b", name: "DeepSeek R1 32B", size: "~20 GB" },
    { id: "deepseek-r1:70b", name: "DeepSeek R1 70B", size: "~42 GB" },
    { id: "command-r", name: "Command-R 35B", size: "~20 GB" },
    { id: "nomic-embed-text", name: "Nomic Embed Text", size: "~0.3 GB" },
];

// ── Chart helpers ─────────────────────────────────────────────────────────────

function _setupCanvas(canvas) {
    if (!canvas) return { W: 0, H: 0 };
    const dpr = window.devicePixelRatio || 1;
    // Use CSS layout size (getBoundingClientRect gives actual rendered size)
    const W = canvas.clientWidth  || 300;
    const H = canvas.clientHeight || 60;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    return { W, H };
}

function _pad(data) {
    const padded = Array(CHART_MAX_POINTS).fill(null);
    const start = CHART_MAX_POINTS - data.length;
    data.forEach((v, i) => { padded[start + i] = v; });
    return padded;
}

function _drawSeries(ctx, padded, W, H, max, color, fillColor) {
    const xStep = W / (CHART_MAX_POINTS - 1);
    ctx.beginPath();
    let started = false;
    padded.forEach((v, i) => {
        if (v === null) return;
        const x = i * xStep;
        const y = H - Math.min(v / max, 1) * (H - 2);
        if (!started) { ctx.moveTo(x, H); ctx.lineTo(x, y); started = true; }
        else ctx.lineTo(x, y);
    });
    const lastIdx = padded.reduceRight((acc, v, i) => acc === -1 && v !== null ? i : acc, -1);
    if (lastIdx >= 0) {
        ctx.lineTo(lastIdx * xStep, H);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
    }
    ctx.beginPath();
    started = false;
    padded.forEach((v, i) => {
        if (v === null) return;
        const x = i * xStep;
        const y = H - Math.min(v / max, 1) * (H - 2);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
}

/**
 * Draw only the crosshair vertical line + highlight dots on the canvas.
 * The tooltip box itself is rendered as an HTML overlay (see createHtmlTooltip).
 */
function _drawCrosshair(ctx, hoverIdx, W, H, series, maxArr) {
    const xStep = W / (CHART_MAX_POINTS - 1);
    const x = hoverIdx * xStep;

    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(150,150,150,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.setLineDash([]);

    series.forEach((s, si) => {
        if (s.value === null) return;
        const max = maxArr[si] || 100;
        const y = H - Math.min(s.value / max, 1) * (H - 2);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
    });
    ctx.restore();
}

/**
 * Create and manage an HTML tooltip element that floats above the canvas.
 * The canvas wrapper must have `position: relative` (added via CSS).
 * Returns { show(x, series, ts), hide(), destroy() }.
 */
function createHtmlTooltip(canvas) {
    const wrapper = canvas.parentElement;

    const tip = document.createElement("div");
    tip.className = "o-sparkline-tooltip";
    tip.style.cssText = [
        "position:absolute",
        "pointer-events:none",
        "z-index:9999",
        "display:none",
        "background:rgba(25,25,25,0.92)",
        "color:#eee",
        "border-radius:6px",
        "padding:8px 12px",
        "font:12px -apple-system,BlinkMacSystemFont,sans-serif",
        "white-space:nowrap",
        "box-shadow:0 2px 8px rgba(0,0,0,0.3)",
        "line-height:1.6",
    ].join(";");
    wrapper.appendChild(tip);

    function show(canvasX, series, ts) {
        const activeSeries = series.filter(s => s.value !== null);
        if (!activeSeries.length) { tip.style.display = "none"; return; }

        // Build inner HTML
        let html = "";
        if (ts) {
            html += `<div style="font-size:11px;font-weight:bold;color:#aaa;margin-bottom:3px">`
                  + new Date(ts).toLocaleTimeString()
                  + `</div>`;
        }
        activeSeries.forEach(s => {
            html += `<div style="display:flex;align-items:center;gap:6px">`
                  + `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0"></span>`
                  + `<span>${s.label}: <strong>${s.formatted}</strong></span>`
                  + `</div>`;
        });
        tip.innerHTML = html;
        tip.style.display = "block";

        // Position: align horizontally relative to canvas, float above canvas
        const canvasRect  = canvas.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();

        // tipWidth may not be ready yet on first paint — use offsetWidth after display:block
        const tipW = tip.offsetWidth;
        const tipH = tip.offsetHeight;

        // X: follow cursor inside canvas, flip if overflowing wrapper
        const canvasLeftInWrapper = canvasRect.left - wrapperRect.left;
        let left = canvasLeftInWrapper + canvasX + 14;
        if (left + tipW > wrapperRect.width - 4) {
            left = canvasLeftInWrapper + canvasX - tipW - 14;
        }
        left = Math.max(2, left);

        // Y: sit just above the canvas, never overflow the top of wrapper
        const canvasTopInWrapper = canvasRect.top - wrapperRect.top;
        let top = canvasTopInWrapper - tipH - 6;
        if (top < 2) top = canvasTopInWrapper + canvasRect.height + 6; // fallback: below canvas

        tip.style.left = `${Math.round(left)}px`;
        tip.style.top  = `${Math.round(top)}px`;
    }

    function hide() { tip.style.display = "none"; }

    function destroy() { tip.remove(); }

    return { show, hide, destroy };
}

/**
 * Create a chart instance on a canvas — sets up event listeners ONCE.
 * Returns an object with:
 *   .update(data, timestamps)  — call every poll cycle to redraw with latest data
 *   .destroy()                 — remove event listeners
 */
function createSparkline(canvas, color, fillColor, formatFn, label) {
    if (!canvas) return { update: () => {}, destroy: () => {} };
    const { W, H } = _setupCanvas(canvas);
    const ctx = canvas.getContext("2d");
    const fmt = formatFn || (v => `${v.toFixed(1)}%`);
    const htmlTip = createHtmlTooltip(canvas);

    let _padded = Array(CHART_MAX_POINTS).fill(null);
    let _paddedTs = Array(CHART_MAX_POINTS).fill(null);
    let _hoverIdx = null;

    const render = () => {
        ctx.clearRect(0, 0, W, H);
        _drawSeries(ctx, _padded, W, H, 100, color, fillColor);
        if (_hoverIdx !== null && _padded[_hoverIdx] !== null) {
            const series = [{ value: _padded[_hoverIdx], label, color, formatted: fmt(_padded[_hoverIdx]) }];
            _drawCrosshair(ctx, _hoverIdx, W, H, series, [100]);
        }
    };

    const onMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (W / rect.width);
        _hoverIdx = Math.max(0, Math.min(CHART_MAX_POINTS - 1, Math.round(mx / (W / (CHART_MAX_POINTS - 1)))));
        render();
        if (_padded[_hoverIdx] !== null) {
            const xStep = W / (CHART_MAX_POINTS - 1);
            const series = [{ value: _padded[_hoverIdx], label, color, formatted: fmt(_padded[_hoverIdx]) }];
            htmlTip.show(_hoverIdx * xStep, series, _paddedTs[_hoverIdx]);
        } else {
            htmlTip.hide();
        }
    };
    const onLeave = () => { _hoverIdx = null; render(); htmlTip.hide(); };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    return {
        update(data, timestamps = []) {
            _padded   = _pad(data);
            _paddedTs = _pad(timestamps);
            render();
        },
        destroy() {
            canvas.removeEventListener("mousemove", onMove);
            canvas.removeEventListener("mouseleave", onLeave);
            htmlTip.destroy();
        },
    };
}

function createNetSparkline(canvas, formatFn) {
    if (!canvas) return { update: () => {}, destroy: () => {} };
    const { W, H } = _setupCanvas(canvas);
    const ctx = canvas.getContext("2d");
    const fmt = formatFn || (v => v >= 1024 ? `${(v / 1024).toFixed(1)} MB/s` : `${v.toFixed(1)} KB/s`);
    const htmlTip = createHtmlTooltip(canvas);

    let _paddedRecv = Array(CHART_MAX_POINTS).fill(null);
    let _paddedSent = Array(CHART_MAX_POINTS).fill(null);
    let _paddedTs   = Array(CHART_MAX_POINTS).fill(null);
    let _maxKbps    = 1;
    let _hoverIdx   = null;

    const render = () => {
        ctx.clearRect(0, 0, W, H);
        _drawSeries(ctx, _paddedRecv, W, H, _maxKbps, "#0d6efd", "rgba(13,110,253,0.15)");
        _drawSeries(ctx, _paddedSent, W, H, _maxKbps, "#fd7e14", "rgba(253,126,20,0.15)");
        if (_hoverIdx !== null && (_paddedRecv[_hoverIdx] !== null || _paddedSent[_hoverIdx] !== null)) {
            const series = [
                { value: _paddedRecv[_hoverIdx], label: "↓ Recv", color: "#0d6efd", formatted: fmt(_paddedRecv[_hoverIdx] ?? 0) },
                { value: _paddedSent[_hoverIdx], label: "↑ Sent", color: "#fd7e14", formatted: fmt(_paddedSent[_hoverIdx] ?? 0) },
            ];
            _drawCrosshair(ctx, _hoverIdx, W, H, series, [_maxKbps, _maxKbps]);
        }
    };

    const onMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (W / rect.width);
        _hoverIdx = Math.max(0, Math.min(CHART_MAX_POINTS - 1, Math.round(mx / (W / (CHART_MAX_POINTS - 1)))));
        render();
        if (_paddedRecv[_hoverIdx] !== null || _paddedSent[_hoverIdx] !== null) {
            const xStep = W / (CHART_MAX_POINTS - 1);
            const series = [
                { value: _paddedRecv[_hoverIdx], label: "↓ Recv", color: "#0d6efd", formatted: fmt(_paddedRecv[_hoverIdx] ?? 0) },
                { value: _paddedSent[_hoverIdx], label: "↑ Sent", color: "#fd7e14", formatted: fmt(_paddedSent[_hoverIdx] ?? 0) },
            ];
            htmlTip.show(_hoverIdx * xStep, series, _paddedTs[_hoverIdx]);
        } else {
            htmlTip.hide();
        }
    };
    const onLeave = () => { _hoverIdx = null; render(); htmlTip.hide(); };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    return {
        update(recvData, sentData, maxKbps, timestamps = []) {
            _paddedRecv = _pad(recvData);
            _paddedSent = _pad(sentData);
            _paddedTs   = _pad(timestamps);
            _maxKbps    = maxKbps || 1;
            render();
        },
        destroy() {
            canvas.removeEventListener("mousemove", onMove);
            canvas.removeEventListener("mouseleave", onLeave);
            htmlTip.destroy();
        },
    };
}


export class OllamaDashboard extends Component {
    static template = "ai_ollama.Dashboard";
    static props = { ...standardActionServiceProps };

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");

        this.state = useState({
            loading: true,
            pulling: false,
            pullModelId: "",
            data: null,
            pullTasks: {},
            searchQuery: "",
            dropdownOpen: false,

            // Real-time metrics
            metrics: {
                cpu:        [],   // % values
                ram:        [],   // % values
                netRecv:    [],   // KB/s
                netSent:    [],   // KB/s
                gpu:        [],   // % (null entries if no GPU)
                timestamps: [],   // unix ms per data point
                latest:     null,
            },
            metricsError: false,
        });

        // Canvas refs
        this.cpuCanvasRef   = useRef("cpuCanvas");
        this.ramCanvasRef   = useRef("ramCanvas");
        this.netCanvasRef   = useRef("netCanvas");
        this.gpuCanvasRef   = useRef("gpuCanvas");

        // Chart instances (created once in onMounted, persist across updates)
        this._charts = { cpu: null, ram: null, net: null, gpu: null };

        this._pollInterval    = null;
        this._metricsInterval = null;

        onWillStart(async () => {
            this._restorePullTasks();
            await this.loadData();
            this._startPollingIfNeeded();
        });

        onMounted(() => {
            // Create chart instances once — event listeners live here permanently
            const fmtNet = v => v >= 1024 ? `${(v/1024).toFixed(1)} MB/s` : `${v.toFixed(1)} KB/s`;
            this._charts.cpu = createSparkline(this.cpuCanvasRef.el, "#0d6efd", "rgba(13,110,253,0.15)", v => `${v.toFixed(1)}%`, "CPU");
            this._charts.ram = createSparkline(this.ramCanvasRef.el, "#198754", "rgba(25,135,84,0.15)",  v => `${v.toFixed(1)}%`, "RAM");
            this._charts.net = createNetSparkline(this.netCanvasRef.el, fmtNet);
            this._charts.gpu = createSparkline(this.gpuCanvasRef.el,  "#dc3545", "rgba(220,53,69,0.15)", v => `${v.toFixed(1)}%`, "GPU");
            // Start metrics polling after canvases are ready
            this._startMetrics();
        });

        onWillUnmount(() => {
            this._stopPolling();
            this._stopMetrics();
            Object.values(this._charts).forEach(c => c?.destroy());
        });
    }

        // ── LocalStorage persistence ──────────────────────────────────────────────

    _savePullTasks() {
        const active = {};
        for (const [key, task] of Object.entries(this.state.pullTasks)) {
            if (task.status === "pulling") active[key] = task;
        }
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(active)); } catch {}
    }

    _restorePullTasks() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                for (const [k, v] of Object.entries(JSON.parse(stored))) {
                    this.state.pullTasks[k] = v;
                }
            }
        } catch {}
    }

    _clearStoredTasks() {
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
    }

    // ── Pull-progress polling ─────────────────────────────────────────────────

    _startPollingIfNeeded() {
        const hasActive = Object.values(this.state.pullTasks).some(t => t.status === "pulling");
        if (hasActive && !this._pollInterval) {
            this._pollInterval = setInterval(() => this._pollProgress(), 2000);
        }
    }

    _stopPolling() {
        if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    }

    async _pollProgress() {
        try {
            const allProgress = await this.orm.call("ollama.pull.wizard", "get_all_pull_progress", []);
            let hasActive = false;

            for (const [modelName, task] of Object.entries(this.state.pullTasks)) {
                const serverTask = allProgress[modelName];
                if (serverTask) {
                    this.state.pullTasks[modelName] = serverTask;
                    if (serverTask.status === "done") {
                        this.notification.add(`Model "${modelName}" downloaded successfully!`, { type: "success" });
                        await this.orm.call("ollama.pull.wizard", "clear_pull_task", [modelName]);
                        await this.loadData();
                    } else if (serverTask.status === "error") {
                        this.notification.add(serverTask.error || `Failed to pull "${modelName}"`, { type: "danger", sticky: true });
                        await this.orm.call("ollama.pull.wizard", "clear_pull_task", [modelName]);
                    } else {
                        hasActive = true;
                    }
                } else if (task.status === "pulling") {
                    this.state.pullTasks[modelName] = { status: "error", progress_pct: 0, status_text: "Lost connection to server", error: "Pull task was lost." };
                }
            }

            for (const [modelName, task] of Object.entries(this.state.pullTasks)) {
                if (task.status === "done" || task.status === "error") delete this.state.pullTasks[modelName];
            }

            this._savePullTasks();
            if (!hasActive) { this._stopPolling(); this.state.pulling = false; }
        } catch {}
    }

    // ── Real-time metrics ─────────────────────────────────────────────────────

    _startMetrics() {
        if (this._metricsInterval) return;
        // First fetch immediately
        this._fetchMetrics();
        this._metricsInterval = setInterval(() => this._fetchMetrics(), METRICS_INTERVAL);
    }

    _stopMetrics() {
        if (this._metricsInterval) { clearInterval(this._metricsInterval); this._metricsInterval = null; }
    }

    async _fetchMetrics() {
        try {
            const result = await this.orm.call(
                "res.config.settings", "get_ollama_metrics", [],
                {}, { shadow: true }   // shadow=true: no loading spinner
            );
            if (!result?.ok || !result?.data) {
                this.state.metricsError = true;
                return;
            }
            const m = result.data;

            const push = (arr, val) => {
                arr.push(val ?? null);
                if (arr.length > CHART_MAX_POINTS) arr.shift();
            };

            push(this.state.metrics.cpu,        m.cpu_pct);
            push(this.state.metrics.ram,        m.ram_pct);
            push(this.state.metrics.netRecv,    m.net_recv_kbps);
            push(this.state.metrics.netSent,    m.net_sent_kbps);
            push(this.state.metrics.gpu,        m.gpu_pct);
            push(this.state.metrics.timestamps, m.ts);
            this.state.metrics.latest = m;
            this.state.metricsError   = false;

            this._redrawCharts();
        } catch {
            this.state.metricsError = true;
        }
    }

    _redrawCharts() {
        const m = this.state.metrics;
        const ts = m.timestamps;
        const fmtNet = v => v >= 1024 ? `${(v/1024).toFixed(1)} MB/s` : `${v.toFixed(1)} KB/s`;

        this._charts.cpu?.update(m.cpu.filter(v => v !== null), ts);
        this._charts.ram?.update(m.ram.filter(v => v !== null), ts);

        const allNet  = [...m.netRecv, ...m.netSent].filter(v => v !== null);
        const maxKbps = allNet.length ? Math.max(...allNet, 1) : 1;
        this._charts.net?.update(
            m.netRecv.filter(v => v !== null),
            m.netSent.filter(v => v !== null),
            maxKbps, ts
        );

        if (m.gpu.some(v => v !== null)) {
            this._charts.gpu?.update(m.gpu.filter(v => v !== null), ts);
        }
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    async loadData() {
        this.state.loading = true;
        try {
            this.state.data = await this.orm.call("res.config.settings", "get_ollama_dashboard_data", []);
        } catch {
            this.state.data = null;
        }
        this.state.loading = false;
    }

    // ── Computed getters ──────────────────────────────────────────────────────

    get availableModels() {
        const installedNames = (this.state.data?.models || []).map(m => {
            const name = m.name;
            return name.endsWith(":latest") ? name.replace(":latest", "") : name;
        });
        return AVAILABLE_MODELS.map(m => ({
            ...m,
            installed: installedNames.includes(m.id) ||
                       installedNames.includes(m.id + ":latest") ||
                       (this.state.data?.models || []).some(im => im.name === m.id),
        }));
    }

    get filteredModels() {
        const query = this.state.searchQuery.toLowerCase().trim();
        if (!query) return this.availableModels;
        return this.availableModels.filter(m =>
            m.name.toLowerCase().includes(query) ||
            m.id.toLowerCase().includes(query) ||
            m.size.toLowerCase().includes(query)
        );
    }

    get selectedModelLabel() {
        if (!this.state.pullModelId) return "";
        const m = AVAILABLE_MODELS.find(m => m.id === this.state.pullModelId);
        return m ? `${m.name} (${m.size})` : this.state.pullModelId;
    }

    get selectedModelWarning() {
        const modelId = this.state.pullModelId;
        if (!modelId || !this.state.data) return null;
        const required = MODEL_REQUIRED_RAM_GB[modelId];
        if (!required) return null;
        const ram = this.state.data.ram;
        if (!ram) return null;
        if (required > ram.total_gb) return {
            level: "danger",
            message: `Model '${modelId}' requires ~${required.toFixed(1)} GB RAM but the server only has ${ram.total_gb} GB total.`,
        };
        if (required > ram.available_gb) return {
            level: "warning",
            message: `Model '${modelId}' requires ~${required.toFixed(1)} GB RAM but only ${ram.available_gb} GB is currently available.`,
        };
        return null;
    }

    get canPull() {
        if (!this.state.pullModelId || this.state.pulling) return false;
        const warning = this.selectedModelWarning;
        return !warning || warning.level !== "danger";
    }

    get activePullTasks() {
        return Object.entries(this.state.pullTasks)
            .filter(([, t]) => t.status === "pulling")
            .map(([name, t]) => ({ name, ...t }));
    }

    // Latest metric values for display
    get latestCpu()     { return this.state.metrics.latest?.cpu_pct     ?? null; }
    get latestRam()     { return this.state.metrics.latest?.ram_pct     ?? null; }
    get latestNetRecv() { return this.state.metrics.latest?.net_recv_kbps ?? null; }
    get latestNetSent() { return this.state.metrics.latest?.net_sent_kbps ?? null; }
    get latestGpu()     { return this.state.metrics.latest?.gpu_pct     ?? null; }
    get hasGpuMetrics() { return this.state.metrics.gpu.some(v => v !== null); }

    // ── UI helpers ────────────────────────────────────────────────────────────

    getStatusClass(usagePct) {
        if (usagePct > 90) return "text-bg-danger";
        if (usagePct > 75) return "text-bg-warning";
        return "text-bg-success";
    }

    getStatusLabel(usagePct) {
        if (usagePct > 90) return "CRITICAL";
        if (usagePct > 75) return "WARNING";
        return "OK";
    }

    formatKbps(kbps) {
        if (kbps === null || kbps === undefined) return "—";
        if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
        return `${kbps.toFixed(1)} KB/s`;
    }

    // ── Search dropdown ───────────────────────────────────────────────────────

    onSearchInput(ev)  { this.state.searchQuery = ev.target.value; this.state.dropdownOpen = true; }
    onSearchFocus()    { this.state.dropdownOpen = true; }
    onSearchBlur()     { setTimeout(() => { this.state.dropdownOpen = false; }, 200); }

    onSelectModel(modelId) {
        this.state.pullModelId = modelId;
        const m = AVAILABLE_MODELS.find(m => m.id === modelId);
        this.state.searchQuery = m ? `${m.name} (${m.size})` : modelId;
        this.state.dropdownOpen = false;
    }

    onClearSelection() { this.state.pullModelId = ""; this.state.searchQuery = ""; }

    // ── Pull / Delete / Refresh ───────────────────────────────────────────────

    async onPullModel() {
        const modelId = this.state.pullModelId;
        if (!modelId) return;
        this.state.pulling = true;
        this.state.pullTasks[modelId] = { status: "pulling", progress_pct: 0, status_text: "Starting download...", error: null };
        this._savePullTasks();
        try {
            await this.orm.call("ollama.pull.wizard", "action_pull_from_dashboard", [modelId]);
            this.state.pullModelId = "";
            this.state.searchQuery = "";
            this._startPollingIfNeeded();
        } catch (e) {
            delete this.state.pullTasks[modelId];
            this._savePullTasks();
            this.state.pulling = false;
            this.notification.add(e.data?.message || `Failed to start pulling "${modelId}"`, { type: "danger", sticky: true });
        }
    }

    async onDismissTask(modelName) {
        delete this.state.pullTasks[modelName];
        this._savePullTasks();
        try { await this.orm.call("ollama.pull.wizard", "clear_pull_task", [modelName]); } catch {}
    }

    async onDeleteModel(modelName) {
        try {
            await this.orm.call("ollama.pull.wizard", "action_delete_model", [modelName]);
            this.notification.add(`Model "${modelName}" deleted.`, { type: "info" });
            await this.loadData();
        } catch (e) {
            this.notification.add(e.data?.message || `Failed to delete "${modelName}"`, { type: "danger" });
        }
    }

    async onRefresh() { await this.loadData(); }
}

registry.category("actions").add("ai_ollama.Dashboard", OllamaDashboard);