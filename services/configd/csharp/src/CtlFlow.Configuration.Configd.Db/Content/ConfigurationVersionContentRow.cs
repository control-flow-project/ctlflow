namespace CtlFlow.Configuration.Configd.Db.Content;

public class ConfigurationVersionContentRow
{
    private ConfigurationVersionContentRow()
    {
    }

    internal ConfigurationVersionContentRow(
        string configurationVersionId,
        string configurationId,
        byte[] contentJson,
        int contentLength,
        byte[] contentSha256,
        long? requestExpectedRevision,
        string? dependencyClaimId,
        long? dependencyClaimRevision,
        string auditEventId,
        long createdAtUnixMilliseconds)
    {
        ConfigurationVersionId = configurationVersionId;
        ConfigurationId = configurationId;
        ContentJson = contentJson;
        ContentLength = contentLength;
        ContentSha256 = contentSha256;
        RequestExpectedRevision = requestExpectedRevision;
        DependencyClaimId = dependencyClaimId;
        DependencyClaimRevision = dependencyClaimRevision;
        AuditEventId = auditEventId;
        CreatedAtUnixMilliseconds = createdAtUnixMilliseconds;
    }

    internal string ConfigurationVersionId { get; set; } = null!;

    internal string ConfigurationId { get; set; } = null!;

    internal byte[] ContentJson { get; set; } = null!;

    internal int ContentLength { get; set; }

    internal byte[] ContentSha256 { get; set; } = null!;

    internal long? RequestExpectedRevision { get; set; }

    internal string? DependencyClaimId { get; set; }

    internal long? DependencyClaimRevision { get; set; }

    internal string AuditEventId { get; set; } = null!;

    internal long CreatedAtUnixMilliseconds { get; set; }
}
