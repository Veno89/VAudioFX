import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const runnerPid = Number(process.argv[2]);
if (process.platform !== 'win32' || !Number.isInteger(runnerPid) || runnerPid < 1)
  throw new Error('Memory profiling requires Windows and an exact owned browser-runner PID.');
await mkdir('.qa', { recursive: true });
const report = `.qa/peak-memory-${runnerPid}.json`;
const ready = `.qa/memory-ready-${runnerPid}.txt`;
const script = String.raw`
$ErrorActionPreference = 'Stop'
$taskParentPid = ${runnerPid}
$taskInitialRoot = Get-CimInstance Win32_Process -Filter "ProcessId=$taskParentPid"
if (!$taskInitialRoot) { throw 'Owned runner is no longer present.' }
$taskDeadline = [DateTime]::UtcNow.AddMinutes(10)
$taskStarted = [DateTime]::UtcNow.ToString('o')
$taskPeaks = @{}
$taskSampleCount = 0
while ([DateTime]::UtcNow -lt $taskDeadline) {
  $taskAll = @(Get-CimInstance Win32_Process)
  $taskRoot = $taskAll | Where-Object { $_.ProcessId -eq $taskParentPid }
  if (!$taskRoot -or $taskRoot.CreationDate -ne $taskInitialRoot.CreationDate) { break }
  $taskOwned = [System.Collections.Generic.HashSet[int]]::new()
  [void]$taskOwned.Add($taskParentPid)
  do {
    $taskChanged = $false
    foreach ($taskProcess in $taskAll) {
      if ($taskOwned.Contains([int]$taskProcess.ParentProcessId) -and $taskOwned.Add([int]$taskProcess.ProcessId)) { $taskChanged = $true }
    }
  } while ($taskChanged)
  foreach ($taskEngine in @('chromium','firefox')) {
    $taskNames = if ($taskEngine -eq 'firefox') { @('firefox.exe') } else { @('chrome.exe','chrome-headless-shell.exe') }
    $taskIds = @($taskAll | Where-Object { $taskOwned.Contains([int]$_.ProcessId) -and $_.Name -in $taskNames } | ForEach-Object { [int]$_.ProcessId })
    if (!$taskIds.Count) { continue }
    $taskPrivate = 0L; $taskWorking = 0L; $taskCount = 0
    foreach ($taskId in $taskIds) {
      $taskNative = Get-Process -Id $taskId -ErrorAction SilentlyContinue
      if ($taskNative) { $taskPrivate += $taskNative.PrivateMemorySize64; $taskWorking += $taskNative.WorkingSet64; $taskCount++ }
    }
    if (!$taskPeaks.ContainsKey($taskEngine)) { $taskPeaks[$taskEngine] = @{ samples = 0; privateBytes = 0L; workingSetBytes = 0L; processCount = 0 } }
    $taskPeak = $taskPeaks[$taskEngine]
    $taskBaseline = '.qa/memory-baseline-${runnerPid}-' + $taskEngine
    if ((Test-Path -LiteralPath ($taskBaseline + '.request')) -and !$taskPeak.ContainsKey('baselinePrivateBytes')) {
      $taskPeak.baselinePrivateBytes = $taskPrivate
      $taskPeak.baselineWorkingSetBytes = $taskWorking
      [IO.File]::WriteAllText(($taskBaseline + '.ready'), 'ready')
    }
    $taskPeak.samples++
    $taskPeak.privateBytes = [Math]::Max($taskPeak.privateBytes, $taskPrivate)
    $taskPeak.workingSetBytes = [Math]::Max($taskPeak.workingSetBytes, $taskWorking)
    $taskPeak.processCount = [Math]::Max($taskPeak.processCount, $taskCount)
  }
  $taskSampleCount++
  if ($taskSampleCount -eq 1) { [IO.File]::WriteAllText('${ready}', 'ready') }
  Start-Sleep -Milliseconds 250
}
$taskReport = @{ startedUtc = $taskStarted; finishedUtc = [DateTime]::UtcNow.ToString('o'); ownedRunnerPid = $taskParentPid; requestedIntervalMs = 250; samples = $taskSampleCount; engines = $taskPeaks; note = 'Sampled sums of owned browser processes. Private bytes are committed private memory, not physical RAM. Working sets may double-count shared pages. Sampling can miss short peaks.' }
[IO.File]::WriteAllText('${report}', ($taskReport | ConvertTo-Json -Depth 5))
`;
const sampler = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
  windowsHide: true,
  stdio: 'inherit',
});
console.log(
  `Task-owned memory sampler ${sampler.pid}; stops when runner ${runnerPid} exits or after ten minutes.`,
);
const code = await new Promise((resolve, reject) => {
  sampler.once('exit', resolve);
  sampler.once('error', reject);
});
if (code !== 0) throw new Error(`Memory sampler failed with exit ${code}.`);
console.log(`Sampled browser memory report: ${report}`);
