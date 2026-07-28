using CtlFlow.Configuration.Configd.Db.Custody;
using CtlFlow.Configuration.Configd.Domain.Secrets;

namespace CtlFlow.Configuration.Configd.Service.Grpc.Requests;

internal sealed record ParsedSecretPublication(
    SecretDraft Draft,
    SecretMaterialLease Material) : IDisposable
{
    public void Dispose() => Material.Dispose();
}
