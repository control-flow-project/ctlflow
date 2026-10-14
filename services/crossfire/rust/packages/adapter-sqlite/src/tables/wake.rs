diesel::table! {
    wake_delivery (id) {
        id -> Text,
        rule_id -> Text,
        agent_id -> Text,
        rule_revision -> BigInt,
        run_id -> Text,
        session_id -> Text,
        scheduled_at -> BigInt,
        created_at -> BigInt,
        status -> Text,
        delivered_at -> Nullable<BigInt>,
    }
}

diesel::table! {
    wake_notice (receiver_agent_id, event_id) {
        receiver_agent_id -> Text,
        event_id -> Text,
        sender_matrix_id -> Text,
        room_id -> Text,
        reserved_at -> BigInt,
        message_body -> Text,
        status -> Text,
        sent_at -> Nullable<BigInt>,
        native_event_id -> Nullable<Text>,
        next_attempt_at -> Nullable<BigInt>,
        last_error -> Nullable<Text>,
    }
}

diesel::table! {
    wake_rule (id) {
        id -> Text,
        owner_id -> Text,
        configured_by_id -> Text,
        name -> Text,
        message -> Text,
        schedule_kind -> Text,
        interval_seconds -> Nullable<BigInt>,
        cron_expression -> Nullable<Text>,
        time_zone -> Nullable<Text>,
        enabled -> BigInt,
        revision -> BigInt,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    wake_rule_agent (rule_id, agent_id) {
        rule_id -> Text,
        agent_id -> Text,
        next_due_at -> BigInt,
        last_delivered_at -> Nullable<BigInt>,
    }
}
