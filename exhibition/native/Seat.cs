using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Kind = Microsoft.Web.WebView2.Core.CoreWebView2MouseEventKind;
using Buttons = Microsoft.Web.WebView2.Core.CoreWebView2MouseEventVirtualKeys;

namespace Whistle.Exhibition {
    sealed class Seat : Form {
        readonly string profile;
        readonly string url;
        Composition composition;
        CoreWebView2CompositionController view;
        Point cursor;
        Buttons buttons;
        public Action<Message> WindowMessage;
        public bool InExhibition = true;
        public Action OpenControls;

        public Seat(Screen screen, string profile, string url) {
            this.profile = profile;
            this.url = url;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.None;
            TopMost = true;
            Bounds = screen.Bounds;
            BackColor = Color.Black;
            Text = "휘슬 전시";
            cursor = new Point(Width / 2, Height / 2);
        }
        [DllImport("user32.dll")] static extern IntPtr SetCursor(IntPtr cursor);
        protected override void WndProc(ref Message message) {
            if (InExhibition && message.Msg == 0x20) {
                SetCursor(IntPtr.Zero);
                message.Result = (IntPtr)1;
                return;
            }
            if (InExhibition && message.Msg == 0x21) {
                message.Result = (IntPtr)3; // MA_NOACTIVATE, preserve keyboard focus on the host.
                return;
            }
            if (WindowMessage != null) WindowMessage(message);
            base.WndProc(ref message);
        }
        public async Task StartAsync(string data, string appDir) {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(data, profile),
                new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding"));
            composition = new Composition(Handle);
            view = await env.CreateCoreWebView2CompositionControllerAsync(Handle);
            view.BoundsMode = CoreWebView2BoundsMode.UseRawPixels;
            view.Bounds = ClientRectangle;
            view.RootVisualTarget = composition.Root;
            composition.Commit();
            view.IsVisible = true;
            var web = view.CoreWebView2;
            web.Settings.AreDevToolsEnabled = false;
            web.Settings.AreDefaultContextMenusEnabled = false;
            web.Settings.IsZoomControlEnabled = false;
            web.Settings.AreBrowserAcceleratorKeysEnabled = false;
            web.NewWindowRequested += (s,e) => { e.Handled = true; };
            var origin = new Uri(url).GetLeftPart(UriPartial.Authority);
            web.NavigationStarting += (s,e) => {
                Uri target;
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out target) || target.GetLeftPart(UriPartial.Authority) != origin)
                    e.Cancel = true;
            };
            var files = new SeatFiles(web);
            await files.Start();
            web.WebMessageReceived += async (s,e) => {
                if (e.Source != url) return;
                string message = e.TryGetWebMessageAsString();
                if (message == "operator" && OpenControls != null) OpenControls();
                else if (message.StartsWith("file|",StringComparison.Ordinal)) {
                    try { await files.Choose(message); }
                    catch (Exception err) { web.PostWebMessageAsJson(Store.Json.Serialize(new { type = "files-error", error = err.Message })); }
                }
            };
            web.DownloadStarting += (s,e) => {
                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"Downloads","Whistle",profile);
                Directory.CreateDirectory(dir);
                string name = Path.GetFileName(e.ResultFilePath);
                if (String.IsNullOrEmpty(name)) name = "Whistle";
                e.ResultFilePath = Path.Combine(dir, DateTime.Now.ToString("yyyyMMdd-HHmmss-fff") + "-" + name);
                e.Handled = true;
            };
            await web.AddScriptToExecuteOnDocumentCreatedAsync(File.ReadAllText(Path.Combine(appDir, "seat.js")));
            await web.CallDevToolsProtocolMethodAsync("Emulation.setFocusEmulationEnabled", "{\"enabled\":true}");
            var loaded = new TaskCompletionSource<bool>();
            web.NavigationCompleted += (s,e) => {
                if (e.IsSuccess) loaded.TrySetResult(true);
                else loaded.TrySetException(new IOException("휘슬 화면을 열 수 없습니다: " + e.WebErrorStatus));
            };
            web.Navigate(url);
            if (await Task.WhenAny(loaded.Task, Task.Delay(30000)) != loaded.Task)
                throw new TimeoutException("휘슬 화면을 여는 시간이 초과되었습니다.");
            await loaded.Task;
            // NavigationCompleted precedes React mounting and the multiplayer handshake.
            for (int i = 0; i < 120; ++i) {
                if (await web.ExecuteScriptAsync("!!document.querySelector('main[data-meeting-status=online]')") == "true") return;
                await Task.Delay(250);
            }
            throw new IOException("휘슬이 전시 방에 연결되지 않았습니다.");
        }
        public void Prompt(string message) {
            if (view != null) view.CoreWebView2.PostWebMessageAsString(message);
        }
        protected override void OnResize(EventArgs e) {
            base.OnResize(e);
            if (view != null && Width > 0 && Height > 0) view.Bounds = ClientRectangle;
        }
        static int Clamp(long value, int size) { return (int)Math.Max(0L, Math.Min(size - 1L, value)); }
        public void MouseInput(MousePacket packet) {
            if (view == null) return;
            bool absolute = (packet.Flags & 1) != 0;
            long x = absolute ? (long)packet.X * (ClientSize.Width - 1) / 65535 : (long)cursor.X + packet.X;
            long y = absolute ? (long)packet.Y * (ClientSize.Height - 1) / 65535 : (long)cursor.Y + packet.Y;
            var next = new Point(Clamp(x, ClientSize.Width), Clamp(y, ClientSize.Height));
            if (next != cursor || buttons == Buttons.None && packet.Buttons != 0) {
                cursor = next;
                Send(Kind.Move);
            }
            Button(packet.Buttons, 1, 2, Buttons.LeftButton, Kind.LeftButtonDown, Kind.LeftButtonUp);
            Button(packet.Buttons, 4, 8, Buttons.RightButton, Kind.RightButtonDown, Kind.RightButtonUp);
            Button(packet.Buttons, 16, 32, Buttons.MiddleButton, Kind.MiddleButtonDown, Kind.MiddleButtonUp);
            if ((packet.Buttons & 0x400) != 0) Send(Kind.Wheel, unchecked((uint)packet.Wheel));
            if ((packet.Buttons & 0x800) != 0) Send(Kind.HorizontalWheel, unchecked((uint)packet.Wheel));
        }
        void Send(Kind kind, uint data = 0) { view.SendMouseInput(kind, buttons, data, cursor); }
        void Button(ushort flags, int down, int up, Buttons key, Kind press, Kind release) {
            if ((flags & down) != 0 && (buttons & key) == 0) { buttons |= key; Send(press); }
            if ((flags & up) != 0 && (buttons & key) != 0) { buttons &= ~key; Send(release); }
        }
        public void ReleaseButtons() {
            if (view != null) MouseInput(new MousePacket { Buttons = 2 | 8 | 32 });
        }
        protected override void Dispose(bool disposing) {
            if (disposing && view != null) { view.RootVisualTarget = null; view.Close(); view = null; }
            if (disposing && composition != null) { composition.Dispose(); composition = null; }
            base.Dispose(disposing);
        }
    }
}
