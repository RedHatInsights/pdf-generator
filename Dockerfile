FROM registry.access.redhat.com/ubi8/ubi-minimal

USER 0

WORKDIR /pdf-gen
ADD . /pdf-gen
RUN mkdir -p /pdf-gen/bin

RUN microdnf install -y git make tar
RUN curl -L https://git.io/n-install --output n-install
RUN chmod +x n-install && yes y | ./n-install
RUN $HOME/n/bin/n 18

# RUN npm install using package-lock.json
RUN npm ci
# Install the chromium locally if necessary.
RUN node node_modules/puppeteer/install.js
RUN chmod -R o+rwx node_modules/puppeteer/.local-chromium

# Check for circular dependencies
RUN node circular.js

# install puppeteer/chromium dependencies
RUN microdnf install -y bzip2 fontconfig pango.x86_64 libXcomposite.x86_64 libXcursor.x86_64 libXdamage.x86_64 libXext.x86_64 libXi.x86_64 libXtst.x86_64 cups-libs.x86_64 libXScrnSaver.x86_64 libXrandr.x86_64 alsa-lib.x86_64 atk.x86_64 gtk3.x86_64 libdrm libgbm libxshmfence libXScrnSaver alsa-lib wget nss.x86_64 nss GConf2 GConf2.x86_64
RUN wget -O /pdf-gen/bin/dumb-init https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_x86_64
RUN chmod +x /pdf-gen/bin/dumb-init

# Set node env variable
ENV NODE_ENV=production

RUN npm run build

EXPOSE 8000
ENTRYPOINT [ "/pdf-gen/bin/dumb-init", "--" ]
CMD ["node", "./dist/server.js"]
