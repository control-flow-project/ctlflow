using System.Buffers;
using System.Text.RegularExpressions;
using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Server.Http;
using Microsoft.AspNetCore.Http.Features;

namespace Crossfire.Server;

public static partial class ContentApplication
{
    public const string SecurityPolicy = "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    [GeneratedRegex(@"^/([A-Za-z0-9_-]{43})/([^?#]+)(?:\?[^#]*)?$", RegexOptions.CultureInvariant)]
    private static partial Regex PathPattern();

    public static WebApplication Build(ApiState state, string listen)
    {
        var builder = WebApplication.CreateSlimBuilder(); builder.Logging.ClearProviders(); builder.WebHost.UseUrls(listen);
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.AddServerHeader = false; options.Limits.MaxConcurrentConnections = 64; options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(10);
            options.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(1); options.Limits.MaxRequestBodySize = 0;
        });
        var application = builder.Build(); var active = 0; var host = new Uri(state.Configuration.ContentOrigin).Authority;
        application.Run(async http =>
        {
            var response = http.Response;
            response.Headers.CacheControl = "no-store"; response.Headers.ContentSecurityPolicy = SecurityPolicy; response.Headers.XContentTypeOptions = "nosniff";
            response.Headers["Referrer-Policy"] = "no-referrer"; response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
            response.Headers.AccessControlAllowOrigin = "*"; response.Headers.AccessControlAllowMethods = "GET, HEAD, OPTIONS"; response.Headers["Cross-Origin-Resource-Policy"] = "cross-origin";
            if (http.Request.Host.Value != host) { response.StatusCode = 421; return; }
            if (http.Request.Method is not ("GET" or "HEAD" or "OPTIONS")) { response.Headers.Allow = "GET, HEAD, OPTIONS"; response.StatusCode = 405; return; }
            var raw = http.Features.Get<IHttpRequestFeature>()?.RawTarget ?? ""; var matched = PathPattern().Match(raw);
            if (!matched.Success || !PublicationValues.Path(matched.Groups[2].Value)) { response.StatusCode = 404; return; }
            var key = matched.Groups[1].Value; var path = matched.Groups[2].Value;
            using var database = new CrossfireDbContext(state.Database); var record = PublicationQueries.PublicFile(database, key, path);
            if (!record.IsSuccess || record.Value is null) { response.StatusCode = record.IsSuccess ? 404 : 503; return; }
            if (http.Request.Method == "OPTIONS") { response.StatusCode = 204; return; }
            if (Interlocked.Increment(ref active) > 32) { Interlocked.Decrement(ref active); response.StatusCode = 503; return; }
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30)); using var stop = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token, http.RequestAborted);
            var buffer = ArrayPool<byte>.Shared.Rent(65536);
            try
            {
                var opened = state.Publications.Read(record.Value.Publication.Id, record.Value.File);
                if (!opened.IsSuccess) { response.StatusCode = 503; return; }
                await using var stream = opened.Value;
                var current = PublicationQueries.PublicFile(database, key, path);
                if (!current.IsSuccess || current.Value is null) { response.StatusCode = current.IsSuccess ? 404 : 503; return; }
                response.ContentType = record.Value.File.Manifest.MediaType; response.ContentLength = record.Value.File.Manifest.Bytes;
                if (http.Request.Method == "HEAD") return;
                long remaining = record.Value.File.Manifest.Bytes;
                while (remaining > 0)
                {
                    var count = await stream.ReadAsync(buffer.AsMemory(0, (int)Math.Min(65536, remaining)), stop.Token);
                    if (count == 0) throw new IOException("Report changed during read"); remaining -= count;
                    current = PublicationQueries.PublicFile(database, key, path);
                    if (!current.IsSuccess || current.Value is null) { http.Abort(); return; }
                    await response.Body.WriteAsync(buffer.AsMemory(0, count), stop.Token);
                }
                if (stream.Length != record.Value.File.Manifest.Bytes) http.Abort();
            }
            catch (Exception error) when (error is IOException or OperationCanceledException or UnauthorizedAccessException)
            {
                state.Diagnostics.Write("Public report read failed: " + error.GetType().Name);
                if (response.HasStarted) http.Abort(); else { response.ContentLength = null; response.StatusCode = 503; }
            }
            finally { ArrayPool<byte>.Shared.Return(buffer); Interlocked.Decrement(ref active); }
        });
        return application;
    }
}
