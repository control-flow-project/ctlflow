using System.Net;
using System.Text.Json;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal sealed record KubernetesObject(
    HttpStatusCode StatusCode,
    JsonElement? Document);
