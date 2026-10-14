using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Microsoft.AspNetCore.Http.Features;

namespace Crossfire.Server.Http;

public static class ApiPipeline
{
    public static RequestDelegate Create(ApiState state, IReadOnlyList<ApiEndpoint> endpoints, Action wake, JsonElement? presentation = null)
    {
        if (endpoints.Select(endpoint => endpoint.OperationName).Distinct(StringComparer.Ordinal).Count() != endpoints.Count)
            throw new InvalidOperationException("REST operations must have exactly one C# implementation");
        var limits = new Dictionary<string, (int Count, long ExpiresAt)>(StringComparer.Ordinal); var rateGate = new object();
        var registration = new RegistrationTransport(state);
        var changes = new FleetChanges();
        bool Rate(HttpContext http)
        {
            lock (rateGate)
            {
                var now = state.Now();
                foreach (var key in limits.Where(entry => entry.Value.ExpiresAt <= now).Select(entry => entry.Key).ToArray()) limits.Remove(key);
                var address = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
                if (!limits.TryGetValue(address, out var limit))
                {
                    if (limits.Count >= 4096) return false;
                    limit = (0, now + 60000);
                }
                limit = (limit.Count + 1, limit.ExpiresAt); limits[address] = limit;
                return limit.Count <= 120;
            }
        }
        return async http =>
        {
            var requestId = Identity.Identifier();
            try
            {
                if (http.Request.Host.Value != new Uri(state.Configuration.PublicOrigin).Authority)
                {
                    await Transport.Send(http, requestId, Results.Fail<ApiReply>("forbidden", "Invalid request host"), 200); return;
                }
                if (http.Request.Headers.ContainsKey("Origin") && http.Request.Headers.Origin != state.Configuration.PublicOrigin)
                {
                    await Transport.Send(http, requestId, Results.Fail<ApiReply>("forbidden", "Invalid request origin"), 200); return;
                }
                var target = RequestTargets.Read(http, state.Configuration.PublicOrigin);
                if (!target.IsSuccess)
                {
                    await Transport.Send(http, requestId, Result<ApiReply>.Fail(target.Error), 200); return;
                }
                var path = target.Value.Path;
                if (await PlatformRoutes.Handle(state, http, path, requestId, presentation)) return;
                if (registration.Handles(path))
                {
                    if ((path == RegistrationTransport.RegisterPath || http.Request.Method == "POST") && !Rate(http))
                    { http.Response.Headers.RetryAfter = "60"; await NativeResponses.Error(http, requestId, 429, "M_LIMIT_EXCEEDED", "Request rate exceeded"); return; }
                    await registration.Handle(http, path, requestId); if (http.Request.Method == "POST" && http.Response.StatusCode == 200) wake(); return;
                }
                if (MatrixRoutes.Handles(path, http.Request.Method)) { await MatrixRoutes.Handle(state, http, path, requestId); return; }
                ApiEndpoint? selected = null; IReadOnlyDictionary<string, string>? parameters = null; string? matchedPath = null;
                var allowed = new List<string>();
                foreach (var endpoint in endpoints)
                {
                    if (matchedPath is not null && matchedPath != endpoint.Operation.Path) continue;
                    var matched = Match(endpoint.Operation.Path, path);
                    if (matched is null) continue;
                    matchedPath = endpoint.Operation.Path; allowed.Add(endpoint.Operation.Method);
                    if (endpoint.Operation.Method != http.Request.Method) continue;
                    selected = endpoint; parameters = matched; break;
                }
                if (selected is null || parameters is null)
                {
                    if (allowed.Count != 0) http.Response.Headers.Allow = string.Join(", ", allowed);
                    await Transport.Send(http, requestId, Results.Fail<ApiReply>(allowed.Count == 0 ? "missing" : "method_not_allowed", allowed.Count == 0 ? "Route not found" : "Method not allowed"), 200); return;
                }
                if (selected.Operation.Authentication == "public" && selected.Operation.Method != "GET" && !Rate(http))
                {
                    http.Response.Headers.RetryAfter = "60";
                    await Transport.Send(http, requestId, Results.Fail<ApiReply>("rate_limit", "Request rate exceeded"), 200); return;
                }
                using var database = new CrossfireDbContext(state.Database);
                var authenticated = await ApiAuthentication.Authenticate(state, database, http, selected, requestId, changes);
                if (!authenticated.IsSuccess) { await Transport.Send(http, requestId, Result<ApiReply>.Fail(authenticated.Error), selected.Operation.Status); return; }
                var query = Transport.Query(http.Request, selected.QueryFields ?? []);
                if (!query.IsSuccess) { await Transport.Send(http, requestId, Result<ApiReply>.Fail(query.Error), selected.Operation.Status); return; }
                if (parameters.Any(value => value.Key == "roomId" ? !Validation.RoomId(value.Value) : value.Key == "eventId" ? !Validation.EventId(value.Value) : !Validation.Identifier(value.Value)))
                {
                    await Transport.Send(http, requestId, Results.Fail<ApiReply>("invalid", "Invalid resource identifier"), selected.Operation.Status); return;
                }
                var input = selected.Operation.Method == "GET" || selected.Operation.Binary ? Result<JsonElement>.Success(JsonValues.Object(_ => { }))
                    : await Transport.Read(http.Request, selected.Operation.MaximumBodyBytes, http.RequestAborted);
                if (!input.IsSuccess) { await Transport.Send(http, requestId, Result<ApiReply>.Fail(input.Error), selected.Operation.Status); return; }
                var result = await selected.Handle(authenticated.Value with { Query = query.Value }, parameters, input.Value);
                if (result.IsSuccess && selected.Operation.Method != "GET") { changes.Notify(parameters.GetValueOrDefault("fleetId")); wake(); }
                await Transport.Send(http, requestId, result, selected.Operation.Status);
            }
            catch (OperationCanceledException) when (http.RequestAborted.IsCancellationRequested) { }
            catch (Exception exception)
            {
                state.Diagnostics.Write("HTTP operation failed: " + exception.GetType().Name + "; request " + requestId);
                if (!http.Response.HasStarted) await Transport.Send(http, requestId, Results.Fail<ApiReply>("unavailable", "The operation could not be completed; request ID: " + requestId), 200);
                else http.Abort();
            }
        };
    }

    public static IReadOnlyDictionary<string, string>? Match(string template, string path)
    {
        var pattern = template.Split('/'); var segments = path.Split('/');
        if (pattern.Length != segments.Length) return null;
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index < pattern.Length; index++)
        {
            var part = pattern[index];
            if (part.StartsWith('{') && part.EndsWith('}'))
            {
                if (segments[index].Length == 0) return null;
                try { values.Add(part[1..^1], Uri.UnescapeDataString(segments[index])); }
                catch (UriFormatException) { return null; }
            }
            else if (part != segments[index]) return null;
        }
        return values;
    }
}
