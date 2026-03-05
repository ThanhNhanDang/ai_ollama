# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
import requests

from odoo import api, fields, models

_logger = logging.getLogger(__name__)


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    ollama_base_url = fields.Char(
        string="Ollama Server URL",
        config_parameter='ai.ollama_base_url',
        default='http://ollama:11434',
        help="URL of the Ollama server. Default: http://ollama:11434 (Docker) "
             "or http://localhost:11434 (local install)",
        groups='base.group_system',
    )

    ollama_enabled = fields.Boolean(
        string="Ollama (Local LLM) enabled",
        compute='_compute_ollama_enabled',
        readonly=True,
        groups='base.group_system',
    )

    ollama_installed_models = fields.Text(
        string="Installed Models",
        compute='_compute_ollama_installed_models',
        groups='base.group_system',
    )

    def _compute_ollama_enabled(self):
        for record in self:
            record.ollama_enabled = bool(record.ollama_base_url)

    def _compute_ollama_installed_models(self):
        for record in self:
            record.ollama_installed_models = ""
            if not record.ollama_base_url:
                continue
            try:
                base_url = record.ollama_base_url.rstrip("/")
                resp = requests.get(f"{base_url}/api/tags", timeout=5)
                if resp.status_code == 200:
                    data = resp.json()
                    models_list = data.get("models", [])
                    if models_list:
                        lines = []
                        for m in models_list:
                            name = m.get("name", "unknown")
                            size_gb = m.get("size", 0) / (1024**3)
                            lines.append(f"✅ {name} ({size_gb:.1f} GB)")
                        record.ollama_installed_models = "\n".join(lines)
                    else:
                        record.ollama_installed_models = "⚠️ No models installed. Use 'Pull New Model' below."
                else:
                    record.ollama_installed_models = f"❌ Ollama returned status {resp.status_code}"
            except requests.ConnectionError:
                record.ollama_installed_models = "❌ Cannot connect to Ollama server"
            except Exception as e:
                record.ollama_installed_models = f"❌ Error: {str(e)}"

    def action_ollama_refresh_models(self):
        """Refresh the installed models list."""
        return {
            'type': 'ir.actions.client',
            'tag': 'reload',
        }
