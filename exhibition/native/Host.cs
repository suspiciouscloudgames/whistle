using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Whistle.Exhibition {
    sealed class Host : ApplicationContext {
        const int Port = 47361;
        const int OperatorKey = 0x5753;
        readonly string appDir = AppDomain.CurrentDomain.BaseDirectory;
        readonly string mapping = Path.Combine(Store.Data, "mice.json");
        readonly Seat[] seats;
        Process relay;
        RawMice mice;
        string[] devices = new string[2];
        bool active, operating, closing;
        public int Result = 1;
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);
        [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hwnd, int id);

        [STAThread] static int Main() {
            try {
                SetProcessDpiAwarenessContext((IntPtr)(-4));
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                var screens = Screen.AllScreens.OrderBy(s => s.Bounds.Left).ThenBy(s => s.Bounds.Top).ToArray();
                if (screens.Length != 2) throw new InvalidOperationException("윈도우 디스플레이 설정에서 모니터 두 대를 ‘확장’으로 연결한 뒤 실행하세요.");
                using (var host = new Host(screens)) {
                    Application.Run(host);
                    return host.Result;
                }
            } catch (Exception e) { MessageBox.Show(e.Message,"휘슬 전시"); return 1; }
        }
        Host(Screen[] screens) {
            seats = screens.Select((screen,i) => new Seat(screen,"seat-" + (i+1), "http://127.0.0.1:" + Port + "/?meeting=exhibition")).ToArray();
            foreach (var seat in seats) {
                seat.OpenControls = () => seat.BeginInvoke((Action)Menu);
                seat.FormClosing += (s,e) => { if (!closing) { e.Cancel = true; seat.BeginInvoke((Action)Menu); } };
            }
            seats[0].Shown += async (s,e) => {
                try { await Start(); } catch (Exception error) {
                    if (!closing) { MessageBox.Show(error.Message,"휘슬 전시"); Finish(1); }
                }
            };
            seats[0].WindowMessage = WindowMessage;
            seats[1].Show();
            seats[0].Show();
        }
        async Task Start() {
            Directory.CreateDirectory(Store.Data);
            await StartRelay();
            Microsoft.Web.WebView2.Core.CoreWebView2Environment.SetLoaderDllFolderPath(appDir);
            await Task.WhenAll(seats.Select(seat => seat.StartAsync(Store.Data,appDir)));
            mice = new RawMice(seats[0].Handle);
            RegisterHotKey(seats[0].Handle,OperatorKey,0x4003,0x55); // Ctrl+Alt+U
            if (File.Exists(mapping)) {
                try {
                    var saved = Store.Json.Deserialize<string[]>(File.ReadAllText(mapping));
                    if (saved != null && saved.Length == 2 && saved[0] != saved[1]) {
                        var connected = mice.Connected();
                        devices = saved.Select(s => connected.Contains(s) ? s : null).ToArray();
                    }
                } catch (ArgumentException) {}
            }
            active = true;
            ShowPrompts();
            string ready = Environment.GetEnvironmentVariable("WHISTLE_READY");
            if (!String.IsNullOrEmpty(ready)) using (var signal = EventWaitHandle.OpenExisting(ready)) signal.Set();
        }
        async Task StartRelay() {
            var info = new ProcessStartInfo(Path.Combine(appDir,"node.exe"), "scripts/run.mjs") {
                WorkingDirectory = appDir, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            info.EnvironmentVariables["HOST"] = "127.0.0.1";
            info.EnvironmentVariables["PORT"] = Port.ToString();
            info.EnvironmentVariables.Remove("NODE_OPTIONS");
            relay = new Process { StartInfo = info, EnableRaisingEvents = true };
            var ready = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            relay.OutputDataReceived += (s,e) => { if (e.Data == "Whistle: http://localhost:" + Port + "/") ready.TrySetResult(true); };
            relay.Exited += (s,e) => {
                ready.TrySetException(new IOException("전시 서버를 시작할 수 없습니다. 실행 중인 전시 앱이나 포트 " + Port + "를 확인하세요."));
                if (active && !closing && !seats[0].IsDisposed) seats[0].BeginInvoke((Action)(() => {
                    if (!closing) { MessageBox.Show("전시 연결 서버가 종료되었습니다. 앱을 다시 실행하세요.","휘슬 전시"); Finish(1); }
                }));
            };
            relay.Start();
            relay.BeginOutputReadLine();
            relay.BeginErrorReadLine();
            if (await Task.WhenAny(ready.Task,Task.Delay(15000)) != ready.Task) throw new TimeoutException("전시 서버를 시작하지 못했습니다.");
            await ready.Task;
        }
        void WindowMessage(Message msg) {
            if (!active || closing || mice == null) return;
            if (msg.Msg == 0x0312 && msg.WParam.ToInt32() == OperatorKey) { seats[0].BeginInvoke((Action)Menu); return; }
            if (msg.Msg == 0xfe && msg.WParam.ToInt32() == 2) {
                int index = Array.IndexOf(devices,mice.Remove(msg.LParam));
                if (index >= 0 && devices[index] != null) {
                    foreach (var seat in seats) seat.ReleaseButtons();
                    devices[index] = null;
                    ShowPrompts();
                }
            }
            if (msg.Msg == 0xff && !operating) mice.Read(msg.LParam, Route);
        }
        void Route(string device, MousePacket packet) {
            int next = Array.IndexOf(devices,null);
            int index = Array.IndexOf(devices,device);
            if (next >= 0) {
                if ((packet.Buttons & 1) != 0 && index < 0) {
                    devices[next] = device;
                    if (devices.All(d => d != null)) Store.Write(mapping,Store.Json.Serialize(devices));
                    ShowPrompts();
                }
                return;
            }
            if (index >= 0) seats[index].MouseInput(packet);
        }
        void ShowPrompts() {
            int next = Array.IndexOf(devices,null);
            for (int i=0;i<seats.Length;i++) seats[i].Prompt(next < 0 ? "" :
                (next == i ? (i+1) + "번 자리에서 사용할 마우스를 클릭하세요." : (next+1) + "번 자리의 마우스 배정을 기다리는 중입니다.") +
                "\nCtrl + Alt + U · 운영자 메뉴");
        }
        void Menu() {
            if (operating || !active || closing) return;
            operating = true;
            foreach (var seat in seats) { seat.ReleaseButtons(); seat.InExhibition = false; }
            try {
                using (var menu = new Operator(Store.ReadVersion(appDir))) {
                    menu.ShowDialog(seats[0]);
                    if (menu.Candidate != null) {
                        Store.Write(Environment.GetEnvironmentVariable("WHISTLE_REQUEST"), menu.Candidate);
                        Finish(42); return;
                    }
                    if (menu.Quit) { Finish(0); return; }
                    if (menu.Reassign) { devices = new string[2]; if (File.Exists(mapping)) File.Delete(mapping); }
                }
            } catch (Exception e) { MessageBox.Show(e.Message,"휘슬 전시"); }
            finally { operating = false; }
            foreach (var seat in seats) seat.InExhibition = true;
            ShowPrompts();
        }
        void Finish(int result) {
            if (closing) return;
            closing = true;
            active = false;
            Result = result;
            UnregisterHotKey(seats[0].Handle,OperatorKey);
            foreach (var seat in seats) { seat.Close(); seat.Dispose(); }
            if (relay != null) {
                try {
                    if (!relay.HasExited) {
                        relay.StandardInput.Close();
                        if (!relay.WaitForExit(3000)) { relay.Kill(); relay.WaitForExit(); }
                    }
                } catch (InvalidOperationException) {}
                relay.Dispose();
            }
            ExitThread();
        }
    }
}
