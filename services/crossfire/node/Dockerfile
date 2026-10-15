FROM matrixconduit/matrix-conduit:v0.10.14@sha256:f13263ad11be1f41cc4d89d8ee0f4ccbcc846efacf51abab2d859e073faef642 AS conduit
FROM vectorim/element-web:v1.12.29@sha256:da32e88c8dafe2c3d4f40ca5e90ab2f43a7c9ac35f0977ec7662dcb4fdcd56d8 AS element
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++ tzdata-utils
COPY services/crossfire/timezones.json /tmp/timezones.json
RUN wget -O /tmp/tzdata.tar.gz "$(node -p 'require("/tmp/timezones.json").url')" \
    && echo "$(node -p 'require("/tmp/timezones.json").sha256')  /tmp/tzdata.tar.gz" | sha256sum -c - \
    && mkdir /tmp/tzdata /zoneinfo \
    && tar -xzf /tmp/tzdata.tar.gz -C /tmp/tzdata \
    && test "$(cat /tmp/tzdata/version)" = "$(node -p process.versions.tz)" \
    && zic -d /zoneinfo /tmp/tzdata/africa /tmp/tzdata/antarctica /tmp/tzdata/asia /tmp/tzdata/australasia /tmp/tzdata/europe /tmp/tzdata/northamerica /tmp/tzdata/southamerica /tmp/tzdata/etcetera /tmp/tzdata/factory /tmp/tzdata/backward \
    && test -f /zoneinfo/Asia/Calcutta \
    && cp /tmp/tzdata/LICENSE /zoneinfo/LICENSE \
    && cp /tmp/tzdata/version /zoneinfo/version \
    && rm -rf /tmp/tzdata /tmp/tzdata.tar.gz
COPY .npmrc package.json package-lock.json tsconfig.base.json ./
COPY LICENSE ./LICENSE
COPY scripts ./scripts
COPY services ./services
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3 --build-from-source
RUN npm run build --workspace=@ctlflow/crossfire

FROM build AS production-dependencies
RUN npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3 --build-from-source
RUN node scripts/stage-node-runtime.mjs /runtime-app

FROM build AS migrations
WORKDIR /app/services/crossfire
ENV NODE_ENV=production CROSSFIRE_DATA_DIR=/runtime
CMD ["node", "/app/node_modules/knex/bin/cli.js", "migrate:latest", "--knexfile", "./knexfile.management.mjs", "--env", "production"]

FROM scratch AS assets
COPY --from=conduit /nix/store/dwpji6cdspyrcfg6sxznxy37fwahmd04-conduit-static-x86_64-unknown-linux-musl-0.10.14/bin/conduit /conduit
COPY --from=build /app/services/crossfire/dist/web /web
COPY --from=build /app/services/crossfire/dist/onboarding /onboarding
COPY --from=element /app /element
COPY --from=build /zoneinfo /zoneinfo

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS production
COPY --from=assets /conduit /usr/local/bin/conduit
WORKDIR /app
COPY --from=production-dependencies /runtime-app ./
COPY --from=assets /element ./element
STOPSIGNAL SIGTERM
EXPOSE 8080 8082
ENTRYPOINT ["node", "/app/services/crossfire/dist/apps/server/src/container.js"]
