using System.Security.Cryptography;
using System.Text;

namespace CtlFlow.Tenancy.Tenantd.Domain.Requests;

public sealed record RequestDigest
{
    private RequestDigest(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static RequestDigest Calculate(string canonicalInput)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(canonicalInput));
        return new RequestDigest(Convert.ToHexString(bytes).ToLowerInvariant());
    }

    public static RequestDigest FromStorage(string value)
    {
        if (value.Length != 64 || value.Any(character =>
                character is not (>= 'a' and <= 'f' or >= '0' and <= '9')))
        {
            throw new InvalidOperationException(
                "Stored request digest is invalid");
        }

        return new RequestDigest(value);
    }

    public override string ToString() => Value;
}
