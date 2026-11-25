"""Mintx Assistant server.

    python -m uvicorn server:app --host 127.0.0.1 --port 8765

Routes
  GET  /health    mode, model and egress-guard status (used by the side panel)
  POST /chat      sanitized conversation in, streamed model reply out (see chat.py)
  GET  /samples/  synthetic test scenarios
  GET  /logs      prompt log viewer (what the model received), when MINTX_LOG_PROMPTS=1

Configuration (environment variables)
  MINTX_MODE         dummy (default, no LLM) | llm
  MINTX_PROVIDER     ollama (default) | ollama-cloud | groq | openrouter
  MINTX_CHAT_MODEL   override the provider's default model
  MINTX_ENDPOINT     override with any OpenAI-compatible chat-completions URL
  MINTX_API_KEY      key for a custom endpoint (groq/openrouter read GROQ_API_KEY / OPENROUTER_API_KEY)
  MINTX_LOG_PROMPTS  1 = record every prompt and reply in logs/prompts.jsonl
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from chat import router

ROOT = Path(__file__).resolve().parent
app = FastAPI(title="Mintx Assistant")
app.include_router(router)
app.mount("/samples", StaticFiles(directory=ROOT / "samples", html=True), name="samples")


@app.get("/logs", include_in_schema=False)
def logs_page():
    return FileResponse(ROOT / "viewer" / "logs.html")
