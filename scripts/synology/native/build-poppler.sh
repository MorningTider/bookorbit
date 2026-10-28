#!/bin/sh
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get install --yes --no-install-recommends cmake make g++ dpkg-dev libfreetype-dev libfontconfig-dev libjpeg62-turbo-dev libpng-dev libtiff-dev libopenjp2-7-dev liblcms2-dev zlib1g-dev libboost-dev
version=$(dpkg-query -W -f='${source:Version}' libpoppler126)
mkdir -p /build/poppler-downloads
cd /build/poppler-downloads
apt-cache showsrc --only-source poppler > /out/poppler-source-apt-records.txt
apt-get source --download-only "poppler=$version"
set -- ./*.dsc
test "$#" -eq 1
dpkg-source -x "$1" /build/poppler-src
python3.11 /build/patch-poppler.py --source /build/poppler-src/poppler/GlobalParams.cc --output /build/poppler-patch
cmake -S /build/poppler-src -B /build/poppler-cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/bookorbit-poppler -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_SKIP_RPATH=ON -DENABLE_UTILS=ON -DENABLE_GLIB=OFF -DENABLE_CPP=OFF -DENABLE_QT5=OFF -DENABLE_QT6=OFF -DENABLE_NSS3=OFF -DENABLE_GPGME=OFF -DENABLE_LIBCURL=OFF -DBUILD_GTK_TESTS=OFF -DBUILD_QT5_TESTS=OFF -DBUILD_QT6_TESTS=OFF -DBUILD_CPP_TESTS=OFF -DBUILD_MANUAL_TESTS=OFF
cmake --build /build/poppler-cmake --parallel 2
cmake --install /build/poppler-cmake
printf '%s\n' "$version" > /out/poppler-source-version.txt
