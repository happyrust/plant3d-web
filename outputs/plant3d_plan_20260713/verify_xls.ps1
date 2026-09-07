param([Parameter(Mandatory = $true)][string]$Path)

$excel = $null
$workbook = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $workbook = $excel.Workbooks.Open((Resolve-Path -LiteralPath $Path).Path, 0, $true)
  $sheetNames = @($workbook.Worksheets | ForEach-Object { $_.Name })
  $summary = [ordered]@{
    FileFormat = $workbook.FileFormat
    SheetCount = $workbook.Worksheets.Count
    Sheets = $sheetNames
    Title = $workbook.Worksheets.Item('开发任务').Range('A1').Text
    FirstTask = $workbook.Worksheets.Item('开发任务').Range('A5').Text
    LastTask = $workbook.Worksheets.Item('开发任务').Range('A20').Text
    Deadline = $workbook.Worksheets.Item('开发任务').Range('F20').Text
    WeeklyTitle = $workbook.Worksheets.Item('周计划').Range('A1').Text
  }
  $summary | ConvertTo-Json -Depth 4
  $workbook.Close($false)
  $workbook = $null
} finally {
  if ($workbook) { $workbook.Close($false) }
  if ($excel) { $excel.Quit() }
  if ($workbook) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) }
  if ($excel) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
