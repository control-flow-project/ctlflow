namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal static partial class AuditDelivery
{
    private const int MaximumTokenLength = 16 * 1024;

    internal static async Task<AuditWorkloadToken> ReadAuditWorkloadToken(
        string path,
        CancellationToken cancellation)
    {
        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete,
            bufferSize: 4_096,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        if (stream.Length is < 1 or > MaximumTokenLength)
        {
            throw new InvalidOperationException(
                "Audit workload token file has an invalid length");
        }

        using var reader = new StreamReader(
            stream,
            System.Text.Encoding.UTF8,
            detectEncodingFromByteOrderMarks: false,
            bufferSize: 4_096,
            leaveOpen: false);
        var material = (await reader.ReadToEndAsync(cancellation)).Trim();
        if (material.Length is < 1 or > MaximumTokenLength
            || material.Any(char.IsWhiteSpace))
        {
            throw new InvalidOperationException(
                "Audit workload token material is invalid");
        }

        return new AuditWorkloadToken(material);
    }
}
