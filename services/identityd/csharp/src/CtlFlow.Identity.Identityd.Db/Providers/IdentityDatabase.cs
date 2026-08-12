using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Providers;

public sealed record IdentityDatabase(
    IDbContextFactory<IdentityDbContext> Contexts,
    IdentityMutationCoordinator AcquireMutation);
