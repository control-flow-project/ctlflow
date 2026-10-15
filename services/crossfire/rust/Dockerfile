ARG CROSSFIRE_ASSETS_IMAGE
FROM ${CROSSFIRE_ASSETS_IMAGE} AS assets
FROM rust:1.98.1-bookworm@sha256:c49256cbe5ea0188bc658a689500d70c41eb51f009a7a7be209caf60a944f3ec AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml LICENSE ./
COPY services/crossfire/rust ./services/crossfire/rust
COPY services/fleetd/rust ./services/fleetd/rust
COPY services/fleet/rust ./services/fleet/rust
RUN cargo build --release --locked -p crossfire-server -p crossfire-adapter-process --bins
RUN cargo metadata --locked --filter-platform x86_64-unknown-linux-gnu --format-version 1 > /native-metadata.json

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS licenses
COPY --from=build /native-metadata.json /native-metadata.json
COPY --from=build /usr/local/cargo/registry/src /usr/local/cargo/registry/src
COPY scripts/rust-licenses.mjs /rust-licenses.mjs
RUN node /rust-licenses.mjs --metadata /native-metadata.json --output /licenses

FROM debian:bookworm-slim@sha256:a4672c0cb26fbdde88e38fa2dfb6c681942306680e41e4378b28770b6e79ee91 AS production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libgcc-s1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=assets /conduit /usr/local/bin/conduit
COPY --from=assets /web ./web
COPY --from=assets /onboarding ./onboarding
COPY --from=assets /element ./element
COPY --from=assets /zoneinfo ./zoneinfo
COPY --from=build /app/target/release/crossfire ./server/crossfire
COPY --from=build /app/target/release/crossfire-native-guard ./server/crossfire-native-guard
COPY LICENSE ./LICENSE
COPY --from=licenses /licenses ./third-party-licenses
ENV TZDIR=/app/zoneinfo
STOPSIGNAL SIGTERM
EXPOSE 8080 8082
ENTRYPOINT ["/app/server/crossfire", "container"]
