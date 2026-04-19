# Familieassistenten — multi-stage Dockerfile
#
# Uke 7 av ISO/IEC 25010-planen (PORT-1, PORT-7).
#
# Build-strategi:
#   Stage 1: builder — node:20-bookworm-slim med toolchain for å
#            kompilere better-sqlite3 (native C++ modul). Installer
#            runtime-deps og kopier dist-filer.
#   Stage 2: runtime — gcr.io/distroless/nodejs20-debian12 med kun
#            Node-binær + app. Ingen shell, ingen apt, minimal
#            attack surface. Distroless bilder er ~25-50 MB mindre
#            enn alpine runtime-images og håndterer glibc korrekt
#            for native modules.
#
# Multiarch: bygges med `docker buildx build --platform linux/amd64,linux/arm64`.
# Både amd64 (x86 dev-PC) og arm64 (RPi5) er støttet.
#
# Build:
#   docker build -t ghcr.io/christerfrestad/familieassistant:dev .
#
# Build multiarch (via GitHub Actions eller lokal buildx):
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -t ghcr.io/christerfrestad/familieassistant:1.3.0 --push .
#
# Run lokalt:
#   docker run --rm -p 7777:7777 \
#     -e NODE_ENV=production \
#     -e AUTH_TOKEN=$(openssl rand -hex 32) \
#     -e ALLOWED_ORIGINS=http://localhost:7777 \
#     -v $(pwd)/data:/app/data \
#     ghcr.io/christerfrestad/familieassistant:dev

# ============================================================================
# Stage 1: Builder
# ============================================================================
# TODO: Pin til spesifikk SHA256 digest for reproducerbare builds:
#   FROM node:20-bookworm-slim@sha256:<hash> AS builder
# Oppdater digest ved Node.js-oppdateringer.
FROM node:20-bookworm-slim AS builder

# Installer minimum build-toolchain for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy package files first for layer-caching
COPY package.json package-lock.json ./

# Production-install. --ignore-scripts first to avoid prepare/postinstall
# noise, then eksplisitt rebuild better-sqlite3 for target arch.
RUN npm ci --omit=dev --no-audit --no-fund

# Kopier kildekode (public/, server/, scripts/load-baseline.js, migrations/)
COPY server ./server
COPY public ./public
COPY scripts/load-baseline.js ./scripts/load-baseline.js

# Valider at appen kan starte med NODE_ENV=test + dry-initialize
# (fanger evt. require-order-feil tidlig)
RUN NODE_ENV=test node -e "require('./server/config')"

# ============================================================================
# Stage 2: Runtime (node:20-bookworm-slim)
# ============================================================================
# Runtime uses slim instead of distroless so the entrypoint script can chown
# /app/data at startup. Portainer-managed Docker volumes (and bind-mounts to
# root-owned host paths) start out as root:root; a non-root process cannot
# mkdir inside them, which caused EACCES on /app/data/backups. tini handles
# PID 1 signals; gosu drops from root to the node user before running node.
FROM node:20-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini gosu ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Labels for OCI image metadata
LABEL org.opencontainers.image.title="FamilyAssistant"
LABEL org.opencontainers.image.description="Self-hosted household assistant — runs locally on Raspberry Pi 5"
LABEL org.opencontainers.image.authors="Christer Frestad"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/ChristerFrestad/FamilyAssistant"

WORKDIR /app

# App files owned by the node user (UID/GID 1000, baked into node:20-slim).
COPY --from=builder --chown=node:node /build/node_modules ./node_modules
COPY --from=builder --chown=node:node /build/server ./server
COPY --from=builder --chown=node:node /build/public ./public
COPY --from=builder --chown=node:node /build/scripts ./scripts
COPY --from=builder --chown=node:node /build/package.json ./package.json

# Entrypoint script runs as root briefly to fix volume ownership, then
# drops to the node user via gosu. Must be root-owned to prevent tampering.
COPY --chown=root:root docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod 0755 /app/docker-entrypoint.sh

# Data volume for SQLite DB and backups. Named volumes and bind-mounts
# that appear as root-owned will be chowned to node by the entrypoint.
VOLUME ["/app/data"]

# HTTP port — override via PORT env var if needed. 7777 is the default
# because 3000 is commonly occupied by Grafana and other self-hosted apps.
EXPOSE 7777

# Default environment. AUTH_TOKEN and ALLOWED_ORIGINS must be set at runtime.
ENV NODE_ENV=production
ENV PORT=7777
ENV DB_PATH=/app/data/familieassistenten.db
ENV BACKUP_DIR=/app/data/backups
ENV LOG_LEVEL=info

# Healthcheck via node-internal fetch — no wget/curl needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:7777/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"]

# tini (PID 1) → entrypoint script (root, fixes perms, gosu-drops) → CMD
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
