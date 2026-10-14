namespace Crossfire.AdapterSqlite.Entities;

public class RuntimeDecisionOptionRow
{
    public string DecisionId { get; set; } = "";
    public string QuestionId { get; set; } = "";
    public string OptionId { get; set; } = "";
    public long Position { get; set; }
    public string Label { get; set; } = "";
    public string Description { get; set; } = "";
}
