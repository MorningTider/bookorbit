#!/bin/sh
set -eu
export DEBIAN_FRONTEND=noninteractive
mkdir -p /out
printf '%s\n' 'Acquire::Retries "2";' 'Acquire::http::Timeout "30";' 'Acquire::https::Timeout "30";' > /etc/apt/apt.conf.d/80-bookorbit-build
node -e 'require("node:fs").writeFileSync("/tmp/bookorbit-build-ca.pem", require("node:tls").rootCertificates.join("\n") + "\n")'
sed -i -e 's|http://deb.debian.org|https://deb.debian.org|g' -e 's/^Types: deb$/Types: deb deb-src/' /etc/apt/sources.list.d/debian.sources
apt-get -o Acquire::https::CaInfo=/tmp/bookorbit-build-ca.pem update
apt-get -o Acquire::https::CaInfo=/tmp/bookorbit-build-ca.pem install --yes --no-install-recommends ca-certificates
xargs -r apt-get install --yes --no-install-recommends < /build/apt-packages.lock
python3.11 - <<'CHECK'
import json,subprocess
for package in json.load(open("/build/support-toolchain-lock.json")):
    actual=subprocess.check_output(["dpkg-query","-W","-f=${Version}",package["name"]],text=True)
    if actual != package["version"]:raise ValueError("Installed toolchain differs from lock: "+package["name"])
CHECK
python3.11 -m venv /build/python-env
/build/python-env/bin/python -m pip install --disable-pip-version-check --no-cache-dir --timeout 30 --retries 2 --require-hashes --no-deps --no-build-isolation --report /out/pip-install.json -r /build/python-requirements.lock
/build/python-env/bin/python -m pip check
