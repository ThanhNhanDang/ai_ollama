# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'AI Ollama - Local LLM',
    'version': '1.0',
    'category': 'Hidden',
    'summary': 'Integrate Ollama (local LLM) with Odoo AI features',
    'description': """
        This module adds Ollama as a local LLM provider for Odoo AI.
        It allows you to use local language models through Ollama,
        keeping your data private and avoiding cloud API costs.

        Features:
        - Use local LLM models (Qwen, Llama, Phi, Mistral, etc.)
        - No API key required
        - Data stays on your server
        - Compatible with all Odoo AI features (chat, agents, etc.)
    """,
    'depends': ['ai', 'ai_app'],
    'data': [
        'views/res_config_settings_views.xml',
    ],
    'installable': True,
    'auto_install': False,
    'author': 'Custom',
    'license': 'LGPL-3',
}
