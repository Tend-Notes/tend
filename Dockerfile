# SPDX-License-Identifier: MIT WITH Commons-Clause
# Multi-stage Dockerfile for Tend
#
# Build: docker build -t tend .
# Run:   docker run -p 3000:3000 -v /path/to/tend-data:/data tend
#
# Data structure inside /data:
#   /data/config.toml         - Server configuration
#   /data/gardens.json        - Garden registry
#   /data/Gardens/Notes/      - Default garden (pages/, journals/)

# =============================================================================
# Stage 1: Build frontend
# =============================================================================
FROM node:22-alpine AS frontend-builder

WORKDIR /app

# Install pnpm. Pin the version (do NOT use pnpm@latest): pnpm 11 turns esbuild's
# blocked build script into a hard error (ERR_PNPM_IGNORED_BUILDS), and floating
# on @latest silently drifted the build across a major. Keep this in sync with
# the packageManager field and the CI pnpm/action-setup version.
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/web/package.json ./packages/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy frontend source
COPY packages/web ./packages/web

# Build frontend
WORKDIR /app/packages/web
RUN pnpm run build

# =============================================================================
# Stage 2: Build Rust backend
# =============================================================================
FROM rust:1.83-alpine AS backend-builder

# Install build dependencies
RUN apk add --no-cache musl-dev openssl-dev openssl-libs-static pkgconfig git

WORKDIR /app

# Copy Cargo files for dependency caching
COPY Cargo.toml Cargo.lock ./
COPY crates/tend-core/Cargo.toml ./crates/tend-core/
COPY crates/tend-storage/Cargo.toml ./crates/tend-storage/
COPY crates/tend-search/Cargo.toml ./crates/tend-search/
COPY crates/tend-git/Cargo.toml ./crates/tend-git/
COPY crates/tend-blocks/Cargo.toml ./crates/tend-blocks/
COPY crates/tend-links/Cargo.toml ./crates/tend-links/
COPY crates/tend-server/Cargo.toml ./crates/tend-server/

# Create dummy source files for dependency caching
RUN mkdir -p crates/tend-core/src && echo "pub fn dummy() {}" > crates/tend-core/src/lib.rs && \
    mkdir -p crates/tend-storage/src && echo "pub fn dummy() {}" > crates/tend-storage/src/lib.rs && \
    mkdir -p crates/tend-search/src && echo "pub fn dummy() {}" > crates/tend-search/src/lib.rs && \
    mkdir -p crates/tend-git/src && echo "pub fn dummy() {}" > crates/tend-git/src/lib.rs && \
    mkdir -p crates/tend-blocks/src && echo "pub fn dummy() {}" > crates/tend-blocks/src/lib.rs && \
    mkdir -p crates/tend-links/src && echo "pub fn dummy() {}" > crates/tend-links/src/lib.rs && \
    mkdir -p crates/tend-server/src && echo "fn main() {}" > crates/tend-server/src/main.rs

# Build dependencies only (cached layer)
RUN cargo build --release --locked && \
    rm -rf crates/*/src

# Copy actual source code
COPY crates ./crates

# Touch files to invalidate cache for source changes
RUN touch crates/tend-core/src/lib.rs && \
    touch crates/tend-storage/src/lib.rs && \
    touch crates/tend-search/src/lib.rs && \
    touch crates/tend-git/src/lib.rs && \
    touch crates/tend-blocks/src/lib.rs && \
    touch crates/tend-links/src/lib.rs && \
    touch crates/tend-server/src/main.rs

# Build the actual application
RUN cargo build --release --locked

# =============================================================================
# Stage 3: Runtime image
# =============================================================================
FROM alpine:3.21

# Install runtime dependencies
RUN apk add --no-cache ca-certificates git openssh-client tzdata

# Create non-root user
RUN addgroup -S tend && adduser -S tend -G tend

WORKDIR /app

# Copy built artifacts
COPY --from=backend-builder /app/target/release/tend /app/tend
COPY --from=frontend-builder /app/packages/web/dist /app/static

# Create data directory with proper structure
# /data is the TEND_BASE_DIR, gardens live under /data/Gardens/
RUN mkdir -p /data/Gardens/Notes/pages /data/Gardens/Notes/journals && \
    chown -R tend:tend /data

# Switch to non-root user
USER tend

# Environment variables
# TEND_HOST=0.0.0.0 is correct for containers: the container's network namespace
# is isolated and traffic only reaches it through published ports (-p host:container).
# HOWEVER, this means the server IS reachable on any published port. In production
# you MUST front this container with a reverse proxy (nginx, Caddy, Traefil, etc.)
# that handles TLS and auth before traffic reaches Tend.
#
# REQUIRED env vars for production deploys (effective v0.7.0):
#   TEND_AUTH_VERIFY_URL=https://<your-auth-proxy>/api/verify
#     Without this, the server refuses to start because WebSocket auth
#     would otherwise be silently bypassed.
#
# The server will also refuse to start if TEND_HOST is non-loopback AND
# TEND_AUTH_REQUIRED=false, unless TEND_DEV_ALLOW_INSECURE=true is also set.
#
# For local-only / single-user testing without a reverse proxy, set:
#   TEND_AUTH_REQUIRED=false
#   TEND_AUTH_DEFAULT_USER=<your-username>
#   TEND_DEV_ALLOW_INSECURE=true   (only when binding to a non-loopback addr)
ENV TEND_HOST=0.0.0.0
ENV TEND_PORT=3000
ENV TEND_BASE_DIR=/data
ENV TEND_STATIC_DIR=/app/static
ENV RUST_LOG=info
# Git needs ssh for remote operations
ENV GIT_SSH_COMMAND=/usr/bin/ssh

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

# Run the server
CMD ["/app/tend"]
