#!/usr/bin/env python3
"""Run a disposable native BookOrbit against a new database on the isolated DB server."""
import argparse, hashlib, http.cookiejar, json, os, pathlib, pwd, re, secrets, shutil, signal, socket, subprocess, tarfile, tempfile, time, urllib.error, urllib.parse, urllib.request
D="/var/packages/ContainerManager/target/usr/bin/docker"
p=argparse.ArgumentParser()
p.add_argument("--expected-image",required=True)
p.add_argument("--run-as",required=True)
p.add_argument("--materials",required=True)
p.add_argument("--output",required=True)
a=p.parse_args()
assert os.geteuid()==0
user=pwd.getpwnam(a.run_as)
assert user.pw_uid!=0
output=pathlib.Path(a.output)
assert output.is_absolute() and not output.exists()
image=subprocess.check_output([D,"inspect","--format","{{.Image}}","bookorbit-app-verify"],text=True).strip()
assert image==a.expected_image
dbinfo=json.loads(subprocess.check_output([D,"inspect","bookorbit-db-verify"],text=True))[0]
dbvars=dict(v.split("=",1) for v in dbinfo["Config"]["Env"] if "=" in v)
dbuser=dbvars["POSTGRES_USER"]
assert re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*",dbuser)
dbhost=dbinfo["NetworkSettings"]["Networks"]["bookorbit-verify"]["IPAddress"]
dbname="bookorbit_native_probe_"+secrets.token_hex(6)
root=pathlib.Path(tempfile.mkdtemp(prefix="bookorbit-app-native-",dir=user.pw_dir))
report={"image":image,"uid":user.pw_uid,"outsideDocker":True,"checks":{}}
proc=None;created=False;stage="materials";private=[];logfile=None
def demote():
 os.setgroups([]);os.setgid(user.pw_gid);os.setuid(user.pw_uid)
def sql(command):
 return subprocess.run([D,"exec","bookorbit-db-verify","psql","-U",dbuser,"-d","postgres","-v","ON_ERROR_STOP=1","-c",command],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=30)
def verify(name,digest):
 f=pathlib.Path(a.materials)/name
 h=hashlib.sha256()
 with f.open("rb") as src:
  for c in iter(lambda:src.read(1048576),b""):h.update(c)
 assert h.hexdigest()==digest,"Material hash mismatch: "+name
 return f
def stop():
 global proc
 if proc is not None:
  if proc.poll() is None:
   os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(timeout=15)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=10)
  proc=None
def request(path,body=None,headers=None):
 req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={"Content-Type":"application/json",**(headers or {})})
 try:
  with opener.open(req,timeout=5) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def start():
 global proc
 proc=subprocess.Popen([str(root/"bin/node"),"--max-old-space-size=512","dist/main.js"],cwd=str(root/"app"),env=env,preexec_fn=demote,start_new_session=True,stdout=logfile,stderr=subprocess.STDOUT)
 deadline=time.monotonic()+90
 while time.monotonic()<deadline:
  if proc.poll() is not None:raise RuntimeError("Native service exited with code "+str(proc.returncode))
  try:
   status,body=request("/api/v1/health")
   if status==200 and json.loads(body)["status"]=="ok":return
  except (OSError,ValueError):pass
  time.sleep(1)
 raise RuntimeError("Native health timed out")
try:
 archive=verify("bookorbit-node-v26.11.1-linux-x64.tar.xz","3883bfc73f9a680ca4eab04b196068aaaab1373ffa77d8fc1a4408222495b651")
 atomic=verify("bookorbit-libatomic.so.1","107ab9f7661a1c47cddfb5cd1def99ec537a50a9a537fbe38cdde1b34b8ba280")
 sharp=verify("sharp-native-probe-20261026.tgz","511f01f0026fc97e9dcdc9ad88ce923503a01c742cabdaf835a2e601a9639c27")
 (root/"bin").mkdir();(root/"lib").mkdir()
 with tarfile.open(str(archive),"r:xz") as tar:
  m=tar.getmember("node-v26.11.1-linux-x64/bin/node")
  assert m.isfile()
  with tar.extractfile(m) as src,open(root/"bin/node","wb") as dst:shutil.copyfileobj(src,dst)
 (root/"bin/node").chmod(0o755);shutil.copyfile(atomic,root/"lib/libatomic.so.1")
 stage="application-export";print("native-probe: exporting isolated application",flush=True)
 (root/"app").mkdir()
 subprocess.run([D,"cp","bookorbit-app-verify:/app/.",str(root/"app")],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=600)
 assert not (root/"app/.env").exists(),"Unexpected environment file"
 with tarfile.open(str(sharp),"r:gz") as tar:
  for m in tar:
   name=pathlib.PurePosixPath(m.name)
   assert not name.is_absolute() and ".." not in name.parts and (m.isdir() or m.isfile())
   if not m.name.startswith("node_modules/@img/"):continue
   target=root/"app"/m.name
   assert not target.is_symlink()
   if m.isdir():target.mkdir(parents=True,exist_ok=True)
   else:
    target.parent.mkdir(parents=True,exist_ok=True)
    with tar.extractfile(m) as src,open(target,"wb") as dst:shutil.copyfileobj(src,dst)
 for name in ["data","books","home"]:(root/name).mkdir()
 for directory,dirs,files in os.walk(root,followlinks=False):
  os.chown(directory,user.pw_uid,user.pw_gid)
  for name in files+dirs:os.lchown(os.path.join(directory,name),user.pw_uid,user.pw_gid)
 stage="database-create";print("native-probe: creating disposable database",flush=True)
 sql('CREATE DATABASE "'+dbname+'" OWNER "'+dbuser+'"');created=True
 url="postgresql://"+urllib.parse.quote(dbuser,safe="")+":"+urllib.parse.quote(dbvars["POSTGRES_PASSWORD"],safe="")+"@"+dbhost+":5432/"+dbname
 token=secrets.token_urlsafe(32);password="NativeTest9"+secrets.token_hex(16)
 private=[url,dbvars["POSTGRES_PASSWORD"],token,password]
 env={"PATH":str(root/"bin")+":/usr/bin:/bin","HOME":str(root/"home"),"NODE_ENV":"production","HOST":"127.0.0.1","APP_DATA_PATH":str(root/"data"),"BOOKS_PATH":str(root/"books"),"LIBRARY_BROWSE_ROOT":str(root/"books"),"DATABASE_URL":url,"JWT_SECRET":secrets.token_hex(32),"SETUP_BOOTSTRAP_TOKEN":token,"PODCAST_ENCRYPTION_KEY":secrets.token_hex(32),"LD_LIBRARY_PATH":str(root/"lib"),"APP_VERSION":"native-isolation-probe-r21","COVER_SLOTS_BACKFILL_MODE":"skip","LOG_LEVEL":"warn"}
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
 status,body=request("/api/v1/auth/login",{"username":"native_probe","password":password})
 assert status==200,"Login response "+str(status)
 report["checks"]["restartAndLogin"]=True
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
