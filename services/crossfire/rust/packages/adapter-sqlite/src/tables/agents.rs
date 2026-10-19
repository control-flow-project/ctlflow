diesel::table! {
    agent (principal_id) {
        principal_id -> Text,
        principal_kind -> Text,
        owner_id -> Text,
        wake_mode -> Text,
    }
}

diesel::table! {
    agent_credential (agent_id) {
        agent_id -> Text,
        provisioning_password -> Text,
        access_token -> Nullable<Text>,
        updated_at -> BigInt,
    }
}

diesel::table! {
    agent_name (name) {
        name -> Text,
        request_id -> Nullable<Text>,
        instance_key -> Nullable<Text>,
        agent_id -> Nullable<Text>,
    }
}

diesel::table! {
    agent_owner_conversation (agent_id) {
        agent_id -> Text,
        owner_id -> Text,
        room_id -> Text,
        created_at -> BigInt,
    }
}

diesel::table! {
    agent_room_grant (agent_id, room_id) {
        agent_id -> Text,
        room_id -> Text,
        generation -> Text,
        authorizer_id -> Text,
        added_by_id -> Text,
        invitation_event_id -> Nullable<Text>,
        admission_kind -> Text,
        access_mode -> Text,
        native_access -> Nullable<Text>,
        muted -> BigInt,
        revision -> BigInt,
        access_revision -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    agent_room_permission (agent_id, room_id, permission_code) {
        agent_id -> Text,
        room_id -> Text,
        generation -> Text,
        permission_code -> Text,
        grant_scope -> Text,
        granted_by_member_id -> Text,
        granted_at -> BigInt,
    }
}

diesel::table! {
    agent_wake_sender (agent_id, sender_principal_id) {
        agent_id -> Text,
        sender_principal_id -> Text,
        include_agents -> BigInt,
    }
}

diesel::table! {
    room_grant_application (agent_id, room_id) {
        agent_id -> Text,
        room_id -> Text,
        observed_generation -> Nullable<Text>,
        applied_revision -> Nullable<BigInt>,
        applied_access_revision -> Nullable<BigInt>,
        membership -> Nullable<Text>,
        native_access -> Nullable<Text>,
        last_attempt_at -> Nullable<BigInt>,
        last_success_at -> Nullable<BigInt>,
        next_check_at -> BigInt,
        error_code -> Nullable<Text>,
        error_message -> Nullable<Text>,
    }
}
