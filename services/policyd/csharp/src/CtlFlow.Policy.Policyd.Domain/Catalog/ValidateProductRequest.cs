using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Operations;
using CtlFlow.Policy.Policyd.Domain.Paths;
using CtlFlow.Policy.Policyd.Domain.Targets;

namespace CtlFlow.Policy.Policyd.Domain.Catalog;

public static partial class OperationCatalog
{
    // Validates a product operation's resource path.
    //
    // The path is anchored under the App admitted for the authenticated
    // Workload, inside the canonical scope for the validated target. The App
    // root is itself a valid target, so an operation needs no trailing segment.
    // Beyond the anchor Policyd owns no product grammar: trailing segments are
    // only required to be canonical.
    public static CatalogRequest ValidateProductRequest(
        OperationToken operation,
        ResourcePath resourcePath,
        PolicyTarget target,
        AppId admittedAppId)
    {
        var segments = resourcePath.Segments;
        var scope = ParseScope(segments, target);

        // <scope>/apps/<app_id>[/<product path>]
        RequireFixed(segments, scope.NextSegment, "apps");
        var appId = ReadSegment(segments, scope.NextSegment + 1);
        if (!string.Equals(
                appId,
                admittedAppId.Value,
                StringComparison.Ordinal))
        {
            throw InvalidPath();
        }

        for (var index = scope.NextSegment + 2;
            index < segments.Count;
            index++)
        {
            RequireProductSegment(segments[index]);
        }

        return new CatalogRequest(
            operation,
            resourcePath,
            target,
            scope.Account);
    }

    // One generic segment grammar: starts alphanumeric, then lower-case
    // alphanumerics, `_`, `-`, or `.`, at most 128 characters. Spaces, encoded
    // forms, and traversal never reach here because ResourcePath rejects them,
    // but the grammar is enforced explicitly rather than assumed.
    private static void RequireProductSegment(string value)
    {
        if (value.Length is < 1 or > 128
            || !IsLowerAlphaNumeric(value[0]))
        {
            throw InvalidPath();
        }

        foreach (var character in value)
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not ('_' or '-' or '.'))
            {
                throw InvalidPath();
            }
        }
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
