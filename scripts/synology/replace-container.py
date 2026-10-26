#!/usr/bin/env python3
"""Replace an inspected application container, retaining it for automatic rollback."""
import argparse
import json
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--container', required=True)
parser.add_argument('--image', required=True)
parser.add_argument('--backup-name', required=True)
parser.add_argument('--version', required=True)
args = parser.parse_args()
docker = '/var/packages/ContainerManager/target/usr/bin/docker'

def run(*arguments, capture=False):
    result = subprocess.run([docker, *arguments], text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Docker operation failed: ' + arguments[0] + ' exit=' + str(result.returncode))
    return result

original = json.loads(run('inspect', args.container, capture=True).stdout)[0]
config = original['Config']
host = original['HostConfig']
# Keep secrets in memory rather than writing an environment file or printing commands.
env = dict(value.split('=', 1) for value in config['Env'])
env['APP_VERSION'] = args.version
env['TOMATO_DOWNLOADER_PATH'] = '/opt/bookorbit/tomato-downloader'
command = ['create', '--name', args.container]
if host.get('Init'):
    command.append('--init')
for key, value in (config.get('Labels') or {}).items():
    command.extend(['--label', key + '=' + value])
logging = host.get('LogConfig') or {}
if logging.get('Type'):
    command.extend(['--log-driver', logging['Type']])
for key, value in (logging.get('Config') or {}).items():
    command.extend(['--log-opt', key + '=' + value])
for key, value in env.items():
    command.extend(['--env', key + '=' + value])
for binding in host.get('Binds') or []:
    command.extend(['--volume', binding])
for target, options in (host.get('Tmpfs') or {}).items():
    command.extend(['--tmpfs', target + (':' + options if options else '')])
for port, bindings in (host.get('PortBindings') or {}).items():
    for binding in bindings or []:
        address = binding.get('HostIp') or '0.0.0.0'
        if ':' in address:
            address = '[' + address + ']'
        command.extend(['--publish', address + ':' + binding['HostPort'] + ':' + port])
command.extend(['--network', host['NetworkMode']])
restart = host.get('RestartPolicy') or {}
if restart.get('Name'):
    policy = restart['Name']
    if policy == 'on-failure' and restart.get('MaximumRetryCount'):
        policy += ':' + str(restart['MaximumRetryCount'])
    command.extend(['--restart', policy])
for field, flag in [('CapDrop', '--cap-drop'), ('CapAdd', '--cap-add'), ('SecurityOpt', '--security-opt')]:
    for value in host.get(field) or []:
        command.extend([flag, value])
if host.get('ReadonlyRootfs'):
    command.append('--read-only')
for field, flag in [('User', '--user'), ('WorkingDir', '--workdir')]:
    if config.get(field):
        command.extend([flag, config[field]])
entrypoint = config.get('Entrypoint') or []
if entrypoint:
    command.extend(['--entrypoint', entrypoint[0]])
command.append(args.image)
command.extend(entrypoint[1:])
command.extend(config.get('Cmd') or [])
run('rename', args.container, args.backup_name)
try:
    run('stop', args.backup_name)
    run(*command, capture=True)
    run('start', args.container)
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        state = json.loads(run('inspect', args.container, capture=True).stdout)[0]['State']
        if (state.get('Health') or {}).get('Status') == 'healthy':
            print('Replacement healthy: ' + args.container + ' image=' + args.image)
            break
        if not state.get('Running'):
            raise RuntimeError('Replacement exited before becoming healthy')
        time.sleep(3)
    else:
        raise RuntimeError('Replacement health check timed out')
except BaseException:
    subprocess.run([docker, 'stop', args.container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run([docker, 'rename', args.container, args.backup_name + '-failed'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run('rename', args.backup_name, args.container)
    run('start', args.container)
    print('Application container restored. Check database migration compatibility before further changes.')
    raise
