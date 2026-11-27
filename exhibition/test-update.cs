using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Whistle.Exhibition;

// The fixture serves the finished ZIP through the same HttpClient path as the operator button.
class UpdateTest {
    sealed class Feed : HttpMessageHandler {
        public string Metadata, Zip;
        public int Downloads, Requests;
        public HttpStatusCode Status = HttpStatusCode.OK;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) {
            Requests++;
            var response = new HttpResponseMessage(Status);
            if (request.RequestUri.AbsolutePath == "/exhibition.json") response.Content = new StringContent(Metadata);
            else if (request.RequestUri.AbsolutePath == "/Whistle-Exhibition-win-x64.zip") {
                Downloads++;
                response.Content = new StreamContent(File.OpenRead(Zip));
            } else throw new Exception("Unexpected URL");
            return Task.FromResult(response);
        }
    }
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    static void Main(string[] args) { Run(args[0]).GetAwaiter().GetResult(); }
    static async Task Run(string output) {
        Check(Marshal.SizeOf(typeof(RawHeader)) == 24 && Marshal.SizeOf(typeof(RawPacket)) == 48,"Windows x64 mouse packet layout");
        var handler = new Feed {
            Metadata = File.ReadAllText(Path.Combine(output,"exhibition.json")),
            Zip = Path.Combine(output,"Whistle-Exhibition-win-x64.zip")
        };
        using (var client = new HttpClient(handler) {BaseAddress = new Uri("https://release.test/")}) {
            Version next = Version.Parse(Store.Json.Deserialize<System.Collections.Generic.Dictionary<string,string>>(handler.Metadata)["version"]);
            Check(handler.Requests == 0,"Unexpected startup request");
            Action<string> report = s => Console.WriteLine(s);
            Check(await OnlineRelease.Fetch(client,next,report) == null && handler.Downloads == 0,"Current version downloaded again");
            var older = new Version("0.0.0");
            handler.Status = HttpStatusCode.NotFound;
            Check(await OnlineRelease.Fetch(client,older,report) == null && handler.Downloads == 0,"Unpublished release applied");
            handler.Status = HttpStatusCode.OK;
            string id = await OnlineRelease.Fetch(client,older,report);
            string dir = Path.Combine(Store.Data,"versions",id);
            Check(Store.ReadVersion(dir) == next && handler.Downloads == 1,"Release not staged");
            Check(!File.Exists(Path.Combine(Store.Data,"current")),"Release activated before readiness");
            var feed = Store.Json.Deserialize<System.Collections.Generic.Dictionary<string,string>>(handler.Metadata);
            feed["sha256"] = new string('0',64);
            handler.Metadata = Store.Json.Serialize(feed);
            try { await OnlineRelease.Fetch(client,older,report); throw new Exception("Damaged download accepted"); }
            catch (InvalidDataException) {}
            Check(Directory.GetDirectories(Path.Combine(Store.Data,"versions")).Length == 1,"Failed update leaked a version");
            Console.WriteLine("Manual download, staged installation and failure retention passed.");
        }
    }
}
