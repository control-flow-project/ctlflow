namespace CtlFlow.Policy.Policyd.Domain.Catalog;

public static partial class OperationCatalog
{
    // The stored owner ID for each kernel owner, matching the specification's
    // operation_owner_id values.
    public static string GetKernelOwnerId(OperationOwner owner) =>
        owner switch
        {
            OperationOwner.Tenantd => "svc_tenantd",
            OperationOwner.Pkgd => "svc_pkgd",
            OperationOwner.Configd => "svc_configd",
            OperationOwner.Execd => "svc_execd",
            OperationOwner.Identityd => "svc_identityd",
            _ => throw new InvalidOperationException(
                "Operation owner is invalid")
        };
}
