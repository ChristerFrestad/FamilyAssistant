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
#   docker run --rm -p 3000:3000 \
#     -e NODE_ENV=production \
#     -e AUTH_TOKEN=$(openssl rand -hex 32) \
#     -e ALLOWED_ORIGINS=http://localhost:3000 \
#     -v $(pwd)/data:/app/data \
#     ghcr.io/christerfrestad/familieassistant:dev

# ============================================================================
# Stage 1: Builder
# ============================================================================
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
# Stage 2: Runtime (distroless)
# ============================================================================
FROM gcr.io/distroless/nodejs20-debian12 AS runtime

# Labels for OCI image metadata
LABEL org.opencontainers.image.title="Familieassistenten"
LABEL org.opencontainers.image.description="Selvhostet husholdningsassistent — kjører lokalt på Raspberry Pi 5"
LABEL org.opencontainers.image.authors="Christer Frestad"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/ChristerFrestad/FamilyAssistant"

WORKDIR /app

# Kopier node_modules og app fra builder (--chown sikrer nonroot eierskap)
COPY --from=builder --chown=nonroot:nonroot /build/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /build/server ./server
COPY --from=builder --chown=nonroot:nonroot /build/public ./public
COPY --from=builder --chown=nonroot:nonroot /build/scripts ./scripts
COPY --from=builder --chown=nonroot:nonroot /build/package.json ./package.json

# Data-volum for SQLite-DB og backups. Mountes som named volume
# eller bind mount til host /home/pi/Familieassistenten/data.
VOLUME ["/app/data"]

# Non-root user (distroless bundler UID 65532 'nonroot')
USER nonroot:nonroot

# HTTP-port — overstyres av PORT env-var om nødvendig
EXPOSE 3000

# Default-miljø. AUTH_TOKEN og ALLOWED_ORIGINS må overstyres ved kjøretid.
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/familieassistenten.db
ENV BACKUP_DIR=/app/data/backups
ENV LOG_LEVEL=info

# Uke 7 PORT-7: healthcheck via node-intern (distroless har ikke wget/curl).
# Node sjekker /health og exit 0/1 basert på status 200.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"]

# Entry point
ENTRYPOINT ["/nodejs/bin/node", "server/index.js"]
