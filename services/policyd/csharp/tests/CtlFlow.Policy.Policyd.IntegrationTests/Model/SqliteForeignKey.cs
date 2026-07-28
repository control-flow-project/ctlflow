namespace CtlFlow.Policy.Policyd.IntegrationTests.Model;

internal sealed record SqliteForeignKey(
    string Table,
    IReadOnlyList<string> Columns,
    string PrincipalTable,
    IReadOnlyList<string> PrincipalColumns,
    string OnDelete)
{
    internal string Signature =>
        $"{Table}({string.Join(",", Columns)})"
        + $"->{PrincipalTable}({string.Join(",", PrincipalColumns)})"
        + $":{OnDelete}";
}
