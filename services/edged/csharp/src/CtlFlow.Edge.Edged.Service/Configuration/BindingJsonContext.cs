using System.Text.Json.Serialization;

namespace CtlFlow.Edge.Edged.Service.Configuration;

[JsonSerializable(typeof(BindingDocument))]
[JsonSourceGenerationOptions(
    AllowTrailingCommas = false,
    PropertyNameCaseInsensitive = false,
    ReadCommentHandling = System.Text.Json.JsonCommentHandling.Disallow)]
internal sealed partial class BindingJsonContext : JsonSerializerContext;
