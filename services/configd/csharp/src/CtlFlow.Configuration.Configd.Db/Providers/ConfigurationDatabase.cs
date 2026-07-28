using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Providers;

public sealed record ConfigurationDatabase(
    IDbContextFactory<ConfigurationDbContext> Contexts,
    ConfigurationMutationCoordinator AcquireMutation);
