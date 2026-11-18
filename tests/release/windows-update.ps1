param([Parameter(Mandatory)][string]$AppPath)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

function Wait-For([string]$Label, [scriptblock]$Read, [int]$Seconds = 45) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        try {
            $result = & $Read
            if ($result) { return $result }
        } catch [System.Windows.Automation.ElementNotAvailableException] {
            # The updater closes the old window before the new process launches.
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out: $Label"
}

function Get-Version {
    $info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($AppPath)
    return "$($info.FileMajorPart).$($info.FileMinorPart).$($info.FileBuildPart)"
}

function Get-AppWindow {
    foreach ($process in Get-Process -Name stock-fund-tauri -ErrorAction SilentlyContinue) {
        if ($process.MainWindowHandle -ne 0) {
            return [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
        }
    }
}

function Find-Control([string]$Name, [System.Windows.Automation.ControlType]$ControlType) {
    $window = Get-AppWindow
    if (!$window) { return }
    [System.Windows.Automation.Condition]$condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty, $Name)
    if ($ControlType) {
        $typeCondition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ControlType)
        $condition = [System.Windows.Automation.AndCondition]::new($condition, $typeCondition)
    }
    return $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Press([string]$Name) {
    $control = Wait-For $Name { Find-Control $Name ([System.Windows.Automation.ControlType]::Button) }
    Write-Host "Clicking $Name"
    $control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}

function Check-Setting([string]$Name, [bool]$Set) {
    $control = Wait-For $Name { Find-Control $Name ([System.Windows.Automation.ControlType]::CheckBox) }
    Write-Host "Checking $Name"
    $toggle = $control.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    if ($Set -and $toggle.Current.ToggleState -ne 'On') { $toggle.Toggle() }
    $null = Wait-For "setting on: $Name" { $toggle.Current.ToggleState -eq 'On' } 10
}

if ((Get-Version) -ne '0.1.0') { throw 'Expected v0.1.0 installed from the public installer' }
$original = Start-Process -FilePath $AppPath -PassThru
Press '设置'
Check-Setting '精简列表' $true
Check-Setting '窗口置顶' $true
Press '保存设置'
Write-Host 'v0.1.0 started and test settings saved.'
$null = Wait-For 'v0.1.1 available' { Find-Control '发现新版本 0.1.1' } 100
Press '下载并安装'
$null = Wait-For 'v0.1.1 installed and relaunched' {
    $app = Get-Process -Name stock-fund-tauri -ErrorAction SilentlyContinue |
        Where-Object { $_.Id -ne $original.Id -and $_.MainWindowHandle -ne 0 }
    $app -and (Get-Version) -eq '0.1.1'
} 240
Press '设置'
Check-Setting '精简列表' $false
Check-Setting '窗口置顶' $false
Write-Host 'v0.1.1 downloaded, installed and relaunched. Both settings were retained.'
