using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Policy.Policyd.Db.Providers;

public sealed record PolicyDatabase(
    IDbContextFactory<PolicyDbContext> Contexts);
