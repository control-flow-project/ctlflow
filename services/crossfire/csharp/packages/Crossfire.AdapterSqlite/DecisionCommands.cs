using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class DecisionCommands
{
    public static Result<Unit> Insert(CrossfireDbContext context, DecisionView decision)
    {
        var value = decision.Native;
        context.RuntimeDecision.Add(new() { Id = value.Id, AgentId = decision.AgentId, RunId = value.RunId, Runtime = value.Runtime,
            SessionId = value.SessionId, RequestId = value.RequestId, TurnId = value.TurnId, ItemId = value.ItemId, Kind = value.Kind,
            Action = value.Action, ReviewText = value.Review, Blocking = value.Blocking ? 1 : 0, ExpiresAt = value.ExpiresAt, CreatedAt = decision.CreatedAt, Status = decision.Status });
        for (var questionIndex = 0; questionIndex < value.Questions.Count; questionIndex++)
        {
            var question = value.Questions[questionIndex];
            context.RuntimeDecisionQuestion.Add(new() { DecisionId = value.Id, QuestionId = question.Id, Position = questionIndex, Title = question.Title,
                Prompt = question.Prompt, Secret = question.Secret ? 1 : 0, AllowText = question.AllowText ? 1 : 0 });
            for (var optionIndex = 0; optionIndex < question.Options.Count; optionIndex++)
            {
                var option = question.Options[optionIndex];
                context.RuntimeDecisionOption.Add(new() { DecisionId = value.Id, QuestionId = question.Id, OptionId = option.Id, Position = optionIndex, Label = option.Label, Description = option.Description });
            }
        }
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Answer(CrossfireDbContext context, string id, IReadOnlyList<DecisionAnswer> answers)
    {
        foreach (var answer in answers) context.RuntimeDecisionAnswer.Add(new() { DecisionId = id, QuestionId = answer.QuestionId, OptionId = answer.OptionId, AnswerText = answer.Text });
        context.RuntimeDecision.Single(row => row.Id == id).Status = "answered";
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Status(CrossfireDbContext context, string id, string status)
    {
        var row = context.RuntimeDecision.SingleOrDefault(row => row.Id == id);
        if (row is not null) row.Status = status;
        if (status != "answered") foreach (var answer in context.RuntimeDecisionAnswer.Where(row => row.DecisionId == id).ToArray()) context.RuntimeDecisionAnswer.Remove(answer);
        context.SaveChanges(); return Results.Done();
    }

    public static DecisionPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(AuthorizationQueries.Ports(context, now), new SqliteUnitOfWork(context), (agent, run) => ListenerQueries.Live(context, agent, run, now()),
            id => DecisionQueries.Find(context, id), value => Insert(context, value), (id, answers) => Answer(context, id, answers),
            id => DecisionQueries.Answers(context, id), (id, status) => Status(context, id, status), () => DecisionQueries.Pending(context),
            intent => MemberCommands.Audit(context, intent, now));
}
