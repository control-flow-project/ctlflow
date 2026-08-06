namespace CtlFlow.Packages.Pkgd.Domain.Packages;

// One operation declared by one component of one immutable Package generation.
// The operation is unique across the whole generation, so exactly one component
// owns it there. A later generation may drop the token or bind it to another
// component without changing what this generation declared.
public class PackageComponentOperation
{
    private string _componentId = null!;
    private long _generation;
    private string _operation = null!;
    private string _packageId = null!;

    private PackageComponentOperation()
    {
    }

    internal PackageComponentOperation(
        PackageId packageId,
        Generation generation,
        ComponentId componentId,
        DeclaredOperation operation)
    {
        _packageId = packageId.Value;
        _generation = generation.Value;
        _componentId = componentId.Value;
        _operation = operation.Value;
    }

    public PackageId PackageId => PackageId.FromStorage(_packageId);
    public Generation Generation => Generation.FromStorage(_generation);
    public ComponentId ComponentId => ComponentId.FromStorage(_componentId);
    public DeclaredOperation Operation =>
        DeclaredOperation.FromStorage(_operation);
}
