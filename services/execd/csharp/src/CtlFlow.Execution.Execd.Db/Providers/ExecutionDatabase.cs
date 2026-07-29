using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Providers;

public sealed record ExecutionDatabase(
    IDbContextFactory<ExecutionDbContext> Contexts,
    ExecutionMutationCoordinator AcquireMutation);
