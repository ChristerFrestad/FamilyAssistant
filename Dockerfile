# FamilyAssistant — multi-stage Dockerfile
#
# Week 7 of the ISO/IEC 25010 plan (PORT-1, PORT-7), extended 2026-05-04
# with a frontend-builder for the v2 React bundle.
#
# Build strategy:
#   Stage 1a: frontend-builder — node:20-bookworm-slim with Vite. Builds
#             client/src/ to /build/public/v2/. The bundle is gitignored
#             in the git checkout, so without this stage the image would
#             miss the v2 React app and fall back to legacy v1.
#   Stage 1b: builder (backend) — node:20-bookworm-slim with the toolchain
#             needed to compile better-sqlite3 (native C++ module).
#             Installs runtime deps, copies dist files, and pulls the v2
#             bundle from frontend-builder.
#   Stage 2:  runtime — node:20-bookworm-slim with tini + gosu for the
#             entrypoint permissions fix. Copies node_modules, server/,
#             public/ (incl. /v2/), and scripts/ from the builder.
#
# Multi-arch: built with `docker buildx build --platform linux/amd64,linux/arm64`.
# Both amd64 (x86 dev PC) and arm64 (RPi5) are supported.
#
# Build:
#   docker build -t ghcr.io/christerfrestad/familyassistant:dev .
#
# Build multi-arch (via GitHub Actions or local buildx):
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -t ghcr.io/christerfrestad/familyassistant:1.3.0 --push .
#
# Run locally:
#   docker run --rm -p 7777:7777 \
#     -e NODE_ENV=production \
#     -e AUTH_TOKEN=$(openssl rand -hex 32) \
#     -e ALLOWED_ORIGINS=http://localhost:7777 \
#     -v $(pwd)/data:/app/data \
#     ghcr.io/christerfrestad/familyassistant:dev

# ============================================================================
# Stage 1a: Frontend builder — Vite-bygget v2 React-bundle
# ============================================================================
# Bygger `client/src/` (TypeScript + React) til `/build/public/v2/`. Output-
# folderen er .gitignored i kilden — bundlen er midlertidig per build, ikke
# noe som skal committes. Backend-builderen under (Stage 1b) plukker den opp
# via COPY --from=frontend-builder.
#
# Stagen bruker full `npm ci` (ikke --omit=dev) fordi Vite, @vitejs/plugin-
# react, tailwindcss og resten av build-toolchain bor i devDependencies. De
# følger ikke med til runtime-imaget — det er kun stage 1b som ender opp i
# stage 2.
#
# Cache-strategi: separat stage betyr at frontend-stagen kun rebuilds når
# package-lock.json eller client/** endres. Endringer kun i server/ gjør
# at denne stagen treffer Docker layer-cache og hopper rett til neste.
FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /build

# Kopier package-filer først for layer-caching
COPY package.json package-lock.json ./

# Full install inkl. devDependencies (Vite + plugins). --ignore-scripts er
# unødvendig her fordi vi ikke trenger better-sqlite3 native-build i denne
# stagen — kun JS-bundling.
RUN npm ci --no-audit --no-fund --ignore-scripts

# Kopier client-kildekode + public (vite trenger public/ for index.html
# template og statiske assets som peker fra index.html).
COPY client ./client
COPY public ./public

# Bygg v2-bundle. Output havner i /build/public/v2/ (jf. vite.config.ts:
# `outDir: path.resolve(__dirname, '..', 'public', 'v2')`).
RUN npm run build:client

# ============================================================================
# Stage 1b: Backend builder
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

# Plukk opp v2-bundle bygget i stage 1a. Skriver over public/v2/ (som ikke
# eksisterer i git-checkout fordi den er .gitignored). Etter dette steget
# har /build/public/ alle statiske filer — både legacy v1 og bygget v2.
COPY --from=frontend-builder /build/public/v2 ./public/v2

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

# Runtime defaults for Portainer / RPi zero-config deploy.
# Secrets (AUTH_TOKEN, SESSION_SECRET) are auto-created on first boot into
# /app/data/bootstrap.json — operators do not set them in Portainer.
ENV NODE_ENV=production
ENV PORT=7777
ENV DB_PATH=/app/data/familieassistenten.db
ENV BACKUP_DIR=/app/data/backups
ENV LOG_LEVEL=info
ENV BOOTSTRAP_ALLOWED=true
ENV MAGIC_LINK_CONSOLE=false
ENV PILOT_BYPASS=false
ENV PILOT_MODE=false
ENV HTTPS_TERMINATED=true
ENV TRUST_PROXY=true
ENV ALLOWED_ORIGINS="*"

# Smoke-test production config load inside the image so a bad gate can never
# ship. Uses a throwaway data dir (not the volume mount).
RUN mkdir -p /tmp/fa-cfg-smoke \
  && DB_PATH=/tmp/fa-cfg-smoke/t.db \
     BOOTSTRAP_FILE=/tmp/fa-cfg-smoke/bootstrap.json \
     NODE_ENV=production \
     BOOTSTRAP_ALLOWED=true \
     PILOT_BYPASS=false \
     MAGIC_LINK_CONSOLE=false \
     node -e "const {config}=require('./server/config'); if(!config.AUTH_TOKEN||config.AUTH_TOKEN.length<16) process.exit(2); if(!config.SESSION_SECRET||config.SESSION_SECRET.length<32) process.exit(3); if(config.PILOT_BYPASS) process.exit(4); console.log('config-smoke-ok port='+config.PORT);" \
  && rm -rf /tmp/fa-cfg-smoke

# Healthcheck via node-internal fetch — no wget/curl needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD ["node", "-e", "fetch('http://localhost:7777/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"]

# tini (PID 1) → entrypoint script (root, fixes perms, gosu-drops) → CMD
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
