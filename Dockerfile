FROM node:20-bookworm

# Install system deps
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CHANGED: install yt-dlp via pip with the [default] extra instead of
# downloading the standalone GitHub-releases binary. The standalone binary
# does NOT bundle the EJS (Embedded JavaScript) challenge-solver scripts
# that yt-dlp needs to solve YouTube's signature/n-challenge — those scripts
# only ship with the pip package. This is why --js-runtimes node was set
# correctly but signature solving still failed: there was nothing for
# node to actually execute.
RUN pip3 install --break-system-packages "yt-dlp[default]"

# Keep the invidious fallback plugin too — now a secondary safety net
# rather than the primary workaround, since proper EJS solving should let
# normal YouTube extraction succeed directly in most cases.
RUN pip3 install --break-system-packages yt-dlp-invidious

# pip installs yt-dlp's entry point to a standard location on PATH.
# Symlink it to /app/operation/yt-dlp so ytDlpPath in your existing code
# (which hardcodes this path) keeps working with zero code changes.
RUN mkdir -p /app/operation && \
    ln -sf "$(which yt-dlp)" /app/operation/yt-dlp && \
    chmod a+rx /app/operation/yt-dlp

# Install Deno as an additional JS runtime. yt-dlp's EJS challenge solver
# prioritizes deno > node > phantomjs, and several documented cases show
# node's JS-challenge-provider detection being unreliable while deno works
# correctly for the same EJS scripts. DENO_INSTALL=/usr/local puts the
# binary directly on PATH with no extra config needed.
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh

# Install node deps (copy package files first for layer caching)
COPY package*.json ./
RUN npm install

# Copy rest of the app
COPY . .

RUN /app/operation/yt-dlp --version

EXPOSE 3000

CMD ["node", "stream.mjs"]
