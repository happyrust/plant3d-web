using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.Versioning;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Xml.Linq;

[assembly: TargetFramework(".NETFramework,Version=v4.5", FrameworkDisplayName = ".NET Framework 4.5")]

namespace Plant3dOfflinePatch
{
    // Plant3D-Web 离线补丁生成器：选两个解压后的发布文件夹（旧版 / 新版），
    // 直接生成可分发执行的升级补丁 EXE。GUI 双击使用，CLI 供脚本调用：
    //   OfflinePatchMaker.exe                              — 打开图形界面
    //   OfflinePatchMaker.exe --source DIR --target DIR [--output EXE] [--force]
    //     未给 --output 时只对比差异不产出；给了则生成补丁 EXE 和 .sha256。
    // 生成的补丁结构与 build-offline-patch.ps1（ZIP 模式）完全一致；规则
    // （允许/保护路径）由 OfflinePatchRules.cs 与本文件一同编译，单点维护。
    sealed class MakerDirEntry
    {
        public string Path;
        public string Hash;
        public long Size;
        public string FullPath;
    }

    sealed class MakerScan
    {
        public List<MakerDirEntry> Publishable = new List<MakerDirEntry>();
        public List<string> ProtectedSeen = new List<string>();
        public List<MakerDirEntry> Other = new List<MakerDirEntry>();
    }

    sealed class MakerDiffEntry
    {
        public string Path;
        public string Kind;
        public MakerDirEntry Source;
        public MakerDirEntry Target;
    }

    static class MakerCore
    {
        public static string Root(string value)
        {
            if (String.IsNullOrWhiteSpace(value)) throw new DirectoryNotFoundException("请选择目录。");
            string root = Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (root.Length <= 3 || !Directory.Exists(root)) throw new DirectoryNotFoundException("目录不存在：" + value);
            DirectoryInfo directory = new DirectoryInfo(root);
            while (directory != null)
            {
                if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("不支持 junction / 符号链接目录：" + directory.FullName);
                directory = directory.Parent;
            }
            return root;
        }

        public static MakerScan Scan(string root)
        {
            MakerScan scan = new MakerScan();
            List<string> pending = new List<string> { "" };
            while (pending.Count > 0)
            {
                string relative = pending[pending.Count - 1];
                pending.RemoveAt(pending.Count - 1);
                string current = String.IsNullOrEmpty(relative) ? root : Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar));
                foreach (string dir in Directory.GetDirectories(current))
                {
                    DirectoryInfo info = new DirectoryInfo(dir);
                    if ((info.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                    string name = String.IsNullOrEmpty(relative) ? info.Name : relative + "/" + info.Name;
                    if (PatchRules.ProtectedDirectory(name)) continue;
                    pending.Add(name);
                }
                foreach (string file in Directory.GetFiles(current))
                {
                    string name = String.IsNullOrEmpty(relative) ? Path.GetFileName(file) : relative + "/" + Path.GetFileName(file);
                    string normalized = PatchRules.Relative(name);
                    if (PatchRules.Protected(normalized)) { scan.ProtectedSeen.Add(normalized); continue; }
                    MakerDirEntry entry = new MakerDirEntry { Path = normalized, FullPath = file, Size = new FileInfo(file).Length };
                    if (PatchRules.Allowed(normalized)) { entry.Hash = PatchRules.Hash(file); scan.Publishable.Add(entry); }
                    else { entry.Hash = PatchRules.Hash(file); scan.Other.Add(entry); }
                }
            }
            return scan;
        }

        static string ScanId(IEnumerable<MakerDirEntry> files)
        {
            StringBuilder text = new StringBuilder();
            foreach (MakerDirEntry file in files.OrderBy(x => x.Path, StringComparer.OrdinalIgnoreCase))
                text.Append(file.Path).Append('=').Append(file.Hash).Append('\n');
            using (MemoryStream stream = new MemoryStream(Encoding.UTF8.GetBytes(text.ToString())))
                return PatchRules.Hash(stream);
        }

        public static string Version(string root, string side)
        {
            string release = Path.Combine(root, "release.json");
            if (!File.Exists(release)) throw new IOException(side + "缺少 release.json，请选一体化发布包解压后的目录。");
            Dictionary<string, object> document;
            try { document = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(release)); }
            catch (Exception error) { throw new IOException(side + "的 release.json 无法解析：" + error.Message, error); }
            object frontend;
            if (document == null || !document.TryGetValue("frontend", out frontend)) throw new IOException(side + "的 release.json 不含 frontend 版本信息。");
            Dictionary<string, object> values = frontend as Dictionary<string, object>;
            object version;
            if (values == null || !values.TryGetValue("version", out version) || version == null || String.IsNullOrWhiteSpace(version.ToString()))
                throw new IOException(side + "的 release.json 不含 frontend.version。");
            return version.ToString();
        }

        public static List<MakerDiffEntry> Diff(MakerScan source, MakerScan target)
        {
            Dictionary<string, MakerDirEntry> a = source.Publishable.ToDictionary(x => x.Path, StringComparer.OrdinalIgnoreCase);
            Dictionary<string, MakerDirEntry> b = target.Publishable.ToDictionary(x => x.Path, StringComparer.OrdinalIgnoreCase);
            Dictionary<string, MakerDirEntry> otherA = source.Other.ToDictionary(x => x.Path, StringComparer.OrdinalIgnoreCase);
            Dictionary<string, MakerDirEntry> otherB = target.Other.ToDictionary(x => x.Path, StringComparer.OrdinalIgnoreCase);
            List<MakerDiffEntry> changes = new List<MakerDiffEntry>();
            foreach (string name in a.Keys.Union(b.Keys).Union(otherA.Keys).Union(otherB.Keys, StringComparer.OrdinalIgnoreCase).OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
            {
                MakerDirEntry left = a.ContainsKey(name) ? a[name] : (otherA.ContainsKey(name) ? otherA[name] : null);
                MakerDirEntry right = b.ContainsKey(name) ? b[name] : (otherB.ContainsKey(name) ? otherB[name] : null);
                if (left != null && right != null && left.Hash == right.Hash) continue;
                if (!PatchRules.Allowed(name)) throw new IOException("出现差异的路径不在补丁发布白名单内，拒绝打包：" + name);
                string kind = left == null ? "add" : (right == null ? "delete" : "replace");
                changes.Add(new MakerDiffEntry { Path = name, Kind = kind, Source = left, Target = right });
            }
            return changes.OrderBy(x => x.Path.Equals("release.json", StringComparison.OrdinalIgnoreCase) ? 1 : 0).ThenBy(x => x.Path, StringComparer.OrdinalIgnoreCase).ToList();
        }

        static XElement Baseline(string name, IEnumerable<MakerDirEntry> files)
        {
            XElement element = new XElement(name);
            foreach (MakerDirEntry file in files.OrderBy(x => x.Path, StringComparer.OrdinalIgnoreCase))
                element.Add(new XElement("file", new XAttribute("path", file.Path), new XAttribute("sha256", file.Hash), new XAttribute("size", file.Size)));
            return element;
        }

        public static string Build(string sourceDir, string targetDir, string output, bool overwrite, Action<string> log)
        {
            string source = Root(sourceDir);
            string target = Root(targetDir);
            if (source.Equals(target, StringComparison.OrdinalIgnoreCase)) throw new IOException("旧版与新版目录相同。");
            string sourceVersion = Version(source, "旧版目录");
            string targetVersion = Version(target, "新版目录");
            log("扫描旧版：" + source);
            MakerScan scanA = Scan(source);
            log("扫描新版：" + target);
            MakerScan scanB = Scan(target);
            List<MakerDiffEntry> changes = Diff(scanA, scanB);
            if (changes.Count == 0) throw new IOException("两个目录没有可打包的发布差异。");
            foreach (MakerScan scan in new[] { scanA, scanB })
                if (scan.ProtectedSeen.Count > 0) log("已按保护规则排除现场配置/数据 " + scan.ProtectedSeen.Count + " 项。");
            string sourceId = ScanId(scanA.Publishable);
            string targetId = ScanId(scanB.Publishable);
            if (String.IsNullOrWhiteSpace(output))
                output = Path.Combine(Path.GetDirectoryName(target), "plant3d-web-patch-v" + sourceVersion + "-to-v" + targetVersion + "-" + sourceId.Substring(0, 8) + ".exe");
            output = Path.GetFullPath(output);
            if (!output.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) output += ".exe";
            if ((File.Exists(output) || File.Exists(output + ".sha256")) && !overwrite) throw new IOException("输出已存在；勾选覆盖或更换输出路径：" + output);
            if (!Directory.Exists(Path.GetDirectoryName(output))) throw new IOException("输出目录不存在：" + Path.GetDirectoryName(output));
            string id = sourceVersion + "-to-" + targetVersion + "-" + sourceId.Substring(0, 8) + "-" + targetId.Substring(0, 8);
            XElement manifest = new XElement("patch",
                new XAttribute("format", "plant3d-offline-patch-v1"), new XAttribute("id", id),
                new XAttribute("sourceVersion", sourceVersion), new XAttribute("targetVersion", targetVersion),
                new XAttribute("sourceScanSha256", sourceId), new XAttribute("targetScanSha256", targetId),
                new XAttribute("sourceReleaseHash", scanA.Publishable.First(x => x.Path == "release.json").Hash),
                new XAttribute("targetReleaseHash", scanB.Publishable.First(x => x.Path == "release.json").Hash));
            manifest.Add(Baseline("source", scanA.Publishable));
            manifest.Add(Baseline("target", scanB.Publishable));
            XElement operations = new XElement("operations");
            foreach (MakerDiffEntry change in changes)
                operations.Add(new XElement("file", new XAttribute("path", change.Path), new XAttribute("kind", change.Kind),
                    new XAttribute("oldHash", change.Source == null ? "" : change.Source.Hash),
                    new XAttribute("newHash", change.Target == null ? "" : change.Target.Hash),
                    new XAttribute("size", change.Target == null ? 0 : change.Target.Size)));
            manifest.Add(operations);

            string work = Path.Combine(Path.GetDirectoryName(output), ".patch-make-" + Guid.NewGuid().ToString("N"));
            try { Directory.CreateDirectory(work); }
            catch (IOException) { work = Path.Combine(Path.GetTempPath(), "plant3d-patch-make-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(work); }
            catch (UnauthorizedAccessException) { work = Path.Combine(Path.GetTempPath(), "plant3d-patch-make-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(work); }
            try
            {
                string payload = Path.Combine(work, "payload.zip");
                using (FileStream fileStream = new FileStream(payload, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (ZipArchive zip = new ZipArchive(fileStream, ZipArchiveMode.Create))
                {
                    ZipArchiveEntry entry = zip.CreateEntry("patch.xml", CompressionLevel.Optimal);
                    using (StreamWriter writer = new StreamWriter(entry.Open(), new UTF8Encoding(false))) writer.Write(manifest.ToString());
                    foreach (MakerDiffEntry change in changes.Where(x => x.Kind != "delete"))
                    {
                        entry = zip.CreateEntry("files/" + change.Path, CompressionLevel.Optimal);
                        using (Stream input = File.OpenRead(change.Target.FullPath))
                        using (Stream packed = entry.Open()) input.CopyTo(packed);
                    }
                }
                string payloadHash = PatchRules.Hash(payload);
                string patchSource = Resource("OfflinePatch.cs").Replace("__PAYLOAD_SHA256__", payloadHash);
                string rulesSource = Resource("OfflinePatchRules.cs");
                File.WriteAllText(Path.Combine(work, "OfflinePatch.cs"), patchSource, new UTF8Encoding(true));
                File.WriteAllText(Path.Combine(work, "OfflinePatchRules.cs"), rulesSource, new UTF8Encoding(true));
                string compiler = CompilerPath();
                string compiled = Path.Combine(work, "patch.exe");
                List<string> arguments = new List<string> { "/nologo", "/target:winexe", "/platform:x64", "/optimize+", "/codepage:65001", "/out:" + compiled, "/resource:" + payload + ",payload.zip" };
                string framework = Path.GetDirectoryName(compiler);
                foreach (string assembly in new[] { "System.dll", "System.Core.dll", "System.Xml.dll", "System.Xml.Linq.dll", "System.Drawing.dll", "System.Windows.Forms.dll", "System.Management.dll", "System.IO.Compression.dll", "System.IO.Compression.FileSystem.dll" })
                    arguments.Add("/reference:" + Path.Combine(framework, assembly));
                arguments.Add(Path.Combine(work, "OfflinePatch.cs"));
                arguments.Add(Path.Combine(work, "OfflinePatchRules.cs"));
                log("编译补丁 EXE：" + compiler);
                ProcessStartInfo info = new ProcessStartInfo(compiler, String.Join(" ", arguments.Select(x => "\"" + x + "\"")));
                info.UseShellExecute = false;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                using (Process process = Process.Start(info))
                {
                    string text = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
                    process.WaitForExit();
                    if (process.ExitCode != 0) throw new IOException("补丁编译失败：\r\n" + text);
                    if (!String.IsNullOrWhiteSpace(text)) log(text.Trim());
                }
                if (File.Exists(output)) File.Delete(output);
                File.Move(compiled, output);
                string digest = PatchRules.Hash(output).ToUpperInvariant();
                File.WriteAllText(output + ".sha256", digest + "  " + Path.GetFileName(output) + "\r\n", Encoding.ASCII);
                log("操作数：" + changes.Count + "（add " + changes.Count(x => x.Kind == "add") + " / replace " + changes.Count(x => x.Kind == "replace") + " / delete " + changes.Count(x => x.Kind == "delete") + "）");
                return output;
            }
            finally
            {
                try { Directory.Delete(work, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
        }

        static string Resource(string name)
        {
            using (Stream stream = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            {
                if (stream == null) throw new InvalidDataException("生成器缺少内嵌源码资源：" + name);
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8)) return reader.ReadToEnd();
            }
        }

        static string CompilerPath()
        {
            foreach (string sub in new[] { "Framework64", "Framework" })
            {
                string path = Path.Combine(Environment.GetEnvironmentVariable("WINDIR"), "Microsoft.NET", sub, "v4.0.30319", "csc.exe");
                if (File.Exists(path)) return path;
            }
            throw new IOException("未找到 .NET Framework 4.x 自带的 csc.exe，无法编译补丁 EXE。");
        }
    }

    static class MakerProgram
    {
        static readonly object LogLock = new object();
        static string LogPath;
        static Action<string> ViewLog;

        static void Log(string value)
        {
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + value;
            try { lock (LogLock) File.AppendAllText(LogPath, line + Environment.NewLine, new UTF8Encoding(true)); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            Console.WriteLine(line);
            try { if (ViewLog != null) ViewLog(line); }
            catch (InvalidOperationException) { }
        }

        [STAThread]
        static int Main(string[] args)
        {
            LogPath = Path.Combine(Path.GetTempPath(), "plant3d-patch-make-" + Process.GetCurrentProcess().Id + "-" + Guid.NewGuid().ToString("N") + ".log");
            try
            {
                if (args.Length == 0)
                {
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    ShowWindow();
                    return 0;
                }
                string source = null, target = null, output = null;
                bool force = false;
                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i] == "--source" && i + 1 < args.Length) source = args[++i];
                    else if (args[i] == "--target" && i + 1 < args.Length) target = args[++i];
                    else if (args[i] == "--output" && i + 1 < args.Length) output = args[++i];
                    else if (args[i] == "--force") force = true;
                    else throw new ArgumentException("Usage: OfflinePatchMaker.exe --source OLD_DIR --target NEW_DIR [--output PATCH.exe] [--force]");
                }
                if (source == null || target == null) throw new ArgumentException("必须同时给出 --source 与 --target。");
                if (String.IsNullOrWhiteSpace(output))
                {
                    ScanOnly(source, target);
                    return 0;
                }
                string produced = MakerCore.Build(source, target, output, force, Log);
                Log("PATCH=" + produced);
                Log("SHA256=" + PatchRules.Hash(produced).ToUpperInvariant());
                return 0;
            }
            catch (Exception error)
            {
                Log(error.ToString());
                if (args.Length == 0) MessageBox.Show(error.Message + "\r\n日志：" + LogPath, "补丁生成失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        static void ScanOnly(string sourceDir, string targetDir)
        {
            string source = MakerCore.Root(sourceDir);
            string target = MakerCore.Root(targetDir);
            MakerScan a = MakerCore.Scan(source);
            MakerScan b = MakerCore.Scan(target);
            Log("旧版 " + MakerCore.Version(source, "旧版目录") + "：发布文件 " + a.Publishable.Count + "，保护排除 " + a.ProtectedSeen.Count + "，白名单外 " + a.Other.Count);
            Log("新版 " + MakerCore.Version(target, "新版目录") + "：发布文件 " + b.Publishable.Count + "，保护排除 " + b.ProtectedSeen.Count + "，白名单外 " + b.Other.Count);
            List<MakerDiffEntry> changes = MakerCore.Diff(a, b);
            foreach (MakerDiffEntry change in changes) Log(change.Kind + " " + change.Path);
            Log("差异共 " + changes.Count + " 项。");
        }

        static void ShowWindow()
        {
            Form form = new Form { Text = "Plant3D-Web 离线补丁生成器", Width = 860, Height = 640, MinimumSize = new Size(760, 540), StartPosition = FormStartPosition.CenterScreen, Font = new Font("Microsoft YaHei UI", 9F) };
            Label title = new Label { Text = "选择两个解压后的发布目录，生成可直接运行的升级补丁 EXE", Dock = DockStyle.Top, Height = 38, Padding = new Padding(12, 10, 0, 0) };
            Label hint = new Label { Text = "旧版 = 现场当前部署；新版 = 本次要发布的内容。现场配置与数据目录自动排除，不会打进补丁。", Dock = DockStyle.Top, Height = 30, Padding = new Padding(12, 2, 0, 0) };
            TableLayoutPanel grid = new TableLayoutPanel { Dock = DockStyle.Top, Height = 112, Padding = new Padding(12, 4, 12, 4), ColumnCount = 3 };
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 110));
            grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 30)); grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 30)); grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
            TextBox sourceBox = new TextBox { Dock = DockStyle.Fill };
            TextBox targetBox = new TextBox { Dock = DockStyle.Fill };
            TextBox outputBox = new TextBox { Dock = DockStyle.Fill };
            Button sourceBrowse = new Button { Text = "旧版目录…", Dock = DockStyle.Fill };
            Button targetBrowse = new Button { Text = "新版目录…", Dock = DockStyle.Fill };
            Button outputBrowse = new Button { Text = "输出 EXE…", Dock = DockStyle.Fill };
            grid.Controls.Add(new Label { Text = "旧版目录", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 0);
            grid.Controls.Add(sourceBox, 1, 0); grid.Controls.Add(sourceBrowse, 2, 0);
            grid.Controls.Add(new Label { Text = "新版目录", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 1);
            grid.Controls.Add(targetBox, 1, 1); grid.Controls.Add(targetBrowse, 2, 1);
            grid.Controls.Add(new Label { Text = "输出补丁 EXE", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 2);
            grid.Controls.Add(outputBox, 1, 2); grid.Controls.Add(outputBrowse, 2, 2);
            Panel controls = new Panel { Dock = DockStyle.Top, Height = 44, Padding = new Padding(12, 4, 12, 4) };
            Button build = new Button { Text = "生成补丁", Width = 120, Dock = DockStyle.Left };
            Button scan = new Button { Text = "只对比差异", Width = 110, Dock = DockStyle.Left };
            CheckBox overwrite = new CheckBox { Text = "允许覆盖同名输出", Checked = false, AutoSize = true, Dock = DockStyle.Right };
            controls.Controls.Add(scan); controls.Controls.Add(build); controls.Controls.Add(overwrite);
            TextBox output = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Font = new Font("Consolas", 9F) };
            Label log = new Label { Text = "日志：" + LogPath, Dock = DockStyle.Bottom, Height = 38, Padding = new Padding(12, 4, 0, 0) };
            form.Controls.Add(output); form.Controls.Add(controls); form.Controls.Add(grid); form.Controls.Add(hint); form.Controls.Add(title); form.Controls.Add(log);
            bool busy = false;
            ViewLog = delegate(string line) { if (!form.IsDisposed) form.BeginInvoke((Action)delegate { output.AppendText(line + Environment.NewLine); }); };
            Action<TextBox, string> pickDir = delegate(TextBox box, string description)
            {
                using (FolderBrowserDialog dialog = new FolderBrowserDialog { Description = description, SelectedPath = box.Text })
                    if (dialog.ShowDialog(form) == DialogResult.OK) box.Text = dialog.SelectedPath;
            };
            sourceBrowse.Click += delegate { pickDir(sourceBox, "选择旧版发布目录（含 start.bat、backend、www、release.json）"); };
            targetBrowse.Click += delegate { pickDir(targetBox, "选择新版发布目录"); };
            outputBrowse.Click += delegate
            {
                using (SaveFileDialog dialog = new SaveFileDialog { Filter = "补丁程序 (*.exe)|*.exe", FileName = "plant3d-web-patch.exe" })
                    if (dialog.ShowDialog(form) == DialogResult.OK) outputBox.Text = dialog.FileName;
            };
            Action<bool> execute = delegate(bool scanOnly)
            {
                string sourceDir = sourceBox.Text, targetDir = targetBox.Text, outputPath = outputBox.Text;
                bool force = overwrite.Checked;
                busy = true; build.Enabled = scan.Enabled = sourceBrowse.Enabled = targetBrowse.Enabled = outputBrowse.Enabled = overwrite.Enabled = sourceBox.Enabled = targetBox.Enabled = outputBox.Enabled = false;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try
                    {
                        string result;
                        if (scanOnly) { ScanOnly(sourceDir, targetDir); result = "对比完成。"; }
                        else
                        {
                            string produced = MakerCore.Build(sourceDir, targetDir, outputPath, force, Log);
                            result = "补丁已生成：\r\n" + produced + "\r\nSHA-256：" + PatchRules.Hash(produced).ToUpperInvariant();
                        }
                        form.BeginInvoke((Action)delegate { MessageBox.Show(form, result, "Plant3D-Web 补丁生成器", MessageBoxButtons.OK, MessageBoxIcon.Information); });
                    }
                    catch (Exception error)
                    {
                        Log(error.ToString());
                        form.BeginInvoke((Action)delegate { MessageBox.Show(form, error.Message + "\r\n日志：" + LogPath, "补丁生成失败", MessageBoxButtons.OK, MessageBoxIcon.Error); });
                    }
                    finally { form.BeginInvoke((Action)delegate { busy = false; build.Enabled = scan.Enabled = sourceBrowse.Enabled = targetBrowse.Enabled = outputBrowse.Enabled = overwrite.Enabled = sourceBox.Enabled = targetBox.Enabled = outputBox.Enabled = true; }); }
                });
            };
            scan.Click += delegate { execute(true); };
            build.Click += delegate { execute(false); };
            form.FormClosing += delegate(object sender, FormClosingEventArgs closing) { if (busy) { closing.Cancel = true; MessageBox.Show(form, "正在处理，请等待完成后关闭。", "生成进行中"); } };
            Application.Run(form);
            ViewLog = null;
        }
    }
}
