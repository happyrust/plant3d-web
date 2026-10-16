using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Plant3dOfflinePatch
{
    // 补丁打包器（build-offline-patch.ps1 / OfflinePatchMaker.exe）与补丁运行器
    // （OfflinePatch.cs 编译出的升级 EXE）共用的路径规则：
    //   Relative  — 归一化并拒绝不安全的相对路径
    //   Protected — 现场配置/数据/运行时状态，永不进入补丁、也不被基线校验
    //   Allowed   — 允许随补丁发布的路径白名单；Protected 优先于 Allowed
    // 规则只在此文件维护一份，两边编译时都直接编译本文件，避免清单漂移。
    public static class PatchRules
    {
        public static string Relative(string value)
        {
            if (String.IsNullOrEmpty(value)) throw new InvalidDataException("Empty path.");
            value = value.Replace('\\', '/');
            foreach (string part in value.Split('/'))
            {
                if (part.Length == 0 || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ") || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                    throw new InvalidDataException("Unsafe path: " + value);
                if (Regex.IsMatch(part, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$", RegexOptions.IgnoreCase))
                    throw new InvalidDataException("Reserved Windows path: " + value);
            }
            return value;
        }

        // 现场内容：项目配置、初始化状态、数据库、工作区、日志、补丁自身的备份/锁。
        // 这些路径在任何一侧目录里出现差异都不算发布差异，也不会被基线校验。
        public static bool Protected(string path)
        {
            string p = Relative(path).ToLowerInvariant();
            return p == "backend/dboption.toml" || p == "backend/.first-run-pending" ||
                p == "backend/web/config.json" || p == "www/config.json" ||
                p == "backend/process.json" || p == "backend/surreal-process.json" ||
                p == ".plant3d-patch.lock" ||
                p.StartsWith("config/") || p.StartsWith("backend/config/") ||
                p.StartsWith("backend/workspace/") || p.StartsWith("backend/assets/") ||
                p.StartsWith("backend/logs/") || p.StartsWith("backend/.surreal/") ||
                p.StartsWith("nginx/logs/") || p.StartsWith("nginx/temp/") ||
                p == "nginx/conf/nginx.conf" ||
                p.StartsWith(".patch-backups/") || p.StartsWith(".patch-work/") ||
                p.EndsWith(".bak");
        }

        // 允许被补丁改动的发布文件。其它路径出现差异直接拒绝打包，
        // 防止把未评审的新发布面悄悄塞进补丁。
        public static bool Allowed(string path)
        {
            string p = Relative(path).ToLowerInvariant();
            if (Protected(p)) return false;
            if (p == "backend/web/config.json" || p == "www/config.json") return false;
            if (p.StartsWith("www/") || p.StartsWith("backend/web/") || p.StartsWith("backend/schema/") || p.StartsWith("backend/resource/") || p.StartsWith("backend/bin/")) return true;
            return new[] { "readme.md", "release.json", "start.bat", "stop.bat", "config.bat", "nginx.conf.template", "sync-offlineconfig.ps1", "test-offlinehttp.ps1", "start-bundledstore.ps1", "nginx/nginx.exe", "nginx/conf/mime.types", "backend/aios-database.exe", "backend/release.json", "backend/readme.md", "backend/changelog.md", "backend/start-ams.ps1", "backend/start-ams.cmd", "backend/start-surreal.ps1", "backend/rollback.ps1", "backend/start-pc.ps1", "backend/start-pc.cmd" }.Contains(p);
        }

        // 目录级保护前缀：枚举文件夹时整目录跳过，避免逐个哈希备份/日志/库数据。
        public static bool ProtectedDirectory(string dir)
        {
            string p = Relative(dir).ToLowerInvariant().TrimEnd('/') + "/";
            return p == "config/" || p == "backend/config/" || p == "backend/workspace/" ||
                p == "backend/assets/" || p == "backend/logs/" || p == "backend/.surreal/" ||
                p == "nginx/logs/" || p == "nginx/temp/" ||
                p.StartsWith(".patch-backups/") || p.StartsWith(".patch-work/");
        }

        public static string Hash(Stream stream)
        {
            using (SHA256 sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }

        public static string Hash(string path)
        {
            using (FileStream stream = File.OpenRead(path)) return Hash(stream);
        }
    }
}
