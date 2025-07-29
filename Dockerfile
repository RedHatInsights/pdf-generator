FROM registry.access.redhat.com/ubi9/ubi-minimal:9.6-1753762263

USER 0

WORKDIR /pdf-gen
ADD . /pdf-gen
RUN mkdir -p /pdf-gen/bin

RUN microdnf install -y git make tar
RUN curl -L https://git.io/n-install --output n-install
RUN chmod +x n-install && yes y | ./n-install
RUN $HOME/n/bin/n 20

ENV XDG_CONFIG_HOME="/tmp/.chromium"
ENV XDG_CACHE_HOME="/tmp/.chromium"
# needed for node-gyp https://github.com/nodejs/node-gyp?tab=readme-ov-file#installation
RUN microdnf install -y python3 make gcc-c++


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
  wget nss

# Set node env variable
ENV NODE_ENV=production
ENV DEBUG=puppeteer-cluster:*

RUN npm run build

EXPOSE 8000
CMD ["node", "./dist/server.js"]
