# Stage 1: Build
FROM registry.access.redhat.com/ubi10/nodejs-22:10.2-1785789721@sha256:f1c63a4a81316b97edb34f61340eb59229b72681bb2040a33296947b9676dc55 AS builder

USER 0
WORKDIR /pdf-gen

# Install build tools for native npm modules (node-gyp)
RUN mkdir -p bin \
 && dnf install -y python3 make gcc-c++ git \
 && dnf clean all

# Install npm dependencies from lockfile — separate layer so code changes don't bust npm cache
COPY package*.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci

# Copy source after dependency install
COPY . .

# Download pinned Chrome, validate build, produce production bundle
ENV NODE_ENV=production
RUN npx @puppeteer/browsers install chrome@151.0.7922.72 --path /opt/app-root/src/.cache/puppeteer \
 && node circular.js \
 && npm run build \
 && npm prune --omit=dev

# Stage 2: Runtime
FROM registry.access.redhat.com/ubi10/nodejs-22-minimal:10.2-1785373147@sha256:a8b67d7c6a96e0aa229ba0e3b84045db98ce640291da088874dc5d67352132d2

USER 0
WORKDIR /pdf-gen

# Install Chrome runtime dependencies and strip base-image npm/nodemon
# (not needed at runtime; their vulnerable transitive deps trigger grype)
RUN microdnf install -y bzip2 fontconfig pango \
  libXcomposite libXcursor libXdamage \
  libXext libXi libXtst cups-libs \
  libXrandr alsa-lib \
  atk gtk3 libdrm mesa-libgbm libxshmfence \
  nss && microdnf clean all \
 && rm -rf /usr/lib/node_modules /usr/bin/npm /usr/bin/npx /usr/bin/nodemon

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
