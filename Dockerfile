# Stage 1: Build the application
FROM registry.access.redhat.com/hi/nodejs:22-builder@sha256:d4e7edbbe3f3eb1e0ed6c9efee00d3e11eff15a2e166f33265c48e1cd1f567b8 AS builder

USER 0
WORKDIR /pdf-gen

# Install build tools for native npm modules (node-gyp)
RUN mkdir -p bin \
 && dnf install -y python3 make gcc-c++ git unzip \
 && dnf clean all

# Install npm dependencies from lockfile — separate layer so code changes don't bust npm cache
COPY package*.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci

# Copy source after dependency install
COPY . .

# Download pinned Chrome, validate build, produce production bundle
ENV NODE_ENV=production
RUN npx @puppeteer/browsers install chrome@151.0.7922.137 --path /opt/app-root/src/.cache/puppeteer \
 && node circular.js \
 && npm run build \
 && npm prune --omit=dev

# Stage 2: Collect Chrome runtime dependencies
# UBI10 is used here because the hummingbird runtime has no package manager.
# This stage is intermediate and discarded after build.
FROM registry.access.redhat.com/ubi10/ubi:latest@sha256:a3210c44455d3de518c9ebf53f391b31f5cb5e9b7f101a130ea2d87b17b32dc0 AS chrome-deps

# Snapshot installed packages before adding Chrome deps
RUN rpm -qa --queryformat '%{NAME}\n' | sort > /pkgs-before.txt

# Install Chrome runtime dependencies
RUN dnf install -y bzip2 fontconfig pango \
  libXcomposite libXcursor libXdamage \
  libXext libXi libXtst cups-libs \
  libXrandr alsa-lib \
  atk gtk3 libdrm mesa-libgbm libxshmfence \
  nss && dnf clean all

# Collect files from newly installed + pre-installed Chrome deps into /chrome-rootfs
# glib2, dbus-libs, expat, krb5-libs, gnutls, libxml2, bzip2-libs are pre-installed
# in UBI10 but absent in hummingbird — append them so the file-copy loop includes them
RUN rpm -qa --queryformat '%{NAME}\n' | sort > /pkgs-after.txt && \
    comm -13 /pkgs-before.txt /pkgs-after.txt > /new-pkgs.txt && \
    printf '%s\n' glib2 dbus-libs expat krb5-libs gnutls libxml2 bzip2-libs \
      libffi libcom_err libidn2 keyutils-libs xz-libs libmount libblkid libuuid p11-kit libtasn1 libunistring >> /new-pkgs.txt && \
    mkdir -p /chrome-rootfs && \
    cat /new-pkgs.txt | xargs rpm -ql 2>/dev/null | while IFS= read -r f; do \
      if [ -d "$f" ] && [ ! -L "$f" ]; then \
        mkdir -p "/chrome-rootfs$f"; \
      elif [ -e "$f" ] || [ -L "$f" ]; then \
        mkdir -p "/chrome-rootfs$(dirname "$f")" && \
        cp -a "$f" "/chrome-rootfs$f" 2>/dev/null || true; \
      fi; \
    done && \
    if [ -d /chrome-rootfs/usr/sbin ]; then \
      mkdir -p /chrome-rootfs/usr/bin && \
      cp -a /chrome-rootfs/usr/sbin/. /chrome-rootfs/usr/bin/ 2>/dev/null || true && \
      rm -rf /chrome-rootfs/usr/sbin; \
    fi

# Stage 3: Runtime (hardened hummingbird image)
FROM registry.access.redhat.com/hi/nodejs:22@sha256:d905990b484db28e1d3d1ad8ff4c90bb103672bf28b57f354717e24138418363

USER 0
WORKDIR /pdf-gen

# Copy Chrome runtime dependencies (libs, fonts, configs) from chrome-deps stage
COPY --from=chrome-deps /chrome-rootfs/ /

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
