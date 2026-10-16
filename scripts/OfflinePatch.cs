using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Management;
using System.Reflection;
using System.Runtime.Versioning;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Xml.Linq;

[assembly: TargetFramework(".NETFramework,Version=v4.5", FrameworkDisplayName = ".NET Framework 4.5")]

namespace Plant3dOfflinePatch
{
    sealed class PatchFile
    {
        public string Path;
        public string Hash;
        public long Size;
    }

    sealed class PatchOperation
    {
        public string Path;
        public string Kind;
        public string OldHash;
        public string NewHash;
        public long Size;
    }

    sealed class PatchPackage
    {
        const string PayloadHash = "__PAYLOAD_SHA256__";
        public byte[] Payload;
        public string Id;
        public string SourceVersion;
        public string TargetVersion;
        public string SourceReleaseHash;
        public string TargetReleaseHash;
        public List<PatchFile> SourceFiles;
        public List<PatchFile> TargetFiles;
        public List<PatchOperation> Operations;

        public PatchPackage()
        {
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            using (MemoryStream memory = new MemoryStream())
            {
                if (stream == null) throw new InvalidDataException("Patch payload is missing.");
                stream.CopyTo(memory);
                Payload = memory.ToArray();
            }
            using (MemoryStream stream = new MemoryStream(Payload))
                if (Files.Hash(stream) != PayloadHash) throw new InvalidDataException("Patch payload checksum failed.");
            using (MemoryStream stream = new MemoryStream(Payload))
            using (ZipArchive zip = new ZipArchive(stream, ZipArchiveMode.Read))
            using (Stream manifest = zip.GetEntry("patch.xml").Open())
            {
                XElement root = XDocument.Load(manifest).Root;
                if ((string)root.Attribute("format") != "plant3d-offline-patch-v1") throw new InvalidDataException("Unsupported patch format.");
                Id = (string)root.Attribute("id");
                SourceVersion = (string)root.Attribute("sourceVersion");
                TargetVersion = (string)root.Attribute("targetVersion");
                SourceReleaseHash = (string)root.Attribute("sourceReleaseHash");
                TargetReleaseHash = (string)root.Attribute("targetReleaseHash");
                SourceFiles = ReadFiles(root.Element("source"));
                TargetFiles = ReadFiles(root.Element("target"));
                Operations = root.Element("operations").Elements("file").Select(x => new PatchOperation {
                    Path = Files.Relative((string)x.Attribute("path")), Kind = (string)x.Attribute("kind"),
                    OldHash = (string)x.Attribute("oldHash"), NewHash = (string)x.Attribute("newHash"), Size = (long)x.Attribute("size")
                }).ToList();
                if (Operations.Any(x => !Files.Allowed(x.Path) || !new[] { "add", "replace", "delete" }.Contains(x.Kind)))
                    throw new InvalidDataException("Unsafe patch operation.");
                if (Operations.Select(x => x.Path).Distinct(StringComparer.OrdinalIgnoreCase).Count() != Operations.Count)
                    throw new InvalidDataException("Duplicate patch operations.");
                Operations = Operations.OrderBy(x => x.Path.Equals("release.json", StringComparison.OrdinalIgnoreCase) ? 1 : 0).ThenBy(x => x.Path, StringComparer.OrdinalIgnoreCase).ToList();
            }
        }

        static List<PatchFile> ReadFiles(XElement root)
        {
            return root.Elements("file").Select(x => new PatchFile {
                Path = Files.Relative((string)x.Attribute("path")), Hash = (string)x.Attribute("sha256"), Size = (long)x.Attribute("size")
            }).ToList();
        }
    }

    static class Files
    {
        public static string Relative(string value) { return PatchRules.Relative(value); }

        public static bool Allowed(string path) { return PatchRules.Allowed(path); }

        public static string Root(string value)
        {
            string root = Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (root.Length <= 3 || !Directory.Exists(root)) throw new DirectoryNotFoundException("Select the extracted installation directory, not a ZIP file.");
            DirectoryInfo directory = new DirectoryInfo(root);
            while (directory != null)
            {
                if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Junctions/symbolic links are not supported: " + directory.FullName);
                directory = directory.Parent;
            }
            return root;
        }

        public static string Under(string root, string relative)
        {
            string path = Path.GetFullPath(Path.Combine(root, Relative(relative).Replace('/', Path.DirectorySeparatorChar)));
            if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Path escapes installation directory.");
            string current = root;
            foreach (string part in Relative(relative).Split('/'))
            {
                current = Path.Combine(current, part);
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Refusing to follow a junction/symbolic link: " + current);
            }
            return path;
        }

        public static string Hash(Stream stream) { return PatchRules.Hash(stream); }

        public static string Hash(string path) { return PatchRules.Hash(path); }

        public static void Parent(string path) { Directory.CreateDirectory(Path.GetDirectoryName(path)); }

        public static void Replace(string source, string target, string expectedHash)
        {
            for (int attempt = 0; ; attempt++)
            {
                try { File.Replace(source, target, null); return; }
                catch (IOException error)
                {
                    int code = error.HResult & 65535;
                    if (attempt >= 6 || (code != 32 && code != 33 && code != 1175) || !File.Exists(source) || !File.Exists(target) || (expectedHash != null && Hash(target) != expectedHash))
                        throw new IOException("无法替换发布文件：" + target + "\r\n" + error.Message, error);
                    Thread.Sleep(100 * (attempt + 1));
                }
            }
        }

        public static void AtomicCopy(string source, string target)
        {
            Parent(target);
            string temporary = target + ".patch-" + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.Copy(source, temporary, false);
                if (File.Exists(target)) Replace(temporary, target, Hash(target));
                else File.Move(temporary, target);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }

    sealed class TcpOwner
    {
        public int Port;
        public int Pid;

        [DllImport("iphlpapi.dll", SetLastError = true)]
        static extern uint GetExtendedTcpTable(IntPtr table, ref int size, [MarshalAs(UnmanagedType.Bool)] bool ordered, int family, int tableClass, uint reserved);

        public static List<TcpOwner> Listeners()
        {
            List<TcpOwner> result = new List<TcpOwner>();
            foreach (int family in new[] { 2, 23 })
            {
                int size = 0;
                uint status = GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, 3, 0);
                if (family == 23 && status == 50) continue;
                if (status != 122 && status != 0) throw new System.ComponentModel.Win32Exception((int)status, "Cannot inspect TCP listeners.");
                IntPtr buffer = Marshal.AllocHGlobal(size);
                try
                {
                    status = GetExtendedTcpTable(buffer, ref size, false, family, 3, 0);
                    if (status != 0) throw new System.ComponentModel.Win32Exception((int)status, "Cannot inspect TCP listeners.");
                    int count = Marshal.ReadInt32(buffer);
                    int rowSize = family == 2 ? 24 : 56;
                    if (count < 0 || 4L + (long)count * rowSize > size) throw new IOException("Invalid TCP listener table.");
                    for (int i = 0; i < count; i++)
                    {
                        IntPtr row = IntPtr.Add(buffer, 4 + i * rowSize);
                        byte[] port = BitConverter.GetBytes(Marshal.ReadInt32(row, family == 2 ? 8 : 20));
                        result.Add(new TcpOwner { Port = port[0] * 256 + port[1], Pid = Marshal.ReadInt32(row, family == 2 ? 20 : 52) });
                    }
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
            return result;
        }
    }

    sealed class PatchRunner
    {
        readonly PatchPackage package;
        readonly Action<string> log;
        public PatchRunner(PatchPackage package, Action<string> log) { this.package = package; this.log = log; }

        public bool Check(string root)
        {
            string release = Files.Under(root, "release.json");
            if (!File.Exists(release)) throw new IOException("No release.json found. Select the 0.2.2 installation directory.");
            string hash = Files.Hash(release);
            bool updated = hash == package.TargetReleaseHash;
            if (!updated && hash != package.SourceReleaseHash) throw new IOException("This installation does not match the specified " + package.SourceVersion + " baseline. No files were changed.");
            List<PatchFile> expected = updated ? package.TargetFiles : package.SourceFiles;
            int count = 0;
            foreach (PatchFile file in expected)
            {
                if (!Files.Allowed(file.Path)) throw new InvalidDataException("Unsafe baseline path.");
                string path = Files.Under(root, file.Path);
                if (!File.Exists(path) || new FileInfo(path).Length != file.Size || Files.Hash(path) != file.Hash)
                    throw new IOException("Published file is missing or locally modified: " + file.Path + ". Configuration/data files are excluded from this check.");
                if (++count % 80 == 0) log("Verified " + count + " published files...");
            }
            foreach (PatchOperation operation in package.Operations)
            {
                string path = Files.Under(root, operation.Path);
                if (!updated && operation.Kind == "add" && (File.Exists(path) || Directory.Exists(path))) throw new IOException("New patch path already exists locally: " + operation.Path);
                if (updated && operation.Kind == "delete" && File.Exists(path)) throw new IOException("Obsolete published file still exists: " + operation.Path);
            }
            log(updated ? "Already updated; no changes or restarts are required." : "Baseline verified. Changes: " + package.Operations.Count + ". Site configuration and data will be preserved.");
            return updated;
        }

        static string Setting(string text, string key, string fallback)
        {
            Match match = Regex.Match(text, "(?m)^\\s*" + Regex.Escape(key) + "\\s*=\\s*(?:\"(?<v>[^\"\\r\\n]*)\"|'(?<v>[^'\\r\\n]*)'|(?<v>\\d+))\\s*(?:#.*)?$");
            return match.Success ? match.Groups["v"].Value : fallback;
        }

        static int Port(string value, bool optional)
        {
            int port;
            if (!Int32.TryParse(value, out port) || port < (optional ? 0 : 1) || port > 65535) throw new IOException("服务端口配置无效；未修改任何程序文件。");
            return port;
        }

        public void CheckStartup(string root)
        {
            if (root.IndexOfAny(new[] { '%', '!', '^' }) >= 0) throw new IOException("安装路径含 CMD 特殊字符，无法安全自动启动。请取消勾选启动服务；未修改任何程序文件。");
            Dictionary<string, string> environment = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            string envPath = Files.Under(root, "config/deploy.env");
            if (File.Exists(envPath))
                foreach (string line in File.ReadAllLines(envPath))
                {
                    int separator = line.IndexOf('=');
                    if (separator > 0 && !line.TrimStart().StartsWith("#")) environment[line.Substring(0, separator).Trim()] = line.Substring(separator + 1).Trim();
                }
            string mode = environment.ContainsKey("BACKEND_MODE") ? environment["BACKEND_MODE"].Replace(" ", "") : "integrated";
            List<int> ports = new List<int>();
            if (mode.Equals("integrated", StringComparison.OrdinalIgnoreCase))
            {
                string config = File.ReadAllText(Files.Under(root, "backend/DbOption.toml"));
                string address = Setting(config, "http_api_addr", "");
                if (String.IsNullOrWhiteSpace(address)) address = Setting(config, "server_release_ip", "127.0.0.1:9099");
                int backend = Port(new Uri("http://" + address.Trim()).Port.ToString(), false);
                int frontend = Port(Setting(config, "frontend_port", "80"), false);
                int compat = Port(Setting(config, "frontend_compat_port", "3100"), true);
                if (frontend == backend || (compat != 0 && (compat == frontend || compat == backend))) throw new IOException("前端、后端和兼容端口不能重复；未修改任何程序文件。");
                ports.Add(backend); ports.Add(frontend); if (compat != 0) ports.Add(compat);
            }
            else
            {
                ports.Add(Port(environment.ContainsKey("FRONTEND_PORT") ? environment["FRONTEND_PORT"].Replace(" ", "") : "80", false));
                ports.Add(3100);
            }
            List<Process> owned = Owned(root);
            HashSet<int> allowed = new HashSet<int>(owned.Select(x => x.Id));
            foreach (Process process in owned) process.Dispose();
            List<TcpOwner> conflicts = TcpOwner.Listeners().Where(x => ports.Contains(x.Port) && !allowed.Contains(x.Pid)).GroupBy(x => x.Port + ":" + x.Pid).Select(x => x.First()).OrderBy(x => x.Port).ToList();
            if (conflicts.Count > 0)
            {
                StringBuilder message = new StringBuilder("无法自动启动：端口被所选目录之外的进程占用。未修改任何程序文件，也未停止任何服务。\r\n");
                foreach (TcpOwner item in conflicts)
                {
                    string executable = "进程路径不可读取";
                    try { using (Process process = Process.GetProcessById(item.Pid)) executable = process.MainModule.FileName; }
                    catch (System.ComponentModel.Win32Exception) { }
                    catch (ArgumentException) { }
                    catch (InvalidOperationException) { }
                    message.AppendLine("端口 " + item.Port + "，PID " + item.Pid + "：" + executable);
                }
                message.Append("请取消勾选“完成后启动服务”以只升级文件，或确认选择的是实际部署目录。补丁不会停止其它目录的实例。");
                throw new IOException(message.ToString());
            }
            log("Startup ports verified: " + String.Join(", ", ports.Select(x => x.ToString())));
        }

        FileStream Lock(string root)
        {
            return new FileStream(Files.Under(root, ".plant3d-patch.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        }

        public string Apply(string root, bool start)
        {
            if (Check(root)) return "Already updated.";
            if (start) CheckStartup(root);
            using (FileStream locked = Lock(root))
            {
                if (Check(root)) return "Already updated.";
                if (start) CheckStartup(root);
                string backup = Files.Under(root, ".patch-backups/" + package.Id + "-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8));
                string stage = Files.Under(root, ".patch-work/" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(backup);
                Directory.CreateDirectory(stage);
                List<PatchOperation> completed = new List<PatchOperation>();
                bool stopped = false;
                try
                {
                    using (MemoryStream memory = new MemoryStream(package.Payload))
                    using (ZipArchive zip = new ZipArchive(memory, ZipArchiveMode.Read))
                    {
                        foreach (PatchOperation operation in package.Operations)
                        {
                            string destination = Files.Under(root, operation.Path);
                            if (operation.Kind != "add")
                            {
                                string saved = Files.Under(backup, "files/" + operation.Path);
                                Files.Parent(saved);
                                File.Copy(destination, saved, false);
                                if (Files.Hash(saved) != operation.OldHash) throw new IOException("Backup verification failed: " + operation.Path);
                            }
                            if (operation.Kind == "delete") continue;
                            string staged = Files.Under(stage, operation.Path);
                            Files.Parent(staged);
                            ZipArchiveEntry entry = zip.GetEntry("files/" + operation.Path);
                            if (entry == null || entry.Length != operation.Size) throw new InvalidDataException("Invalid payload entry: " + operation.Path);
                            using (Stream input = entry.Open())
                            using (FileStream output = new FileStream(staged, FileMode.CreateNew, FileAccess.Write, FileShare.None)) input.CopyTo(output);
                            if (Files.Hash(staged) != operation.NewHash) throw new InvalidDataException("Payload entry checksum failed: " + operation.Path);
                        }
                    }
                    Journal(backup, root, "prepared", completed);
                    log("Backup: " + backup);
                    StopOwned(root);
                    stopped = true;
                    foreach (PatchOperation operation in package.Operations)
                    {
                        string destination = Files.Under(root, operation.Path);
                        if (operation.Kind != "add" && (!File.Exists(destination) || Files.Hash(destination) != operation.OldHash)) throw new IOException("File changed during upgrade: " + operation.Path);
                        Files.Parent(destination);
                        if (operation.Kind == "delete")
                        {
                            string retired = Files.Under(backup, "removed/" + operation.Path);
                            Files.Parent(retired);
                            File.Move(destination, retired);
                        }
                        else
                        {
                            string staged = Files.Under(stage, operation.Path);
                            if (operation.Kind == "add") File.Move(staged, destination);
                            else Files.Replace(staged, destination, operation.OldHash);
                        }
                        completed.Add(operation);
                        Journal(backup, root, "applying", completed);
                        log(operation.Kind + " " + operation.Path);
                    }
                    VerifyTarget(root);
                    if (start) Start(root, Path.Combine(backup, "start.log"));
                    Journal(backup, root, "applied", completed);
                    log("Upgrade complete: " + package.SourceVersion + " -> " + package.TargetVersion);
                    return "升级成功。备份目录：\r\n" + backup + (start ? "\r\n服务启动命令已成功完成。" : "\r\n服务保持停止；可运行 start.bat 启动。");
                }
                catch (Exception failure)
                {
                    log("Upgrade failed: " + failure.Message);
                    if (stopped)
                    {
                        try
                        {
                            StopOwned(root);
                            Restore(root, backup, completed);
                            Journal(backup, root, "rolled-back", completed);
                            log("Changed files restored. Services remain stopped.");
                        }
                        catch (Exception recovery)
                        {
                            log("ROLLBACK INCOMPLETE: " + recovery.Message);
                            throw new IOException("升级失败，自动恢复未完成。请保留备份与日志。备份：" + backup, new AggregateException(failure, recovery));
                        }
                    }
                    throw new IOException((stopped ? "升级未完成；本次文件变更已恢复，服务保持停止。" : "升级准备失败；未修改程序文件。") + "\r\n原因：" + failure.Message + "\r\n备份：" + backup, failure);
                }
                finally
                {
                    try { Directory.Delete(stage, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
            }
        }

        public string Rollback(string root, string backup, bool start)
        {
            backup = Files.Root(backup);
            string backupRoot = Files.Under(root, ".patch-backups");
            if (!backup.StartsWith(backupRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Select a backup inside this installation's .patch-backups directory.");
            XElement journal = XDocument.Load(Path.Combine(backup, "journal.xml")).Root;
            if ((string)journal.Attribute("patch") != package.Id || !root.Equals((string)journal.Attribute("root"), StringComparison.OrdinalIgnoreCase)) throw new IOException("Backup belongs to a different installation or patch.");
            string state = (string)journal.Attribute("state");
            if (state != "applied" && state != "applying" && state != "rolled-back" && state != "prepared") throw new IOException("Backup does not represent a recoverable patch.");
            List<PatchOperation> operations = package.Operations.ToList();
            using (FileStream locked = Lock(root))
            {
                ValidateRestore(root, backup, operations);
                if (start) CheckStartup(root);
                StopOwned(root);
                Restore(root, backup, operations);
                Journal(backup, root, "rolled-back", operations);
                if (start) Start(root, Path.Combine(backup, "rollback-start.log"));
            }
            return "回滚完成。现场配置与数据未改动。";
        }

        void VerifyTarget(string root)
        {
            foreach (PatchOperation operation in package.Operations)
            {
                string path = Files.Under(root, operation.Path);
                if (operation.Kind == "delete")
                {
                    if (File.Exists(path)) throw new IOException("Obsolete file remains: " + operation.Path);
                }
                else if (!File.Exists(path) || Files.Hash(path) != operation.NewHash) throw new IOException("Post-upgrade verification failed: " + operation.Path);
            }
        }

        void ValidateRestore(string root, string backup, IEnumerable<PatchOperation> operations)
        {
            foreach (PatchOperation operation in operations)
            {
                string path = Files.Under(root, operation.Path);
                string current = File.Exists(path) ? Files.Hash(path) : "";
                if (operation.Kind != "add")
                {
                    string saved = Files.Under(backup, "files/" + operation.Path);
                    if (!File.Exists(saved) || Files.Hash(saved) != operation.OldHash) throw new IOException("Backup checksum failed: " + operation.Path);
                }
                if (current.Length > 0 && current != operation.OldHash && current != operation.NewHash)
                    throw new IOException("File was edited after the patch; refusing to overwrite: " + operation.Path);
            }
        }

        void Restore(string root, string backup, IEnumerable<PatchOperation> operations)
        {
            List<PatchOperation> reverse = operations.Reverse().OrderBy(x => x.Path.Equals("release.json", StringComparison.OrdinalIgnoreCase) ? 1 : 0).ToList();
            ValidateRestore(root, backup, reverse);
            foreach (PatchOperation operation in reverse)
            {
                string path = Files.Under(root, operation.Path);
                if (operation.Kind == "add")
                {
                    if (File.Exists(path)) File.Delete(path);
                }
                else if (!File.Exists(path) || Files.Hash(path) != operation.OldHash)
                    Files.AtomicCopy(Files.Under(backup, "files/" + operation.Path), path);
                log("restored " + operation.Path);
            }
        }

        void Journal(string backup, string root, string state, IEnumerable<PatchOperation> completed)
        {
            XDocument document = new XDocument(new XElement("upgrade", new XAttribute("patch", package.Id), new XAttribute("root", root), new XAttribute("state", state), new XAttribute("utc", DateTime.UtcNow.ToString("o")), completed.Select(x => new XElement("completed", new XAttribute("path", x.Path)))));
            string path = Path.Combine(backup, "journal.xml");
            string temporary = path + ".tmp";
            document.Save(temporary);
            if (File.Exists(path)) Files.Replace(temporary, path, Files.Hash(path));
            else File.Move(temporary, path);
        }

        List<Process> Owned(string root)
        {
            string nginx = Files.Under(root, "nginx/nginx.exe");
            string backend = Files.Under(root, "backend/aios-database.exe");
            List<Process> result = new List<Process>();
            using (ManagementObjectSearcher search = new ManagementObjectSearcher("SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name='nginx.exe' OR Name='aios-database.exe'"))
            using (ManagementObjectCollection found = search.Get())
                foreach (ManagementObject item in found)
                {
                    string executable = item["ExecutablePath"] as string;
                    if (!String.Equals(executable, nginx, StringComparison.OrdinalIgnoreCase) && !String.Equals(executable, backend, StringComparison.OrdinalIgnoreCase)) continue;
                    try
                    {
                        Process process = Process.GetProcessById(Convert.ToInt32(item["ProcessId"]));
                        if (String.Equals(process.MainModule.FileName, executable, StringComparison.OrdinalIgnoreCase)) result.Add(process);
                        else process.Dispose();
                    }
                    catch (ArgumentException) { }
                }
            return result;
        }

        void StopOwned(string root)
        {
            List<Process> processes = Owned(root);
            foreach (Process process in processes)
                using (process)
                {
                    try
                    {
                        if (!process.HasExited)
                        {
                            log("Stopping package-owned process " + process.Id + ": " + process.MainModule.FileName);
                            process.Kill();
                            if (!process.WaitForExit(15000)) throw new IOException("Package process did not stop.");
                        }
                    }
                    catch (InvalidOperationException) { }
                }
            List<Process> remaining = Owned(root);
            try { if (remaining.Count > 0) throw new IOException("A watchdog restarted the package. Stop its supervisor before applying the patch."); }
            finally { foreach (Process process in remaining) process.Dispose(); }
        }

        void Start(string root, string output)
        {
            ProcessStartInfo info = new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe");
            info.Arguments = "/d /c \"echo.|call \"" + Files.Under(root, "start.bat") + "\" --no-browser >\"" + output + "\" 2>&1\"";
            info.WorkingDirectory = root;
            info.UseShellExecute = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            using (Process process = Process.Start(info))
            {
                if (!process.WaitForExit(180000))
                {
                    process.Kill();
                    throw new IOException("Startup timed out. See " + output);
                }
                if (process.ExitCode != 0) throw new IOException("Startup failed. See " + output);
            }
            log("Startup completed. Log: " + output);
        }
    }

    static class Program
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
            LogPath = Path.Combine(Path.GetTempPath(), "plant3d-patch-" + Process.GetCurrentProcess().Id + "-" + Guid.NewGuid().ToString("N") + ".log");
            try
            {
                PatchPackage package = new PatchPackage();
                if (args.Length == 0)
                {
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    ShowWindow(package);
                    return 0;
                }
                string target = null;
                string backup = null;
                bool yes = false;
                bool check = false;
                bool start = false;
                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i] == "--target" && i + 1 < args.Length) target = args[++i];
                    else if (args[i] == "--rollback" && i + 1 < args.Length) backup = args[++i];
                    else if (args[i] == "--yes") yes = true;
                    else if (args[i] == "--check") check = true;
                    else if (args[i] == "--start") start = true;
                    else if (args[i] == "--no-start") start = false;
                    else throw new ArgumentException("Usage: patch.exe --target INSTALL_DIR (--check | --yes) [--start] [--rollback BACKUP_DIR]");
                }
                if (target == null || check == yes) throw new ArgumentException("Specify --target and exactly one of --check or --yes.");
                string root = Files.Root(target);
                PatchRunner runner = new PatchRunner(package, Log);
                if (check)
                {
                    if (backup != null) throw new ArgumentException("Rollback requires --yes.");
                    bool updated = runner.Check(root);
                    if (start && !updated) runner.CheckStartup(root);
                }
                else
                {
                    Log("Confirmed: package processes may be stopped; mem-mode state is not durable.");
                    Log(backup == null ? runner.Apply(root, start) : runner.Rollback(root, backup, start));
                }
                return 0;
            }
            catch (Exception error)
            {
                Log(error.ToString());
                if (args.Length == 0) MessageBox.Show(error.Message + "\r\n日志：" + LogPath, "Plant3D-Web 补丁失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        static void ShowWindow(PatchPackage package)
        {
            Form form = new Form { Text = "Plant3D-Web 离线升级补丁", Width = 800, Height = 580, MinimumSize = new Size(720, 500), StartPosition = FormStartPosition.CenterScreen, Font = new Font("Microsoft YaHei UI", 9F) };
            Label title = new Label { Text = "升级 " + package.SourceVersion + " → " + package.TargetVersion + "（Server 2012 R2 脚本修复版）", Dock = DockStyle.Top, Height = 38, Padding = new Padding(12, 10, 0, 0) };
            Label hint = new Label { Text = "选择旧包解压后的安装目录。保留项目配置和数据；升级前备份并停止该目录内的服务。", Dock = DockStyle.Top, Height = 34, Padding = new Padding(12, 4, 0, 0) };
            Panel pathPanel = new Panel { Dock = DockStyle.Top, Height = 42, Padding = new Padding(12, 5, 12, 5) };
            Button browse = new Button { Text = "选择目录…", Dock = DockStyle.Right, Width = 110 };
            TextBox path = new TextBox { Dock = DockStyle.Fill, Text = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\') };
            pathPanel.Controls.Add(path); pathPanel.Controls.Add(browse);
            Panel controls = new Panel { Dock = DockStyle.Top, Height = 44, Padding = new Padding(12, 4, 12, 4) };
            Button apply = new Button { Text = "检查并升级", Width = 120, Dock = DockStyle.Left };
            Button inspect = new Button { Text = "只检查", Width = 95, Dock = DockStyle.Left };
            Button rollback = new Button { Text = "恢复备份…", Width = 110, Dock = DockStyle.Left };
            CheckBox restart = new CheckBox { Text = "完成后启动服务", Checked = false, AutoSize = true, Dock = DockStyle.Right };
            controls.Controls.Add(rollback); controls.Controls.Add(inspect); controls.Controls.Add(apply); controls.Controls.Add(restart);
            TextBox output = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Font = new Font("Consolas", 9F) };
            Label log = new Label { Text = "日志：" + LogPath, Dock = DockStyle.Bottom, Height = 38, Padding = new Padding(12, 4, 0, 0) };
            form.Controls.Add(output); form.Controls.Add(controls); form.Controls.Add(pathPanel); form.Controls.Add(hint); form.Controls.Add(title); form.Controls.Add(log);
            bool busy = false;
            ViewLog = delegate(string line) { if (!form.IsDisposed) form.BeginInvoke((Action)delegate { output.AppendText(line + Environment.NewLine); }); };
            browse.Click += delegate { using (FolderBrowserDialog dialog = new FolderBrowserDialog { Description = "选择 0.2.2 安装目录（其中应有 start.bat、backend、www 和 release.json）", SelectedPath = path.Text }) if (dialog.ShowDialog(form) == DialogResult.OK) path.Text = dialog.SelectedPath; };
            Action<bool, string> execute = delegate(bool dry, string backup)
            {
                string target = path.Text;
                bool start = restart.Checked;
                busy = true; apply.Enabled = inspect.Enabled = rollback.Enabled = browse.Enabled = restart.Enabled = path.Enabled = false;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try
                    {
                        string root = Files.Root(target);
                        PatchRunner runner = new PatchRunner(package, Log);
                        string result;
                        if (backup == null && runner.Check(root)) result = "已经升级，无需重复操作。";
                        else if (dry)
                        {
                            if (start) runner.CheckStartup(root);
                            result = "检查通过，未修改文件或停止服务。";
                        }
                        else
                        {
                            if (start) runner.CheckStartup(root);
                            DialogResult consent = (DialogResult)form.Invoke((Func<DialogResult>)delegate {
                                return MessageBox.Show(form, "目标：" + root + "\r\n\r\n将停止此目录内的 nginx 与后端。mem 模式的内存数据会丢失，现场配置和数据库文件不改动。\r\n请关闭其它自动重启/守护程序。\r\n完成后启动服务：" + (start ? "是" : "否") + "\r\n\r\n是否继续？", backup == null ? "确认升级" : "确认恢复备份", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
                            });
                            result = consent != DialogResult.Yes ? "已取消，未修改文件。" : backup == null ? runner.Apply(root, start) : runner.Rollback(root, backup, start);
                        }
                        form.BeginInvoke((Action)delegate { MessageBox.Show(form, result, "Plant3D-Web 补丁", MessageBoxButtons.OK, MessageBoxIcon.Information); });
                    }
                    catch (Exception error)
                    {
                        Log(error.ToString());
                        form.BeginInvoke((Action)delegate { MessageBox.Show(form, error.Message + "\r\n日志：" + LogPath, "补丁未完成", MessageBoxButtons.OK, MessageBoxIcon.Error); });
                    }
                    finally { form.BeginInvoke((Action)delegate { busy = false; apply.Enabled = inspect.Enabled = rollback.Enabled = browse.Enabled = restart.Enabled = path.Enabled = true; }); }
                });
            };
            inspect.Click += delegate { execute(true, null); };
            apply.Click += delegate { execute(false, null); };
            rollback.Click += delegate { using (FolderBrowserDialog dialog = new FolderBrowserDialog { Description = "选择此安装目录 .patch-backups 内的一次备份目录" }) if (dialog.ShowDialog(form) == DialogResult.OK) execute(false, dialog.SelectedPath); };
            form.FormClosing += delegate(object sender, FormClosingEventArgs args) { if (busy) { args.Cancel = true; MessageBox.Show(form, "正在处理，请等待完成后关闭。", "升级进行中"); } };
            Application.Run(form);
            ViewLog = null;
        }
    }
}
