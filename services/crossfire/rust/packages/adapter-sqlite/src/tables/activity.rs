diesel::table! {
    audit_event (id) {
        id -> Text,
        request_id -> Text,
        actor_credential_id -> Nullable<Text>,
        actor_kind -> Text,
        actor_principal_id -> Nullable<Text>,
        owner_id -> Nullable<Text>,
        target_kind -> Text,
        target_id -> Text,
        room_id -> Nullable<Text>,
        membership_generation -> Nullable<Text>,
        authorizer_id -> Nullable<Text>,
        added_by_id -> Nullable<Text>,
        permission_code -> Nullable<Text>,
        action -> Text,
        outcome -> Text,
        message -> Text,
        created_at -> BigInt,
    }
}

diesel::table! {
    incident_notification (incident_id, phase) {
        incident_id -> Text,
        phase -> Text,
        body -> Text,
        next_attempt_at -> BigInt,
        event_id -> Nullable<Text>,
    }
}

diesel::table! {
    listener_run (id) {
        controller_fleet_id -> Nullable<Text>,
        controller_connection_id -> Nullable<Text>,
        controller_credential_id -> Nullable<Text>,
        id -> Text,
        agent_id -> Text,
        release -> Nullable<Text>,
        started_at -> BigInt,
        last_seen_at -> BigInt,
        active_ms -> BigInt,
        messages_delivered -> BigInt,
        stopped_at -> Nullable<BigInt>,
        disconnect_requested_at -> Nullable<BigInt>,
    }
}

diesel::table! {
    listener_stat_checkpoint (run_id) {
        run_id -> Text,
        sequence -> BigInt,
        digest -> Text,
        captured_at -> BigInt,
    }
}

diesel::table! {
    listener_stat_flow (run_id, bucket_at, room_id, sender_matrix_id, message_type) {
        run_id -> Text,
        bucket_at -> BigInt,
        room_id -> Text,
        sender_matrix_id -> Text,
        message_type -> Text,
        observed -> BigInt,
        delivered -> BigInt,
        content_bytes -> BigInt,
        delivered_bytes -> BigInt,
        attachment_bytes -> BigInt,
        largest_bytes -> BigInt,
    }
}

diesel::table! {
    listener_stat_interval (run_id, bucket_at) {
        run_id -> Text,
        bucket_at -> BigInt,
        agent_id -> Text,
        started_at -> BigInt,
        ended_at -> BigInt,
        captured_at -> BigInt,
        dropped -> BigInt,
    }
}

diesel::table! {
    listener_stat_usage (run_id, bucket_at, runtime, session_id) {
        run_id -> Text,
        bucket_at -> BigInt,
        runtime -> Text,
        session_id -> Text,
        input -> BigInt,
        cached_input -> BigInt,
        cache_write_input -> Nullable<BigInt>,
        output -> BigInt,
        reasoning_output -> Nullable<BigInt>,
        total -> BigInt,
    }
}

diesel::table! {
    management_conversation (owner_id) {
        owner_id -> Text,
        room_id -> Text,
        created_at -> BigInt,
    }
}

diesel::table! {
    runtime_decision (id) {
        id -> Text,
        agent_id -> Text,
        run_id -> Text,
        runtime -> Text,
        session_id -> Text,
        request_id -> Text,
        turn_id -> Text,
        item_id -> Text,
        kind -> Text,
        action -> Text,
        review_text -> Text,
        blocking -> BigInt,
        expires_at -> Nullable<BigInt>,
        created_at -> BigInt,
        status -> Text,
    }
}

diesel::table! {
    runtime_decision_answer (decision_id, question_id) {
        decision_id -> Text,
        question_id -> Text,
        option_id -> Nullable<Text>,
        answer_text -> Nullable<Text>,
    }
}

diesel::table! {
    runtime_decision_option (decision_id, question_id, option_id) {
        decision_id -> Text,
        question_id -> Text,
        option_id -> Text,
        position -> BigInt,
        label -> Text,
        description -> Text,
    }
}

diesel::table! {
    runtime_decision_question (decision_id, question_id) {
        decision_id -> Text,
        question_id -> Text,
        position -> BigInt,
        title -> Text,
        prompt -> Text,
        secret -> BigInt,
        allow_text -> BigInt,
    }
}

diesel::table! {
    runtime_incident (id) {
        id -> Text,
        owner_id -> Text,
        agent_id -> Nullable<Text>,
        fleet_id -> Nullable<Text>,
        run_id -> Nullable<Text>,
        session_id -> Nullable<Text>,
        kind -> Text,
        message -> Text,
        created_at -> BigInt,
        recovered_at -> Nullable<BigInt>,
    }
}

diesel::table! {
    runtime_observation (run_id, session_id) {
        run_id -> Text,
        agent_id -> Text,
        session_id -> Text,
        room_id -> Nullable<Text>,
        runtime -> Text,
        state -> Text,
        observed_at -> BigInt,
        history_mode -> Text,
        max_input_bytes -> BigInt,
        error_message -> Nullable<Text>,
        last_activity_at -> Nullable<BigInt>,
        history_available -> Nullable<BigInt>,
    }
}

diesel::table! {
    runtime_setting (run_id, session_id, name) {
        run_id -> Text,
        session_id -> Text,
        name -> Text,
        configured_value -> Nullable<Text>,
        effective_value -> Nullable<Text>,
    }
}

diesel::table! {
    runtime_usage_checkpoint (agent_id, runtime, session_id) {
        agent_id -> Text,
        runtime -> Text,
        session_id -> Text,
        input -> BigInt,
        cached_input -> BigInt,
        cache_write_input -> Nullable<BigInt>,
        output -> BigInt,
        reasoning_output -> Nullable<BigInt>,
        total -> BigInt,
        captured_at -> BigInt,
    }
}
