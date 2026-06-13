#!/bin/bash

echo "Starting build..."

# Find where node is and symlink it to a standard path
NODE_PATH=$(which node)
echo "node found at: $NODE_PATH"

# Symlink to /usr/local/bin if not already there
if [ ! -f /usr/local/bin/node ]; then
    ln -s $NODE_PATH /usr/local/bin/node
fi

# Symlink to /usr/bin as well for yt-dlp to find it
if [ ! -f /usr/bin/node ]; then
    ln -s $NODE_PATH /usr/bin/node
fi

# Install Python, pip and ffmpeg
apt-get update && apt-get install -y python3 python3-pip ffmpeg

# Install yt-dlp with EJS scripts via pip
pip3 install "yt-dlp[default]" --break-system-packages

# Install Deno as reliable fallback JS runtime
curl -fsSL https://deno.land/install.sh | sh
export DENO_INSTALL="/root/.deno"
export PATH="$DENO_INSTALL/bin:$PATH"
ln -sf $DENO_INSTALL/bin/deno /usr/local/bin/deno

# Download latest yt-dlp binary as fallback
mkdir -p /app/operation
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp
chmod a+rx /app/operation/yt-dlp

# Install npm dependencies
npm install

# Verify installations
echo "node path: $(which node)"
echo "node version: $(node --version)"
echo "deno version: $(deno --version 2>/dev/null || echo 'not found')"
echo "python version: $(python3 --version)"
echo "ffmpeg version: $(ffmpeg -version | head -n 1)"
echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "Build complete!"
echo "yt-dlp location: $(which yt-dlp)"
echo "yt-dlp pip location: $(pip3 show yt-dlp | grep Location)"
