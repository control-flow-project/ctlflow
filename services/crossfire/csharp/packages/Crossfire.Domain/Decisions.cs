using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class Decisions
{
    private static bool Same(DecisionCreation original, DecisionCreation input)
    {
        if (original.Id != input.Id || original.RunId != input.RunId || original.Runtime != input.Runtime || original.SessionId != input.SessionId
            || original.RequestId != input.RequestId || original.TurnId != input.TurnId || original.ItemId != input.ItemId || original.Kind != input.Kind
            || original.Action != input.Action || original.Review != input.Review || original.Blocking != input.Blocking || original.ExpiresAt != input.ExpiresAt
            || original.Questions.Count != input.Questions.Count) return false;
        for (var index = 0; index < original.Questions.Count; index++)
        {
            var left = original.Questions[index]; var right = input.Questions[index];
            if (left.Id != right.Id || left.Title != right.Title || left.Prompt != right.Prompt || left.Secret != right.Secret
                || left.AllowText != right.AllowText || !left.Options.SequenceEqual(right.Options)) return false;
        }
        return true;
    }

    public static Result<DecisionView> Current(DecisionPorts ports, DecisionView value)
        => CurrentStatus(ports, value.AgentId, value.Native.RunId, value.Native.ExpiresAt, value.Status).Map(status => value with { Status = status });

    private static Result<string> CurrentStatus(DecisionPorts ports, string agentId, string runId, long? expiresAt, string status)
    {
        if (status is not ("pending" or "answered")) return Result<string>.Success(status);
        var run = ports.LiveRun(agentId, runId);
        if (!run.IsSuccess && run.Error.Code != "conflict") return Result<string>.Fail(run.Error);
        return Result<string>.Success(expiresAt is not null && expiresAt <= ports.Authorization.Now() || !run.IsSuccess ? "expired" : status);
    }

    public static Result<DecisionView> Create(DecisionPorts ports, Actor actor, string agentId, DecisionCreation input)
    {
        if (input.Runtime is not ("codex" or "pi")) return Results.Fail<DecisionView>("invalid", "Unsupported native runtime");
        return ports.Transaction.Run(() =>
        {
            var authority = Authorization.Require(ports.Authorization, actor, "runtime.report.self");
            if (!authority.IsSuccess) return Result<DecisionView>.Fail(authority.Error);
            if (actor.PrincipalId != agentId) return Results.Fail<DecisionView>("missing", "Agent not found");
            var run = ports.LiveRun(agentId, input.RunId);
            if (!run.IsSuccess) return Result<DecisionView>.Fail(run.Error);
            if (input.ExpiresAt is not null && input.ExpiresAt <= ports.Authorization.Now()) return Results.Fail<DecisionView>("conflict", "The native decision has already expired");
            if (input.Questions.Select(question => question.Id).Distinct(StringComparer.Ordinal).Count() != input.Questions.Count
                || input.Questions.Any(question => question.Options.Select(option => option.Id).Distinct(StringComparer.Ordinal).Count() != question.Options.Count || !question.AllowText && question.Options.Count == 0))
                return Results.Fail<DecisionView>("invalid", "Native questions need unique identities and an answer mechanism");
            var previous = ports.Find(input.Id);
            if (!previous.IsSuccess) return Result<DecisionView>.Fail(previous.Error);
            if (previous.Value is not null) return previous.Value.AgentId == agentId && Same(previous.Value.Native, input)
                ? Current(ports, previous.Value) : Results.Fail<DecisionView>("conflict", "Decision identity is already bound to another native request");
            var value = new DecisionView(input, agentId, ports.Authorization.Now(), "pending");
            var saved = ports.Insert(value);
            return saved.IsSuccess ? Result<DecisionView>.Success(value) : Result<DecisionView>.Fail(saved.Error);
        });
    }

    public static Result<DecisionView> Read(DecisionPorts ports, Actor actor, string agentId, string id)
    {
        var authority = Authorization.Agent(ports.Authorization, actor, agentId, "read");
        if (!authority.IsSuccess) return Result<DecisionView>.Fail(authority.Error);
        var found = ports.Find(id);
        if (!found.IsSuccess) return Result<DecisionView>.Fail(found.Error);
        return found.Value?.AgentId == agentId ? ports.Transaction.Run(() => Current(ports, found.Value))
            : Results.Fail<DecisionView>("missing", "Decision not found");
    }

    public static Result<Unit> Answer(DecisionPorts ports, Actor actor, string agentId, string id, IReadOnlyList<DecisionAnswer> answers, string requestId)
        => ports.Transaction.Run(() =>
        {
            var authority = Authorization.Require(ports.Authorization, actor, "runtime.decision.answer.owned");
            if (!authority.IsSuccess) return Result<Unit>.Fail(authority.Error);
            var agent = ports.Authorization.Agent(agentId);
            if (!agent.IsSuccess) return Result<Unit>.Fail(agent.Error);
            if (actor.Kind != "human" || agent.Value?.OwnerId != actor.PrincipalId) return Results.Fail<Unit>("missing", "Owner decision not found");
            var decision = Read(ports, actor, agentId, id);
            if (!decision.IsSuccess) return Result<Unit>.Fail(decision.Error);
            if (decision.Value.Status != "pending") return Results.Fail<Unit>("conflict", "This native request is no longer pending");
            var questions = decision.Value.Native.Questions;
            if (answers.Count != questions.Count || answers.Select(answer => answer.QuestionId).Distinct(StringComparer.Ordinal).Count() != questions.Count)
                return Results.Fail<Unit>("invalid", "Answer every native question exactly once");
            foreach (var question in questions)
            {
                var answer = answers.FirstOrDefault(value => value.QuestionId == question.Id);
                if (answer is null || (answer.OptionId is null) == (answer.Text is null) || answer.OptionId is not null && !question.Options.Any(option => option.Id == answer.OptionId)
                    || answer.Text is not null && (!question.AllowText || string.IsNullOrWhiteSpace(answer.Text)))
                    return Results.Fail<Unit>("invalid", "Answer is not one of the native choices");
            }
            var saved = ports.Answer(id, answers);
            return saved.IsSuccess ? ports.Audit(new(requestId, actor.Kind, actor.PrincipalId, actor.PrincipalId, "runtime-decision", id,
                "runtime-decision.answer", Message: "Owner submitted a native answer; answer content is private.")) : saved;
        });

    public static Result<DecisionPoll> Poll(DecisionPorts ports, Actor actor, string agentId, string id)
    {
        var authority = Authorization.Require(ports.Authorization, actor, "runtime.report.self");
        if (!authority.IsSuccess) return Result<DecisionPoll>.Fail(authority.Error);
        if (actor.PrincipalId != agentId) return Results.Fail<DecisionPoll>("missing", "Decision not found");
        var current = Read(ports, actor, agentId, id);
        if (!current.IsSuccess) return Result<DecisionPoll>.Fail(current.Error);
        var answers = current.Value.Status == "answered" ? ports.Answers(id) : Result<IReadOnlyList<DecisionAnswer>>.Success([]);
        return answers.Map(values => new DecisionPoll(current.Value.Status, values));
    }

    public static Result<bool> Receipt(DecisionPorts ports, Actor actor, string agentId, string id, string status)
        => ports.Transaction.Run(() =>
        {
            var authority = Authorization.Require(ports.Authorization, actor, "runtime.report.self");
            if (!authority.IsSuccess) return Result<bool>.Fail(authority.Error);
            if (actor.PrincipalId != agentId) return Results.Fail<bool>("missing", "Decision not found");
            var found = ports.Find(id);
            if (!found.IsSuccess) return Result<bool>.Fail(found.Error);
            if (found.Value is null) return Result<bool>.Success(false);
            if (found.Value.AgentId != agentId) return Results.Fail<bool>("missing", "Decision not found");
            if (status == "responded" && found.Value.Status is not ("answered" or "responded")) return Results.Fail<bool>("conflict", "No answer was submitted to this native request");
            if (status == "cancelled" && found.Value.Status is not ("pending" or "answered" or "cancelled")) return Results.Fail<bool>("conflict", "The native request is already settled");
            return ports.Status(id, status).Map(_ => true);
        });

    public static Result<Unit> Expire(DecisionPorts ports)
        => ports.Transaction.Run(() =>
        {
            var pending = ports.Pending();
            if (!pending.IsSuccess) return Result<Unit>.Fail(pending.Error);
            foreach (var decision in pending.Value)
            {
                var current = CurrentStatus(ports, decision.AgentId, decision.RunId, decision.ExpiresAt, decision.Status);
                if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
                if (current.Value != "expired") continue;
                var saved = ports.Status(decision.Id, "expired");
                if (!saved.IsSuccess) return saved;
            }
            return Results.Done();
        });
}
