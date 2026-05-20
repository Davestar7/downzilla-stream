#!/bin/bash

# Download yt-dlp
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o yt-dlp && chmod +x yt-dlp

# Download ffmpeg static build
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  -o ffmpeg.tar.xz
tar -xf ffmpeg.tar.xz --wildcards '*/ffmpeg' --strip-components=1
chmod +x ffmpeg
rm ffmpeg.tar.xz

echo "✅ Binaries ready"