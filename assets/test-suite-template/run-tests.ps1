param(
    [switch] $JsonLines,
    # Any other runner options, for example: --attach, --grep smoke, --profile qa
    [Parameter(ValueFromRemainingArguments = $true)] [string[]] $RunnerOptions
)

$runnerPath = $env:PERSEPHONE_TEST_EXE
if (-not $runnerPath) {
    $runner = Get-Command persephone-test.exe -ErrorAction SilentlyContinue
    if ($runner) { $runnerPath = $runner.Source }
}

if (-not $runnerPath -or -not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
    Write-Error "Cannot find persephone-test.exe. Add it to PATH or set PERSEPHONE_TEST_EXE to its full path."
    exit 1
}

$suiteDirectory = $PSScriptRoot
$arguments = @($suiteDirectory)
if ($JsonLines) { $arguments += @("--reporter", "json-lines") }
if ($RunnerOptions) { $arguments += $RunnerOptions }

& $runnerPath @arguments
exit $LASTEXITCODE
