#!/bin/sh
# Entrypoint: start Ollama server + FastAPI sidecar concurrently

set -e

echo "[entrypoint] Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

echo "[entrypoint] Starting FastAPI sidecar on port 11435..."
python3 /app/ollama_sidecar.py &
SIDECAR_PID=$!

# If either process dies, kill the other and exit
wait_and_exit() {
    echo "[entrypoint] A process exited. Shutting down..."
    kill $OLLAMA_PID $SIDECAR_PID 2>/dev/null || true
    exit 1
}

trap wait_and_exit TERM INT

# Wait for both
wait $OLLAMA_PID $SIDECAR_PID