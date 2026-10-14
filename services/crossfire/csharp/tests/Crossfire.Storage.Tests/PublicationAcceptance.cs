using System.Security.Cryptography;
using System.Text;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class PublicationAcceptance
{
    public static async Task Verify(CrossfireDbContext context, Actor owner, Actor administrator, long start)
    {
        var directory = PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "crossfire-reports-" + Identity.Identifier()));
        try
        {
            using var store = new PublicationStore(directory, 2, path => new StateLock(path));
            try { using var duplicate = new PublicationStore(directory, 2, path => new StateLock(path)); throw new InvalidOperationException("duplicate report owner was accepted"); }
            catch (IOException) { Equal(true, true, "same-process ownership refusal does not block indefinitely"); }
            var fixture = FleetFixture.Create(context, owner, start); var now = start;
            var ports = PublicationCommands.Ports(context, () => now, store, new(1073741824, 134217728, 4096, 128, 2), "https://content.example.test");
            var bytes = Encoding.UTF8.GetBytes("<!doctype html><title>Reviewed report</title><p>Verified</p>");
            var file = new PublicationFileInput("index.html", "text/html", bytes.Length, Convert.ToHexStringLower(SHA256.HashData(bytes)));
            var manifest = new PublicationCreation("Reviewed report", [file]);
            Equal(PublicationValues.Validate(manifest).Value, (long)bytes.Length, "report bytes are summed from the declared manifest");
            foreach (var path in new[] { "../index.html", "a/../index.html", "/index.html", "a//index.html", "a\\b.html", "a./index.html", "a/%2e/index.html" })
                Equal(PublicationValues.Validate(manifest with { Files = [file with { Path = path }] }).IsSuccess, false, "unsafe report path is rejected: " + path);
            Equal(PublicationValues.Validate(manifest with { Files = [file, file with { Path = "INDEX.HTML" }] }).IsSuccess, false, "case-colliding public paths are rejected");
            Equal(PublicationValues.Validate(manifest with { Files = [file, file with { Path = "index.html/child.html" }] }).IsSuccess, false, "a report file cannot also be a directory");
            Equal(PublicationValues.Validate(manifest with { Files = [file with { Bytes = PublicationValues.FileBytes + 1 }] }).IsSuccess, false, "single-file maximum is enforced before I/O");
            Equal(Publications.Create(ports, owner, manifest, Identity.Identifier()).Error.Code, "forbidden", "humans do not impersonate a report publisher");
            Equal(Publications.Create(ports with { Budget = ports.Budget with { AgentBytes = bytes.Length - 1 } }, fixture.Actor, manifest, Identity.Identifier()).Error.Code, "capacity", "staging reserves capacity before receiving bytes");
            var created = Publications.Create(ports, fixture.Actor, manifest, Identity.Identifier()); Equal(created.IsSuccess, true, "active fleet agent stages its manifest");
            var id = created.Value.Summary.Record.Publication.Id; var key = created.Value.Summary.Record.Publication.PublicKey; var declared = created.Value.Files[0];
            Equal(created.Value.Summary.Url is null, true, "staging does not expose a public URL");
            Equal(PublicationQueries.PublicFile(context, key, "index.html").Value is null, true, "uncommitted bytes cannot be publicly resolved");
            Equal((await Publications.Commit(ports, fixture.Actor, id, 0, Identity.Identifier())).Error.Code, "conflict", "publication requires every declared file");
            using (var wrong = new MemoryStream(new byte[bytes.Length]))
                Equal((await Publications.Upload(ports, fixture.Actor, id, declared.Id, bytes.Length, wrong)).Error.Code, "invalid", "digest mismatch never marks a file uploaded");
            Equal(PublicationQueries.Files(context, id).Value[0].Uploaded, false, "invalid upload does not alter the manifest receipt");
            using (var input = new MemoryStream(bytes, writable: false))
                Equal((await Publications.Upload(ports, fixture.Actor, id, declared.Id, bytes.Length, input)).IsSuccess, true, "bounded streaming upload matches its manifest");
            Equal(System.IO.Directory.GetFiles(Path.Combine(directory, id), ".pending-*").Length, 0, "failed and successful upload temporaries are disposed");
            var committed = await Publications.Commit(ports, fixture.Actor, id, 0, Identity.Identifier()); Equal(committed.IsSuccess, true, "manifest verification precedes atomic publication");
            Equal(committed.Value.Summary.Url, "https://content.example.test/" + key + "/index.html", "public link contains only the unguessable capability");
            Equal((await Publications.Commit(ports, fixture.Actor, id, 0, Identity.Identifier())).Value.Summary.Record.Publication.Revision, 1L, "exact commit retry is idempotent");
            Equal(PublicationQueries.PublicFile(context, key, "index.html").Value?.File.Id, declared.Id, "published file resolution uses exact declared path");
            var opened = store.Read(id, declared); Equal(opened.IsSuccess, true, "report storage opens an owned regular file");
            await using (var stream = opened.Value)
            { using var output = new MemoryStream(); await stream.CopyToAsync(output); Equal(Convert.ToHexStringLower(SHA256.HashData(output.ToArray())), file.Sha256, "streamed public bytes retain the declared digest"); }
            Equal(Publications.List(ports, owner, new(1, 20, "Reviewed")).Value.Items.Count, 1, "owner report listing is paginated and scoped");
            Equal(Publications.Read(ports, administrator, id).Value.Summary.AllowedActions.Contains("delete"), true, "administrator can remove another owner's report");
            Equal((await Publications.Delete(ports, owner, id, 0, Identity.Identifier())).Error.Code, "conflict", "public deletion requires the reviewed revision");
            Equal((await Publications.Delete(ports, owner, id, 1, Identity.Identifier())).IsSuccess, true, "owner deletion fences reads before reclaiming storage");
            Equal(PublicationQueries.PublicFile(context, key, "index.html").Value is null, true, "deleted public capability stops resolving immediately");
            Equal(System.IO.Directory.Exists(Path.Combine(directory, id)), false, "deleted report files are reclaimed");
            Equal((await Publications.Delete(ports, owner, id, 1, Identity.Identifier())).IsSuccess, true, "deletion replay remains idempotent");
            Equal(PublicationQueries.Usage(context, fixture.AgentId).Value.AgentBytes, 0L, "cleaned report releases reserved capacity");
            var staged = Publications.Create(ports, fixture.Actor, manifest, Identity.Identifier()).Value; now += 3600001;
            Equal((await Publications.Maintain(ports)).Value, 1L, "expired staging is fenced and cleaned without a browser visit");
            Equal(PublicationQueries.Find(context, staged.Summary.Record.Publication.Id).Value?.Publication.State, "deleted", "expired manifest retains its single canonical deleted state");
        }
        finally { System.IO.Directory.Delete(directory, recursive: true); }
    }
}
