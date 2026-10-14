FROM matrixconduit/matrix-conduit:v0.10.14@sha256:f13263ad11be1f41cc4d89d8ee0f4ccbcc846efacf51abab2d859e073faef642 AS conduit
FROM vectorim/element-web:v1.12.29@sha256:da32e88c8dafe2c3d4f40ca5e90ab2f43a7c9ac35f0977ec7662dcb4fdcd56d8 AS element
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++ tzdata
RUN node --input-type=module -e 'import { readFileSync } from "node:fs"; if (!readFileSync("/usr/share/zoneinfo/tzdata.zi", "utf8").startsWith("# version " + process.versions.tz + "\n")) throw new Error("Install the exact IANA database matching the pinned Node release before building native assets");'
COPY .npmrc package.json package-lock.json tsconfig.base.json ./
COPY LICENSE ./LICENSE
COPY scripts ./scripts
COPY services ./services
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3 --build-from-source
RUN npm run build --workspace=@ctlflow/crossfire

FROM build AS production-dependencies
RUN npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3 --build-from-source

FROM build AS migrations
WORKDIR /app/services/crossfire
ENV NODE_ENV=production CROSSFIRE_DATA_DIR=/runtime
CMD ["node", "/app/node_modules/knex/bin/cli.js", "migrate:latest", "--knexfile", "./knexfile.management.mjs", "--env", "production"]

FROM scratch AS assets
COPY --from=conduit /nix/store/dwpji6cdspyrcfg6sxznxy37fwahmd04-conduit-static-x86_64-unknown-linux-musl-0.10.14/bin/conduit /conduit
COPY --from=build /app/services/crossfire/dist/web /web
COPY --from=build /app/services/crossfire/dist/onboarding /onboarding
COPY --from=element /app /element
COPY --from=build /usr/share/zoneinfo /zoneinfo

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS production
COPY --from=assets /conduit /usr/local/bin/conduit
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/services/crossfire ./services/crossfire
COPY --from=build /app/package.json /app/.npmrc /app/LICENSE ./
COPY --from=assets /element ./element
STOPSIGNAL SIGTERM
EXPOSE 8080
ENTRYPOINT ["node", "/app/services/crossfire/dist/apps/server/src/container.js"]
