# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'AI Ollama - Local LLM',
    'version': '1.1',
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
        - Pull models directly from settings UI
    """,
    'depends': ['ai', 'ai_app'],
    'data': [
        'security/ir.model.access.csv',
        'wizard/ollama_pull_wizard_views.xml',
        'views/res_config_settings_views.xml',
        'views/ai_agent_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'ai_ollama/static/src/**/*',
        ],
    },
    'installable': True,
    'auto_install': False,
    'author': 'Custom',
    'license': 'LGPL-3',
}
