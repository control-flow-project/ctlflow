namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

internal sealed class InvalidFieldException(
    string field,
    string message,
    string reason = "FieldValueInvalid",
    int statusCode = StatusCodes.Status400BadRequest) : Exception(message)
{
    internal string Field { get; } = field;

    internal string Reason { get; } = reason;

    internal int StatusCode { get; } = statusCode;
}
