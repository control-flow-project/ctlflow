using System.Diagnostics;
using CtlFlow.Identity.V1;
using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Targets;
using CtlFlow.Policy.Policyd.Service.Configuration;
using CtlFlow.Policy.Policyd.Service.Security;
using CtlFlow.Policy.Policyd.Service.Security.Invocations;
using CtlFlow.Policy.Policyd.Service.Telemetry;
using Grpc.Core;
using WirePrincipalKind = CtlFlow.Identity.V1.PrincipalKind;
using DomainPrincipalKind =
    CtlFlow.Policy.Policyd.Domain.Identifiers.PrincipalKind;

namespace CtlFlow.Policy.Policyd.Service.Identity;

internal static partial class IdentityFacts
{
    internal static async Task<PrincipalFacts> ResolvePrincipal(
        IdentityService.IdentityServiceClient client,
        IdentitySettings settings,
        PolicydTelemetry telemetry,
        InvocationIdentity invocation,
        PolicyTarget target,
        CancellationToken cancellation)
    {
        using var activity = telemetry.StartIdentityCall("ResolvePrincipal");
        try
        {
            var request = new ResolvePrincipalRequest
            {
                PrincipalId = invocation.Actor.Value,
                TenantId = target.TenantId.Value
            };
            if (target.WorkspaceId is { } workspace)
            {
                request.WorkspaceId = workspace.Value;
            }
            var headers = await CreateIdentityMetadata(
                settings,
                invocation.Token,
                activity,
                cancellation);
            var response = await client.ResolvePrincipalAsync(
                request,
                headers,
                DateTime.UtcNow.Add(settings.CallTimeout),
                cancellation);
            var facts = ValidatePrincipalResponse(response, invocation);
            activity?.SetStatus(ActivityStatusCode.Ok);
            return facts;
        }
        catch (RpcException exception)
        {
            activity?.SetStatus(ActivityStatusCode.Error);
            throw MapIdentityFailure(exception, cancellation);
        }
        catch (Exception exception) when (
            exception is IOException
                or InvalidDataException
                or InvalidOperationException
                or ArgumentException
                or OverflowException)
        {
            activity?.SetStatus(ActivityStatusCode.Error);
            throw new IdentityUnavailableException(exception);
        }
    }

    private static PrincipalFacts ValidatePrincipalResponse(
        ResolvePrincipalResponse response,
        InvocationIdentity invocation)
    {
        var principal = PrincipalId.Parse(response.PrincipalId);
        var account = PrincipalId.Parse(response.SubjectAccountId);
        if (principal != invocation.Actor
            || account != invocation.SubjectAccount
            || response.PrincipalRevision is 0 or > long.MaxValue
            || response.SubjectAccountRevision is 0 or > long.MaxValue
            || response.MembershipRevision is 0 or > long.MaxValue)
        {
            throw new InvalidDataException(
                "Identityd returned inconsistent principal facts");
        }
        var kind = response.PrincipalKind switch
        {
            WirePrincipalKind.Human => DomainPrincipalKind.Human,
            WirePrincipalKind.Service => DomainPrincipalKind.Service,
            WirePrincipalKind.Virtual => DomainPrincipalKind.Virtual,
            _ => throw new InvalidDataException(
                "Identityd returned an invalid principal kind")
        };
        if (kind != principal.Kind
            || (kind == DomainPrincipalKind.Virtual
                ? principal == account
                : principal != account))
        {
            throw new InvalidDataException(
                "Identityd returned inconsistent attachment facts");
        }
        return new PrincipalFacts(
            principal,
            kind,
            response.PrincipalEnabled,
            account,
            response.SubjectAccountEnabled);
    }
}
