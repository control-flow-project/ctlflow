using System.Reflection;

namespace CtlFlow.Audit.Auditd.Db.Schema;

public static partial class Schemas
{
    private const string ManifestResourceName =
        "CtlFlow.Audit.Auditd.SchemaManifest";
    private static readonly IReadOnlyList<string> ExpectedMigrationNames =
        LoadExpectedMigrationNames();

    public static IReadOnlyList<string> ReadExpectedMigrationNames() =>
        ExpectedMigrationNames;

    private static IReadOnlyList<string> LoadExpectedMigrationNames()
    {
        using var stream = typeof(AuditDbContext).Assembly
            .GetManifestResourceStream(ManifestResourceName)
            ?? throw new InvalidOperationException(
                "The embedded schema manifest is missing");
        using var reader = new StreamReader(stream);
        var names = new List<string>();

        while (reader.ReadLine() is { } line)
        {
            var separator = line.IndexOf('\t');
            if (separator <= 0 || line.Length - separator - 1 != 64)
            {
                throw new InvalidOperationException(
                    "The embedded schema manifest is invalid");
            }

            names.Add(line[..separator]);
        }

        if (names.Count == 0)
        {
            throw new InvalidOperationException(
                "The embedded schema manifest is empty");
        }

        return names.AsReadOnly();
    }
}
