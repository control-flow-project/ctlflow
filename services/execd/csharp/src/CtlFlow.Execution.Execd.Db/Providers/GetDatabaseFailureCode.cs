using System.Data.Common;
using Microsoft.Data.Sqlite;

namespace CtlFlow.Execution.Execd.Db.Providers;

public static partial class ExecutionDatabaseProviders
{
    public static int GetDatabaseFailureCode(DbException exception) =>
        exception is SqliteException sqlite
            ? sqlite.SqliteExtendedErrorCode
            : exception.ErrorCode;
}
