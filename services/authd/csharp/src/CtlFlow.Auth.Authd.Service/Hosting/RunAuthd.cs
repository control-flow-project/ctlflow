using CtlFlow.Auth.Authd.Service.Admission;
using CtlFlow.Auth.Authd.Service.Configuration;
using CtlFlow.Auth.Authd.Service.State;
using CtlFlow.Auth.Authd.Service.Telemetry;
using CtlFlow.Identity.V1;
using CtlFlow.Tenancy.V1;
using Grpc.Net.Client;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using static CtlFlow.Auth.Authd.Service.Configuration.AuthdConfiguration;
using static CtlFlow.Auth.Authd.Service.Egress.EgressClients;
using static CtlFlow.Auth.Authd.Service.Http.BrowserRoutes;
using static CtlFlow.Auth.Authd.Service.Http.HttpResponses;
using static CtlFlow.Auth.Authd.Service.Telemetry.TelemetryConfiguration;
using static CtlFlow.Auth.Authd.Service.Transport.PrivateGrpcChannels;

namespace CtlFlow.Auth.Authd.Service.Hosting;

internal static partial class AuthdProcess
{
    private static readonly IReadOnlyDictionary<
        string,
        (string Method, string Operation)>
        PublicRoutes = new Dictionary<
            string,
            (string Method, string Operation)>(
                StringComparer.Ordinal)
        {
            ["/auth/v1/begin"] =
                (HttpMethods.Post, "authd.http.begin"),
            ["/auth/v1/callback"] =
                (HttpMethods.Get, "authd.http.callback"),
            ["/auth/v1/logout"] =
                (HttpMethods.Post, "authd.http.logout")
        };

    internal static async Task<int> RunAuthd(string[] args)
    {
        var settings = await LoadServiceSettings(CancellationToken.None);
        var identityChannel = CreatePrivateGrpcChannel(settings.Identity);
        var tenantChannel = CreatePrivateGrpcChannel(settings.Tenant);
        var egressClient = CreateEgressClient();
        var builder = WebApplication.CreateSlimBuilder(args);
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Limits.MaxConcurrentConnections = 256;
            options.Limits.MaxConcurrentUpgradedConnections = 0;
            options.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(15);
            options.Limits.MaxRequestBodySize = 4 * 1024 + 1;
            options.Limits.MaxRequestBufferSize = 32 * 1024;
            options.Limits.MaxResponseBufferSize = 16 * 1024;
            options.Limits.MaxRequestHeaderCount = 4_096;
            options.Limits.MaxRequestHeadersTotalSize = 17 * 1024;
            options.Limits.MaxRequestLineSize = 17 * 1024;
            options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(5);
            options.Listen(
                settings.Public.Address,
                settings.Public.Port,
                listen => listen.Protocols = HttpProtocols.Http1);
            options.Listen(
                settings.Probe.Address,
                settings.Probe.Port,
                listen => listen.Protocols = HttpProtocols.Http1);
        });

        ConfigureTelemetry(builder, settings.Telemetry);
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton<AuthenticationAttemptStore>();
        builder.Services.AddSingleton<PublicAdmission>();
        builder.Services.AddSingleton(egressClient);
        builder.Services.AddSingleton(identityChannel);
        builder.Services.AddSingleton(tenantChannel);
        builder.Services.AddSingleton(
            new IdentityService.IdentityServiceClient(identityChannel));
        builder.Services.AddSingleton(
            new TenantService.TenantServiceClient(tenantChannel));

        await using var application = builder.Build();
        application.Use(async (context, next) =>
        {
            if (context.Connection.LocalPort == settings.Probe.Port)
            {
                if (context.Request.Method != HttpMethods.Get
                    || context.Request.Path != "/healthz"
                        && context.Request.Path != "/readyz")
                {
                    context.Response.StatusCode =
                        StatusCodes.Status404NotFound;
                    return;
                }
                await next(context);
                return;
            }

            if (!PublicRoutes.TryGetValue(
                    context.Request.Path.Value ?? "",
                    out var route))
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            AddSecurityHeaders(context.Response);
            var telemetry =
                context.RequestServices
                    .GetRequiredService<AuthdTelemetry>();
            if (!string.Equals(
                    context.Request.Method,
                    route.Method,
                    StringComparison.Ordinal))
            {
                context.Response.Headers.Allow = route.Method;
                await WriteDeclaredError(
                    context,
                    telemetry,
                    route.Operation,
                    StatusCodes.Status405MethodNotAllowed,
                    "method_not_allowed",
                    "OTHER");
                return;
            }
            if (CalculateHeaderBytes(context.Request.Headers) > 16 * 1024)
            {
                await WriteDeclaredError(
                    context,
                    telemetry,
                    route.Operation,
                    StatusCodes.Status431RequestHeaderFieldsTooLarge,
                    "headers_too_large",
                    route.Method);
                return;
            }
            if (CalculateCookieBytes(context.Request.Headers) > 8 * 1024)
            {
                await WriteDeclaredError(
                    context,
                    telemetry,
                    route.Operation,
                    StatusCodes.Status431RequestHeaderFieldsTooLarge,
                    "cookie_too_large",
                    route.Method);
                return;
            }
            if (CalculateTargetBytes(context.Request) > 16 * 1024)
            {
                await WriteDeclaredError(
                    context,
                    telemetry,
                    route.Operation,
                    StatusCodes.Status414UriTooLong,
                    "target_too_large",
                    route.Method);
                return;
            }

            var admission =
                context.RequestServices
                    .GetRequiredService<PublicAdmission>();
            if (!admission.TryAcquirePublic())
            {
                telemetry.RecordAdmissionRejection(
                    "public_concurrency");
                await WriteRateLimited(
                    context,
                    telemetry,
                    route.Operation,
                    route.Method);
                return;
            }
            var callback = false;
            try
            {
                if (!admission.TryAcquireRoute(context.Request.Path))
                {
                    telemetry.RecordAdmissionRejection("rate");
                    await WriteRateLimited(
                        context,
                        telemetry,
                        route.Operation,
                        route.Method);
                    return;
                }
                if (context.Request.Path == "/auth/v1/callback")
                {
                    callback = admission.TryAcquireCallback();
                    if (!callback)
                    {
                        telemetry.RecordAdmissionRejection(
                            "callback_concurrency");
                        await WriteRateLimited(
                            context,
                            telemetry,
                            route.Operation,
                            route.Method);
                        return;
                    }
                }
                await next(context);
            }
            finally
            {
                if (callback)
                {
                    admission.ReleaseCallback();
                }
                admission.ReleasePublic();
            }
        });

        application.MapMethods(
            "/auth/v1/begin",
            [HttpMethods.Post],
            BeginAuthentication);
        application.MapMethods(
            "/auth/v1/callback",
            [HttpMethods.Get],
            CompleteProviderCallback);
        application.MapMethods(
            "/auth/v1/logout",
            [HttpMethods.Post],
            Logout);
        application.MapGet("/healthz", static () => Results.NoContent());
        application.MapGet("/readyz", static () => Results.NoContent());

        await application.RunAsync();
        return 0;
    }

    private static int CalculateHeaderBytes(IHeaderDictionary headers)
    {
        var total = 0;
        foreach (var header in headers)
        {
            foreach (var value in header.Value)
            {
                total = checked(
                    total + header.Key.Length + (value?.Length ?? 0) + 4);
            }
        }
        return total;
    }

    private static int CalculateCookieBytes(IHeaderDictionary headers)
    {
        var total = 0;
        foreach (var value in headers.Cookie)
        {
            total = checked(total + (value?.Length ?? 0));
        }
        return total;
    }

    private static int CalculateTargetBytes(HttpRequest request) =>
        System.Text.Encoding.UTF8.GetByteCount(
            request.PathBase.Value
            + request.Path.Value
            + request.QueryString.Value);

    private static Task WriteRateLimited(
        HttpContext context,
        AuthdTelemetry telemetry,
        string operation,
        string method) =>
        WriteDeclaredError(
            context,
            telemetry,
            operation,
            StatusCodes.Status429TooManyRequests,
            "rate_limited",
            method,
            retryAfterSeconds: 1);

    private static async Task WriteDeclaredError(
        HttpContext context,
        AuthdTelemetry telemetry,
        string operation,
        int statusCode,
        string outcome,
        string method,
        int? retryAfterSeconds = null)
    {
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        using var activity = telemetry.StartHttpOperation(
            operation,
            context.Request);
        try
        {
            await WriteError(
                context.Response,
                statusCode,
                context.RequestAborted,
                retryAfterSeconds: retryAfterSeconds);
        }
        finally
        {
            telemetry.RecordHttpOperation(
                activity,
                operation,
                method,
                statusCode,
                outcome,
                "none",
                started);
        }
    }
}
