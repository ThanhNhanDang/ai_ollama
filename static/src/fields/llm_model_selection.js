/** @odoo-module **/

import { SelectionField, selectionField } from "@web/views/fields/selection/selection_field";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { useState, onWillStart } from "@odoo/owl";

export class LlmModelSelectionField extends SelectionField {
    static template = "ai_ollama.LlmModelSelectionField";

    setup() {
        super.setup();
        this.orm = useService("orm");
        this.state = useState({ pulledModels: [] });

        onWillStart(async () => {
            await this.loadPulledModels();
        });
    }

    async loadPulledModels() {
        try {
            this.state.pulledModels = await this.orm.call(
                "ai.agent",
                "get_ollama_pulled_models",
                []
            );
        } catch {
            this.state.pulledModels = [];
        }
    }

    isOllamaModel(value) {
        if (!value) return false;
        const label = this.options.find(([v]) => v === value)?.[1] || "";
        return label.includes("(Local)");
    }

    isPulled(value) {
        if (!this.isOllamaModel(value)) return false;
        return this.state.pulledModels.includes(value);
    }

    get choices() {
        return this.options.map(([value, label]) => ({
            value,
            label,
            isLocal: label.includes("(Local)"),
            isPulled: this.state.pulledModels.includes(value),
        }));
    }

    get string() {
        const currentValue = this.value;
        const option = this.options.find(([v]) => v === currentValue);
        if (!option) return "";
        const label = option[1];
        if (label.includes("(Local)") && this.state.pulledModels.includes(currentValue)) {
            return `${label} - Pulled`;
        }
        return label;
    }
}

export const llmModelSelectionField = {
    ...selectionField,
    component: LlmModelSelectionField,
};

registry.category("fields").add("llm_model_selection", llmModelSelectionField);
