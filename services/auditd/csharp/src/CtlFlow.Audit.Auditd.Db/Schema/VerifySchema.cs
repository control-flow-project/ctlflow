using CtlFlow.Audit.Auditd.Db.Providers;

namespace CtlFlow.Audit.Auditd.Db.Schema;

public static partial class Schemas
{
    public static async Task<SchemaCompatibility> VerifySchema(
        AuditDatabase auditDatabase,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = AuditDbTelemetry.StartOperation("verify_schema");
        var ledger = await VerifyMigrationLedger(auditDatabase, cancellation);
        if (ledger != SchemaCompatibility.Compatible)
        {
            return ledger;
        }

        await VerifyMappedSchema(auditDatabase, cancellation);
        return SchemaCompatibility.Compatible;
    }
}
