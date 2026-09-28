FROM matrixconduit/matrix-conduit:v0.10.14@sha256:f13263ad11be1f41cc4d89d8ee0f4ccbcc846efacf51abab2d859e073faef642 AS conduit
FROM vectorim/element-web:v1.12.29@sha256:da32e88c8dafe2c3d4f40ca5e90ab2f43a7c9ac35f0977ec7662dcb4fdcd56d8 AS element
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80

COPY --from=conduit /nix/store /nix/store
RUN set -eu; for binary in /nix/store/*/bin/conduit; do cp "$binary" /usr/local/bin/conduit; done; test -x /usr/local/bin/conduit; rm -rf /nix/store
WORKDIR /app
COPY .npmrc package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=element /app /app/web
COPY scripts/bootstrap.ts scripts/container.ts scripts/instance.ts scripts/room-service.ts scripts/lease.ts scripts/control-auth.ts scripts/onboarding.ts scripts/version.ts ./scripts/
COPY skills/conduit-chat/scripts/lib.ts skills/conduit-chat/scripts/limits.ts ./skills/conduit-chat/scripts/
ENV CROSSFIRE_DATA_DIR=/runtime CROSSFIRE_WEB_ROOT=/app/web
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/app/scripts/container.ts"]
