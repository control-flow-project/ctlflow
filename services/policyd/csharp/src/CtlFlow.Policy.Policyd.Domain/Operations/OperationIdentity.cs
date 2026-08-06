using CtlFlow.Policy.Policyd.Domain.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Operations;

// The tagged identity stored policy is evaluated against. All three fields are
// non-empty and participate in policy keys, so two packages may declare the
// same token and a package token may be lexically identical to a kernel token
// without crossing authority.
public sealed record OperationIdentity
{
    // Closed union persisted in policy rows: 1 = kernel, 2 = package.
    public const int KernelOwnerKind = 1;
    public const int PackageOwnerKind = 2;

    private OperationIdentity(
        int ownerKind,
        string ownerId,
        OperationToken operation)
    {
        OwnerKind = ownerKind;
        OwnerId = ownerId;
        Operation = operation;
    }

    public int OwnerKind { get; }
    public string OwnerId { get; }
    public OperationToken Operation { get; }

    public static OperationIdentity Kernel(
        string ownerId,
        OperationToken operation) =>
        new(KernelOwnerKind, ValidateOwnerId(ownerId), operation);

    public static OperationIdentity Package(
        PackageId packageId,
        OperationToken operation) =>
        new(PackageOwnerKind, packageId.Value, operation);

    private static string ValidateOwnerId(string value)
    {
        if (value.Length is < 1 or > 128
            || value[0] is not (>= 'a' and <= 'z' or >= '0' and <= '9'))
        {
            throw new ArgumentException(
                "Operation owner ID is not canonical",
                nameof(value));
        }

        foreach (var character in value)
        {
            if (character is not (>= 'a' and <= 'z')
                and not (>= '0' and <= '9')
                and not ('_' or '-' or '.'))
            {
                throw new ArgumentException(
                    "Operation owner ID is not canonical",
                    nameof(value));
            }
        }

        return value;
    }
}
