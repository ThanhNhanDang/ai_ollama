# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
import requests

from odoo import api, models

_logger = logging.getLogger(__name__)


class AIAgent(models.Model):
    _inherit = 'ai.agent'

    @api.model
    def _get_llm_model_selection(self):
        """Override to only show installed Ollama models in the dropdown.

        Non-Ollama providers (OpenAI, Google) show all models.
        Ollama provider only shows models installed on the server.
        """
        from odoo.addons.ai.utils import llm_providers
        from odoo.addons.ai_ollama.utils.ollama_patch import OLLAMA_PROVIDER

        installed = self._get_installed_ollama_models()

        selection = []
        for provider in llm_providers.PROVIDERS:
            if provider.name != "ollama":
                # Non-Ollama: show all models
                selection.extend(provider.llms)
            elif installed is not None:
                # Ollama: only show installed models
                for model_id, display_name in OLLAMA_PROVIDER.llms:
                    if self._is_model_installed(model_id, installed):
                        selection.append((model_id, display_name))
                # Also add any custom pulled models not in predefined list
                predefined_ids = {m[0] for m in OLLAMA_PROVIDER.llms}
                for model_name in sorted(installed):
                    if not any(self._is_model_installed(pid, {model_name}) for pid in predefined_ids):
                        display = model_name.replace(":", " ").replace("-", " ").title()
                        selection.append((model_name, f"{display} (Local)"))
            else:
                # Ollama unreachable: show all as fallback
                selection.extend(provider.llms)
        return selection

    @api.model
    def _get_installed_ollama_models(self):
        """Query Ollama API for installed models. Returns set of names or None if unreachable."""
        base_url = self.env["ir.config_parameter"].sudo().get_param(
            "ai.ollama_base_url", "http://ollama:11434"
        ).rstrip("/")

        try:
            resp = requests.get(f"{base_url}/api/tags", timeout=3)
            if resp.status_code == 200:
                models_data = resp.json().get("models", [])
                installed = set()
                for m in models_data:
                    name = m.get("name", "")
                    installed.add(name)
                    # Also add without :latest tag for matching
                    if name.endswith(":latest"):
                        installed.add(name.replace(":latest", ""))
                _logger.debug("AI Ollama: Found %d installed models", len(installed))
                return installed
            return None
        except Exception as e:
            _logger.debug("AI Ollama: Cannot reach Ollama server: %s", e)
            return None

    @staticmethod
    def _is_model_installed(model_id, installed_set):
        """Check if a model_id matches any installed model.

        Handles cases like:
        - Exact match: "qwen2.5:7b" in {"qwen2.5:7b"}
        - Base name: "llama3.1" matches "llama3.1:latest"
        - With latest: "mistral" matches "mistral:latest"
        """
        if model_id in installed_set:
            return True
        # "mistral" should match "mistral:latest"
        if f"{model_id}:latest" in installed_set:
            return True
        # "llama3.1:latest" should match "llama3.1"
        if model_id.endswith(":latest") and model_id.replace(":latest", "") in installed_set:
            return True
        return False
