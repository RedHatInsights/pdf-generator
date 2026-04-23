# Stage 1: Build
FROM registry.access.redhat.com/ubi9/nodejs-22:9.7-1776920122@sha256:d4a687c72950936d298c98d37bd1be962449af336ebd6c8aa00b94971e6894c0 AS builder

USER 0
WORKDIR /pdf-gen
COPY . .
RUN mkdir -p bin

# Install build tools for native npm modules (node-gyp)
RUN dnf install -y python3 make gcc-c++ git && dnf clean all

# Install npm dependencies from lockfile
RUN npm ci

# Download Chrome for PDF generation
RUN node node_modules/puppeteer/install.mjs

# Check for circular dependencies
RUN node circular.js

# Build the application
ENV NODE_ENV=production
RUN npm run build

# Stage 2: Runtime
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal:9.7-1776863671@sha256:670c207e6872898228015fa8ec2e4165cfa13089a9e5fccb4f9c6d6cda2811ba

USER 0
WORKDIR /pdf-gen

# Install Chrome runtime dependencies
RUN microdnf install -y bzip2 fontconfig pango \
  libXcomposite libXcursor libXdamage \
  libXext libXi libXtst cups-libs \
  libXScrnSaver libXrandr alsa-lib \
  atk gtk3 libdrm libgbm libxshmfence \
  nss && microdnf clean all

# Copy application artifacts from builder
COPY --from=builder /pdf-gen/dist ./dist
COPY --from=builder /pdf-gen/node_modules ./node_modules
COPY --from=builder /pdf-gen/package.json ./package.json
COPY --from=builder /pdf-gen/public ./public
COPY --from=builder /pdf-gen/docs/openapi.json ./docs/openapi.json

# Copy Chrome binary
COPY --from=builder /opt/app-root/src/.cache/puppeteer /opt/app-root/src/.cache/puppeteer

ENV HOME=/opt/app-root/src
ENV XDG_CONFIG_HOME="/tmp/.chromium"
ENV XDG_CACHE_HOME="/tmp/.chromium"
ENV NODE_ENV=production
ENV DEBUG=puppeteer-cluster:*

EXPOSE 8000
CMD ["node", "./dist/server.js"]
