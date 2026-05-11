# Paseo daemon — multi-stage production build
# Usage:
#   docker build -t paseo .
#   docker compose -f docker-compose.prod.yml up

# ── Stage 1: Build ──────────────────────────────────────────
FROM node:22-slim AS build

# node-pty requires python3 + make + g++ for node-gyp
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps (full, including devDependencies for build)
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/highlight/package.json packages/highlight/
COPY packages/relay/package.json packages/relay/
COPY packages/cli/package.json packages/cli/
COPY packages/expo-two-way-audio/package.json packages/expo-two-way-audio/
COPY packages/app/package.json packages/app/
COPY packages/website/package.json packages/website/
COPY packages/desktop/package.json packages/desktop/

RUN npm ci --ignore-scripts && \
    npm rebuild node-pty

# Copy source and build server
COPY packages/server/ packages/server/
COPY packages/highlight/ packages/highlight/
COPY packages/relay/ packages/relay/
COPY packages/cli/ packages/cli/
COPY tsconfig.base.json ./

RUN npm run build --workspace=@bas-more/server

# ── Stage 2: Production ────────────────────────────────────
FROM node:22-slim AS production

# node-pty native addon needs libstdc++ at runtime (already in slim)
# curl for healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files for production install
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/highlight/package.json packages/highlight/
COPY packages/relay/package.json packages/relay/
COPY packages/cli/package.json packages/cli/
COPY packages/expo-two-way-audio/package.json packages/expo-two-way-audio/
COPY packages/app/package.json packages/app/
COPY packages/website/package.json packages/website/
COPY packages/desktop/package.json packages/desktop/

# Install production deps only — node-pty needs rebuild
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    npm ci --omit=dev --ignore-scripts && \
    npm rebuild node-pty && \
    apt-get purge -y python3 make g++ && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Copy built server from build stage
COPY --from=build /app/packages/server/dist packages/server/dist

# Create paseo home directory
RUN mkdir -p /data/paseo && chown node:node /data/paseo

ENV NODE_ENV=production
ENV PASEO_HOME=/data/paseo
ENV PASEO_LISTEN=0.0.0.0:6767
ENV PASEO_LOG_FORMAT=json

EXPOSE 6767

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:6767/api/health || exit 1

CMD ["node", "packages/server/dist/scripts/supervisor-entrypoint.js"]
