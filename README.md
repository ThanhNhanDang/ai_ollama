# 🤖 AI Ollama - Local LLM Integration for Odoo 19

Integrate **Ollama** (Local LLM) into Odoo 19, enabling the use of AI models running on your own server — no cloud API keys required.

## ✨ Features

- 🔒 **Private** — Data never leaves your server
- 💰 **Free** — Unlimited tokens, zero cost forever
- 🔌 **Plug & Play** — Automatically adds Ollama to the LLM provider list
- 🐳 **Docker Ready** — Easy deployment via Docker Compose

## 📋 Requirements

- **Odoo 19** with the `ai` (base) module installed
- **Ollama** running (via Docker or native install)
- **Minimum RAM:** 2GB free (for small models like `qwen2.5:1.5b`)

## 🚀 Installation Guide

### 1. Set Up Ollama via Docker

Add to your `docker-compose.yml`:

```yaml
# Small model
services:
  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    deploy:
      resources:
        limits:
          memory: 3G
    restart: unless-stopped

volumes:
  ollama_data:

# Big model
services:
  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    environment:
      - OLLAMA_KEEP_ALIVE=24h        # Keep model in RAM for 24h (faster responses)
      - OLLAMA_NUM_PARALLEL=8         # Handle 8 concurrent requests
      - OLLAMA_MAX_LOADED_MODELS=2    # Keep 2 models loaded simultaneously
      - OLLAMA_CONTEXT_LENGTH=8192    # 8K context window
    deploy:
      resources:
        limits:
          memory: 48G
    restart: unless-stopped

volumes:
  ollama_data:
```

Start the container:
```bash
docker compose up -d ollama
```

### 2. Pull an AI Model

```bash
# Choose a model that fits your available RAM:
docker exec ollama ollama pull qwen2.5:1.5b    # ~1.1GB RAM (lightweight)
docker exec ollama ollama pull phi4-mini        # ~2.4GB RAM (balanced)
docker exec ollama ollama pull llama3.1         # ~4.7GB RAM (powerful)
```

### 3. Verify Ollama is Running

```bash
# Linux/Mac:
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5:1.5b","messages":[{"role":"user","content":"Hello"}]}'

# Windows PowerShell:
Invoke-RestMethod -Uri "http://localhost:11434/v1/chat/completions" `
  -Method Post -ContentType "application/json" `
  -Body '{"model":"qwen2.5:1.5b","messages":[{"role":"user","content":"Hello"}]}'
```

### 4. Install the Module in Odoo

1. Copy the `ai_ollama` folder into your Odoo addons path
2. Go to **Apps** → **Update Apps List**
3. Search for **"AI Ollama"** → click **Install**
4. Go to **Settings** → **General Settings** → **Integrations** → Verify the Ollama URL

## ⚙️ Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `ai.ollama_base_url` | `http://ollama:11434` | Ollama server URL |

- **Docker:** use `http://ollama:11434` (service name in docker-compose)
- **Local install:** use `http://localhost:11434`

## 📦 Supported Models

| Model | Size | RAM Needed | Notes |
|-------|------|------------|-------|
| `qwen2.5:0.5b` | 0.5B | ~0.5GB | Ultra-light, low quality |
| `qwen2.5:1.5b` | 1.5B | ~1.1GB | Lightweight, basic usage |
| `qwen2.5:3b` | 3B | ~2GB | Balanced |
| `llama3.2:1b` | 1B | ~0.8GB | Lightweight |
| `llama3.2:3b` | 3B | ~2GB | Good |
| `phi4-mini` | 3.8B | ~2.4GB | Recommended |
| `gemma3:1b` | 1B | ~0.8GB | Lightweight |
| `gemma3:4b` | 4B | ~2.5GB | Good |
| `mistral` | 7B | ~4.1GB | Powerful |
| `llama3.1` | 8B | ~4.7GB | Very powerful |
| `qwen2.5:7b` | 7B | ~4.7GB | Very powerful |
| `deepseek-r1:1.5b` | 1.5B | ~1.1GB | Reasoning model |
| `deepseek-r1:7b` | 7B | ~4.7GB | Strong reasoning |

> 💡 To add more models, pull them via Ollama and add entries to `OLLAMA_PROVIDER.llms` in `utils/ollama_patch.py`

## 🏗️ Architecture

```
ai_ollama/
├── __manifest__.py              # Module manifest
├── __init__.py
├── models/
│   ├── __init__.py
│   └── res_config_settings.py   # Ollama URL config field
├── utils/
│   ├── __init__.py
│   └── ollama_patch.py          # Core: Patches PROVIDERS + LLMApiService
└── views/
    └── res_config_settings_views.xml  # Settings UI
```

This module works by **monkey-patching** `LLMApiService` and `PROVIDERS` from the base `ai` module at load time — no original source code is modified.

## 📝 Notes

- **RAG/Embedding is not supported** in this version. Can be added later if needed.
- Ollama uses the **Chat Completions API** (`/v1/chat/completions`), not the OpenAI Responses API.
- Response speed depends on your server's CPU/RAM. Using a GPU (NVIDIA) will significantly improve performance.

## 📄 License

LGPL-3
