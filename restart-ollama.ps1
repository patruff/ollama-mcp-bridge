# restart-ollama.ps1 - Cross-platform Ollama restart script
Write-Host "Detecting operating system..."

# Use different variable names to avoid conflict with read-only variables
$onWindows = $false
$onMacOS = $false
$onLinux = $false

# For PowerShell Core 6+ use built-in variables
if ($PSVersionTable.PSVersion.Major -ge 6) {
    $onWindows = $IsWindows
    $onMacOS = $IsMacOS
    $onLinux = $IsLinux
} else {
    # For PowerShell 5.x assume Windows
    $onWindows = $true
}

if ($onWindows) { Write-Host "Running on Windows" }
elseif ($onMacOS) { Write-Host "Running on macOS" }
elseif ($onLinux) { Write-Host "Running on Linux" }

Write-Host "Stopping Ollama processes..."

if ($onWindows) {
    # Windows commands
    Get-Process | Where-Object {$_.ProcessName -like '*ollama*'} | ForEach-Object { $_.Kill() }
} elseif ($onMacOS -or $onLinux) {
    # macOS/Linux commands
    $ollamaProcesses = ps aux | grep ollama | grep -v grep
    if ($ollamaProcesses) {
        Write-Host "Found Ollama processes, terminating..."
        pkill -f ollama
    }
}

Write-Host "Waiting for cleanup..."
Start-Sleep -Seconds 5

Write-Host "Checking for remaining processes..."

if ($onWindows) {
    $remaining = Get-Process | Where-Object {$_.ProcessName -like '*ollama*'}
    if ($remaining) {
        Write-Host "Found remaining processes, force killing..."
        $remaining | ForEach-Object { $_.Kill() }
    }
} elseif ($onMacOS -or $onLinux) {
    $remaining = ps aux | grep ollama | grep -v grep
    if ($remaining) {
        Write-Host "Found remaining processes, force killing..."
        pkill -9 -f ollama
    }
}

Write-Host "Checking port 11434..."

if ($onWindows) {
    $portUse = netstat -ano | findstr "11434"
    if ($portUse) {
        $pid = ($portUse -split ' ')[-1]
        Write-Host "Killing process using port 11434: $pid"
        taskkill /F /PID $pid
    }
} elseif ($onMacOS -or $onLinux) {
    $portUse = lsof -ti:11434
    if ($portUse) {
        Write-Host "Killing process using port 11434: $portUse"
        kill -9 $portUse
    }
}

Write-Host "Starting Ollama..."

if ($onWindows) {
    Start-Process ollama -ArgumentList "serve" -NoNewWindow
} elseif ($onMacOS -or $onLinux) {
    # Start Ollama in background
    nohup ollama serve > /dev/null 2>&1 &
    Write-Host "Ollama started in background"
}

Write-Host "Ollama restart complete!"