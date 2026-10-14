namespace Crossfire.AdapterSqlite.Entities;

public class PublicationFileRow
{
    public string Id { get; set; } = "";
    public string PublicationId { get; set; } = "";
    public string Path { get; set; } = "";
    public string MediaType { get; set; } = "";
    public long Bytes { get; set; }
    public string Sha256 { get; set; } = "";
    public long Uploaded { get; set; }
}
