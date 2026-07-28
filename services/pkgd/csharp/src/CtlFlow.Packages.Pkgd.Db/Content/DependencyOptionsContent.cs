using CtlFlow.Packages.Pkgd.Domain.Packages;

namespace CtlFlow.Packages.Pkgd.Db.Content;

public sealed record DependencyOptionsContent(
    ComponentId ComponentId,
    DependencyName DependencyName,
    DependencyOptionsReference Reference,
    byte[] CanonicalJson);
