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

# Install yt-dlp with EJS scripts via pip to /app/operation
mkdir -p /app/operation
pip3 install "yt-dlp[default]" --target /app/operation --break-system-packages

# Create executable wrapper at /app/operation/yt-dlp
cat > /app/operation/yt-dlp << 'EOF'
#!/usr/bin/env python3
import sys
sys.path.insert(0, '/app/operation')
from yt_dlp import main
main()
EOF
chmod a+rx /app/operation/yt-dlp

# Install npm dependencies
npm install

# Verify installations
echo "node path: $(which node)"
echo "node version: $(node --version)"
echo "python version: $(python3 --version)"
echo "ffmpeg version: $(ffmpeg -version | head -n 1)"
echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "Build complete!"
