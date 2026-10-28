#!/usr/bin/env python3
"""Run a source-built native candidate against a disposable isolated database."""
import argparse, hashlib, http.cookiejar, json, os, pathlib, pwd, re, secrets, shutil, signal, socket, subprocess, tarfile, tempfile, time, urllib.error, urllib.parse, urllib.request
D="/var/packages/ContainerManager/target/usr/bin/docker"
p=argparse.ArgumentParser()
p.add_argument("--candidate",required=True)
p.add_argument("--source-commit",required=True)
p.add_argument("--run-as",required=True)
p.add_argument("--output",required=True)
a=p.parse_args()
assert os.geteuid()==0
user=pwd.getpwnam(a.run_as)
assert user.pw_uid!=0
output=pathlib.Path(a.output)
assert output.is_absolute() and not output.exists()
candidate=pathlib.Path(a.candidate).resolve(strict=True)
assert re.fullmatch(r"[a-f0-9]{40}",a.source_commit)
provenance=json.loads((candidate/"provenance/source-build.json").read_text())
assert provenance["sourceCommit"]==a.source_commit and provenance["sharpNativeCheck"] is True
assert candidate.stat().st_uid==user.pw_uid
dbinfo=json.loads(subprocess.check_output([D,"inspect","bookorbit-db-verify"],text=True))[0]
dbvars=dict(v.split("=",1) for v in dbinfo["Config"]["Env"] if "=" in v)
dbuser=dbvars["POSTGRES_USER"]
assert re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*",dbuser)
dbhost=dbinfo["NetworkSettings"]["Networks"]["bookorbit-verify"]["IPAddress"]
dbname="bookorbit_native_probe_"+secrets.token_hex(6)
root=pathlib.Path(tempfile.mkdtemp(prefix="bookorbit-app-native-",dir=user.pw_dir))
report={"sourceCommit":a.source_commit,"uid":user.pw_uid,"outsideDocker":True,"databaseKind":"disposable-isolated-container","checks":{}}
authHeaders={}
proc=None;created=False;stage="materials";private=[];logfile=None
def demote():
 os.setgroups([]);os.setgid(user.pw_gid);os.setuid(user.pw_uid)
def sql(command):
 return subprocess.run([D,"exec","bookorbit-db-verify","psql","-U",dbuser,"-d","postgres","-v","ON_ERROR_STOP=1","-c",command],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=30)
def stop():
 global proc
 if proc is not None:
  if proc.poll() is None:
   os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(timeout=15)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=10)
  proc=None
def request(path,body=None,headers=None):
 req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={"Content-Type":"application/json",**authHeaders,**(headers or {})})
 try:
  with opener.open(req,timeout=5) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def start():
 global proc
 proc=subprocess.Popen([str(root/"bin/node"),"--max-old-space-size=512","dist/main.js"],cwd=str(root/"app"),env=env,preexec_fn=demote,start_new_session=True,stdout=logfile,stderr=subprocess.STDOUT)
 started=time.monotonic()
 deadline=started+180
 while time.monotonic()<deadline:
  if proc.poll() is not None:raise RuntimeError("Native service exited with code "+str(proc.returncode))
  try:
   status,body=request("/api/v1/health")
   if status==200 and json.loads(body)["status"]=="ok":
    report.setdefault("startupSeconds",[]).append(round(time.monotonic()-started,2));return
  except (OSError,ValueError):pass
  time.sleep(1)
 raise RuntimeError("Native health timed out")
try:
 for name in ["app","bin","lib","support"]:
  (root/name).symlink_to(candidate/name,target_is_directory=True)
 for name in ["data","books","home"]:(root/name).mkdir()
 os.chown(root,user.pw_uid,user.pw_gid)
 for name in ["data","books","home"]:os.chown(root/name,user.pw_uid,user.pw_gid)
 stage="database-create";print("native-probe: creating disposable database",flush=True)
 sql('CREATE DATABASE "'+dbname+'" OWNER "'+dbuser+'"');created=True
 url="postgresql://"+urllib.parse.quote(dbuser,safe="")+":"+urllib.parse.quote(dbvars["POSTGRES_PASSWORD"],safe="")+"@"+dbhost+":5432/"+dbname
 token=secrets.token_urlsafe(32);password="NativeTest9"+secrets.token_hex(16)
 private=[url,dbvars["POSTGRES_PASSWORD"],token,password]
 env={"PATH":str(root/"bin")+":/usr/bin:/bin","HOME":str(root/"home"),"NODE_ENV":"production","HOST":"127.0.0.1","APP_DATA_PATH":str(root/"data"),"BOOKS_PATH":str(root/"books"),"LIBRARY_BROWSE_ROOT":str(root/"books"),"DATABASE_URL":url,"JWT_SECRET":secrets.token_hex(32),"SETUP_BOOTSTRAP_TOKEN":token,"PODCAST_ENCRYPTION_KEY":secrets.token_hex(32),"LD_LIBRARY_PATH":str(root/"lib"),"APP_VERSION":"source-native-isolation-probe","FFMPEG_PATH":str(root/"bin/ffmpeg"),"FFPROBE_PATH":str(root/"bin/ffprobe"),"KOBO_CLOUDSCRAPER_PYTHON":str(root/"bin/python3"),"COVER_SLOTS_BACKFILL_MODE":"skip","LOG_LEVEL":"info"}
 private.extend([env["JWT_SECRET"],env["PODCAST_ENCRYPTION_KEY"]])
 with socket.socket() as s:s.bind(("127.0.0.1",0));port=s.getsockname()[1]
 env["PORT"]=str(port);env["APP_URL"]="http://127.0.0.1:"+str(port);base=env["APP_URL"]
 opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),urllib.request.ProxyHandler({}))
 logfile=open(root/"service.log","w+b")
 stage="database-migrate";print("native-probe: applying migrations",flush=True)
 result=subprocess.run([str(root/"bin/node"),"dist/scripts/migrate.js"],cwd=str(root/"app"),env=env,preexec_fn=demote,stdout=logfile,stderr=subprocess.STDOUT,timeout=120)
 assert result.returncode==0,"Native migrations failed"
 report["checks"]["nativeDatabaseMigrations"]=True
 stage="native-start";print("native-probe: starting ordinary-user service",flush=True)
 start();report["checks"]["healthAndDatabase"]=True
 assert "Uid:\t"+str(user.pw_uid) in pathlib.Path("/proc/"+str(proc.pid)+"/status").read_text()
 report["checks"]["ordinaryUserProcess"]=True
 status,body=request("/")
 assert status==200 and b"<html" in body.lower()
 report["checks"]["frontendServed"]=True
 status,body=request("/api/v1/book-sources/status")
 assert status==401
 report["checks"]["unauthenticatedDenied"]=True
 assert json.loads(request("/api/v1/auth/setup-status")[1])["needsSetup"] is True
 stage="native-setup"
 status,body=request("/api/v1/auth/setup",{"username":"native_probe","name":"Native verification","email":"native-probe@example.test","password":password},{"x-setup-token":token})
 assert status==201,"Setup response "+str(status)
 report["checks"]["freshSetup"]=True
 assert json.loads(request("/api/v1/auth/setup-status")[1])["needsSetup"] is False
 stage="native-restart";print("native-probe: checking restart persistence",flush=True)
 stop();start()
 assert json.loads(request("/api/v1/auth/setup-status")[1])["needsSetup"] is False
 status,body=request("/api/v1/auth/login",{"username":"native_probe","password":password,"clientKind":"native"})
 assert status==200,"Login response "+str(status)
 report["checks"]["restartAndLogin"]=True
 credentials=json.loads(body)
 assert credentials.get("accessToken"),"Native login token missing"
 authHeaders["Authorization"]="Bearer "+credentials["accessToken"]
 private.append(credentials["accessToken"])
 stage="source-upload-txt"
 status,body=request("/api/v1/libraries",{"name":"原生验收书库","icon":"book","folders":[str(root/"books")],"watch":False})
 assert status==201,"Library create response "+str(status)
 library=json.loads(body)["id"]
 text="第一章 原生服务\n群晖图书正文，验证 TXT 直接阅读。\n第二章 持久化\n重启后仍应可以阅读。\n".encode("utf-8")
 boundary="BookOrbitNative"+secrets.token_hex(16)
 payload=("--"+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="native-test.txt"\r\nContent-Type: text/plain\r\n\r\n').encode()+text+("\r\n--"+boundary+"--\r\n").encode()
 req=urllib.request.Request(base+"/api/v1/libraries/"+str(library)+"/upload",data=payload,headers={**authHeaders,"Content-Type":"multipart/form-data; boundary="+boundary})
 with opener.open(req,timeout=60) as response:
  assert response.status==201
  book=json.loads(response.read())["bookId"]
 status,body=request("/api/v1/books/"+str(book))
 assert status==200,"Imported book detail response "+str(status)
 detail=json.loads(body)
 txt=next(f for f in detail["files"] if f["format"]=="txt")
 status,body=request("/api/v1/books/files/"+str(txt["id"])+"/serve")
 assert status==200 and body==text,"TXT content differs"
 status,body=request("/api/v1/books/files/"+str(txt["id"])+"/serve",headers={"Range":"bytes=0-11"})
 assert status==206 and body==text[:12],"TXT range differs"
 report["checks"]["txtImportReadAndRange"]=True
 stage="source-convert-epub"
 status,body=request("/api/v1/books/"+str(book)+"/convert-txt-to-epub",{"encoding":"utf8","chapters":"chinese"})
 assert status==201,"TXT conversion response "+str(status)
 status,body=request("/api/v1/epub/"+str(book)+"/info")
 assert status==200 and json.loads(body)["spine"],"Converted EPUB spine missing"
 report["checks"]["txtToEpubAndReaderInfo"]=True
 stage="source-content-restart"
 stop();start()
 status,body=request("/api/v1/books/"+str(book))
 assert status==200 and len(json.loads(body)["files"])>=2,"Files did not persist"
 status,body=request("/api/v1/books/files/"+str(txt["id"])+"/serve")
 assert status==200 and body==text,"TXT did not persist"
 report["checks"]["importAndConversionRestartPersistence"]=True
 report["passed"]=True
except Exception as e:
 report["passed"]=False;report["failedStage"]=stage
 message=str(e)
 for secret in private:message=message.replace(secret,"[redacted]")
 report["error"]=message[:300]
 if logfile:
  logfile.flush();logfile.seek(0)
  log=logfile.read().decode(errors="replace")
  for secret in private:log=log.replace(secret,"[redacted]")
  report["diagnosticTail"]=log[-3500:]
finally:
 stop()
 if logfile:logfile.close()
 if created:
  try:
   sql('DROP DATABASE "'+dbname+'" WITH (FORCE)')
   report["temporaryDatabaseRemoved"]=True
  except Exception:report["temporaryDatabaseRemoved"]=False;report["passed"]=False
 shutil.rmtree(root);report["temporaryApplicationRemoved"]=not root.exists()
 fd=os.open(str(output),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,"w") as f:json.dump(report,f,indent=2)
 print(json.dumps(report))
raise SystemExit(0 if report["passed"] else 1)
