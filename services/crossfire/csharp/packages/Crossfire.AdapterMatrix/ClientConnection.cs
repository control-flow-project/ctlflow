using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public static class ClientConnection
{
    public static Result<MessagingConnection> Connect(HttpClient http, BackendConfiguration configuration, BackendAccount account)
    {
        var parameters = configuration.Parameters;
        if (configuration.Type != "matrix" || !Validation.Fields(parameters, ["origin", "serverName"]).IsSuccess
            || WireJson.Text(parameters, "origin") is not { } origin || !Validation.Origin(origin).IsSuccess
            || !Validation.Text(parameters.GetProperty("serverName"), 255).IsSuccess || !MatrixSyntax.UserId(account.UserId)
            || account.AccessToken.Length is < 1 or > 8192 || !TextRules.WellFormed(account.AccessToken))
            return Results.Fail<MessagingConnection>("invalid", "Invalid Matrix client configuration or account");
        var endpoint = new NativeEndpoint(origin, account.AccessToken, 45000); var client = new MessageClient(http, endpoint, account.UserId);
        var invitations = new InvitationReader(http, endpoint, account.UserId);
        return Result<MessagingConnection>.Success(new(client.Ports(), invitations.Read));
    }
}

internal sealed class InvitationReader(HttpClient http, NativeEndpoint endpoint, string self)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private InvitationState? state;

    public async ValueTask<Result<IReadOnlyList<string>>> Read(CancellationToken cancellation)
    {
        await gate.WaitAsync(cancellation);
        try
        {
            var query = "?timeout=0&filter=" + MatrixJson.Segment(InvitationSynchronization.Filter) + (state is null ? "" : "&since=" + MatrixJson.Segment(state.Since));
            var response = await NativeHttp.Json(http, endpoint, "GET", MatrixJson.Api + "/sync" + query, maximumBytes: 67108864, cancellation: cancellation);
            if (!response.IsSuccess) return Result<IReadOnlyList<string>>.Fail(response.Error);
            using var received = response.Value;
            if (received.Status != 200) return Results.Fail<IReadOnlyList<string>>(received.Status switch { 401 => "unauthorized", 403 => "forbidden", 429 => "rate_limit", _ => "unavailable" }, "Matrix invitation synchronization failed");
            var parsed = InvitationSynchronization.Apply(received.Body, self, state);
            if (!parsed.IsSuccess) return Result<IReadOnlyList<string>>.Fail(parsed.Error);
            state = parsed.Value;
            return Result<IReadOnlyList<string>>.Success(state.Senders.Keys.Order(StringComparer.Ordinal).ToArray());
        }
        finally { gate.Release(); }
    }
}
