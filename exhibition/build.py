"""Build the portable Windows x64 exhibition ZIP and its manual-update feed."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SDK_VERSION = "1.0.3537.50"
NODE_VERSION = "22.22.2"
ASSETS = {
    "webview.nupkg": (f"https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/{SDK_VERSION}/microsoft.web.webview2.{SDK_VERSION}.nupkg", "5ea526bbd728adda0da4d31219267e96460494a427e4894c4e09d9f320f4b9aa"),
    "node.zip": (f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-win-x64.zip", "7c93e9d92bf68c07182b471aa187e35ee6cd08ef0f24ab060dfff605fcc1c57c"),
    "hangul.tgz": ("https://registry.npmjs.org/hangul-js/-/hangul-js-0.2.6.tgz", "a5954cf891e5e4767d387b09d175e10f363196853060bf660238e446b32e0325"),
}

def sha(path):
    with open(path, "rb") as f:
        h = hashlib.sha256()
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
        return h.hexdigest()

def obtain(cache, name):
    url, digest = ASSETS[name]
    path = cache / name
    if not path.exists():
        urllib.request.urlretrieve(url, path)
    if sha(path) != digest:
        raise ValueError(f"Unexpected checksum for {path}")
    return path

def unzip_file(archive, member, dest):
    with archive.open(member) as src, open(dest, "wb") as target:
        shutil.copyfileobj(src, target)

def compile_cs(out, sources, refs):
    compiler = shutil.which("mcs") or shutil.which("csc")
    if not compiler and os.name == "nt":
        compiler = str(Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe")
    if not compiler:
        raise RuntimeError("Install Mono mcs or a C# compiler for .NET Framework.")
    flags = ["-sdk:4.6.2"] if Path(compiler).name == "mcs" else []
    subprocess.run([compiler, *flags, "-nologo", "-target:winexe", "-platform:x64", "-optimize+",
                    "-out:" + str(out), *["-r:" + str(ref) for ref in refs],
                    *[str(HERE / "native" / (s + ".cs")) for s in sources]], check=True)

def build(args):
    args.cache.mkdir(exist_ok=True, parents=True)
    args.out.mkdir(exist_ok=True, parents=True)
    version = args.version or (HERE / "version.txt").read_text().strip()
    if not re.fullmatch(r"(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){2}", version):
        raise ValueError("Use a three-part numeric release version, e.g. 1.1.0")
    assets = {name: obtain(args.cache, name) for name in ASSETS}
    with tempfile.TemporaryDirectory(prefix="whistle-exhibition-") as temp:
        root = Path(temp)
        app = root / "app"
        (app / "scripts").mkdir(parents=True)
        licenses = app / "licenses"
        licenses.mkdir()
        with zipfile.ZipFile(assets["webview.nupkg"]) as archive:
            for member, dest in [("lib/net462/Microsoft.Web.WebView2.Core.dll", app / "Microsoft.Web.WebView2.Core.dll"),
                                 ("runtimes/win-x64/native/WebView2Loader.dll", app / "WebView2Loader.dll"),
                                 ("LICENSE.txt", licenses / "WebView2.txt"),
                                 ("NOTICE.txt", licenses / "WebView2-notice.txt")]:
                unzip_file(archive, member, dest)
        with zipfile.ZipFile(assets["node.zip"]) as archive:
            prefix = f"node-v{NODE_VERSION}-win-x64/"
            unzip_file(archive, prefix + "node.exe", app / "node.exe")
            unzip_file(archive, prefix + "LICENSE", licenses / "Node.txt")
        with tarfile.open(assets["hangul.tgz"]) as archive:
            hangul = archive.extractfile("package/hangul.min.js").read()
            (licenses / "Hangul.txt").write_bytes(archive.extractfile("package/LICENSE").read())
        (app / "seat.js").write_bytes(hangul + b";\n" + (HERE / "seat.js").read_bytes() + b";\n" + (HERE / "seat-pickers.js").read_bytes())
        (app / "version.txt").write_text(version)
        shutil.copyfile(HERE / "run.mjs", app / "scripts/run.mjs")
        shutil.copytree(REPO / "node_modules/ws", app / "node_modules/ws")
        controls = ["System.Windows.Forms.dll", "System.Drawing.dll", "System.Web.Extensions.dll",
                    "System.IO.Compression.dll", "System.IO.Compression.FileSystem.dll"]
        compile_cs(root / "Whistle.exe", ["Launcher", "Package"], controls)
        compile_cs(app / "ExhibitionHost.exe", ["Host","Seat","SeatFiles","RawMice","Composition","Package","Operator","OnlineRelease"],
                   [*controls, "System.Net.Http.dll", app / "Microsoft.Web.WebView2.Core.dll"])
        subprocess.run(["node", str(HERE / "bundle-server.mjs"), str(app / "scripts/serve.mjs")], cwd=REPO, check=True)
        env = {**os.environ, "VITE_MEETING_SERVER_URL": "", "VITE_PORTAL_SERVER_URL": ""}
        subprocess.run(["node", str(REPO / "node_modules/vite/bin/vite.js"), "build",
                        "--outDir", str(app / "dist")], cwd=REPO, env=env, check=True)
        product = "whistle-exhibition-x64"
        paths = sorted(p for p in app.rglob("*") if p.is_file())
        manifest = dict(product=product, version=version, files={p.relative_to(app).as_posix():sha(p) for p in paths})
        (root / "release.json").write_text(json.dumps(manifest,separators=(",",":")),encoding="utf8")
        filename = "Whistle-Exhibition-win-x64.zip"
        with zipfile.ZipFile(root / filename, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in [root / "Whistle.exe", root / "release.json", *paths]:
                archive.write(path, path.relative_to(root))
        shutil.copyfile(root / filename, args.out / filename)
        feed = dict(product=product, version=version, sha256=sha(root / filename))
        (args.out / "exhibition.json").write_text(json.dumps(feed,indent=2) + "\n",encoding="utf8")
        print(args.out / filename)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "whistle-exhibition-sdk")
    parser.add_argument("--version", help="Three-part version for a new manual update")
    build(parser.parse_args())
