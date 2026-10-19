using System.Text.Json;
using System.Text.RegularExpressions;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public static partial class MatrixSettings
{
    public const string ReadinessPath = "/_matrix/client/versions";
    public static Result<string> AdministratorUser(string username, string? serverName)
    {
        if (username.Length is < 1 or > 80 || username.Any(character => character is not (>= 'a' and <= 'z' or >= '0' and <= '9' or '.' or '_' or '=' or '-'))
            || username == "conduit" || username.StartsWith("crossfire-", StringComparison.Ordinal) || username.StartsWith("agent-", StringComparison.Ordinal))
            return Results.Fail<string>("invalid", "Supply a regular human --administrator username");
        var administrator = "@" + username + ":" + serverName;
        return MatrixSyntax.UserId(administrator) ? Result<string>.Success(administrator) : Results.Fail<string>("invalid", "Invalid Matrix administrator ID");
    }
    public static Result<MatrixConfiguration> Read(BackendConfiguration backend, string instance, string administrator)
    {
        var input = backend.Parameters;
        if (backend.Type != "matrix" || !Validation.Fields(input, ["origin", "serverName", "jwtSecret", "registrationSecret"]).IsSuccess)
            return Results.Fail<MatrixConfiguration>("invalid", "Expected Matrix server configuration");
        var origin = WireJson.Text(input, "origin"); var name = Validation.Text(input.GetProperty("serverName"), 200);
        var jwt = Validation.Text(input.GetProperty("jwtSecret"), 200, 32); var registration = Validation.Text(input.GetProperty("registrationSecret"), 200, 32);
        if (origin is null || !Validation.Origin(origin).IsSuccess || !name.IsSuccess || !ServerName().IsMatch(name.Value) || !jwt.IsSuccess || !registration.IsSuccess
            || !MatrixSyntax.UserId(administrator) || !administrator.EndsWith(":" + name.Value, StringComparison.Ordinal))
            return Results.Fail<MatrixConfiguration>("invalid", "Invalid Matrix server configuration or administrator");
        return Result<MatrixConfiguration>.Success(new(origin, name.Value, jwt.Value, registration.Value, "@crossfire-" + instance + ":" + name.Value));
    }
    [GeneratedRegex("\\A[a-z0-9.-]+(?::[0-9]+)?\\z", RegexOptions.CultureInvariant)]
    private static partial Regex ServerName();
}
