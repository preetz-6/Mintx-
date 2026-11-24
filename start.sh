#!/usr/bin/env sh
# Start the Mintx Assistant server (macOS / Linux).
#   ./start.sh            real answers from local Ollama (qwen2.5:7b)
#   ./start.sh dummy      instant offline replies, no LLM needed
cd "$(dirname "$0")"
export MINTX_MODE="${1:-llm}"
export MINTX_CHAT_MODEL="${MINTX_CHAT_MODEL:-qwen2.5:7b}"
echo "Mintx server ($MINTX_MODE) on http://127.0.0.1:8765"
exec python -m uvicorn server:app --host 127.0.0.1 --port 8765
