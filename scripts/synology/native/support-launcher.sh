#!/bin/sh
set -eu
unset LD_PRELOAD LD_LIBRARY_PATH
base=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
support="$base/support"
name=$(basename -- "$0")
SSL_CERT_FILE="$support/ca-certificates.crt"
FONTCONFIG_FILE="$support/fontconfig/fonts.conf"
FONTCONFIG_PATH="$support/fontconfig"
BOOKORBIT_POPPLER_DATADIR="$support/poppler-data"
export SSL_CERT_FILE FONTCONFIG_FILE FONTCONFIG_PATH BOOKORBIT_POPPLER_DATADIR
case "$name" in
  python3)
    PYTHONHOME="$support/python"
    PYTHONPATH="$support/python/lib/python3.11/site-packages"
    PYTHONNOUSERSITE=1
    PYTHONUTF8=1
    REQUESTS_CA_BUNDLE="$SSL_CERT_FILE"
    export PYTHONHOME PYTHONPATH PYTHONNOUSERSITE PYTHONUTF8 REQUESTS_CA_BUNDLE
    BOOKORBIT_PYTHON_LAUNCHER="$base/bin/python3"
    export BOOKORBIT_PYTHON_LAUNCHER
    exec "$support/private-lib/ld-linux-x86-64.so.2" --argv0 "$base/bin/python3" --library-path "$support/private-lib" "$support/python/bin/python3.11" "$@"
    ;;
  ffmpeg|ffprobe|pdfinfo|pdftoppm|pdftotext|pdffonts|ddjvu|djvused|c44|fc-match)
    exec "$support/private-lib/ld-linux-x86-64.so.2" --argv0 "$base/bin/$name" --library-path "$support/private-lib" "$support/bin/$name" "$@"
    ;;
  *) printf '%s\n' 'Unsupported BookOrbit support tool' >&2; exit 64 ;;
esac
