using Crossfire.AdapterHttp;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterCrossfire;

public static class CoordinationTransport
{
    public static Coordination Create(HttpClient http, string origin, string? token)
    { var client = new OperationClient(http, origin, () => token, RestOperations.All); return new(origin, client.Call); }
    public static AgentMatrix Matrix(HttpClient http, AgentProfile profile, int timeoutMilliseconds = 45000)
        => new(async (request, cancellation) =>
        {
            var query = request.Query is null || request.Query.Count == 0 ? "" : "?" + string.Join('&', request.Query.Select(value => Uri.EscapeDataString(value.Key) + "=" + Uri.EscapeDataString(value.Value)));
            var response = await NativeHttp.Json(http, new(profile.Settings.Homeserver, profile.Account.AccessToken, timeoutMilliseconds), request.Method, request.Path + query, request.Body, request.MaximumBytes, cancellation);
            if (!response.IsSuccess) return Result<MatrixResponse>.Fail(response.Error); using var received = response.Value; return Result<MatrixResponse>.Success(new(received.Status, received.Body.Clone()));
        });
}
