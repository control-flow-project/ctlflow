using System.Text.RegularExpressions;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record PublicationFileInput(string Path, string MediaType, long Bytes, string Sha256);
public sealed record PublicationCreation(string Title, IReadOnlyList<PublicationFileInput> Files);
public sealed record Publication(string Id, string AgentId, string PublicKey, string Title, string State, long Revision, long CreatedAt, long ExpiresAt,
    long? PublishedAt, long? DeletedAt, long? CleanedAt, long TotalBytes, long FileCount);
public sealed record PublicationFile(string Id, string PublicationId, PublicationFileInput Manifest, bool Uploaded);
public sealed record PublicationRecord(Publication Publication, string AgentName, string OwnerId, string OwnerName);
public sealed record PublicationSummary(PublicationRecord Record, string? Url, IReadOnlyList<string> AllowedActions);
public sealed record PublicationDetails(PublicationSummary Summary, IReadOnlyList<PublicationFile> Files);
public sealed record PublicationQuery(int Page, int PageSize, string Search, string? State = null, string? AgentId = null, string? OwnerId = null);
public sealed record PublicationUsage(long InstanceBytes, long AgentBytes, long InstanceCount, long AgentCount);
public sealed record PublicationBudget(long InstanceBytes, long AgentBytes, long InstanceCount, long AgentCount, int Uploads);
public sealed record PublicReportFile(Publication Publication, PublicationFile File);
public interface PublicationStorage : IDisposable
{
    ValueTask<Result<T>> Exclusive<T>(string id, Func<ValueTask<Result<T>>> operation);
    ValueTask<Result<Unit>> Upload(string id, PublicationFile file, Stream input, CancellationToken cancellation);
    ValueTask<Result<Unit>> Verify(string id, IReadOnlyList<PublicationFile> files, CancellationToken cancellation);
    Result<Stream> Read(string id, PublicationFile file);
    Result<Unit> Remove(string id);
}
public sealed record PublicationPorts(ListenerPorts Listener, PublicationStorage Store, PublicationBudget Budget, string Origin,
    Func<string, Result<PublicationRecord?>> Find, Func<string, Result<IReadOnlyList<PublicationFile>>> Files,
    Func<Publication, IReadOnlyList<PublicationFile>, Result<Unit>> Insert, Func<string, string, Result<Unit>> Uploaded,
    Func<string, long, long, Result<Unit>> Publish, Func<string, long, long, Result<Unit>> Fence, Func<string, long, Result<Unit>> Cleaned,
    Func<string, Result<PublicationUsage>> Usage, Func<PublicationQuery, Result<Page<PublicationRecord>>> Page,
    Func<long, int, Result<IReadOnlyList<Publication>>> Maintenance, Func<string, string, Result<PublicReportFile?>> PublicFile);

public static partial class PublicationValues
{
    public const long FileBytes = 8388608;
    public const long BundleBytes = 33554432;
    private static readonly IReadOnlyDictionary<string, string> Media = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["html"] = "text/html", ["css"] = "text/css", ["js"] = "text/javascript", ["mjs"] = "text/javascript", ["json"] = "application/json", ["txt"] = "text/plain", ["csv"] = "text/csv",
        ["png"] = "image/png", ["jpg"] = "image/jpeg", ["jpeg"] = "image/jpeg", ["gif"] = "image/gif", ["webp"] = "image/webp", ["avif"] = "image/avif", ["svg"] = "image/svg+xml", ["ico"] = "image/x-icon", ["woff"] = "font/woff", ["woff2"] = "font/woff2", ["pdf"] = "application/pdf"
    };
    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._/\-]*$", RegexOptions.CultureInvariant)]
    private static partial Regex PathPattern();
    [GeneratedRegex(@"^[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex DigestPattern();
    public static bool Path(string value) => value.Length is >= 1 and <= 240 && PathPattern().IsMatch(value)
        && value.Split('/').All(part => part.Length is >= 1 and <= 100 && char.IsAsciiLetterOrDigit(part[0]) && !part.EndsWith('.'));
    public static Result<long> Validate(PublicationCreation input)
    {
        if (TextRules.Blank(input.Title) || input.Title.Length > 200 || input.Title.Any(value => value is <= '\u001f' or '\u007f') || input.Files.Count is < 1 or > 512) return Results.Fail<long>("invalid", "A title and bounded static file manifest are required");
        long total = 0; var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in input.Files)
        {
            var suffix = file.Path[(file.Path.LastIndexOf('.') + 1)..];
            if (!Path(file.Path)) return Results.Fail<long>("invalid", "Use a relative report path with letters, digits, dots, underscores, hyphens and forward slashes");
            if (!Media.TryGetValue(suffix, out var media) || file.MediaType != media || file.Bytes is < 0 or > FileBytes || !DigestPattern().IsMatch(file.Sha256)) return Results.Fail<long>("invalid", "File size, MIME type or digest does not match the static manifest");
            if (!paths.Add(file.Path)) return Results.Fail<long>("invalid", "Report paths must be unique, including case"); total += file.Bytes;
        }
        foreach (var path in paths)
        {
            var offset = path.IndexOf('/');
            while (offset >= 0) { if (paths.Contains(path[..offset])) return Results.Fail<long>("invalid", "A file cannot also be a directory"); offset = path.IndexOf('/', offset + 1); }
        }
        return input.Files.Any(file => file.Path == "index.html") && total <= BundleBytes ? Result<long>.Success(total) : Results.Fail<long>("invalid", "A report requires index.html and at most 32 MiB of static files");
    }
}
