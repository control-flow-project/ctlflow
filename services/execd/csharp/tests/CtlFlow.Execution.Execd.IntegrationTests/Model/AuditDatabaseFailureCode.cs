using Microsoft.Data.Sqlite;
using static CtlFlow.Execution.Execd.Db.Providers.ExecutionDatabaseProviders;

namespace CtlFlow.Execution.Execd.IntegrationTests.Model;

internal static partial class ModelAudits
{
    internal static void AuditDatabaseFailureCode()
    {
        var failure = new SqliteException(
            "database failure",
            5,
            517);
        Require(
            GetDatabaseFailureCode(failure) == 517,
            "The extended SQLite failure code was not retained");
    }
}
