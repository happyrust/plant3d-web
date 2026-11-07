/**
 * 离线包 PowerShell 脚本的 Server 2012 R2 兼容门禁。
 *
 * 现场是 Windows Server 2012 R2，自带 Windows PowerShell 4.0；开发机是 5.1。下面这些写法
 * 在 5.1 上能跑、本地测不出来，到 4.0 上才会报语法错误、找不到命令，或者像 Get-Command
 * 结果的 .Source 那样静默取到空值。命令和参数清单按 PSScriptAnalyzer 官方兼容配置
 * （2012 R2 + PowerShell 4.0 对比 5.1）核对过。PowerShell 7 才有的写法（?? / ?. 等）在
 * 5.1 上同样报错，本地就会暴露，这里不重复拦截。
 *
 * .Source 只在对象来自 Get-Command 时才算问题：接口 JSON 和哈希表里的 source 字段在 4.0 上
 * 照常可用，所以只拦「从 Get-Command 赋值的变量」和同一行里直接取 Get-Command 结果的用法。
 *
 * 注释行、<# #> 注释块和 here-string（Add-Type 的 C# 源码在里面）不检查；确属误判的行
 * 可在行尾加 `# ps4-ok` 跳过。
 */

const RULES = [
  {
    pattern: /::new\s*\(/i,
    reason: '[类型]::new() 构造语法要 PowerShell 5.0，改用 New-Object',
  },
  {
    pattern: /^\s*(?:class|enum)\s+\w/i,
    reason: 'class / enum 定义要 PowerShell 5.0',
  },
  {
    pattern: /^\s*using\s+(?:namespace|module|assembly)\s/i,
    reason: 'using namespace / module / assembly 语句要 PowerShell 5.0',
  },
  {
    pattern: /(?<![\w$-])(?:Set-Content|Add-Content|Out-File)\b[^|;]*\s-NoNewline\b/i,
    reason: 'Set-Content / Add-Content / Out-File 的 -NoNewline 参数要 PowerShell 5.0',
  },
  {
    pattern: /(?<![\w$-])(?:Get-ChildItem|gci)\b[^|;]*\s-Depth\b/i,
    reason: 'Get-ChildItem 的 -Depth 参数要 PowerShell 5.0',
  },
  {
    pattern: /(?<![\w$-])(?:Expand-Archive|Compress-Archive|New-TemporaryFile|New-Guid|Get-ItemPropertyValue|Format-Hex|Get-Clipboard|Set-Clipboard|ConvertFrom-String|Write-Information|Import-PowerShellDataFile|Get-ComputerInfo|Get-TimeZone|Set-TimeZone|Clear-RecycleBin|Get-LocalUser)\b/i,
    reason: '该命令 PowerShell 5.0 起才有',
  },
];

const COMMAND_INFO_SOURCE_REASON = 'Get-Command 结果的 .Source 属性要 PowerShell 5.0，4.0 上是空值；取命令路径改用 .Path';
const COMMAND_VAR_ASSIGNMENT = /\$(?:\w+:)?(\w+)\s*=\s*[@(\s]*(?:Get-Command|gcm)\b/gi;
const INLINE_COMMAND_SOURCE = /(?<![\w$-])(?:Get-Command|gcm)\b.*(?:\)\s*\.Source\b|\$(?:_|PSItem)\.Source\b|-Exp\w*\s+Source\b|\|\s*(?:ForEach-Object|foreach|%)\s+Source\b)/i;
const VARIABLE_SOURCE = /\$(?:\w+:)?(\w+)\.Source\b/gi;

const NON_CODE_BLOCK = /<#[\s\S]*?#>|@(['"])[ \t]*\n[\s\S]*?\n\1@/g;

/**
 * 返回脚本里 PowerShell 4.0 不支持的写法，行号按原文件计。
 * @param {string} content 脚本全文
 * @returns {{ line: number, reason: string, text: string }[]}
 */
export function findPowerShell4Incompatibilities(content) {
  const lines = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(NON_CODE_BLOCK, (block) => block.replace(/[^\n]/g, ''))
    .split('\n')
    .map((line) => (/^\s*#/.test(line) || /#\s*ps4-ok\b/i.test(line) ? '' : line));

  const commandVars = new Set();
  for (const line of lines) {
    for (const match of line.matchAll(COMMAND_VAR_ASSIGNMENT)) {
      commandVars.add(match[1].toLowerCase());
    }
  }

  const problems = [];
  lines.forEach((line, index) => {
    const reasons = RULES.filter((rule) => rule.pattern.test(line)).map((rule) => rule.reason);
    if (
      INLINE_COMMAND_SOURCE.test(line)
      || [...line.matchAll(VARIABLE_SOURCE)].some((match) => commandVars.has(match[1].toLowerCase()))
    ) {
      reasons.push(COMMAND_INFO_SOURCE_REASON);
    }
    for (const reason of reasons) {
      problems.push({ line: index + 1, reason, text: line.trim() });
    }
  });
  return problems;
}
