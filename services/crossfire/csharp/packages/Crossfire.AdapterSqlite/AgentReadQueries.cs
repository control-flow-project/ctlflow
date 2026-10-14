using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterSqlite;

public static class AgentReadQueries
{
    public static Result<AgentReadSnapshot> Load(CrossfireDbContext context, IReadOnlyList<string> ids, long now)
    {
        var records = AuthorizationQueries.AgentViews(context, ids); if (!records.IsSuccess) return Result<AgentReadSnapshot>.Fail(records.Error);
        var deployments = AgentDirectoryQueries.Deployments(context, ids); if (!deployments.IsSuccess) return Result<AgentReadSnapshot>.Fail(deployments.Error);
        var activity = ListenerBatchQueries.Activity(context, ids, now); if (!activity.IsSuccess) return Result<AgentReadSnapshot>.Fail(activity.Error);
        var runtime = RuntimeQueries.Summaries(context, ids); if (!runtime.IsSuccess) return Result<AgentReadSnapshot>.Fail(runtime.Error);
        return RetirementQueries.Snapshot(context, ids, [], now).Map(retirement => new AgentReadSnapshot(records.Value, deployments.Value, activity.Value, runtime.Value, retirement));
    }

    public static AgentReadPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(AuthorizationQueries.Ports(context, now), input => AgentDirectoryQueries.Page(context, input, now()), ids => Load(context, ids, now()));
}
