namespace Crossfire.Domain;

public sealed record SetupDescriptor(string Server, string OwnerMatrixId, string PackageVersion, string Instructions);
