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

/**
 * Build a padded array of CHART_MAX_POINTS nulls with data right-aligned.
 */
function _pad(data) {
    const padded = Array(CHART_MAX_POINTS).fill(null);
    const start = CHART_MAX_POINTS - data.length;
    data.forEach((v, i) => { padded[start + i] = v; });
    return padded;
}

/**
 * Draw filled area + line for one data series onto ctx.
 * @param {CanvasRenderingContext2D} ctx
 * @param {(number|null)[]} padded  CHART_MAX_POINTS array
 * @param {number} W canvas width
 * @param {number} H canvas height
 * @param {number} max  y-axis maximum
 * @param {string} color
 * @param {string} fillColor
 */
function _drawSeries(ctx, padded, W, H, max, color, fillColor) {
    const xStep = W / (CHART_MAX_POINTS - 1);

    // Fill
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

    // Line
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
 * Draw crosshair + tooltip bubble at hovered index.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} hoverIdx  index in padded array (0-based)
 * @param {number} W
 * @param {number} H
 * @param {{value: number|null, label: string, color: string}[]} series
 * @param {number[]} maxArr  [max for series 0, max for series 1, ...]
 * @param {number|null} ts  unix timestamp ms (nullable)
 */
function _drawTooltip(ctx, hoverIdx, W, H, series, maxArr, ts) {
    const xStep = W / (CHART_MAX_POINTS - 1);
    const x = hoverIdx * xStep;

    // Vertical crosshair line
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(100,100,100,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw dot on each series at hover point
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

    // Tooltip box
    const timeStr = ts ? new Date(ts).toLocaleTimeString() : "";
    const lines = series
        .filter(s => s.value !== null)
        .map(s => `${s.label}: ${s.formatted}`);
    if (timeStr) lines.unshift(timeStr);

    const PAD = 8;
    const LINE_H = 16;
    const boxW = 130;
    const boxH = PAD * 2 + lines.length * LINE_H;

    // Position: flip left if near right edge
    let bx = x + 10;
    if (bx + boxW > W) bx = x - boxW - 10;
    let by = 4;
    if (by + boxH > H) by = H - boxH - 4;

    // Shadow
    ctx.shadowColor = "rgba(0,0,0,0.15)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "rgba(30,30,30,0.88)";
    const r = 6;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + boxW - r, by);
    ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r);
    ctx.lineTo(bx + boxW, by + boxH - r);
    ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH);
    ctx.lineTo(bx + r, by + boxH);
    ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // Text
    lines.forEach((line, i) => {
        const isTime = i === 0 && timeStr;
        ctx.font = isTime ? "10px sans-serif" : "11px sans-serif";
        ctx.fillStyle = isTime ? "#aaa" : "#fff";
        // Colored dot for series lines
        if (!isTime && series.filter(s => s.value !== null)[i - (timeStr ? 1 : 0)]) {
            const s = series.filter(s => s.value !== null)[i - (timeStr ? 1 : 0)];
            ctx.beginPath();
            ctx.arc(bx + PAD + 4, by + PAD + i * LINE_H + 4, 3, 0, Math.PI * 2);
            ctx.fillStyle = s.color;
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.fillText(line, bx + PAD + 12, by + PAD + i * LINE_H + LINE_H / 2 + 3);
        } else {
            ctx.fillText(line, bx + PAD, by + PAD + i * LINE_H + LINE_H / 2 + 3);
        }
    });

    ctx.restore();
}

/**
 * Render sparkline with hover tooltip support.
 * Returns a cleanup function to remove event listeners.
 */
function drawSparkline(canvas, data, color, fillColor, timestamps = [], formatFn = null, label = "") {
    if (!canvas) return () => {};
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const padded = _pad(data);
    const paddedTs = _pad(timestamps);
    const fmt = formatFn || (v => `${v}%`);

    const render = (hoverIdx = null) => {
        ctx.clearRect(0, 0, W, H);
        _drawSeries(ctx, padded, W, H, 100, color, fillColor);

        if (hoverIdx !== null && padded[hoverIdx] !== null) {
            _drawTooltip(ctx, hoverIdx, W, H,
                [{ value: padded[hoverIdx], label, color, formatted: fmt(padded[hoverIdx]) }],
                [100],
                paddedTs[hoverIdx]
            );
        }
    };

    render();

    // Mouse events
    const onMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (W / rect.width);
        const xStep = W / (CHART_MAX_POINTS - 1);
        const idx = Math.round(mx / xStep);
        render(Math.max(0, Math.min(CHART_MAX_POINTS - 1, idx)));
    };
    const onLeave = () => render(null);

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    return () => {
        canvas.removeEventListener("mousemove", onMove);
        canvas.removeEventListener("mouseleave", onLeave);
    };
}

/**
 * Network sparkline with 2 series and hover tooltip.
 */
function drawNetSparkline(canvas, recvData, sentData, maxKbps, timestamps = [], formatFn = null) {
    if (!canvas) return () => {};
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const max = maxKbps || 1;
    const paddedRecv = _pad(recvData);
    const paddedSent = _pad(sentData);
    const paddedTs   = _pad(timestamps);
    const fmt = formatFn || (v => v >= 1024 ? `${(v/1024).toFixed(1)} MB/s` : `${v.toFixed(1)} KB/s`);

    const render = (hoverIdx = null) => {
        ctx.clearRect(0, 0, W, H);
        _drawSeries(ctx, paddedRecv, W, H, max, "#0d6efd", "rgba(13,110,253,0.15)");
        _drawSeries(ctx, paddedSent, W, H, max, "#fd7e14", "rgba(253,126,20,0.15)");

        if (hoverIdx !== null && (paddedRecv[hoverIdx] !== null || paddedSent[hoverIdx] !== null)) {
            _drawTooltip(ctx, hoverIdx, W, H,
                [
                    { value: paddedRecv[hoverIdx], label: "↓ Recv", color: "#0d6efd", formatted: fmt(paddedRecv[hoverIdx] ?? 0) },
                    { value: paddedSent[hoverIdx], label: "↑ Sent", color: "#fd7e14", formatted: fmt(paddedSent[hoverIdx] ?? 0) },
                ],
                [max, max],
                paddedTs[hoverIdx]
            );
        }
    };

    render();

    const onMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (W / rect.width);
        const xStep = W / (CHART_MAX_POINTS - 1);
        const idx = Math.round(mx / xStep);
        render(Math.max(0, Math.min(CHART_MAX_POINTS - 1, idx)));
    };
    const onLeave = () => render(null);

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    return () => {
        canvas.removeEventListener("mousemove", onMove);
        canvas.removeEventListener("mouseleave", onLeave);
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

        // Chart event listener cleanup functions
        this._chartCleanups = [];

        this._pollInterval    = null;
        this._metricsInterval = null;

        onWillStart(async () => {
            this._restorePullTasks();
            await this.loadData();
            this._startPollingIfNeeded();
            this._startMetrics();
        });

        onWillUnmount(() => {
            this._stopPolling();
            this._stopMetrics();
            this._chartCleanups.forEach(fn => fn());
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

        // Clean up previous event listeners
        this._chartCleanups.forEach(fn => fn());
        this._chartCleanups = [];

        const ts = m.timestamps;

        const c1 = drawSparkline(
            this.cpuCanvasRef.el,
            m.cpu.filter(v => v !== null),
            "#0d6efd", "rgba(13,110,253,0.15)",
            ts, v => `${v.toFixed(1)}%`, "CPU"
        );

        const c2 = drawSparkline(
            this.ramCanvasRef.el,
            m.ram.filter(v => v !== null),
            "#198754", "rgba(25,135,84,0.15)",
            ts, v => `${v.toFixed(1)}%`, "RAM"
        );

        // Network: scale to max seen
        const allNet = [...m.netRecv, ...m.netSent].filter(v => v !== null);
        const maxKbps = allNet.length ? Math.max(...allNet, 1) : 1;
        const fmtNet = v => v >= 1024 ? `${(v / 1024).toFixed(1)} MB/s` : `${v.toFixed(1)} KB/s`;
        const c3 = drawNetSparkline(
            this.netCanvasRef.el,
            m.netRecv.filter(v => v !== null),
            m.netSent.filter(v => v !== null),
            maxKbps, ts, fmtNet
        );

        this._chartCleanups = [c1, c2, c3];

        if (this.gpuCanvasRef.el && m.gpu.some(v => v !== null)) {
            const c4 = drawSparkline(
                this.gpuCanvasRef.el,
                m.gpu.filter(v => v !== null),
                "#dc3545", "rgba(220,53,69,0.15)",
                ts, v => `${v.toFixed(1)}%`, "GPU"
            );
            this._chartCleanups.push(c4);
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