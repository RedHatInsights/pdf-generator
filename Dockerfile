FROM registry.access.redhat.com/ubi8/ubi-minimal:8.10-1154 

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
RUN microdnf install -y bzip2 fontconfig pango.x86_64 \
  libXcomposite.x86_64 libXcursor.x86_64 libXdamage.x86_64 \
  libXext.x86_64 libXi.x86_64 libXtst.x86_64 cups-libs.x86_64 \
  libXScrnSaver.x86_64 libXrandr.x86_64 alsa-lib.x86_64 \
  atk.x86_64 gtk3.x86_64 libdrm libgbm libxshmfence libXScrnSaver alsa-lib \
  wget nss.x86_64 nss GConf2 GConf2.x86_64


# Set node env variable
ENV NODE_ENV=production
ENV DEBUG=puppeteer-cluster:*

RUN npm run build

EXPOSE 8000
CMD ["node", "./dist/server.js"]
