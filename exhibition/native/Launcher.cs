using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace Whistle.Exhibition {
    static class Launcher {
        [STAThread]
        static void Main() {
            bool owns;
            using (var mutex = new Mutex(true, @"Local\WhistleExhibitionLauncher", out owns)) {
                if (!owns) return;
                try { Run(); } catch (Exception e) { MessageBox.Show(e.Message, "휘슬 전시"); }
            }
        }
        static string DirectoryFor(string id) {
            if (id == "") return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app");
            Guid parsed;
            if (!Guid.TryParseExact(id, "N", out parsed)) throw new InvalidDataException("설치 버전 경로를 읽을 수 없습니다.");
            return Path.Combine(Store.Data, "versions", parsed.ToString("N"));
        }
        static void Run() {
            Directory.CreateDirectory(Store.Data);
            var currentFile = Path.Combine(Store.Data, "current");
            string current = File.Exists(currentFile) ? File.ReadAllText(currentFile).Trim() : "";
            string candidate = current;
            while (true) {
                string ticket = Path.Combine(Store.Data, Guid.NewGuid().ToString("N") + ".request");
                string readyName = @"Local\WhistleExhibition-" + Guid.NewGuid().ToString("N");
                try {
                    using (var ready = new EventWaitHandle(false, EventResetMode.ManualReset, readyName)) {
                        var dir = DirectoryFor(candidate);
                        var info = new ProcessStartInfo(Path.Combine(dir, "ExhibitionHost.exe")) {
                            UseShellExecute = false, WorkingDirectory = dir
                        };
                        info.EnvironmentVariables["WHISTLE_READY"] = readyName;
                        info.EnvironmentVariables["WHISTLE_REQUEST"] = ticket;
                        using (var host = Process.Start(info)) {
                            var startup = Stopwatch.StartNew();
                            while (!ready.WaitOne(200) && !host.HasExited) {
                                if (candidate != current && startup.Elapsed > TimeSpan.FromSeconds(90)) {
                                    host.Kill();
                                    host.WaitForExit();
                                    break;
                                }
                            }
                            if (!ready.WaitOne(0) && candidate != current)
                                throw new IOException("새 버전을 시작하지 못해 이전 버전으로 돌아갑니다.");
                            if (ready.WaitOne(0) && candidate != current) {
                                Store.Write(currentFile, candidate);
                                current = candidate;
                            }
                            host.WaitForExit();
                            if (host.ExitCode != 42 || !File.Exists(ticket)) return;
                        }
                    }
                    candidate = File.ReadAllText(ticket).Trim();
                } catch (Exception e) {
                    if (candidate == current) throw;
                    MessageBox.Show(e.Message, "휘슬 업데이트");
                    candidate = current;
                } finally { if (File.Exists(ticket)) File.Delete(ticket); }
            }
        }
    }
}
