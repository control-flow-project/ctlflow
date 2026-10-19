using System.Text.Json;
using System.Text.RegularExpressions;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;
using Crossfire.Server.Http;

namespace Crossfire.Server;

public sealed record ServerConfiguration(string Instance, string PublicOrigin, string ContentOrigin, BackendConfiguration Messaging,
    string Administrator, PublicationBudget PublicationBudget, long LoggingRetentionDays, IReadOnlyList<string>? TrustedProxyAddresses = null);

public static partial class Configurations
{
    public static Result<ServerConfiguration> Parse(JsonElement input)
    {
        var fields = Validation.Fields(input, ["instance", "publicOrigin", "contentOrigin", "messaging", "administrator"],
            ["publicationBudget", "loggingRetentionDays", "trustedProxyAddresses"]);
        if (!fields.IsSuccess) return Result<ServerConfiguration>.Fail(fields.Error);
        var instance = Validation.Text(input.GetProperty("instance"), 40);
        var administrator = Validation.Text(input.GetProperty("administrator")); var messaging = MessagingContract.Configuration(input.GetProperty("messaging"));
        if (!instance.IsSuccess || !InstanceName().IsMatch(instance.Value) || !administrator.IsSuccess || !Validation.UserId(administrator.Value) || !messaging.IsSuccess)
            return Results.Fail<ServerConfiguration>("invalid", "Invalid server configuration");
        var publicOrigin = ReadOrigin(input, "publicOrigin"); var contentOrigin = ReadOrigin(input, "contentOrigin");
        if (!publicOrigin.IsSuccess) return Result<ServerConfiguration>.Fail(publicOrigin.Error);
        if (!contentOrigin.IsSuccess) return Result<ServerConfiguration>.Fail(contentOrigin.Error);
        if (new Uri(contentOrigin.Value).Host == new Uri(publicOrigin.Value).Host)
            return Results.Fail<ServerConfiguration>("invalid", "Publications require a separate content hostname and origin");
        var budget = input.TryGetProperty("publicationBudget", out var limits) ? Budget(limits) : Result<PublicationBudget>.Success(new(1073741824, 134217728, 4096, 128, 8));
        if (!budget.IsSuccess) return Result<ServerConfiguration>.Fail(budget.Error);
        var retention = input.TryGetProperty("loggingRetentionDays", out var days) ? Validation.Integer(days, 1, Validation.MaxWireInteger / 86400000) : Result<long>.Success(7);
        if (!retention.IsSuccess) return Result<ServerConfiguration>.Fail(retention.Error);
        var proxies = input.TryGetProperty("trustedProxyAddresses", out var addresses) ? PublicRequestBudget.Proxies(addresses) : Result<IReadOnlyList<string>>.Success([]);
        if (!proxies.IsSuccess) return Result<ServerConfiguration>.Fail(proxies.Error);
        return Result<ServerConfiguration>.Success(new(instance.Value, publicOrigin.Value, contentOrigin.Value, messaging.Value, administrator.Value, budget.Value, retention.Value, proxies.Value));
    }

    private static Result<string> ReadOrigin(JsonElement input, string name)
        => input.GetProperty(name).ValueKind == JsonValueKind.String ? Validation.Origin(input.GetProperty(name).GetString()!) : Results.Fail<string>("invalid", "Invalid server origin");

    private static Result<PublicationBudget> Budget(JsonElement input)
    {
        var fields = Validation.Fields(input, ["instanceBytes", "agentBytes", "instanceCount", "agentCount", "uploads"]);
        if (!fields.IsSuccess) return Result<PublicationBudget>.Fail(fields.Error);
        var instance = Validation.Integer(input.GetProperty("instanceBytes"), 1, 1099511627776); var agent = Validation.Integer(input.GetProperty("agentBytes"), 1);
        var instanceCount = Validation.Integer(input.GetProperty("instanceCount"), 1, 100000); var agentCount = Validation.Integer(input.GetProperty("agentCount"), 1);
        var uploads = Validation.Integer(input.GetProperty("uploads"), 1, 32);
        return instance.IsSuccess && agent.IsSuccess && instanceCount.IsSuccess && agentCount.IsSuccess && uploads.IsSuccess
            && agent.Value <= instance.Value && agentCount.Value <= instanceCount.Value
            ? Result<PublicationBudget>.Success(new(instance.Value, agent.Value, instanceCount.Value, agentCount.Value, (int)uploads.Value))
            : Results.Fail<PublicationBudget>("invalid", "Publication budgets must be positive, finite and nested within the instance budget");
    }

    [GeneratedRegex("\\A[a-z][a-z0-9-]*\\z", RegexOptions.CultureInvariant)]
    private static partial Regex InstanceName();
}
