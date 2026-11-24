# Start the Mintx Assistant server.
#   .\start.ps1               real answers from local Ollama (qwen2.5:7b)
#   .\start.ps1 -Mode dummy   instant offline replies, no LLM needed
#   .\start.ps1 -Model llama3.2:3b
param(
    [ValidateSet('llm', 'dummy')] [string]$Mode = 'llm',
    [string]$Model = 'qwen2.5:7b'
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:MINTX_MODE = $Mode
$env:MINTX_CHAT_MODEL = $Model
if ($Mode -eq 'llm') {
    try { $null = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 }
    catch { Write-Warning 'Ollama is not answering on port 11434. Start the Ollama app, or use -Mode dummy.' }
}
Write-Host "Mintx server ($Mode$(if ($Mode -eq 'llm') { ", $env:MINTX_CHAT_MODEL" })) on http://127.0.0.1:8765"
Write-Host 'Load the assistant folder in chrome://extensions, open http://127.0.0.1:8765/samples/ and press Alt+M.'
python -m uvicorn server:app --host 127.0.0.1 --port 8765
