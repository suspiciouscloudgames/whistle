using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace Whistle.Exhibition {
    static class OnlineRelease {
        public const string Address = "https://github.com/suspiciouscloudgames/whistle/releases/download/exhibition-windows/";
        sealed class Info {
            public string product { get; set; }
            public string version { get; set; }
            public string sha256 { get; set; }
        }
        public static async Task<string> Fetch(HttpClient client, Version current, Action<string> report) {
            report("새 전시 버전 확인 중…");
            Info info;
            using (var response = await client.GetAsync("exhibition.json")) {
                if (response.StatusCode == HttpStatusCode.NotFound) { report("게시된 전시 업데이트가 없습니다."); return null; }
                response.EnsureSuccessStatusCode();
                info = Store.Json.Deserialize<Info>(await response.Content.ReadAsStringAsync());
            }
            Version next;
            if (info == null || info.product != "whistle-exhibition-x64" || !Version.TryParse(info.version,out next) ||
                info.sha256 == null || info.sha256.Length != 64) throw new InvalidDataException("전시 업데이트 정보를 읽을 수 없습니다.");
            if (next <= current) { report("현재 최신 버전입니다.  " + current); return null; }
            report(current + " → " + next + "\n새 버전을 내려받고 있습니다…");
            string zip = Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N") + ".zip");
            try {
                using (var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(3)))
                using (var download = await client.GetAsync("Whistle-Exhibition-win-x64.zip",HttpCompletionOption.ResponseHeadersRead,deadline.Token)) {
                    download.EnsureSuccessStatusCode();
                    using (var input = await download.Content.ReadAsStreamAsync())
                    using (var output = new FileStream(zip,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None)) {
                        byte[] buffer = new byte[81920];
                        int n;
                        while ((n = await input.ReadAsync(buffer,0,buffer.Length,deadline.Token)) > 0) {
                            if (output.Length + n > 300L * 1024 * 1024) throw new InvalidDataException("업데이트가 너무 큽니다.");
                            await output.WriteAsync(buffer,0,n);
                        }
                        output.Position = 0;
                        if (await Task.Run(() => Store.Hash(output)) != info.sha256) throw new InvalidDataException("다운로드 검증에 실패했습니다.");
                    }
                }
                report("패키지 확인 중…");
                return await Task.Run(() => Packages.Stage(zip,current,next));
            } finally { if (File.Exists(zip)) File.Delete(zip); }
        }
    }
}
