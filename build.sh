#!/bin/bash

mkdir -p operation

# Download yt-dlp
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o operation/yt-dlp && chmod +x operation/yt-dlp

# Download ffmpeg
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  -o ffmpeg.tar.xz
tar -xf ffmpeg.tar.xz --wildcards '*/ffmpeg' --strip-components=1
chmod +x ffmpeg
mv ffmpeg operation/ffmpeg
rm ffmpeg.tar.xz

echo "✅ Binaries ready"