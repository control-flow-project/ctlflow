namespace CtlFlow.Configuration.Configd.Domain.Failures;

public sealed class ContractException : Exception
{
    public ContractException(ContractFailure failure)
        : base(failure.ToString())
    {
        Failure = failure;
    }

    public ContractFailure Failure { get; }

    public override string ToString() => $"ContractException({Failure})";
}
