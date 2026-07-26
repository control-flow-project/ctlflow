using System.Security.Cryptography;

namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public sealed record InvocationTokenId
{
    private InvocationTokenId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static InvocationTokenId Generate() =>
        new(Convert.ToHexString(
            RandomNumberGenerator.GetBytes(16)).ToLowerInvariant());
}
