# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import logging
import requests

from odoo import api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

# Available models for pull dropdown
AVAILABLE_MODELS = [
    ('qwen2.5:0.5b', 'Qwen 2.5 0.5B (~0.4 GB)'),
    ('qwen2.5:1.5b', 'Qwen 2.5 1.5B (~1.0 GB)'),
    ('qwen2.5:3b', 'Qwen 2.5 3B (~2.0 GB)'),
    ('qwen2.5:7b', 'Qwen 2.5 7B (~4.7 GB) ⭐'),
    ('qwen2.5:14b', 'Qwen 2.5 14B (~9.0 GB)'),
    ('qwen2.5:32b', 'Qwen 2.5 32B (~20 GB)'),
    ('qwen2.5:72b', 'Qwen 2.5 72B (~45 GB)'),
    ('qwen2.5-coder:7b', 'Qwen 2.5 Coder 7B (~4.7 GB)'),
    ('llama3.1', 'Llama 3.1 8B (~4.7 GB)'),
    ('llama3.1:70b', 'Llama 3.1 70B (~42 GB)'),
    ('llama3.2:1b', 'Llama 3.2 1B (~0.8 GB)'),
    ('llama3.2:3b', 'Llama 3.2 3B (~2.0 GB)'),
    ('phi4-mini', 'Phi-4 Mini 3.8B (~2.4 GB)'),
    ('phi4', 'Phi-4 14B (~9.0 GB)'),
    ('gemma3:1b', 'Gemma 3 1B (~0.8 GB)'),
    ('gemma3:4b', 'Gemma 3 4B (~2.5 GB)'),
    ('gemma3:12b', 'Gemma 3 12B (~8.3 GB)'),
    ('mistral', 'Mistral 7B (~4.1 GB)'),
    ('mistral-small', 'Mistral Small 24B (~14 GB)'),
    ('deepseek-r1:1.5b', 'DeepSeek R1 1.5B (~1.0 GB)'),
    ('deepseek-r1:7b', 'DeepSeek R1 7B (~4.7 GB)'),
    ('deepseek-r1:14b', 'DeepSeek R1 14B (~9.0 GB)'),
    ('deepseek-r1:32b', 'DeepSeek R1 32B (~20 GB)'),
    ('deepseek-r1:70b', 'DeepSeek R1 70B (~42 GB)'),
    ('command-r', 'Command-R 35B (~20 GB)'),
    ('nomic-embed-text', 'Nomic Embed Text (Embedding, ~0.3 GB)'),
]


class OllamaPullWizard(models.TransientModel):
    _name = 'ollama.pull.wizard'
    _description = 'Pull Ollama Model'

    model_to_pull = fields.Selection(
        selection=AVAILABLE_MODELS,
        string="Select Model",
        required=True,
    )

    def action_pull(self):
        """Pull the selected model from Ollama."""
        self.ensure_one()
        model_name = self.model_to_pull

        base_url = self.env["ir.config_parameter"].sudo().get_param(
            "ai.ollama_base_url", "http://ollama:11434"
        ).rstrip("/")

        try:
            _logger.info("AI Ollama: Starting pull for model '%s'", model_name)

            resp = requests.post(
                f"{base_url}/api/pull",
                json={"name": model_name, "stream": True},
                stream=True,
                timeout=(10, None),
            )

            if resp.status_code != 200:
                raise UserError(f"Ollama error: {resp.text}")

            last_status = ""
            for line in resp.iter_lines():
                if line:
                    try:
                        progress = json.loads(line)
                        last_status = progress.get("status", "")
                        if "error" in progress:
                            raise UserError(f"Ollama pull error: {progress['error']}")
                    except json.JSONDecodeError:
                        continue

            _logger.info("AI Ollama: Pull complete for '%s': %s", model_name, last_status)

            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': 'Ollama',
                    'message': f'✅ Model "{model_name}" downloaded successfully!',
                    'type': 'success',
                    'sticky': False,
                    'next': {'type': 'ir.actions.client', 'tag': 'reload'},
                }
            }

        except requests.ConnectionError:
            raise UserError(
                f"Cannot connect to Ollama at {base_url}. "
                "Make sure the Ollama server is running."
            )
