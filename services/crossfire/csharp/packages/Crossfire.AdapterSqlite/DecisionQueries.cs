using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class DecisionQueries
{
    public static Result<DecisionView?> Find(CrossfireDbContext context, string id)
    {
        var row = Stored.Read(() => context.RuntimeDecision.AsNoTracking().SingleOrDefault(row => row.Id == id));
        if (!row.IsSuccess) return Result<DecisionView?>.Fail(row.Error);
        if (row.Value is null) return Result<DecisionView?>.Success(null);
        var questions = Stored.Read(() => context.RuntimeDecisionQuestion.AsNoTracking().Where(row => row.DecisionId == id).OrderBy(row => row.Position).ToArray());
        if (!questions.IsSuccess) return Result<DecisionView?>.Fail(questions.Error);
        var options = Stored.Read(() => context.RuntimeDecisionOption.AsNoTracking().Where(row => row.DecisionId == id).OrderBy(row => row.Position).ToArray());
        if (!options.IsSuccess) return Result<DecisionView?>.Fail(options.Error);
        var value = row.Value;
        return Result<DecisionView?>.Success(new(new(value.Id, value.RunId, value.Runtime, value.SessionId, value.RequestId, value.TurnId, value.ItemId,
            value.Kind, value.Action, value.ReviewText, value.Blocking == 1, value.ExpiresAt,
            questions.Value.Select(question => new DecisionQuestion(question.QuestionId, question.Title, question.Prompt, question.Secret == 1, question.AllowText == 1,
                options.Value.Where(option => option.QuestionId == question.QuestionId).Select(option => new DecisionOption(option.OptionId, option.Label, option.Description)).ToArray())).ToArray()),
            value.AgentId, value.CreatedAt, value.Status));
    }

    public static Result<IReadOnlyList<DecisionSummary>> Pending(CrossfireDbContext context)
        => Stored.Read<IReadOnlyList<DecisionSummary>>(() => context.RuntimeDecision.AsNoTracking().Where(row => row.Status == "pending" || row.Status == "answered")
            .Select(row => new DecisionSummary(row.Id, row.AgentId, row.RunId, row.Runtime, row.SessionId, row.RequestId, row.TurnId, row.ItemId,
                row.Kind, row.Action, row.Blocking == 1, row.ExpiresAt, row.CreatedAt, row.Status)).ToArray());

    public static Result<Page<DecisionSummary>> List(CrossfireDbContext context, string agentId, int page, int pageSize, string? status)
    {
        var offset = checked((page - 1) * pageSize);
        var count = Stored.Read(() => context.RuntimeDecision.AsNoTracking().Where(row => row.AgentId == agentId && (status == null || row.Status == status)).LongCount());
        if (!count.IsSuccess) return Result<Page<DecisionSummary>>.Fail(count.Error);
        var items = Stored.Read(() => context.RuntimeDecision.AsNoTracking().Where(row => row.AgentId == agentId && (status == null || row.Status == status))
            .OrderByDescending(row => row.CreatedAt).ThenBy(row => row.Id).Skip(offset).Take(pageSize)
            .Select(row => new DecisionSummary(row.Id, row.AgentId, row.RunId, row.Runtime, row.SessionId, row.RequestId, row.TurnId, row.ItemId,
                row.Kind, row.Action, row.Blocking == 1, row.ExpiresAt, row.CreatedAt, row.Status)).ToArray());
        return items.Map(values => new Page<DecisionSummary>(values, page, pageSize, count.Value));
    }

    public static Result<IReadOnlyList<DecisionAnswer>> Answers(CrossfireDbContext context, string id)
        => Stored.Read<IReadOnlyList<DecisionAnswer>>(() => context.RuntimeDecisionAnswer.AsNoTracking().Where(row => row.DecisionId == id)
            .Select(row => new DecisionAnswer(row.QuestionId, row.OptionId, row.AnswerText)).ToArray());
}
