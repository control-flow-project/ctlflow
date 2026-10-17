FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /app
COPY .npmrc package.json package-lock.json tsconfig.base.json ./
COPY LICENSE ./LICENSE
COPY scripts ./scripts
COPY services ./services
RUN npm ci --ignore-scripts && npm run build --workspace=@ctlflow/fleet
RUN mkdir /packages && npm pack --workspace=@ctlflow/fleetd --workspace=@ctlflow/fleet --ignore-scripts --pack-destination /packages \
    && npm install --prefix /opt/ctlflow --userconfig /app/.npmrc --omit=dev --ignore-scripts /packages/*.tgz
RUN npm install --prefix /opt/native --userconfig /app/.npmrc --omit=dev --ignore-scripts \
    @openai/codex@0.162.0 @earendil-works/pi-coding-agent@1.0.0
ENV PATH=/opt/native/node_modules/.bin:$PATH
RUN node services/fleetd/docker/node/verify-native.mjs

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80
RUN apk add --no-cache bash ca-certificates curl git openssh-client ripgrep socat \
    && chmod 0700 /home/node \
    && mkdir -p /home/node/workspaces \
    && chown node:node /home/node/workspaces
COPY --from=build /opt/ctlflow /opt/ctlflow
COPY --from=build /opt/native /opt/native
COPY LICENSE /opt/ctlflow/LICENSE
COPY services/fleetd/docker/node/start-local.sh /opt/ctlflow/start-local.sh
ENV HOME=/home/node XDG_CONFIG_HOME=/home/node/.config CODEX_HOME=/home/node/.codex PI_CODING_AGENT_DIR=/home/node/.pi/agent
ENV PATH=/opt/ctlflow/node_modules/.bin:/opt/native/node_modules/.bin:$PATH
USER node
WORKDIR /home/node/workspaces
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=8s --start-period=30s --retries=3 CMD ["fleet", "daemon", "status", "--root", "/home/node/.ctlflow/controller"]
CMD ["fleetd", "--root", "/home/node/.ctlflow/controller", "--name", "local-docker"]
