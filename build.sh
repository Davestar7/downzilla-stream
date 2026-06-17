#!/bin/bash

echo "Starting build..."

NODE_PATH=$(which node)
if [ ! -f /usr/local/bin/node ]; then ln -s $NODE_PATH /usr/local/bin/node; fi
if [ ! -f /usr/bin/node ]; then ln -s $NODE_PATH /usr/bin/node; fi

apt-get update && apt-get install -y python3 python3-pip ffmpeg

# Install yt-dlp
mkdir -p /app/operation
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp
chmod a+rx /app/operation/yt-dlp

# Download bgutil .so plugin directly
mkdir -p /root/yt-dlp-plugins/bgutil-ytdlp-pot-provider/yt_dlp_plugins/extractor
curl -L https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/libbgutil_ytdlp_pot_provider-linux-x86_64.so -o /root/yt-dlp-plugins/bgutil-ytdlp-pot-provider/libbgutil_ytdlp_pot_provider.so

# Download the Python plugin zip
curl -L https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-ytdlp-pot-provider-rs.zip -o /tmp/bgutil-plugin.zip
cd /tmp && unzip -o bgutil-plugin.zip -d /root/yt-dlp-plugins/

# Install pip plugin
pip3 install bgutil-ytdlp-pot-provider --break-system-packages

npm install

echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "node version: $(node --version)"
echo "Build complete!"
