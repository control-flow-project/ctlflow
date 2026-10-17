ARG CROSSFIRE_ASSETS_IMAGE
FROM ${CROSSFIRE_ASSETS_IMAGE} AS assets
FROM mcr.microsoft.com/dotnet/sdk:11.0.100-rc.1@sha256:207b30ec860b1c4edef3bfe33dd7af8d38726533cf5a77cb782006451281872e AS build
WORKDIR /app
ENV DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_GENERATE_ASPNET_CERTIFICATE=false
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ zlib1g-dev && rm -rf /var/lib/apt/lists/*
COPY global.json Directory.Build.props Directory.Build.targets Directory.Packages.props Ctlflow.CSharp.slnx ./
COPY services/crossfire/csharp ./services/crossfire/csharp
RUN dotnet publish services/crossfire/csharp/apps/Crossfire.Server -c Release -r linux-x64 -p:PublishAot=true -p:CppCompilerAndLinker=gcc -o /native
RUN dotnet publish services/crossfire/csharp/apps/Crossfire.Server -c Release -p:PublishAot=false --self-contained false -o /managed

FROM mcr.microsoft.com/dotnet/aspnet:11.0.0-rc.1@sha256:dc8eceaff799d9ec4ac787d10925a1d0f69f85161cb8022e1d87a425e868cffe AS managed
COPY --from=assets /conduit /usr/local/bin/conduit
WORKDIR /app
COPY --from=assets /web ./web
COPY --from=assets /onboarding ./onboarding
COPY --from=assets /element ./element
COPY --from=assets /zoneinfo ./zoneinfo
ENV TZDIR=/app/zoneinfo
COPY --from=build /managed ./server
COPY LICENSE ./LICENSE
USER 0
STOPSIGNAL SIGTERM
EXPOSE 8080 8082
HEALTHCHECK --interval=30s --timeout=8s --start-period=90s --retries=3 CMD ["dotnet", "/app/server/Crossfire.Server.dll", "health"]
ENTRYPOINT ["dotnet", "/app/server/Crossfire.Server.dll", "container"]

FROM mcr.microsoft.com/dotnet/runtime-deps:11.0.0-rc.1@sha256:943986fbc5af53235bcbf5ffbeed418e921933dc1d6d3755cfb683bb2e3e8acc AS nativeaot
COPY --from=assets /conduit /usr/local/bin/conduit
WORKDIR /app
COPY --from=assets /web ./web
COPY --from=assets /onboarding ./onboarding
COPY --from=assets /element ./element
COPY --from=assets /zoneinfo ./zoneinfo
ENV TZDIR=/app/zoneinfo
COPY --from=build /native ./server
COPY LICENSE ./LICENSE
USER 0
STOPSIGNAL SIGTERM
EXPOSE 8080 8082
HEALTHCHECK --interval=30s --timeout=8s --start-period=90s --retries=3 CMD ["/app/server/Crossfire.Server", "health"]
ENTRYPOINT ["/app/server/Crossfire.Server", "container"]
