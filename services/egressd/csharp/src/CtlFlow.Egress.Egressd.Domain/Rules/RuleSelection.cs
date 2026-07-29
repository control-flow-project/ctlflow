namespace CtlFlow.Egress.Egressd.Domain.Rules;

public abstract record RuleSelection
{
    private RuleSelection()
    {
    }

    public sealed record Selected(EgressRule Rule) : RuleSelection;

    public sealed record MethodNotAllowed(
        IReadOnlyList<EgressMethod> Methods) : RuleSelection;

    public sealed record Missing : RuleSelection;
}
