using CtlFlow.Egress.Egressd.Domain.Bindings;
using CtlFlow.Egress.Egressd.Domain.Rules;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal static partial class EgressdConfiguration
{
    internal static async Task<BoundConfiguration> ParseBinding(
        string bindingPath,
        string secretsPath,
        CancellationToken cancellation)
    {
        var secrets = await ParseSecrets(secretsPath, cancellation);
        using var document = await ReadStrictJsonDocument(
            bindingPath,
            "Egressd binding document",
            cancellation);
        var root = document.RootElement;
        RequireProperties(
            root,
            new HashSet<string>(
                [
                    "schema_version",
                    "binding_id",
                    "caller",
                    "origin",
                    "rules"
                ],
                StringComparer.Ordinal));
        if (ReadInteger(root, "schema_version") != 1)
        {
            throw new InvalidOperationException(
                "Egressd binding schema version is invalid");
        }

        var caller = ReadObject(root, "caller");
        RequireProperties(
            caller,
            new HashSet<string>(
                ["namespace", "service_account"],
                StringComparer.Ordinal));
        var rules = new List<EgressRule>();
        foreach (var value in ReadArray(root, "rules", 1, 256)
            .EnumerateArray())
        {
            rules.Add(await ParseRule(value, cancellation));
        }
        ValidateRules(rules, secrets);

        return new BoundConfiguration(
            new EgressBinding(
                await BindingId.Parse(
                    ReadString(root, "binding_id"),
                    cancellation),
                await CallerBinding.Parse(
                    ReadString(caller, "namespace"),
                    ReadString(caller, "service_account"),
                    cancellation),
                await EgressOrigin.Parse(
                    ReadString(root, "origin"),
                    cancellation),
                rules),
            secrets);
    }
}
