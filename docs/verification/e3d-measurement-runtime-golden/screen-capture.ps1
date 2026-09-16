# screen-capture.ps1 -Out <png> [-Hwnd <main window hwnd>]
# Companion to printwindow-capture.ps1 for the E3D 3.1 shadow main window (golden MD section 40.1): PrintWindow only
# returns a stale frame for that window and never includes the floating PML forms, so this one BitBlts the composited
# desktop (Graphics.CopyFromScreen) over the window's on-screen rectangle, clipped to the primary display, at physical
# pixels (SetProcessDPIAware first). The window must be restored (not iconic) and on top of anything you want in the frame.
param([Parameter(Mandatory=$true)][string]$Out, [long]$Hwnd = 94838402)
# Screen capture (BitBlt from the composited desktop) of the window's on-screen rectangle, clipped to the primary
# display, at true physical pixels. PrintWindow only returns a stale frame for this window and misses floating forms.
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class Shot {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
}
'@
[void][Shot]::SetProcessDPIAware()
Add-Type -AssemblyName System.Drawing
$h = [IntPtr]$Hwnd
if ([Shot]::IsIconic($h)) { Write-Output "fail: window is iconic"; exit 1 }
$r = New-Object Shot+RECT; [void][Shot]::GetWindowRect($h, [ref]$r)
$sw = [Shot]::GetSystemMetrics(0); $sh = [Shot]::GetSystemMetrics(1)
$x0 = [Math]::Max(0, $r.L); $y0 = [Math]::Max(0, $r.T); $x1 = [Math]::Min($sw, $r.R); $y1 = [Math]::Min($sh, $r.B)
$w = $x1 - $x0; $hgt = $y1 - $y0
if ($w -le 0 -or $hgt -le 0) { Write-Output "fail: empty rect"; exit 1 }
$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x0, $y0, 0, 0, (New-Object System.Drawing.Size $w, $hgt))
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "ok size=${w}x${hgt} window=$($r.L),$($r.T)-$($r.R),$($r.B) screen=${sw}x${sh} out=$Out"
