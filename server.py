"""Mintx Assistant server.

    python -m uvicorn server:app --host 127.0.0.1 --port 8765

Routes
  GET  /health    mode, model and egress-guard status (used by the side panel)
  POST /chat      sanitized conversation in, streamed model reply out (see chat.py)
  GET  /samples/  synthetic test scenarios

Configuration (environment variables)
  MINTX_MODE        dummy (default, no LLM) | llm
  MINTX_CHAT_MODEL  model name, default qwen2.5:7b
  MINTX_ENDPOINT    OpenAI-compatible chat completions URL, default local Ollama
  MINTX_API_KEY     only if the endpoint needs one
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from chat import router

ROOT = Path(__file__).resolve().parent
app = FastAPI(title="Mintx Assistant")
app.include_router(router)
app.mount("/samples", StaticFiles(directory=ROOT / "samples", html=True), name="samples")
