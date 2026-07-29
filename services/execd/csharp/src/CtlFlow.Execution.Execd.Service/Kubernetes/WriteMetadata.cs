using System.Text.Json;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesBodies
{
    internal static void WriteMetadata(
        Utf8JsonWriter writer,
        string name,
        string? namespaceName,
        IReadOnlyDictionary<string, string> annotations,
        IReadOnlyDictionary<string, string>? labels = null)
    {
        writer.WriteStartObject("metadata");
        writer.WriteString("name", name);
        if (namespaceName is not null)
        {
            writer.WriteString("namespace", namespaceName);
        }

        writer.WriteStartObject("annotations");
        foreach (var annotation in annotations)
        {
            writer.WriteString(annotation.Key, annotation.Value);
        }

        writer.WriteEndObject();
        if (labels is not null)
        {
            writer.WriteStartObject("labels");
            foreach (var label in labels)
            {
                writer.WriteString(label.Key, label.Value);
            }

            writer.WriteEndObject();
        }

        writer.WriteEndObject();
    }
}
