# Stage 1: Build
FROM registry.access.redhat.com/ubi10/nodejs-22:10.2-1788329676@sha256:b0c5f09854f6d56eb8651290723f0a9cc088c00ce52d3597ad52eced0e50cda5 AS builder

USER 0
WORKDIR /pdf-gen

# Install build tools for native npm modules (node-gyp).
# Skipped in hermetic mode: --ignore-scripts uses prebuilt binaries instead.
RUN if [ ! -f /cachi2/cachi2.env ]; then \
      mkdir -p bin \
      && dnf install -y python3 make gcc-c++ git \
      && dnf clean all; \
    fi

# Install npm dependencies from lockfile — separate layer so code changes don't bust npm cache
COPY package*.json ./
RUN if [ -f /cachi2/cachi2.env ]; then \
      . /cachi2/cachi2.env \
      && PUPPETEER_SKIP_DOWNLOAD=true npm ci --ignore-scripts --offline --no-audit --no-fund; \
    else \
      PUPPETEER_SKIP_DOWNLOAD=true npm ci; \
    fi

# Copy source after dependency install
COPY . .

# Download pinned Chrome, validate build, produce production bundle
ENV NODE_ENV=production
RUN if [ -d /cachi2/output/deps/generic ]; then \
      # Hermetic mode: extract Chrome from prefetched generic artifact using yauzl
      mkdir -p /opt/app-root/src/.cache/puppeteer/chrome/linux-153.0.8010.47 \
      && node --input-type=module -e " \
           import {unpackArchive} from '@puppeteer/browsers/lib/fileUtil.js'; \
           await unpackArchive('/cachi2/output/deps/generic/chrome-linux64.zip', \
             '/opt/app-root/src/.cache/puppeteer/chrome/linux-153.0.8010.47'); \
         " \
      && echo 'Chrome extracted from prefetched archive'; \
    else \
      npx @puppeteer/browsers install chrome@153.0.8010.47 --path /opt/app-root/src/.cache/puppeteer; \
    fi \
 && node circular.js \
 && npm run build \
 && npm prune --omit=dev

# Stage 2: Runtime
FROM registry.access.redhat.com/ubi10/nodejs-22-minimal:10.2-1788245048@sha256:dd2ef4164a4d155a002c431d185847bfe2c508d34afb1384c56be023bae3037e

USER 0
WORKDIR /pdf-gen

# Install Chrome runtime dependencies and strip base-image npm/nodemon.
# (not needed at runtime; their vulnerable transitive deps trigger grype)
# In hermetic mode, RPM repos are injected by cachi2 — microdnf resolves locally.
RUN if [ ! -f /cachi2/cachi2.env ]; then microdnf update -y; fi \
 && microdnf install -y bzip2 fontconfig pango \
  libXcomposite libXcursor libXdamage \
  libXext libXi libXtst cups-libs \
  libXrandr alsa-lib \
  atk gtk3 libdrm mesa-libgbm libxshmfence \
  nss && microdnf clean all \
 && rm -rf /usr/lib/node_modules /usr/lib/node_modules_22 /usr/bin/npm /usr/bin/npx /usr/bin/nodemon

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

# Drop to non-root user for runtime (OpenShift restricted-SCC compatible)
RUN chown -R 1001:0 /pdf-gen && chmod -R g=u /pdf-gen && \
    chmod -R g=u /opt/app-root/src/.cache/puppeteer
USER 1001

EXPOSE 8000
CMD ["node", "./dist/server.js"]
