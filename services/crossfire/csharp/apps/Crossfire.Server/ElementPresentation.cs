using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.Server.Http;

namespace Crossfire.Server;

public static class ElementPresentation
{
    public static JsonElement Read(string directory, string origin)
    {
        var name = "config." + new Uri(origin).Host + ".json";
        FileStream stream;
        try { stream = AssetFiles.Open(directory, name); }
        catch (FileNotFoundException) { return JsonValues.Object(_ => { }); }
        using (stream)
        {
            if (stream.Length > 65536) throw new IOException("Element presentation configuration exceeds 64 KiB");
            using var document = JsonDocument.Parse(stream);
            if (document.RootElement.ValueKind != JsonValueKind.Object) throw new IOException("Invalid Element presentation configuration");
            return JsonValues.Object(writer =>
            {
                foreach (var name in new[] { "brand", "default_theme", "branding", "embedded_pages", "setting_defaults" })
                    if (document.RootElement.TryGetProperty(name, out var value)) { writer.WritePropertyName(name); value.WriteTo(writer); }
            });
        }
    }
}
