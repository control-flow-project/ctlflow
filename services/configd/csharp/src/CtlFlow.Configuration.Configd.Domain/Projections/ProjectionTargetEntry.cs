using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;

namespace CtlFlow.Configuration.Configd.Domain.Projections;

public class ProjectionTargetEntry
{
    private long _enteredAtRevision;
    private string _projectionId = null!;
    private string _targetVersionId = null!;

    private ProjectionTargetEntry()
    {
    }

    internal ProjectionTargetEntry(
        ProjectionId projectionId,
        ProjectionTarget target,
        Revision enteredAtRevision)
    {
        _projectionId = projectionId.Value;
        _targetVersionId = target switch
        {
            ProjectionTarget.Configuration configuration =>
                configuration.VersionId.Value,
            ProjectionTarget.Secret secret => secret.VersionId.Value,
            _ => throw new InvalidOperationException(
                "Projection target is invalid")
        };
        _enteredAtRevision = enteredAtRevision.Value;
    }

    public ProjectionId ProjectionId =>
        ProjectionId.FromStorage(_projectionId);

    public Revision EnteredAtRevision =>
        Revision.FromStorage(_enteredAtRevision);
}
