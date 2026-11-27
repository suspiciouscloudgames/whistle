using Microsoft.Web.WebView2.Core;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace Whistle.Exhibition {
    // Keep the file input and its browser document paired throughout each independent chooser.
    sealed class SeatFiles {
        readonly CoreWebView2 web;
        readonly List<string> paths = new List<string>();
        int node;
        string folder;
        string token;
        public SeatFiles(CoreWebView2 web) { this.web = web; }
        public async Task Start() {
            await web.CallDevToolsProtocolMethodAsync("Page.enable","{}");
            var receiver = web.GetDevToolsProtocolEventReceiver("Page.fileChooserOpened");
            receiver.DevToolsProtocolEventReceived += (s,e) => {
                var data = Store.Json.Deserialize<Dictionary<string,object>>(e.ParameterObjectAsJson);
                object value;
                if (!data.TryGetValue("backendNodeId",out value)) return;
                node = Convert.ToInt32(value);
                Show(null);
            };
            await web.CallDevToolsProtocolMethodAsync("Page.setInterceptFileChooserDialog","{\"enabled\":true}");
            web.NavigationStarting += (s,e) => { node = 0; paths.Clear(); token = null; };
        }
        void Show(string dir) {
            var items = new List<object>();
            paths.Clear();
            token = Guid.NewGuid().ToString("N");
            Action<string,string,bool> add = (path,label,isFolder) => {
                items.Add(new { id = paths.Count, label, directory = isFolder });
                paths.Add(path);
            };
            string error = null;
            if (dir == null) {
                add(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"바탕 화면",true);
                add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"Downloads"),"다운로드",true);
                add(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),"사진",true);
                foreach (string drive in Directory.GetLogicalDrives()) add(drive,drive,true);
            } else {
                try {
                    foreach (var entry in new DirectoryInfo(dir).EnumerateFileSystemInfos()
                            .Where(f => (f.Attributes & (FileAttributes.Hidden | FileAttributes.System)) == 0)
                            .OrderByDescending(f => f is DirectoryInfo).ThenBy(f => f.Name,StringComparer.CurrentCultureIgnoreCase))
                        add(entry.FullName, entry.Name, entry is DirectoryInfo);
                } catch (Exception e) { error = e.Message; }
            }
            folder = dir;
            web.PostWebMessageAsJson(Store.Json.Serialize(new { type = "files", folder = dir ?? "위치", token, items, error }));
        }
        public async Task Choose(string command) {
            string[] parts = command.Split('|');
            if (node == 0 || parts.Length != 3 || parts[1] != token) return;
            if (parts[2] == "cancel") { node = 0; paths.Clear(); return; }
            if (parts[2] == "up") {
                var parent = folder == null ? null : Directory.GetParent(folder);
                Show(parent == null ? null : parent.FullName);
                return;
            }
            int index;
            if (!Int32.TryParse(parts[2],out index) || index < 0 || index >= paths.Count) return;
            string path = paths[index];
            if (Directory.Exists(path)) { Show(path); return; }
            if (!File.Exists(path)) { Show(folder); return; }
            await web.CallDevToolsProtocolMethodAsync("DOM.setFileInputFiles",Store.Json.Serialize(new { files = new[]{path}, backendNodeId = node }));
            node = 0;
            paths.Clear();
            web.PostWebMessageAsJson("{\"type\":\"files-done\"}");
        }
    }
}
