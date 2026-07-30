# Stage 1: Build
FROM registry.access.redhat.com/ubi9/nodejs-22:9.8-1780375952@sha256:fa57578b663265db4360118e6aedb7f150b8162b81ef567e0a66b14b80ee3329 AS builder

USER 0
WORKDIR /pdf-gen
COPY . .
RUN mkdir -p bin

# Install build tools for native npm modules (node-gyp)
RUN dnf install -y python3 make gcc-c++ git && dnf clean all

# Install npm dependencies from lockfile (skip default Chrome download)
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci

# Download Chrome 149.0.7827.53 for PDF generation (patches CVEs in bundled 149.0.7827.22)
RUN npx @puppeteer/browsers install chrome@149.0.7827.103 --path /opt/app-root/src/.cache/puppeteer

# Check for circular dependencies
RUN node circular.js

# Build the application
ENV NODE_ENV=production
RUN npm run build

# Stage 2: Runtime
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal:9.8-1779828907@sha256:75a2c4753c2475d715e31304ec1effef61770713e6e9fdafdcb80351dbdf3ba5

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
COPY --chown=1001:0 --from=builder /pdf-gen/dist ./dist
COPY --chown=1001:0 --from=builder /pdf-gen/node_modules ./node_modules
COPY --chown=1001:0 --from=builder /pdf-gen/package.json ./package.json
COPY --chown=1001:0 --from=builder /pdf-gen/public ./public
COPY --chown=1001:0 --from=builder /pdf-gen/docs/openapi.json ./docs/openapi.json

# Copy Chrome binary
COPY --chown=1001:0 --from=builder /opt/app-root/src/.cache/puppeteer /opt/app-root/src/.cache/puppeteer

ENV HOME=/opt/app-root/src
ENV XDG_CONFIG_HOME="/tmp/.chromium"
ENV XDG_CACHE_HOME="/tmp/.chromium"
ENV NODE_ENV=production
ENV DEBUG=puppeteer-cluster:*

# Drop back to non-root user for runtime (OpenShift restricted-SCC compatible)
RUN chown -R 1001:0 /pdf-gen && chmod -R g=u /pdf-gen
USER 1001

EXPOSE 8000
CMD ["node", "./dist/server.js"]
