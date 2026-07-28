using CtlFlow.Configuration.Configd.Db.Content;
using CtlFlow.Configuration.Configd.Db.Custody;
using CtlFlow.Configuration.Configd.Domain.Projections;

namespace CtlFlow.Configuration.Configd.Db.Projections;

public abstract class ProjectionPayloadLease : IDisposable
{
    private ProjectionPayloadLease()
    {
    }

    public abstract ProjectionDataKind Kind { get; }

    public abstract int Length { get; }

    public abstract void CopyTo(Span<byte> destination);

    public abstract void Dispose();

    internal sealed class Configuration(
        ConfigurationContentLease content) : ProjectionPayloadLease
    {
        public override ProjectionDataKind Kind =>
            ProjectionDataKind.Configuration;

        public override int Length => content.Reference.Length.Value;

        public override void CopyTo(Span<byte> destination) =>
            content.CopyTo(destination);

        public override void Dispose() => content.Dispose();
    }

    internal sealed class Secret(
        SecretMaterialLease material) : ProjectionPayloadLease
    {
        public override ProjectionDataKind Kind => ProjectionDataKind.Secret;

        public override int Length => material.Length;

        public override void CopyTo(Span<byte> destination) =>
            material.CopyTo(destination);

        public override void Dispose() => material.Dispose();
    }
}
