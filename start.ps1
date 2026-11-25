# Start the Mintx Assistant server.
#   .\start.ps1                                  local Ollama (qwen2.5:7b)
#   .\start.ps1 -Provider groq -LogPrompts       Groq cloud model, record every prompt (view at /logs)
#   .\start.ps1 -Provider ollama-cloud           Ollama Cloud model (run `ollama signin` once first)
#   .\start.ps1 -Provider openrouter             OpenRouter free model
#   .\start.ps1 -Mode dummy                      instant offline replies, no LLM
#   .\start.ps1 -Model llama3.2:3b               any model name the provider offers
# API keys are read from the environment, never from files:
#   $env:GROQ_API_KEY = "..."   or   $env:OPENROUTER_API_KEY = "..."
param(
    [ValidateSet('llm', 'dummy')] [string]$Mode = 'llm',
    [ValidateSet('ollama', 'ollama-cloud', 'groq', 'openrouter')] [string]$Provider = 'ollama',
    [string]$Model,
    [switch]$LogPrompts
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:MINTX_MODE = $Mode
$env:MINTX_PROVIDER = $Provider
if ($Model) { $env:MINTX_CHAT_MODEL = $Model } else { Remove-Item Env:MINTX_CHAT_MODEL -ErrorAction SilentlyContinue }
$env:MINTX_LOG_PROMPTS = if ($LogPrompts) { '1' } else { '0' }

if ($Mode -eq 'llm') {
    if ($Provider -in 'ollama', 'ollama-cloud') {
        try { $null = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 }
        catch { Write-Warning 'Ollama is not answering on port 11434. Start the Ollama app, or use -Mode dummy.' }
        if ($Provider -eq 'ollama-cloud') { Write-Host 'Ollama Cloud: if requests fail with 401, run `ollama signin` once.' }
    }
    if ($Provider -eq 'groq' -and -not $env:GROQ_API_KEY) { Write-Warning 'Set $env:GROQ_API_KEY first (free key at console.groq.com).' }
    if ($Provider -eq 'openrouter' -and -not $env:OPENROUTER_API_KEY) { Write-Warning 'Set $env:OPENROUTER_API_KEY first (openrouter.ai/keys).' }
}
$label = if ($Mode -eq 'dummy') { 'dummy model' } else { "$Provider$(if ($Model) { ", $Model" })" }
Write-Host "Mintx server ($label) on http://127.0.0.1:8765"
if ($LogPrompts) { Write-Host 'Prompt log: http://127.0.0.1:8765/logs' }
Write-Host 'Load the assistant folder in chrome://extensions, open http://127.0.0.1:8765/samples/ and press Alt+M.'
python -m uvicorn server:app --host 127.0.0.1 --port 8765
