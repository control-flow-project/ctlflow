using System.Diagnostics;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Service.Configuration;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Auditing.AuditDelivery;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityRequests;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityResponses;
using LoginProvidersDb =
    CtlFlow.Identity.Identityd.Db.LoginProviders.LoginProviders;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<SetWorkspaceLoginProviderAdmissionResponse>
        SetWorkspaceLoginProviderAdmission(
            SetWorkspaceLoginProviderAdmissionRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateAdmin(
            context,
            IdentityAdminOperation.SetWorkspaceLoginProviderAdmission,
            now);
        var target = await ParseIdentityTarget(
            request.TenantId,
            request.WorkspaceId,
            context.CancellationToken);
        var providerId = await ProviderId.Parse(
            request.ProviderId,
            context.CancellationToken);
        await AuthorizeAdmin(
            identity,
            IdentityAdminOperation.SetWorkspaceLoginProviderAdmission,
            target,
            $"/tenants/{target.TenantId.Value}/workspaces/{target.WorkspaceId!.Value}/login-providers/{providerId.Value}",
            context);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            now,
            context.CancellationToken);
        var result =
            await LoginProvidersDb.SetWorkspaceLoginProviderAdmission(
                _identityDatabase,
                target.TenantId,
                target.WorkspaceId!,
                providerId,
                request.Admitted,
                audit,
                context.CancellationToken);
        await RecordAdministrationAudit(
            result.AuditIntent,
            context.CancellationToken);
        var response = new SetWorkspaceLoginProviderAdmissionResponse();
        if (result.Value is not null)
        {
            response.Admission =
                CreateWorkspaceLoginProviderAdmissionMessage(result.Value);
        }

        return response;
    }
}
