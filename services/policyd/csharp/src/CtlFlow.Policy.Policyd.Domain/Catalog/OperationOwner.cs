namespace CtlFlow.Policy.Policyd.Domain.Catalog;

// The fixed kernel operation owners. Product operations never appear here:
// their owner is the resolved Package identity, not a catalog member.
public enum OperationOwner
{
    Tenantd = 1,
    Pkgd = 2,
    Configd = 3,
    Execd = 4
}
