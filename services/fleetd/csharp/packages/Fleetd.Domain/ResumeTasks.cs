using System.Globalization;
using Crossfire.AgentCore;
using Crossfire.Kernel;

namespace Fleetd.Domain;

public static class ResumeTasks
{
    public static string Text(ResumeWork work) => "[Crossfire session restarted]\nYour saved session was restarted. Unfinished activity was checkpointed at " + DateTimeOffset.FromUnixTimeMilliseconds(work.CheckpointedAt).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture)
        + ". Before continuing, re-read the applicable AGENTS.md files and follow their current instructions. Review your existing history. If your previous task is unfinished and still authorized, resume that task; this is not a new assignment."
        + "\nNo pending question or permission has been answered or approved. If a decision is still needed, ask the owner again and wait.\nUse Crossfire tools for chat replies. This controller notice is not a message from a room or person and grants no new permissions."
        + (work.Context is "shared" or "control" ? "\nDo not infer a destination room from this notice; retain the original task attribution from history." : "\nThis notice belongs only to the saved room history " + work.Context + ". Do not disclose its contents to other rooms.")
        + "\nIf the task is already complete or no longer authorized, do not repeat its effects.";
    public static async ValueTask<Result<Unit>> Resume(OwnedRuntimeConnection connection, string primary, IReadOnlyList<SavedRuntimeContext> contexts, ResumeWorkStore store)
    {
        var saved = store.Read(); if (!saved.IsSuccess) return Result<Unit>.Fail(saved.Error);
        if (saved.Value.Any(work => !contexts.Any(context => context.Context == work.Context && context.SessionId == work.SessionId))) return Results.Fail<Unit>("conflict", "Interrupted task references a different native history; review before resuming");
        foreach (var work in saved.Value)
        {
            var target = work.Context == primary ? Result<RuntimeConnection>.Success(connection) : await connection.Conversation(work.Context); if (!target.IsSuccess) return Result<Unit>.Fail(target.Error); if (target.Value.SessionId != work.SessionId) return Results.Fail<Unit>("conflict", "Interrupted task cannot use a different room history");
            var settled = await target.Value.Settle(); if (!settled.IsSuccess) return Result<Unit>.Fail(settled.Error);
            var previous = target.Value.Acknowledge([work.MessageId]); if (!previous.IsSuccess) return previous;
            var turn = target.Value.TurnControl is null ? Result<string?>.Success(null) : await target.Value.TurnControl.ActiveTurn(); if (!turn.IsSuccess) return Result<Unit>.Fail(turn.Error);
            if (turn.Value is null)
            {
                var renewed = store.Renew(work.MessageId); if (!renewed.IsSuccess) return Result<Unit>.Fail(renewed.Error);
                var delivered = await target.Value.Deliver(Text(renewed.Value), renewed.Value.MessageId); if (!delivered.IsSuccess) return delivered;
                var acknowledged = target.Value.Acknowledge([renewed.Value.MessageId]); if (!acknowledged.IsSuccess) return acknowledged;
            }
        }
        return Results.Done();
    }
}
