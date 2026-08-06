using CtlFlow.Execution.Execd.Domain.Operations;
using CtlFlow.Execution.Execd.Service.Security;
using CtlFlow.Execution.Execd.Service.Security.Callers;
using CtlFlow.Execution.Execd.Service.Security.Workloads;
using CtlFlow.Execution.V1;
using Grpc.Core;
using static CtlFlow.Execution.Execd.Service.Grpc.Responses.ExecutionResponses;
using static CtlFlow.Execution.Execd.Service.Security.Workloads.WorkloadAuthentication;
using WorkloadDatabase =
    CtlFlow.Execution.Execd.Db.Workloads.Workloads;

namespace CtlFlow.Execution.Execd.Service.Grpc;

internal sealed partial class ExecutionGrpcService
{
    private IReadOnlySet<KubernetesServiceAccountSubject>?
        _policydOnlyCallers;

    // The one admitted caller of the resolver, as an autonomous kernel set so
    // authentication rejects invocation tokens on this service-to-service call.
    private IReadOnlySet<KubernetesServiceAccountSubject> PolicydOnlyCallers =>
        _policydOnlyCallers ??= new HashSet<KubernetesServiceAccountSubject>
        {
            _settings.PolicydCaller
        };

    // Confirms one admitted product operation for one authenticated Workload
    // ServiceAccount subject.
    //
    // This method deliberately performs no authorization call. Policyd calls it
    // while deciding, so calling Policyd here would make authorization recurse.
    // Admission is exact and method-specific: only Policyd may call it, and no
    // operator path exists.
    public override async Task<ResolveWorkloadOperationBindingResponse>
        ResolveWorkloadOperationBinding(
            ResolveWorkloadOperationBindingRequest request,
            ServerCallContext context)
    {
        // Admission is exact and method-specific: Policyd is the only admitted
        // caller, authenticated as an autonomous kernel workload with no
        // invocation token. The service-wide caller sets do not apply here.
        var identity = await AuthenticateWorkloadRequest(
            context.RequestHeaders,
            _tokenAuthorities,
            PolicydOnlyCallers,
            NoAutonomousCallers,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        if (identity.ImmediateCaller is not
                AuthenticatedExecutionCaller.Workload workloadCaller
            || workloadCaller.Subject != _settings.PolicydCaller)
        {
            throw new RpcException(new Status(
                StatusCode.PermissionDenied,
                "Caller is not admitted"));
        }

        // Both selectors are validated before any lookup: a malformed field is
        // an invalid request, not a concealed absence.
        RequireDerivedSubject(request.ServiceAccountSubject);
        var operation = await ParseOperationToken(
            request.Operation,
            context.CancellationToken);

        // The subject is a value Execd itself derived; the operation is an
        // untrusted selector confirmed against the admitted snapshot. The
        // whole resolution — subject, operation membership, Workload state,
        // App, Package, and Placement ancestry — comes from one consistent
        // database snapshot.
        var binding = await WorkloadDatabase.ResolveWorkloadOperationBinding(
            _database,
            request.ServiceAccountSubject,
            operation,
            context.CancellationToken);
        if (binding is null)
        {
            throw NotFound();
        }

        return new ResolveWorkloadOperationBindingResponse
        {
            EffectivePlacementTarget =
                CreatePlacementTargetResponse(binding.EffectiveTarget),
            AppId = binding.AppId.Value,
            PackageId = binding.PackageId.Value
        };
    }

    // Only Execd's own derived subject form can name a Workload; anything else
    // is a malformed field rather than an unknown subject.
    private static void RequireDerivedSubject(string value)
    {
        if (value.Length is < 1 or > 512)
        {
            throw InvalidArgument("Service account subject is invalid");
        }

        try
        {
            _ = Domain.Naming.NativeNames.ParseServiceAccountSubject(value);
        }
        catch (InvalidOperationException)
        {
            throw InvalidArgument("Service account subject is invalid");
        }
    }

    private static async ValueTask<OperationToken> ParseOperationToken(
        string value,
        CancellationToken cancellation)
    {
        try
        {
            return await OperationToken.Parse(value, cancellation);
        }
        catch (ArgumentException)
        {
            throw InvalidArgument("Operation token is invalid");
        }
    }

    private static RpcException InvalidArgument(string message) =>
        new(new Status(StatusCode.InvalidArgument, message));

    // An unknown subject, an inactive Workload or Placement ancestor, and an
    // unadmitted operation are indistinguishable to the caller.
    private static RpcException NotFound() =>
        new(new Status(
            StatusCode.NotFound,
            "No admitted Workload operation binding"));
}
