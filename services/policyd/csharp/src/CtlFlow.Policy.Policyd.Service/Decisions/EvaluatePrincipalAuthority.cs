using CtlFlow.Identity.V1;
using CtlFlow.Policy.Policyd.Db.Providers;
using CtlFlow.Policy.Policyd.Domain.Decisions;
using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Operations;
using CtlFlow.Policy.Policyd.Domain.Paths;
using CtlFlow.Policy.Policyd.Domain.Rules;
using CtlFlow.Policy.Policyd.Domain.Targets;
using CtlFlow.Policy.Policyd.Service.Configuration;
using CtlFlow.Policy.Policyd.Service.Security.Invocations;
using CtlFlow.Policy.Policyd.Service.Telemetry;
using static CtlFlow.Policy.Policyd.Db.Decisions.PolicyDecisions;
using static CtlFlow.Policy.Policyd.Service.Identity.IdentityFacts;

namespace CtlFlow.Policy.Policyd.Service.Decisions;

internal static partial class AccessDecisions
{
    private static async Task<bool> EvaluatePrincipalAuthority(
        PolicyDatabase database,
        IdentityService.IdentityServiceClient identityClient,
        IdentitySettings identitySettings,
        PolicydTelemetry telemetry,
        InvocationIdentity invocation,
        PrincipalId principal,
        PolicyTarget target,
        OperationIdentity operation,
        ResourcePath resourcePath,
        CancellationToken cancellation)
    {
        var allowed = PolicyRules.Allows(
            resourcePath,
            await FindRules(
                database,
                target,
                new PolicySubjects(principal, Array.Empty<GroupId>()),
                operation,
                cancellation));

        GroupId? after = null;
        do
        {
            var page = await ListPrincipalGroups(
                identityClient,
                identitySettings,
                telemetry,
                invocation,
                principal,
                target,
                after,
                cancellation);
            if (page.Groups.Count > 0)
            {
                var groupRules = await FindRules(
                    database,
                    target,
                    new PolicySubjects(null, page.Groups),
                    operation,
                    cancellation);
                allowed |= PolicyRules.Allows(resourcePath, groupRules);
            }
            after = page.NextAfterGroupId;
        }
        while (after is not null);

        return allowed;
    }
}
