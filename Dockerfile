# Paseo daemon — multi-stage production build
# Usage:
#   docker build -t paseo .
#   docker compose -f docker-compose.prod.yml up

# ── Stage 1: Build ──────────────────────────────────────────
# Pin to digest for reproducible builds. Update via:
#   docker pull node:22-slim && docker inspect --format='{{index .RepoDigests 0}}' node:22-slim
FROM node:22-slim@sha256:868499d55378719bffa87b0ed1f099591823c029b543043c09c2483468e93201 AS build

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

# The server imports from @bas-more/relay and @bas-more/highlight at runtime.
# Building only @bas-more/server leaves their dist/ empty, so the daemon
# crashes with ERR_MODULE_NOT_FOUND. The root build:daemon script builds the
# dependency chain in order (highlight → relay → server → cli).
RUN npm run build:daemon

# ── Stage 2: Production ────────────────────────────────────
# Pin to digest for reproducible builds. Update via:
#   docker pull node:22-slim && docker inspect --format='{{index .RepoDigests 0}}' node:22-slim
FROM node:22-slim@sha256:868499d55378719bffa87b0ed1f099591823c029b543043c09c2483468e93201 AS production

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

# Copy built server + workspace deps it imports at runtime
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/relay/dist packages/relay/dist
COPY --from=build /app/packages/highlight/dist packages/highlight/dist

# Create paseo home directory
RUN mkdir -p /data/paseo && chown node:node /data/paseo

ENV NODE_ENV=production
ENV PASEO_HOME=/data/paseo
ENV PASEO_LISTEN=0.0.0.0:6767
ENV PASEO_LOG_FORMAT=json

EXPOSE 6767

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:6767/health/live || exit 1

CMD ["node", "packages/server/dist/scripts/supervisor-entrypoint.js"]
