#!/usr/bin/env python3
"""Create a bounded, no-internet BookOrbit client for native PG acceptance.

This runs the existing application image; PostgreSQL remains the native SPK.
No source production environment or credentials are printed or exported.
"""
import argparse
import copy
import http.client
import ipaddress
import json
import os
import pathlib
import secrets
import socket
import subprocess
import urllib.parse


class DockerConnection(http.client.HTTPConnection):
    def __init__(self):super().__init__('localhost',timeout=120)
    def connect(self):
        self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(self.timeout);self.sock.connect('/var/run/docker.sock')


def docker(method,path,body=None):
    connection=DockerConnection()
    try:
        connection.request(method,path,body=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
        response=connection.getresponse();data=response.read()
        if response.status>=400:
            message=json.loads(data).get('message','Unknown Docker error')
            if isinstance(body,dict):
                for item in body.get('Env',[]):
                    value=item.partition('=')[2]
                    if len(value)>8:message=message.replace(value,'<redacted>')
            raise RuntimeError('Docker '+method+' failed with status '+str(response.status)+': '+message[:500])
        return json.loads(data) if data else None
    finally:connection.close()


def main():
    if os.environ.get('BOOKORBIT_VERIFY_ISOLATED')!='1':raise ValueError('Explicit isolated acceptance is required')
    parser=argparse.ArgumentParser();parser.add_argument('--stage-root',type=pathlib.Path,required=True);args=parser.parse_args()
    stage=args.stage_root
    if not stage.is_absolute() or stage.exists():raise ValueError('Use a new isolated stage directory')
    credentials=json.loads(pathlib.Path('/volume1/database/pg/state/bookorbit-acceptance-credentials.json').read_text())
    if credentials['database']!='bookorbit_acceptance' or credentials['role']!='bookorbit_acceptance':raise ValueError('Unexpected acceptance database')
    source=docker('GET','/containers/bookorbit-app/json')
    if source['State']['Status']!='running':raise ValueError('Production application must remain running')
    subnet=ipaddress.ip_network('172.30.77.0/24');network_name='bookorbit-nativepg-acceptance'
    networks=docker('GET','/networks')
    for network in networks:
        if network['Name']==network_name:raise ValueError('An acceptance network already exists')
        for item in network.get('IPAM',{}).get('Config',[]):
            if item.get('Subnet'):
                other=ipaddress.ip_network(item['Subnet'])
                if other.version==subnet.version and other.overlaps(subnet):raise ValueError('Acceptance subnet conflicts with an existing container network')
    network=docker('POST','/networks/create',{'Name':network_name,'Driver':'bridge','Internal':True,'CheckDuplicate':True,'Labels':{'bookorbit.acceptance':'native-pg'},'IPAM':{'Config':[{'Subnet':str(subnet),'Gateway':'172.30.77.1'}]}})
    stage.mkdir(mode=0o700)
    app=stage/'app';app.mkdir()
    source_data=next(m['Source'] for m in source['Mounts'] if m['Destination']=='/data')
    subprocess.run(['cp','-a',source_data+'/.',str(app)],check=True,timeout=300,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    config=copy.deepcopy(source['Config']);host=copy.deepcopy(source['HostConfig'])
    env=dict(v.split('=',1) for v in config['Env'])
    port=str(env.get('PORT','3000'))
    env.update({'POSTGRES_HOST':'172.30.77.1','POSTGRES_PORT':'5433','POSTGRES_DB':credentials['database'],'POSTGRES_USER':credentials['role'],'POSTGRES_PASSWORD':credentials['password'],'DATABASE_URL':'postgres://'+urllib.parse.quote(credentials['role'],safe='')+':'+urllib.parse.quote(credentials['password'],safe='')+'@172.30.77.1:5433/'+credentials['database'],'JWT_SECRET':secrets.token_hex(32),'SETUP_BOOTSTRAP_TOKEN':secrets.token_hex(32),'APP_URL':'http://127.0.0.1:18185','CLIENT_URL':'http://127.0.0.1:18185','COVER_SLOTS_BACKFILL_MODE':'skip'})
    config['Env']=[key+'='+value for key,value in env.items()]
    config['Entrypoint']=['/bin/nice','-n','10']+(config.get('Entrypoint') or [])
    config['Labels']={'bookorbit.acceptance':'native-pg'}
    config.pop('Hostname',None);config.pop('Domainname',None)
    binds=[]
    for mount in source['Mounts']:
        if mount['Type']!='bind':raise ValueError('Unexpected application mount type')
        if mount['Destination']=='/data':binds.append(str(app)+':/data:rw')
        elif mount['Destination'].startswith('/books'):binds.append(mount['Source']+':'+mount['Destination']+':ro')
        else:raise ValueError('Unreviewed production application mount')
    host.update({'Binds':binds,'NetworkMode':network_name,'PortBindings':{port+'/tcp':[{'HostIp':'127.0.0.1','HostPort':'18185'}]},'RestartPolicy':{'Name':'no','MaximumRetryCount':0},'Memory':1024*1024*1024,'NanoCpus':0,'CpuShares':0,'CpuPeriod':0,'CpuQuota':0,'AutoRemove':False})
    config['HostConfig']=host
    name='bookorbit-nativepg-acceptance'
    created=docker('POST','/containers/create?name='+name,config)
    receipt={'container':name,'containerId':created['Id'],'network':network_name,'networkId':network['Id'],'subnet':str(subnet),'nativeGateway':'172.30.77.1','database':credentials['database'],'stageRoot':str(stage),'port':18185,'sourceImage':source['Config']['Image'],'noInternet':True,'readOnlyBooks':True,'productionContainerUnchanged':True,'schedulingPriority':'nice10','memoryLimitMiB':1024}
    path=stage/'receipt.json';path.write_text(json.dumps(receipt,indent=2));path.chmod(0o600)
    print(json.dumps(receipt))
    print('Configure native PG for 172.30.77.0/24 at 172.30.77.1 and restart its DSM package before starting this acceptance application.')

if __name__=='__main__':main()
