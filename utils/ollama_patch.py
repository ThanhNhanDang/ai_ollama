# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""
Monkey-patch the AI module to add Ollama as a local LLM provider.

This module patches:
1. PROVIDERS list in ai.utils.llm_providers — adds Ollama models
2. LLMApiService in ai.utils.llm_api_service — adds Ollama request handling
"""
import json
import logging

from odoo.addons.ai.utils import llm_providers
from odoo.addons.ai.utils import llm_api_service

_logger = logging.getLogger(__name__)

# =============================================================================
# 1. Patch PROVIDERS list to include Ollama
# =============================================================================

OLLAMA_PROVIDER = llm_providers.Provider(
    name="ollama",
    display_name="Ollama (Local)",
    embedding_model="nomic-embed-text",
    llms=[
        # Small models (< 4GB RAM)
        ("qwen2.5:0.5b", "Qwen 2.5 0.5B (Local)"),
        ("qwen2.5:1.5b", "Qwen 2.5 1.5B (Local)"),
        ("qwen2.5:3b", "Qwen 2.5 3B (Local)"),
        ("llama3.2:1b", "Llama 3.2 1B (Local)"),
        ("llama3.2:3b", "Llama 3.2 3B (Local)"),
        ("phi4-mini", "Phi-4 Mini 3.8B (Local)"),
        ("gemma3:1b", "Gemma 3 1B (Local)"),
        ("gemma3:4b", "Gemma 3 4B (Local)"),
        ("deepseek-r1:1.5b", "DeepSeek R1 1.5B (Local)"),
        # Medium models (4-8GB RAM)
        ("qwen2.5:7b", "Qwen 2.5 7B (Local)"),
        ("llama3.1", "Llama 3.1 8B (Local)"),
        ("mistral", "Mistral 7B (Local)"),
        ("deepseek-r1:7b", "DeepSeek R1 7B (Local)"),
        ("gemma3:12b", "Gemma 3 12B (Local)"),
        # Large models (8-20GB RAM) — need 16GB+ free
        ("qwen2.5:14b", "Qwen 2.5 14B (Local)"),
        ("deepseek-r1:14b", "DeepSeek R1 14B (Local)"),
        ("phi4", "Phi-4 14B (Local)"),
        ("mistral-small", "Mistral Small 24B (Local)"),
        ("command-r", "Command-R 35B (Local)"),
        # XL models (20-48GB RAM) — need 32GB+ free
        ("qwen2.5:32b", "Qwen 2.5 32B (Local)"),
        ("deepseek-r1:32b", "DeepSeek R1 32B (Local)"),
        ("qwen2.5:72b", "★ Qwen 2.5 72B (Local)"),
        ("llama3.1:70b", "★ Llama 3.1 70B (Local)"),
        ("deepseek-r1:70b", "★ DeepSeek R1 70B (Local)"),
    ],
)

# Add Ollama to the providers list
llm_providers.PROVIDERS.append(OLLAMA_PROVIDER)

# Update the embedding models selection
llm_providers.EMBEDDING_MODELS_SELECTION.append(
    (OLLAMA_PROVIDER.embedding_model, OLLAMA_PROVIDER.display_name)
)

_logger.info("AI Ollama: Patched PROVIDERS list with Ollama provider (%d models)", len(OLLAMA_PROVIDER.llms))

# =============================================================================
# 2. Patch LLMApiService to handle Ollama requests
# =============================================================================

# Save original methods
_original_init = llm_api_service.LLMApiService.__init__
_original_request_llm = llm_api_service.LLMApiService._request_llm
_original_get_api_token = llm_api_service.LLMApiService._get_api_token
_original_get_base_headers = llm_api_service.LLMApiService._get_base_headers
_original_build_tool_call_response = llm_api_service.LLMApiService._build_tool_call_response


def _patched_init(self, env, provider='openai'):
    """Extended __init__ to support 'ollama' provider."""
    if provider == 'ollama':
        self.provider = 'ollama'
        ollama_url = env["ir.config_parameter"].sudo().get_param(
            "ai.ollama_base_url", "http://ollama:11434"
        )
        # Remove trailing slash
        self.base_url = ollama_url.rstrip("/") + "/v1"
        self.env = env
    else:
        _original_init(self, env, provider)


def _patched_get_api_token(self):
    """Ollama doesn't require an API token."""
    if self.provider == 'ollama':
        return "ollama"  # Dummy token, Ollama ignores auth
    return _original_get_api_token(self)


def _patched_get_base_headers(self):
    """Ollama doesn't need Authorization header but accepts it."""
    if self.provider == 'ollama':
        return {
            'Content-Type': 'application/json',
        }
    return _original_get_base_headers(self)


def _request_llm_ollama(self, llm_model, system_prompts, user_prompts, tools=None,
                         files=None, schema=None, temperature=0.2, inputs=(), web_grounding=False):
    """Make a request to Ollama using the Chat Completions API format.

    Ollama supports the OpenAI Chat Completions API (/v1/chat/completions),
    NOT the newer Responses API (/v1/responses).
    """
    messages = []

    # System prompts
    for prompt in system_prompts:
        if prompt:
            messages.append({"role": "system", "content": prompt})

    # Previous conversation inputs
    for inp in (inputs or []):
        if isinstance(inp, dict):
            role = inp.get("role", "user")
            content = inp.get("content", "")
            if role == "function_call_output":
                # Tool response - convert to assistant message
                messages.append({
                    "role": "tool",
                    "content": str(inp.get("output", "")),
                    "tool_call_id": inp.get("call_id", ""),
                })
            elif role in ("user", "assistant", "system"):
                if content:
                    messages.append({"role": role, "content": content})

    # User prompts
    user_content = "\n\n".join(p for p in user_prompts if p)
    if user_content:
        messages.append({"role": "user", "content": user_content})

    # Files - convert to text in the user message (Ollama doesn't support file uploads)
    if files:
        file_texts = []
        for idx, file in enumerate(files, start=1):
            if file["mimetype"] == "text/plain":
                file_texts.append(f"[File {idx}]:\n{file['value']}")
            elif file["mimetype"].startswith("image/"):
                file_texts.append(f"[File {idx}: Image - content not available in text mode]")
            else:
                file_texts.append(f"[File {idx}: {file['mimetype']} - content not available]")
        if file_texts:
            messages.append({"role": "user", "content": "Attached files:\n" + "\n\n".join(file_texts)})

    body = {
        "model": llm_model,
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }

    # JSON schema mode
    if schema:
        body["response_format"] = {"type": "json_object"}

    # Tool calling support
    if tools:
        body["tools"] = [{
            "type": "function",
            "function": {
                "name": tool_name,
                "description": tool_description,
                "parameters": tool_parameter_schema,
            }
        } for tool_name, (tool_description, __, __, tool_parameter_schema) in tools.items()]

    from odoo.addons.ai.utils.ai_logging import api_call_logging
    with api_call_logging(messages, tools) as record_response:
        llm_response = self._request(
            method="post",
            endpoint="/chat/completions",
            headers=self._get_base_headers(),
            body=body,
            timeout=120,  # Local models can be slower
        )

        to_call = []
        response = []
        next_inputs = list(inputs or ())

        choices = llm_response.get("choices", [])
        for choice in choices:
            message = choice.get("message", {})

            # Handle tool calls
            tool_calls = message.get("tool_calls", [])
            if tool_calls:
                for tc in tool_calls:
                    func = tc.get("function", {})
                    tool_name = func.get("name", "")
                    try:
                        arguments = json.loads(func.get("arguments", "{}"))
                    except json.JSONDecodeError:
                        _logger.error("AI Ollama: Malformed tool arguments: %s", func)
                        continue
                    call_id = tc.get("id", tool_name)
                    to_call.append((tool_name, call_id, arguments))
                    # Add to next_inputs for follow-up
                    next_inputs.append({
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [tc],
                    })
            else:
                # Regular text response
                content = message.get("content", "")
                if content:
                    response.append(content)

        if record_response:
            record_response(to_call, response)

        return response, to_call, next_inputs


def _patched_request_llm(self, *args, **kwargs):
    """Route to Ollama handler if provider is 'ollama'."""
    if self.provider == 'ollama':
        return _request_llm_ollama(self, *args, **kwargs)
    return _original_request_llm(self, *args, **kwargs)


def _patched_build_tool_call_response(self, tool_call_id, return_value):
    """Build tool call response for Ollama (OpenAI chat completions format)."""
    if self.provider == 'ollama':
        return {
            "role": "tool",
            "content": str(return_value),
            "tool_call_id": tool_call_id,
        }
    return _original_build_tool_call_response(self, tool_call_id, return_value)


# Apply patches
llm_api_service.LLMApiService.__init__ = _patched_init
llm_api_service.LLMApiService._request_llm = _patched_request_llm
llm_api_service.LLMApiService._get_api_token = _patched_get_api_token
llm_api_service.LLMApiService._get_base_headers = _patched_get_base_headers
llm_api_service.LLMApiService._build_tool_call_response = _patched_build_tool_call_response

_logger.info("AI Ollama: Patched LLMApiService with Ollama support")
