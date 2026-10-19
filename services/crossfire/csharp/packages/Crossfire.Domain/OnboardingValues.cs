namespace Crossfire.Domain;

public sealed record SetupDescriptor(string Server, string OwnerBackendUserId, string PackageVersion, string Instructions);
