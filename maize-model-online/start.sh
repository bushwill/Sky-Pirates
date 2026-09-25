#!/bin/sh
set -eu

version_file="/usr/src/source/build-version.txt"
build_number=$(cat "$version_file")
build_number=$((build_number + 1))
version="A.${build_number}"

printf '%s\n' "$build_number" > "$version_file"

sed -i -E \
    -e "s/(<meta name=\"build-version\" content=\")[^\"]+/\1${version}/" \
    -e "s/(p5\\.min\\.js\\?v=)[A-Za-z0-9.]+/\1${version}/g" \
    -e "s/(App\\.js\\?v=)[A-Za-z0-9.]+/\1${version}/g" \
    /usr/src/source/client/index.html

find /usr/src/app -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a /usr/src/source/client/. /usr/src/app/

echo "Maize model version: ${version}"
exec nginx -c /usr/src/source/nginx.conf -g "daemon off;"
