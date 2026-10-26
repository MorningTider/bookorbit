# coding: utf-8
"""Probe media tools from a pinned isolated image outside Docker; no system installs."""
import argparse, hashlib, io, json, os, pathlib, pwd, shutil, subprocess, tarfile, tempfile, wave, uuid
D="/var/packages/ContainerManager/target/usr/bin/docker"
p=argparse.ArgumentParser()
p.add_argument("--expected-image",required=True)
p.add_argument("--run-as",required=True)
p.add_argument("--output",required=True)
p.add_argument("--djvu-apks")
a=p.parse_args()
assert os.geteuid()==0
user=pwd.getpwnam(a.run_as)
assert user.pw_uid!=0
out=pathlib.Path(a.output)
assert out.is_absolute() and not out.exists()
actual=subprocess.check_output([D,"inspect","--format","{{.Image}}","bookorbit-app-verify"],text=True).strip()
assert actual==a.expected_image
root=pathlib.Path(tempfile.mkdtemp(prefix="bookorbit-media-",dir=user.pw_dir))
report={"image":actual,"uid":user.pw_uid,"outsideDocker":True,"checks":{}}
verify_name="bookorbit-native-apk-"+uuid.uuid4().hex[:12]
verify_started=False
inventory=r"""
import io,json,os,re,shutil,subprocess,tarfile,sys
tools={t:shutil.which(t) for t in ["ffmpeg","ffprobe","pdfinfo","pdftoppm","pdftotext","ddjvu","djvused","c44"]}
files={}
for name,path in tools.items():
 if not path: continue
 files["bin/"+name]=path
 r=subprocess.run(["ldd",path],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 if r.returncode: raise RuntimeError("ldd failed: "+name)
 for lib in re.findall(r"(?:=>\s+|^\s*)(/[^\s()]+)",r.stdout,re.M):
  key="lib/"+os.path.basename(lib)
  if key in files and os.path.realpath(files[key])!=os.path.realpath(lib): raise RuntimeError("library collision")
  files[key]=lib
with tarfile.open(fileobj=sys.stdout.buffer,mode="w|",dereference=True) as tar:
 data=json.dumps(tools).encode()
 info=tarfile.TarInfo("inventory.json");info.size=len(data);tar.addfile(info,io.BytesIO(data))
 for dst,src in files.items():tar.add(src,arcname=dst,recursive=False)
"""
def demote():
 os.setgroups([]);os.setgid(user.pw_gid);os.setuid(user.pw_uid)
def run(tool,args):
 env=os.environ.copy();env.pop("LD_LIBRARY_PATH",None)
 cmd=[str(root/"lib/ld-musl-x86_64.so.1"),"--library-path",str(root/"lib"),str(root/"bin"/tool)]+args
 r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,preexec_fn=demote,timeout=40)
 if r.returncode:raise RuntimeError(tool+" failed: "+r.stderr.decode(errors="replace")[-500:])
 return r.stdout
try:
 with tempfile.TemporaryFile() as f:
  subprocess.run([D,"exec","bookorbit-app-verify","python3","-c",inventory],stdout=f,check=True,timeout=90)
  f.seek(0)
  with tarfile.open(fileobj=f) as tar:
   for m in tar:
    path=pathlib.PurePosixPath(m.name)
    assert not path.is_absolute() and ".." not in path.parts and m.isfile()
    target=root/m.name;target.parent.mkdir(parents=True,exist_ok=True)
    with tar.extractfile(m) as src,open(target,"wb") as dest:shutil.copyfileobj(src,dest)
    target.chmod(0o755 if m.name!="inventory.json" else 0o600)
 report["tools"]=json.loads((root/"inventory.json").read_text())
 if a.djvu_apks:
  packages={"djvulibre-3.5.29-r0.apk":"063c372624d2a97cdd272c927c3a7e8de966c9fe2413a961a42097faddbe2f43","djvulibre-libs-3.5.29-r0.apk":"e0f365ebefcb052534cf16520915c9cee7909e357f5ff2bab53039e718b12ed5"}
  apkroot=pathlib.Path(a.djvu_apks).resolve()
  for name,digest in packages.items():
   assert hashlib.sha256((apkroot/name).read_bytes()).hexdigest()==digest,"DjVu archive hash mismatch"
  verify_started=True
  verify=subprocess.run([D,"run","--rm","--name",verify_name,"--network","none","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges","--entrypoint","apk",*sum((["--mount","type=bind,source="+str(apkroot/n)+",target=/probe/"+n+",readonly"] for n in packages),[]),actual,"verify"]+["/probe/"+n for n in packages],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
  assert verify.returncode==0,"Alpine APK signature verification failed"
  report["checks"]["djvuPackageSignatures"]=True
  for name in packages:
   with tarfile.open(str(apkroot/name),ignore_zeros=True) as tar:
    for m in tar:
     if not m.isfile():continue
     path=pathlib.PurePosixPath(m.name)
     assert not path.is_absolute() and ".." not in path.parts
     if m.name in ["usr/bin/ddjvu","usr/bin/djvused","usr/bin/c44"]:target=root/"bin"/path.name
     elif m.name.startswith("usr/lib/libdjvulibre.so."):target=root/"lib"/path.name
     else:continue
     with tar.extractfile(m) as src,open(target,"wb") as dst:shutil.copyfileobj(src,dst)
     target.chmod(0o755)
  # The signed APK provides the SONAME link separately from the regular library.
  libraries=list((root/"lib").glob("libdjvulibre.so.21.*"))
  assert len(libraries)==1
  shutil.copyfile(libraries[0],root/"lib/libdjvulibre.so.21")

 for base,dirs,files in os.walk(root):
  os.chown(base,user.pw_uid,user.pw_gid)
  for file in files:os.chown(os.path.join(base,file),user.pw_uid,user.pw_gid)
 audio=root/"sample.wav"
 with wave.open(str(audio),"wb") as f:
  f.setnchannels(1);f.setsampwidth(2);f.setframerate(8000);f.writeframes(b"\0\0"*8000)
 run("ffmpeg",["-v","error","-i",str(audio),"-c:a","aac",str(root/"sample.m4a")])
 meta=json.loads(run("ffprobe",["-v","error","-show_format","-show_streams","-of","json",str(root/"sample.m4a")]))
 assert meta["streams"][0]["codec_name"]=="aac" and float(meta["format"]["duration"])>0
 report["checks"]["audioEncodeAndProbe"]=True
 objects=[b"<< /Type /Catalog /Pages 2 0 R >>",b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>"]
 content=b"0 0 1 rg 10 10 80 80 re f\n"
 objects.append(b"<< /Length "+str(len(content)).encode()+b" >>\nstream\n"+content+b"endstream")
 pdf=bytearray(b"%PDF-1.4\n");offsets=[0]
 for i,obj in enumerate(objects,1):
  offsets.append(len(pdf));pdf.extend(str(i).encode()+b" 0 obj\n"+obj+b"\nendobj\n")
 pos=len(pdf);pdf.extend(b"xref\n0 5\n0000000000 65535 f \n")
 for off in offsets[1:]:pdf.extend(("%010d 00000 n \n"%off).encode())
 pdf.extend(("trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"%pos).encode())
 (root/"sample.pdf").write_bytes(pdf)
 assert b"Pages:" in run("pdfinfo",[str(root/"sample.pdf")])
 run("pdftoppm",["-singlefile","-scale-to","100","-png",str(root/"sample.pdf"),str(root/"render")])
 assert (root/"render.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
 run("pdftotext",[str(root/"sample.pdf"),str(root/"sample.txt")])
 report["checks"]["pdfMetadataRenderAndExtract"]=True
 if a.djvu_apks:
  (root/"sample.ppm").write_bytes(b"P6\n16 12\n255\n"+bytes([0,90,180])*16*12)
  run("c44",[str(root/"sample.ppm"),str(root/"sample.djvu")])
  assert run("djvused",[str(root/"sample.djvu"),"-e","n"]).strip()==b"1"
  run("ddjvu",["-format=ppm",str(root/"sample.djvu"),str(root/"decoded.ppm")])
  assert (root/"decoded.ppm").read_bytes().startswith(b"P6")
  report["checks"]["djvuEncodeInspectDecode"]=True
 report["passed"]=all(report["checks"].values())
except Exception as e:
 report["passed"]=False;report["error"]=str(e)[:700]
finally:
 if verify_started:
  subprocess.run([D,"rm","-f",verify_name],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
 shutil.rmtree(root)
 report["temporaryRuntimeRemoved"]=not root.exists()
 fd=os.open(str(out),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,"w") as f:json.dump(report,f,indent=2)
 print(json.dumps(report))
raise SystemExit(0 if report["passed"] else 1)
