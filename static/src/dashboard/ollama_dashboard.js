/** @odoo-module **/

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { standardActionServiceProps } from "@web/webclient/actions/action_service";
import { Component, useState, onWillStart, onWillUnmount } from "@odoo/owl";

const STORAGE_KEY = "ollama_pull_tasks";

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
            // Pull progress tracking
            pullTasks: {},  // {modelName: {status, progress_pct, status_text, error}}
            // Search dropdown
            searchQuery: "",
            dropdownOpen: false,
        });

        this._pollInterval = null;

        onWillStart(async () => {
            this._restorePullTasks();
            await this.loadData();
            this._startPollingIfNeeded();
        });

        onWillUnmount(() => {
            this._stopPolling();
        });
    }

    // ── LocalStorage persistence ──

    _savePullTasks() {
        const active = {};
        for (const [key, task] of Object.entries(this.state.pullTasks)) {
            if (task.status === "pulling") {
                active[key] = task;
            }
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
        } catch {
            // localStorage quota exceeded or disabled
        }
    }

    _restorePullTasks() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const tasks = JSON.parse(stored);
                for (const [key, task] of Object.entries(tasks)) {
                    this.state.pullTasks[key] = task;
                }
            }
        } catch {
            // corrupted data
        }
    }

    _clearStoredTasks() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            // ignore
        }
    }

    // ── Polling ──

    _startPollingIfNeeded() {
        const hasActive = Object.values(this.state.pullTasks).some(
            t => t.status === "pulling"
        );
        if (hasActive && !this._pollInterval) {
            this._pollInterval = setInterval(() => this._pollProgress(), 2000);
        }
    }

    _stopPolling() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
    }

    async _pollProgress() {
        try {
            const allProgress = await this.orm.call(
                "ollama.pull.wizard", "get_all_pull_progress", []
            );

            let hasActive = false;

            for (const [modelName, task] of Object.entries(this.state.pullTasks)) {
                const serverTask = allProgress[modelName];

                if (serverTask) {
                    this.state.pullTasks[modelName] = serverTask;

                    if (serverTask.status === "done") {
                        this.notification.add(
                            `Model "${modelName}" downloaded successfully!`,
                            { type: "success" }
                        );
                        await this.orm.call(
                            "ollama.pull.wizard", "clear_pull_task", [modelName]
                        );
                        // Refresh dashboard data
                        await this.loadData();
                    } else if (serverTask.status === "error") {
                        this.notification.add(
                            serverTask.error || `Failed to pull "${modelName}"`,
                            { type: "danger", sticky: true }
                        );
                        await this.orm.call(
                            "ollama.pull.wizard", "clear_pull_task", [modelName]
                        );
                    } else {
                        hasActive = true;
                    }
                } else if (task.status === "pulling") {
                    // Server lost track (restart?) — mark as unknown
                    this.state.pullTasks[modelName] = {
                        status: "error",
                        progress_pct: 0,
                        status_text: "Lost connection to server",
                        error: "Pull task was lost. The server may have restarted.",
                    };
                }
            }

            // Clean finished tasks from state
            for (const [modelName, task] of Object.entries(this.state.pullTasks)) {
                if (task.status === "done" || task.status === "error") {
                    delete this.state.pullTasks[modelName];
                }
            }

            this._savePullTasks();

            if (!hasActive) {
                this._stopPolling();
                this.state.pulling = false;
            }
        } catch {
            // network error, try again next poll
        }
    }

    // ── Data loading ──

    async loadData() {
        this.state.loading = true;
        try {
            this.state.data = await this.orm.call(
                "res.config.settings", "get_ollama_dashboard_data", []
            );
        } catch {
            this.state.data = null;
        }
        this.state.loading = false;
    }

    // ── Computed getters ──

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

        if (required > ram.total_gb) {
            return {
                level: "danger",
                message: `Model '${modelId}' requires ~${required.toFixed(1)} GB RAM but the server only has ${ram.total_gb} GB total. This model cannot run on this server.`,
            };
        }
        if (required > ram.available_gb) {
            return {
                level: "warning",
                message: `Model '${modelId}' requires ~${required.toFixed(1)} GB RAM but only ${ram.available_gb} GB is currently available. Running this model may cause memory pressure.`,
            };
        }
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

    // ── UI helpers ──

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

    // ── Search dropdown actions ──

    onSearchInput(ev) {
        this.state.searchQuery = ev.target.value;
        this.state.dropdownOpen = true;
    }

    onSearchFocus() {
        this.state.dropdownOpen = true;
    }

    onSearchBlur() {
        // Delay to allow click on dropdown item
        setTimeout(() => {
            this.state.dropdownOpen = false;
        }, 200);
    }

    onSelectModel(modelId) {
        this.state.pullModelId = modelId;
        const m = AVAILABLE_MODELS.find(m => m.id === modelId);
        this.state.searchQuery = m ? `${m.name} (${m.size})` : modelId;
        this.state.dropdownOpen = false;
    }

    onClearSelection() {
        this.state.pullModelId = "";
        this.state.searchQuery = "";
    }

    // ── Pull / Delete / Refresh ──

    async onPullModel() {
        const modelId = this.state.pullModelId;
        if (!modelId) return;

        this.state.pulling = true;
        this.state.pullTasks[modelId] = {
            status: "pulling",
            progress_pct: 0,
            status_text: "Starting download...",
            error: null,
        };
        this._savePullTasks();

        try {
            await this.orm.call(
                "ollama.pull.wizard", "action_pull_from_dashboard", [modelId]
            );
            // Clear selection
            this.state.pullModelId = "";
            this.state.searchQuery = "";
            // Start polling for progress
            this._startPollingIfNeeded();
        } catch (e) {
            delete this.state.pullTasks[modelId];
            this._savePullTasks();
            this.state.pulling = false;
            this.notification.add(
                e.data?.message || `Failed to start pulling "${modelId}"`,
                { type: "danger", sticky: true }
            );
        }
    }

    async onDismissTask(modelName) {
        delete this.state.pullTasks[modelName];
        this._savePullTasks();
        try {
            await this.orm.call(
                "ollama.pull.wizard", "clear_pull_task", [modelName]
            );
        } catch {
            // ignore
        }
    }

    async onDeleteModel(modelName) {
        try {
            await this.orm.call(
                "ollama.pull.wizard", "action_delete_model", [modelName]
            );
            this.notification.add(
                `Model "${modelName}" deleted.`,
                { type: "info" }
            );
            await this.loadData();
        } catch (e) {
            this.notification.add(
                e.data?.message || `Failed to delete "${modelName}"`,
                { type: "danger" }
            );
        }
    }

    async onRefresh() {
        await this.loadData();
    }
}

registry.category("actions").add("ai_ollama.Dashboard", OllamaDashboard);
