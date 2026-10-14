using Microsoft.EntityFrameworkCore;
using Crossfire.AdapterSqlite.Entities;

namespace Crossfire.AdapterSqlite;

public sealed partial class CrossfireDbContext
{
    private static void ConfigureTables3(ModelBuilder model)
    {
        model.Entity<WakeRuleRow>(entity =>
        {
            entity.ToTable("wake_rule");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.OwnerId).HasColumnName("owner_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ConfiguredById).HasColumnName("configured_by_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Name).HasColumnName("name").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Message).HasColumnName("message").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ScheduleKind).HasColumnName("schedule_kind").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.IntervalSeconds).HasColumnName("interval_seconds").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.CronExpression).HasColumnName("cron_expression").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.TimeZone).HasColumnName("time_zone").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.Enabled).HasColumnName("enabled").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Revision).HasColumnName("revision").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.UpdatedAt).HasColumnName("updated_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<WakeRuleAgentRow>(entity =>
        {
            entity.ToTable("wake_rule_agent");
            entity.HasKey(value => new { value.RuleId, value.AgentId });
            entity.Property(value => value.RuleId).HasColumnName("rule_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.NextDueAt).HasColumnName("next_due_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.LastDeliveredAt).HasColumnName("last_delivered_at").HasColumnType("INTEGER").ValueGeneratedNever();
        });
        model.Entity<WakeDeliveryRow>(entity =>
        {
            entity.ToTable("wake_delivery");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RuleId).HasColumnName("rule_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RuleRevision).HasColumnName("rule_revision").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RunId).HasColumnName("run_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SessionId).HasColumnName("session_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ScheduledAt).HasColumnName("scheduled_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Status).HasColumnName("status").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.DeliveredAt).HasColumnName("delivered_at").HasColumnType("INTEGER").ValueGeneratedNever();
        });
        model.Entity<AgentOwnerConversationRow>(entity =>
        {
            entity.ToTable("agent_owner_conversation");
            entity.HasKey(value => value.AgentId);
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.OwnerId).HasColumnName("owner_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RoomId).HasColumnName("room_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<RuntimeDecisionRow>(entity =>
        {
            entity.ToTable("runtime_decision");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RunId).HasColumnName("run_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Runtime).HasColumnName("runtime").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SessionId).HasColumnName("session_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RequestId).HasColumnName("request_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.TurnId).HasColumnName("turn_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ItemId).HasColumnName("item_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Kind).HasColumnName("kind").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Action).HasColumnName("action").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ReviewText).HasColumnName("review_text").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Blocking).HasColumnName("blocking").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ExpiresAt).HasColumnName("expires_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Status).HasColumnName("status").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
        model.Entity<RuntimeDecisionQuestionRow>(entity =>
        {
            entity.ToTable("runtime_decision_question");
            entity.HasKey(value => new { value.DecisionId, value.QuestionId });
            entity.Property(value => value.DecisionId).HasColumnName("decision_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.QuestionId).HasColumnName("question_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Position).HasColumnName("position").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Title).HasColumnName("title").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Prompt).HasColumnName("prompt").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Secret).HasColumnName("secret").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AllowText).HasColumnName("allow_text").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<RuntimeDecisionOptionRow>(entity =>
        {
            entity.ToTable("runtime_decision_option");
            entity.HasKey(value => new { value.DecisionId, value.QuestionId, value.OptionId });
            entity.Property(value => value.DecisionId).HasColumnName("decision_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.QuestionId).HasColumnName("question_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.OptionId).HasColumnName("option_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Position).HasColumnName("position").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Label).HasColumnName("label").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Description).HasColumnName("description").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
        model.Entity<RuntimeDecisionAnswerRow>(entity =>
        {
            entity.ToTable("runtime_decision_answer");
            entity.HasKey(value => new { value.DecisionId, value.QuestionId });
            entity.Property(value => value.DecisionId).HasColumnName("decision_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.QuestionId).HasColumnName("question_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.OptionId).HasColumnName("option_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.AnswerText).HasColumnName("answer_text").HasColumnType("TEXT").ValueGeneratedNever();
        });
        model.Entity<RuntimeObservationRow>(entity =>
        {
            entity.ToTable("runtime_observation");
            entity.HasKey(value => new { value.RunId, value.SessionId });
            entity.Property(value => value.RunId).HasColumnName("run_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SessionId).HasColumnName("session_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RoomId).HasColumnName("room_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.Runtime).HasColumnName("runtime").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.State).HasColumnName("state").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ObservedAt).HasColumnName("observed_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.HistoryMode).HasColumnName("history_mode").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.MaxInputBytes).HasColumnName("max_input_bytes").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ErrorMessage).HasColumnName("error_message").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.LastActivityAt).HasColumnName("last_activity_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.HistoryAvailable).HasColumnName("history_available").HasColumnType("INTEGER").ValueGeneratedNever();
        });
        model.Entity<RuntimeSettingRow>(entity =>
        {
            entity.ToTable("runtime_setting");
            entity.HasKey(value => new { value.RunId, value.SessionId, value.Name });
            entity.Property(value => value.RunId).HasColumnName("run_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SessionId).HasColumnName("session_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Name).HasColumnName("name").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ConfiguredValue).HasColumnName("configured_value").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.EffectiveValue).HasColumnName("effective_value").HasColumnType("TEXT").ValueGeneratedNever();
        });
    }
}
