FROM matrixconduit/matrix-conduit:v0.10.14@sha256:f13263ad11be1f41cc4d89d8ee0f4ccbcc846efacf51abab2d859e073faef642 AS conduit
FROM vectorim/element-web:v1.12.29@sha256:da32e88c8dafe2c3d4f40ca5e90ab2f43a7c9ac35f0977ec7662dcb4fdcd56d8 AS element
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY .npmrc package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/client/package.json ./apps/client/
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/files/package.json ./packages/files/
COPY packages/matrix/package.json ./packages/matrix/
COPY packages/agent-core/package.json ./packages/agent-core/
COPY packages/adapter-codex/package.json ./packages/adapter-codex/
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3 --build-from-source
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.core.json ./
COPY scripts ./scripts
COPY skills ./skills
COPY docs ./docs
COPY third-party ./third-party
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80
COPY --from=conduit /nix/store /nix/store
RUN set -eu; for binary in /nix/store/*/bin/conduit; do cp "$binary" /usr/local/bin/conduit; done; test -x /usr/local/bin/conduit; rm -rf /nix/store
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/apps ./dist/apps
COPY --from=build /app/dist/packages ./dist/packages
COPY --from=build /app/dist/onboarding ./dist/onboarding
COPY --from=build /app/dist/web ./dist/web
COPY --from=build /app/package.json /app/.npmrc ./
COPY --from=element /app ./element
STOPSIGNAL SIGTERM
EXPOSE 8080
ENTRYPOINT ["node", "/app/dist/apps/server/src/container.js"]
