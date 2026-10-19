using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.AdapterMatrix;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed record BootstrapSecrets(string ServicePassword, string AdministratorPassword);

public static class Bootstrap
{
    public static Result<BootstrapSecrets> Parse(JsonElement input)
    {
        var fields = Validation.Fields(input, ["servicePassword", "administratorPassword"]);
        if (!fields.IsSuccess) return Result<BootstrapSecrets>.Fail(fields.Error);
        var service = Validation.Text(input.GetProperty("servicePassword"), 1024, 32); var administrator = Validation.Text(input.GetProperty("administratorPassword"), 1024, 12);
        return service.IsSuccess && administrator.IsSuccess ? Result<BootstrapSecrets>.Success(new(service.Value, administrator.Value))
            : Results.Fail<BootstrapSecrets>("invalid", "Invalid private bootstrap credentials");
    }

    public static async ValueTask<Result<Unit>> Apply(MatrixConfiguration configuration, string administrator, BootstrapSecrets secrets, AccountAuthority matrix, CancellationToken cancellation = default)
    {
        var service = await matrix.Provision(configuration.ServiceBackendUserId, secrets.ServicePassword, WireJson.Object(writer => writer.WriteString("deviceId", "CROSSFIRE_CONTROL")), cancellation);
        if (!service.IsSuccess) return Result<Unit>.Fail(service.Error);
        using var client = NativeHttp.Client();
        var native = new NativeEndpoint(configuration.Origin, service.Value.AccessToken);
        var directory = await MatrixJson.Ok(client, native, "GET", MatrixJson.Api + "/directory/room/" + MatrixJson.Segment("#admins:" + configuration.ServerName), cancellation: cancellation);
        if (!directory.IsSuccess) return Result<Unit>.Fail(directory.Error);
        var room = MatrixJson.Text(directory.Value, "room_id");
        if (room is null) return Results.Fail<Unit>("native", "Native administrator room is missing");
        var members = await MatrixJson.Ok(client, native, "GET", MatrixJson.Api + "/rooms/" + MatrixJson.Segment(room) + "/joined_members", cancellation: cancellation);
        if (!members.IsSuccess) return Result<Unit>.Fail(members.Error);
        if (!members.Value.TryGetProperty("joined", out var joined) || joined.ValueKind != JsonValueKind.Object || !joined.TryGetProperty(configuration.ServiceBackendUserId, out _))
            return Results.Fail<Unit>("native", "The private service identity must be the first native administrator; refusing adoption of another homeserver");
        var present = await matrix.Exists(administrator, cancellation);
        if (!present.IsSuccess) return Result<Unit>.Fail(present.Error);
        return present.Value ? Results.Done() : (await matrix.Provision(administrator, secrets.AdministratorPassword, WireJson.Object(writer => writer.WriteString("deviceId", "CROSSFIRE_HUMAN")), cancellation)).Map(_ => default(Unit));
    }
}
