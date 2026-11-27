using System;
using System.IO;
using System.IO.Compression;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

namespace Whistle.Exhibition {
    static class Store {
        public static readonly string Data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WhistleExhibition");
        public static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        public static void Write(string path, string text) {
            var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temp, text);
            try {
                if (File.Exists(path)) File.Replace(temp, path, null);
                else File.Move(temp, path);
            } finally { if (File.Exists(temp)) File.Delete(temp); }
        }
        public static Version ReadVersion(string dir) { return Version.Parse(File.ReadAllText(Path.Combine(dir,"version.txt")).Trim()); }
        public static string Hash(Stream stream) {
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }
        public static string Under(string root, string name) {
            if (String.IsNullOrEmpty(name) || name.Contains("\\") || name.Contains(":") || Path.IsPathRooted(name))
                throw new InvalidDataException("업데이트 경로가 올바르지 않습니다.");
            foreach (var part in name.Split('/')) {
                if (part.Length == 0 || part == "." || part == ".." || part.TrimEnd(' ', '.') != part ||
                    part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) throw new InvalidDataException("잘못된 파일 이름");
            }
            var path = Path.GetFullPath(Path.Combine(root, name));
            if (!path.StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("업데이트 경로가 올바르지 않습니다.");
            return path;
        }
    }

    sealed class ReleaseFiles {
        public string product { get; set; }
        public string version { get; set; }
        public Dictionary<string,string> files { get; set; }
    }
    static class Packages {
        // The launcher stays outside the versioned app, so the running files are never overwritten.
        public static string Stage(string zipPath, Version current, Version expected = null) {
            string id = Guid.NewGuid().ToString("N");
            string dir = Path.Combine(Store.Data, "versions", id);
            Directory.CreateDirectory(dir);
            try {
                using (var zip = ZipFile.OpenRead(zipPath)) {
                    var entry = zip.GetEntry("release.json");
                    if (entry == null || entry.Length > 512000) throw new InvalidDataException("휘슬 전시 업데이트 ZIP을 선택하세요.");
                    ReleaseFiles manifest;
                    using (var reader = new StreamReader(entry.Open())) manifest = Store.Json.Deserialize<ReleaseFiles>(reader.ReadToEnd());
                    Version next;
                    if (manifest == null || manifest.product != "whistle-exhibition-x64" || !Version.TryParse(manifest.version,out next) ||
                        manifest.files == null || manifest.files.Count > 3000) throw new InvalidDataException("전시 앱 패키지가 올바르지 않습니다.");
                    if (expected != null && next != expected) throw new InvalidDataException("공개된 버전과 패키지 버전이 다릅니다.");
                    if (next <= current) throw new InvalidDataException("현재 버전과 같거나 이전 버전입니다.");
                    long total = 0;
                    foreach (var file in manifest.files) {
                        string dest = Store.Under(dir, file.Key);
                        var item = zip.GetEntry("app/" + file.Key);
                        if (item == null || (total += item.Length) > 512L * 1024 * 1024) throw new InvalidDataException("업데이트 파일이 없거나 너무 큽니다.");
                        Directory.CreateDirectory(Path.GetDirectoryName(dest));
                        using (var src = item.Open())
                        using (var output = new FileStream(dest, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None)) {
                            src.CopyTo(output);
                            output.Position = 0;
                            if (Store.Hash(output) != file.Value) throw new InvalidDataException("파일 검증 실패: " + file.Key);
                        }
                    }
                    foreach (var required in new[]{"ExhibitionHost.exe","version.txt","node.exe","scripts/serve.mjs","dist/index.html","seat.js","WebView2Loader.dll","Microsoft.Web.WebView2.Core.dll"})
                        if (!File.Exists(Path.Combine(dir,required))) throw new InvalidDataException("필수 파일 누락: " + required);
                    if (Store.ReadVersion(dir) != next) throw new InvalidDataException("버전 검증에 실패했습니다.");
                }
                return id;
            } catch { Directory.Delete(dir,true); throw; }
        }
    }
}
