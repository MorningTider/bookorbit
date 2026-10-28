#!/bin/sh
set -eu
export DEBIAN_FRONTEND=noninteractive
mkdir -p /out
printf '%s\n' 'Acquire::Retries "2";' 'Acquire::http::Timeout "30";' 'Acquire::https::Timeout "30";' > /etc/apt/apt.conf.d/80-bookorbit-build
node -e 'require("node:fs").writeFileSync("/tmp/bookorbit-build-ca.pem", require("node:tls").rootCertificates.join("\n") + "\n")'
sed -i -e 's|http://deb.debian.org|https://deb.debian.org|g' -e 's/^Types: deb$/Types: deb deb-src/' /etc/apt/sources.list.d/debian.sources
apt-get -o Acquire::https::CaInfo=/tmp/bookorbit-build-ca.pem update
apt-get -o Acquire::https::CaInfo=/tmp/bookorbit-build-ca.pem install --yes --no-install-recommends ca-certificates
apt-get install --yes --no-install-recommends ffmpeg poppler-utils poppler-data djvulibre-bin python3.11 python3.11-venv fonts-noto-cjk fonts-dejavu-core
python3.11 -m venv /build/python-env
/build/python-env/bin/python -m pip install --disable-pip-version-check --no-cache-dir --timeout 30 --retries 2 --report /out/pip-install.json -r /build/requirements.in
