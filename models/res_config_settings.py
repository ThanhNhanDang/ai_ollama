# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


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

    def _compute_ollama_enabled(self):
        for record in self:
            record.ollama_enabled = bool(record.ollama_base_url)
