namespace CtlFlow.Execution.Execd.Domain.Runs;

public abstract record RunCreationDecision
{
    private RunCreationDecision()
    {
    }

    public sealed record Create : RunCreationDecision;

    public sealed record Current(RunRecord Run)
        : RunCreationDecision;
}
