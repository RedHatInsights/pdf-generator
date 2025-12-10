FROM registry.access.redhat.com/ubi9/ubi-minimal:9.7-1762956380

USER 0

WORKDIR /pdf-gen
ADD . /pdf-gen
RUN mkdir -p /pdf-gen/bin

RUN microdnf module enable -y nodejs:22 && \
    microdnf install -y nodejs npm --nodocs

ENV HOME=/tmp

ENV PUPPETEER_SKIP_DOWNLOAD=true
# RUN npm install using package-lock.json
RUN npm ci
# Install the chromium locally if necessary.
RUN node node_modules/puppeteer/install.mjs

# Check for circular dependencies
RUN node circular.js

# install puppeteer/chromium dependencies
RUN microdnf install -y bzip2 fontconfig pango \
  libXcomposite libXcursor libXdamage \
  libXext libXi libXtst cups-libs \
  libXScrnSaver libXrandr alsa-lib \
  atk gtk3 libdrm libgbm libxshmfence \
  wget nss firefox

# Set node env variable
ENV NODE_ENV=production
ENV DEBUG=puppeteer-cluster:*

RUN npm run build

EXPOSE 8000
CMD ["node", "./dist/server.js"]
