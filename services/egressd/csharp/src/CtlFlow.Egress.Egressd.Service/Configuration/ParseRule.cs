using System.Text.Json;
using CtlFlow.Egress.Egressd.Domain.Rules;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal static partial class EgressdConfiguration
{
    private const int MaximumBodyBytes = 64 * 1024 * 1024;
    private static readonly IReadOnlySet<string> RuleProperties =
        new HashSet<string>(
            [
                "rule_id",
                "methods",
                "match",
                "upstream_path_prefix",
                "forward_request_headers",
                "forward_response_headers",
                "set_request_headers",
                "maximum_request_body_bytes",
                "maximum_response_body_bytes",
                "forward_trace_context"
            ],
            StringComparer.Ordinal);

    internal static async Task<EgressRule> ParseRule(
        JsonElement value,
        CancellationToken cancellation)
    {
        RequireProperties(value, RuleProperties);
        var match = ReadObject(value, "match");
        RequireProperties(
            match,
            new HashSet<string>(
                ["kind", "path"],
                StringComparer.Ordinal));
        return new EgressRule(
            await RuleId.Parse(ReadString(value, "rule_id"), cancellation),
            ParseMethods(value),
            new PathMatch(
                ReadString(match, "kind") switch
                {
                    "exact" => PathMatchKind.Exact,
                    "prefix" => PathMatchKind.Prefix,
                    _ => throw new InvalidDataException(
                        "Rule match kind is invalid")
                },
                await RulePath.Parse(
                    ReadString(match, "path"),
                    cancellation)),
            await RulePath.Parse(
                ReadString(value, "upstream_path_prefix"),
                cancellation),
            await ParseHeaderNames(
                value,
                "forward_request_headers",
                requestHeaders: true,
                cancellation),
            await ParseHeaderNames(
                value,
                "forward_response_headers",
                requestHeaders: false,
                cancellation),
            await ParseHeaderReplacements(value, cancellation),
            ReadBodyBound(value, "maximum_request_body_bytes"),
            ReadBodyBound(value, "maximum_response_body_bytes"),
            ReadBoolean(value, "forward_trace_context"));
    }

    private static IReadOnlySet<EgressMethod> ParseMethods(
        JsonElement value)
    {
        var methods = new HashSet<EgressMethod>();
        foreach (var item in ReadArray(
            value,
            "methods",
            1,
            7).EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String
                || item.GetString() is not { } method
                || !methods.Add(method switch
                {
                    "GET" => EgressMethod.Get,
                    "HEAD" => EgressMethod.Head,
                    "POST" => EgressMethod.Post,
                    "PUT" => EgressMethod.Put,
                    "PATCH" => EgressMethod.Patch,
                    "DELETE" => EgressMethod.Delete,
                    "OPTIONS" => EgressMethod.Options,
                    _ => throw new InvalidDataException(
                        "Rule method is invalid")
                }))
            {
                throw new InvalidDataException(
                    "Rule methods are invalid");
            }
        }

        return methods;
    }

    private static long ReadBodyBound(
        JsonElement value,
        string name)
    {
        var bound = ReadInteger(value, name);
        return bound is >= 1 and <= MaximumBodyBytes
            ? bound
            : throw new InvalidDataException($"{name} is invalid");
    }
}
