using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class StatisticsAcceptance
{
    public static void Verify(CrossfireDbContext context, Actor owner, long now)
    {
        var fixture = FleetFixture.Create(context, owner, now);
        var flow = new TrafficFlow("!test:example.test", "@owner:example.test", "m.text", new(2, 1, 100, 40, 200, 60));
        var tokens = new TokenCounts(100, 20, null, 10, 5, 110);
        var batch = new StatisticsBatch(1, 10, 20, 0, [flow], [new("codex", "history", tokens)]);
        Equal(Statistics.Digest(batch), "f3e19a90c73621c777875d2b0e4f56c1893e954d53c45089bdae2d44815867b5", "statistics checkpoint digest matches canonical Node JSON bytes");
        Equal(StatisticsCommands.Record(context, fixture.AgentId, fixture.RunId, batch, now).IsSuccess, true, "bounded statistics interval persists");
        Equal(StatisticsCommands.Record(context, fixture.AgentId, fixture.RunId, batch, now).IsSuccess, true, "identical statistics receipt is idempotent");
        Equal(StatisticsCommands.Record(context, fixture.AgentId, fixture.RunId, batch with { Dropped = 1 }, now).Error.Code, "conflict", "same sequence cannot replace its summary");
        var first = StatisticsQueries.Read(context, [fixture.AgentId], now - 1, 1, 20).Value;
        Equal(first.Intervals, 1L, "hourly summaries are compacted per listener"); Equal(first.Totals.Observed, 2L, "replayed interval does not double count traffic");
        Equal(first.Tokens!.Input, 0L, "first native cumulative counter establishes a baseline"); Equal(first.Tokens.CacheWriteInput, null, "unknown cached writes remain unknown");
        var next = batch with { Sequence = 2, StartedAt = 20, EndedAt = 30, Dropped = 1, Usage = [new("codex", "history", new(150, 30, null, 20, 9, 170))] };
        Equal(StatisticsCommands.Record(context, fixture.AgentId, fixture.RunId, next, now + 1).IsSuccess, true, "subsequent cumulative usage stores only a delta");
        var second = StatisticsQueries.Read(context, [fixture.AgentId], now - 1, 1, 20).Value;
        Equal(second.Intervals, 1L, "multiple intervals do not grow unbounded rows within an hour"); Equal(second.Totals.Observed, 4L, "new interval traffic accumulates exactly once");
        Equal(second.Tokens!.Input, 50L, "input tokens use the recorded native delta"); Equal(second.Tokens.CachedInput, 10L, "cached tokens use the recorded native delta");
        Equal(second.Tokens.Output, 10L, "output token delta"); Equal(second.Tokens.ReasoningOutput, 4L, "reasoning token delta"); Equal(second.Dropped, 1L, "dropped summaries are retained without payloads");
        Equal(StatisticsCommands.Record(context, fixture.AgentId, fixture.RunId, batch with { Sequence = 3 }, now + 2).IsSuccess, true, "regressed native usage does not reject independent traffic");
        Equal(StatisticsQueries.Read(context, [fixture.AgentId], now - 1, 1, 20).Value.Dropped, 2L, "regressed usage is counted as a dropped sample");
        Equal(StatisticsQueries.Read(context, [fixture.AgentId], now + 3, 1, 20).Value.Tokens is null, true, "time-window filtering happens in SQL");
        Equal(StatisticsQueries.Read(context, [], now - 1, 1, 20).Value.Totals.Observed, 0L, "empty fleet statistics cannot include unrelated traffic");
        Equal(context.ListenerStatFlow.AsNoTracking().Count(row => row.RunId == fixture.RunId), 1, "only one compact flow key exists in the hour");
        var failed = Transactions.Run(context, () =>
        {
            var saved = StatisticsCommands.Record(context, fixture.AgentId, fixture.RunId, batch with { Sequence = 4 }, now + 3);
            return saved.IsSuccess ? Results.Fail<Unit>("conflict", "force outer rollback") : saved;
        });
        Equal(failed.Error.Code, "conflict", "statistics supports outer transaction rollback");
        var runId = fixture.RunId;
        Equal(context.ListenerStatCheckpoint.AsNoTracking().Single(row => row.RunId == runId).Sequence, 3L, "outer rollback restores exact checkpoint and counters");
    }
}
