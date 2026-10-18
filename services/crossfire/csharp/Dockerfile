ARG CROSSFIRE_ASSETS_IMAGE
FROM ${CROSSFIRE_ASSETS_IMAGE} AS assets
FROM mcr.microsoft.com/dotnet/sdk:11.0.100-rc.2@sha256:bfabf51e74c5a7cf2fc4eac852145db86f4867d475257d809518d6a2b0fe71e1 AS build
WORKDIR /app
ENV DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_GENERATE_ASPNET_CERTIFICATE=false
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ zlib1g-dev && rm -rf /var/lib/apt/lists/*
COPY global.json Directory.Build.props Directory.Build.targets Directory.Packages.props Ctlflow.CSharp.slnx ./
COPY services/crossfire/csharp ./services/crossfire/csharp
RUN dotnet publish services/crossfire/csharp/apps/Crossfire.Server -c Release -r linux-x64 -p:PublishAot=true -p:CppCompilerAndLinker=gcc -o /native
RUN dotnet publish services/crossfire/csharp/apps/Crossfire.Server -c Release -p:PublishAot=false --self-contained false -o /managed

FROM mcr.microsoft.com/dotnet/aspnet:11.0.0-rc.2@sha256:623c52ed3fad0fa423b8cc860910492364b0d6245870a415e997017d4a4f4513 AS managed
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

FROM mcr.microsoft.com/dotnet/runtime-deps:11.0.0-rc.2@sha256:fccbc81aefc5cb3f40373a99844b0950d71eabd49225ce4442a5fcf11917acee AS nativeaot
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
