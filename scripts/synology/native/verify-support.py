#!/usr/bin/env python3
"""Exercise private media/Python tools on synthetic data as an ordinary user."""
import argparse
import http.server
import importlib.util
import json
import os
import pathlib
import subprocess
import ssl
import tempfile
import threading
import time
import wave


def chinese_pdf():
    text = "群晖图书 BookOrbit 中文阅读"
    content = ("BT /F1 18 Tf 20 80 Td <" + text.encode("utf-16-be").hex() + "> Tj ET\n").encode()
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>",
        b"<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>",
        b"<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 6 0 R /DW 1000 >>",
        b"<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 800 /StemV 80 >>",
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"endstream"]
    data = bytearray(b"%PDF-1.4\n");offsets = [0]
    for index, item in enumerate(objects, 1):
        offsets.append(len(data));data.extend(str(index).encode() + b" 0 obj\n" + item + b"\nendobj\n")
    position = len(data);data.extend(b"xref\n0 8\n0000000000 65535 f \n")
    for offset in offsets[1:]: data.extend(("%010d 00000 n \n" % offset).encode())
    data.extend(("trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % position).encode())
    return bytes(data), text


def verify(candidate, output, work_parent, tool_timeout=40):
    if not 10<=tool_timeout<=180:raise ValueError('Bounded tool timeout required')
    if os.geteuid() == 0: raise ValueError("Support acceptance must run as an ordinary user")
    candidate = pathlib.Path(candidate).resolve(strict=True);output = pathlib.Path(output).absolute()
    if output.exists() or output.is_symlink(): raise ValueError("Report must be new")
    report = {"uid": os.geteuid(), "checks": {}, "kind": "synthetic-support-runtime", "toolTimeoutSeconds":tool_timeout}
    with tempfile.TemporaryDirectory(prefix="bookorbit-support-check-", dir=work_parent) as temporary:
        work = pathlib.Path(temporary)
        environment = {"PATH": str(candidate / "bin") + ":/usr/bin:/bin", "HOME": str(work), "LANG": "C.UTF-8",
                       "TMPDIR":str(work), "PYTHONPYCACHEPREFIX":str(work/"python-cache"), "XDG_CACHE_HOME": str(work / "cache"), "LD_LIBRARY_PATH": str(candidate / "lib")}
        def run(tool, arguments, cwd=None):
            result = subprocess.run([str(candidate / "bin" / tool)] + arguments, cwd=str(cwd or work), env=environment,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=tool_timeout)
            if result.returncode: raise RuntimeError(tool + ": " + result.stderr.decode(errors="replace")[-500:])
            return result.stdout
        def runtime_abi():
            code = "import importlib.util,json,pathlib,os,sys;spec=importlib.util.spec_from_file_location('abi',sys.argv[1]);abi=importlib.util.module_from_spec(spec);spec.loader.exec_module(abi);manifest=json.loads(pathlib.Path(sys.argv[2]).read_text());print(json.dumps({'missing':abi.process_missing(manifest.get('requiredLibcSymbols')),'loader':os.readlink('/proc/self/exe')}))"
            data = json.loads(run("python3", ["-c", code, str(pathlib.Path(__file__).with_name("support-abi.py")), str(candidate / "support/support-manifest.json")]))
            report["missingRuntimeSymbols"] = data["missing"]
            report["runtimeLoader"] = data["loader"]
            assert not data["missing"], "Missing private runtime symbols: " + ", ".join(data["missing"][:8])
            assert pathlib.Path(data["loader"]).resolve() == (candidate / "support/private-lib/ld-linux-x86-64.so.2").resolve()
        def audio():
            with wave.open(str(work / "input.wav"), "wb") as stream:
                stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(8000);stream.writeframes(bytes(16000))
            run("ffmpeg", ["-v", "error", "-i", "input.wav", "-c:a", "aac", "-metadata", "title=群晖音频", "output.m4a"])
            data = json.loads(run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", "output.m4a"]))
            assert data["streams"][0]["codec_name"] == "aac" and float(data["format"]["duration"]) > 0
            assert data["format"]["tags"]["title"] == "群晖音频"
        def fonts():
            assert b"Noto" in run("fc-match", ["sans-serif:lang=zh-cn"])
        def pdf():
            data, expected = chinese_pdf();(work / "sample.pdf").write_bytes(data)
            assert b"Pages:" in run("pdfinfo", ["sample.pdf"])
            actual = run("pdftotext", ["-enc", "UTF-8", "sample.pdf", "-"]).decode("utf-8")
            assert "".join(actual.split()) == "".join(expected.split()), "Chinese PDF text mismatch"
            run("pdftoppm", ["-singlefile", "-scale-to", "600", "-png", "sample.pdf", "render"])
            image = work / "render.png"
            assert image.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
            script = "require('sharp')(process.argv[1]).stats().then(s=>{if(!s.channels.some(c=>c.min<200&&c.max>240))process.exit(1)}).catch(()=>process.exit(1))"
            run("node", ["-e", script, str(image)], candidate / "app")
        def djvu():
            (work / "input.ppm").write_bytes(b"P6\n16 12\n255\n" + bytes([0, 90, 180]) * 16 * 12)
            run("c44", ["input.ppm", "sample.djvu"])
            assert run("djvused", ["sample.djvu", "-e", "n"]).strip() == b"1"
            (work / "text.txt").write_text('(page 0 0 16 12 "BookOrbit 群晖")')
            run("djvused", ["sample.djvu", "-s", "-e", "select 1; set-txt text.txt"])
            assert "BookOrbit 群晖" in run("djvused", ["sample.djvu", "-u", "-e", "select 1; print-pure-txt"]).decode("utf-8")
            run("ddjvu", ["-format=tiff", "sample.djvu", "decoded.tiff"])
            assert (work / "decoded.tiff").read_bytes()[:4] in (b"II*\0", b"MM\0*")
        def python():
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    body = b"bookorbit-private-probe";self.send_response(200);self.end_headers();self.wfile.write(body)
                def log_message(self, *args): pass
            certificate_code = "from cryptography import x509;from cryptography.x509.oid import NameOID;from cryptography.hazmat.primitives import hashes,serialization;from cryptography.hazmat.primitives.asymmetric import ec;import datetime,ipaddress,pathlib,sys;root=pathlib.Path(sys.argv[1]);key=ec.generate_private_key(ec.SECP256R1());name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'BookOrbit private verification')]);now=datetime.datetime.now(datetime.timezone.utc);cert=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(days=1)).add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True).add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1')),x509.DNSName('localhost')]),critical=False).sign(key,hashes.SHA256());(root/'probe-cert.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM));(root/'probe-key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))"
            run("python3", ["-c", certificate_code, str(work)])
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(str(work / "probe-cert.pem"), str(work / "probe-key.pem"))
            with http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
                server.socket = context.wrap_socket(server.socket, server_side=True)
                thread = threading.Thread(target=server.serve_forever, daemon=True);thread.start()
                try:
                    code = "import ssl,subprocess,sys,json,cloudscraper,cryptography,os;assert os.path.realpath(sys.executable)==os.path.realpath(os.environ['BOOKORBIT_PYTHON_LAUNCHER']);ctx=ssl.create_default_context();assert ctx.get_ca_certs();s=cloudscraper.create_scraper(interpreter='native');s.trust_env=False;r=s.get(sys.argv[1],verify=sys.argv[2],timeout=5);assert r.status_code==200 and r.text=='bookorbit-private-probe';assert subprocess.check_output([sys.executable,'-c','import ssl,cloudscraper;print(123)']).strip()==b'123';print(json.dumps({'python':sys.version.split()[0],'ssl':ssl.OPENSSL_VERSION,'cryptography':cryptography.__version__,'executable':sys.executable}))"
                    result = json.loads(run("python3", ["-c", code, "https://localhost:" + str(server.server_port) + "/probe", str(work / "probe-cert.pem")]))
                    report["python"] = result
                finally: server.shutdown();thread.join(timeout=2)
        for name, operation in [("privateLibcAbi", runtime_abi), ("audioTagsEncodeProbe", audio), ("privateCjkFonts", fonts), ("chinesePdfTextAndRender", pdf),
                                ("djvuTextAndDecode", djvu), ("pythonTlsCloudscraperAndChild", python)]:
            started=time.monotonic()
            try: operation();report["checks"][name] = {"passed": True}
            except Exception as error: report["checks"][name] = {"passed": False, "errorClass": type(error).__name__, "error": str(error)[:700]}
            report["checks"][name]["durationSeconds"]=round(time.monotonic()-started,2)
            print(name, report["checks"][name]["passed"], flush=True)
    report["temporarySamplesRemoved"] = not pathlib.Path(temporary).exists()
    report["passed"] = all(item["passed"] for item in report["checks"].values()) and report["temporarySamplesRemoved"]
    fd = os.open(str(output), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream: json.dump(report, stream, indent=2)
    print(json.dumps(report), flush=True)
    return report


if __name__ == "__main__":
    p = argparse.ArgumentParser();p.add_argument("--candidate", required=True);p.add_argument("--output", required=True);p.add_argument("--work-parent", required=True);p.add_argument("--tool-timeout",type=int,default=40)
    a = p.parse_args();raise SystemExit(0 if verify(a.candidate, a.output, a.work_parent,a.tool_timeout)["passed"] else 1)
