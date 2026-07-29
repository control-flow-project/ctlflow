export function createBindingDocument(
  origin: string,
  namespaceName: string,
  serviceAccountName: string
): object {
  const allMethods = [
    "GET",
    "HEAD",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS"
  ];
  const rule = (
    ruleId: string,
    methods: readonly string[],
    kind: "exact" | "prefix",
    path: string,
    upstreamPath: string,
    overrides: Readonly<Record<string, unknown>> = {}
  ): object => ({
    rule_id: ruleId,
    methods,
    match: { kind, path },
    upstream_path_prefix: upstreamPath,
    forward_request_headers: [],
    forward_response_headers: ["content-type"],
    set_request_headers: [],
    maximum_request_body_bytes: 65_536,
    maximum_response_body_bytes: 65_536,
    forward_trace_context: false,
    ...overrides
  });

  return {
    schema_version: 1,
    binding_id: "test-binding",
    caller: {
      namespace: namespaceName,
      service_account: serviceAccountName
    },
    origin,
    rules: [
      rule("root", allMethods, "exact", "/", "/echo"),
      rule("nested", allMethods, "prefix", "/nested", "/echo"),
      rule(
        "nested-deep",
        allMethods,
        "prefix",
        "/nested/deep",
        "/deep"),
      rule("api-exact", ["GET"], "exact", "/api", "/exact"),
      rule("api-prefix", ["GET", "POST"], "prefix", "/api", "/v2"),
      rule("method-get", ["GET"], "exact", "/method", "/echo"),
      rule(
        "method-delete",
        ["DELETE"],
        "exact",
        "/method",
        "/echo"),
      rule(
        "headers",
        ["POST"],
        "exact",
        "/headers",
        "/echo",
        {
          forward_request_headers: [
            "accept",
            "authorization",
            "content-type",
            "cookie",
            "x-app"
          ],
          forward_response_headers: [
            "content-type",
            "set-cookie",
            "x-upstream"
          ],
          set_request_headers: [{
            name: "x-literal",
            value: { literal: "fixed-value" }
          }, {
            name: "x-secret",
            value: { secret_name: "provider-key" }
          }]
        }),
      rule(
        "status",
        ["GET"],
        "exact",
        "/status",
        "/status",
        {
          forward_response_headers: [
            "content-type",
            "set-cookie",
            "x-upstream"
          ]
        }),
      rule(
        "redirect",
        ["GET"],
        "exact",
        "/redirect",
        "/redirect",
        { forward_response_headers: ["location"] }),
      rule(
        "small-request",
        ["POST"],
        "exact",
        "/small-request",
        "/echo",
        { maximum_request_body_bytes: 16 }),
      rule(
        "known-large",
        ["GET"],
        "exact",
        "/known-large",
        "/known-large",
        { maximum_response_body_bytes: 16 }),
      rule(
        "stream-large",
        ["GET"],
        "exact",
        "/stream-large",
        "/stream-large",
        { maximum_response_body_bytes: 16 }),
      rule("deadline", ["GET"], "exact", "/deadline", "/delay"),
      rule("slow", ["GET"], "exact", "/slow", "/slow"),
      rule("cancel", ["GET"], "exact", "/cancel", "/cancel"),
      rule(
        "binary",
        ["GET"],
        "exact",
        "/binary",
        "/binary",
        { forward_response_headers: ["content-type"] }),
      rule(
        "sse",
        ["GET"],
        "exact",
        "/sse",
        "/sse",
        { forward_response_headers: ["content-type"] }),
      rule(
        "trace-on",
        ["GET"],
        "exact",
        "/trace-on",
        "/echo",
        { forward_trace_context: true }),
      rule(
        "trace-off",
        ["GET"],
        "exact",
        "/trace-off",
        "/echo")
    ]
  };
}
