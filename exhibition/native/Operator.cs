using System;
using System.Drawing;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Whistle.Exhibition {
    sealed class Operator : Form {
        readonly Version current;
        readonly Label status = new Label();
        readonly FlowLayoutPanel panel = new FlowLayoutPanel();
        bool busy;
        public string Candidate;
        public bool Reassign, Quit;
        public Operator(Version version) {
            current = version;
            Text = "휘슬 전시 · 운영자";
            Font = new Font("Malgun Gothic", 11);
            ClientSize = new Size(455, 290);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            TopMost = true;
            MinimizeBox = MaximizeBox = false;
            panel.Dock = DockStyle.Fill;
            panel.Padding = new Padding(18);
            Controls.Add(panel);
            status.Size = new Size(410,72);
            status.Text = "휘슬 전시 " + current + "\n업데이트 방법을 선택하세요.";
            panel.Controls.Add(status);
            Add("지금 업데이트", async () => await Update(true));
            Add("업데이트 ZIP 선택", async () => await Update(false));
            Add("마우스 다시 배정", () => { Reassign = true; Close(); return Task.CompletedTask; });
            Add("전시로 돌아가기", () => { Close(); return Task.CompletedTask; });
            Add("전시 종료", () => { Quit = true; Close(); return Task.CompletedTask; });
            FormClosing += (s,e) => { if (busy) e.Cancel = true; };
        }
        void Add(string text, Func<Task> action) {
            var button = new Button { Text = text, Width = 194, Height = 42 };
            button.Click += async (s,e) => await action();
            panel.Controls.Add(button);
        }
        async Task Update(bool online) {
            if (busy) return;
            string zip = null;
            try {
                if (!online) {
                    using (var picker = new OpenFileDialog { Filter = "휘슬 전시 업데이트 (*.zip)|*.zip" }) {
                        if (picker.ShowDialog(this) != DialogResult.OK) return;
                        zip = picker.FileName;
                    }
                }
                busy = true;
                foreach (Control c in panel.Controls) if (c is Button) c.Enabled = false;
                if (online) {
                    ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                    using (var client = new HttpClient { BaseAddress = new Uri(OnlineRelease.Address), Timeout = TimeSpan.FromMinutes(3) }) {
                        client.DefaultRequestHeaders.UserAgent.ParseAdd("Whistle-Exhibition/" + current);
                        Candidate = await OnlineRelease.Fetch(client,current,message => status.Text = message);
                    }
                } else {
                    status.Text = "패키지 확인 중…";
                    Candidate = await Task.Run(() => Packages.Stage(zip,current));
                }
            } catch (Exception e) { status.Text = "현재 전시 버전을 유지합니다.\n" + e.Message; }
            finally {
                busy = false;
                foreach (Control c in panel.Controls) if (c is Button) c.Enabled = true;
                if (Candidate != null) Close();
            }
        }
    }
}
