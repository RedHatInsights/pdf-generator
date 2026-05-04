# Stage 1: Build
FROM registry.access.redhat.com/ubi9/nodejs-22:9.7-1777855484@sha256:52bd0ad7c4f167c6d7104dc19540b445566c3af556f6e92bfde76938f30a8e20 AS builder

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
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal:9.7-1777883927@sha256:36278561543e51f9a798a7f68aa1e978205052b19837173b3ee81861a5d898df

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
