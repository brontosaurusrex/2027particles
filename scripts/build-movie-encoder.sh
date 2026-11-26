#!/usr/bin/env bash
# Run with the pinned Emscripten 4.0.20 SDK on PATH.
set -euo pipefail

project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
source_archive=
if [[ $# -eq 1 ]]; then
  source_archive=$(realpath -- "$1")
fi
build_dir=$(mktemp -d)
trap 'rm -rf -- "$build_dir"' EXIT
cd "$build_dir"
version=7.1.2
archive=ffmpeg-$version.tar.xz
if [[ -n "$source_archive" ]]; then
  cp -- "$source_archive" "$archive"
else
  curl -fsSL "https://ffmpeg.org/releases/$archive" -o "$archive"
fi
printf '%s  %s\n' 089bc60fb59d6aecc5d994ff530fd0dcb3ee39aa55867849a2bbc4e555f9c304 "$archive" | sha256sum -c
tar -xf "$archive"
cd "ffmpeg-$version"
emconfigure ./configure \
  --target-os=none --arch=wasm32 --enable-cross-compile \
  --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=emnm \
  --disable-everything --disable-programs --disable-doc --disable-debug --disable-autodetect \
  --disable-network --disable-pthreads --disable-asm --disable-avdevice --disable-avfilter \
  --disable-swscale --disable-swresample --enable-encoder=prores_ks,cfhd --enable-muxer=mov
emmake make -j "${PARTICLES_BUILD_JOBS:-4}"
mkdir -p "$project_dir/public/video"
emcc -O3 -I. "$project_dir/scripts/movie-encoder.c" \
  libavformat/libavformat.a libavcodec/libavcodec.a libavutil/libavutil.a \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createEncoder -sENVIRONMENT=worker \
  -sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=0 -sEXPORTED_RUNTIME_METHODS=HEAPU8,UTF8ToString \
  -o "$project_dir/public/video/encoder.js"
chmod 644 "$project_dir/public/video/encoder.wasm"
