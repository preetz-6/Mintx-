#!/usr/bin/env sh
# Start the Mintx Assistant server (macOS / Linux).
#   ./start.sh                         local Ollama (qwen2.5:7b)
#   ./start.sh llm groq --log          Groq cloud model, record prompts (view at /logs)
#   ./start.sh dummy                   instant offline replies, no LLM
# Providers: ollama | ollama-cloud | groq | openrouter. Keys: GROQ_API_KEY / OPENROUTER_API_KEY.
cd "$(dirname "$0")"
export MINTX_MODE="${1:-llm}"
export MINTX_PROVIDER="${2:-ollama}"
[ "$3" = "--log" ] && export MINTX_LOG_PROMPTS=1 || export MINTX_LOG_PROMPTS=0
echo "Mintx server ($MINTX_MODE, $MINTX_PROVIDER) on http://127.0.0.1:8765"
[ "$MINTX_LOG_PROMPTS" = "1" ] && echo "Prompt log: http://127.0.0.1:8765/logs"
exec python -m uvicorn server:app --host 127.0.0.1 --port 8765
