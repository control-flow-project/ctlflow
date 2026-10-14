diesel::table! {
    fleet (owner_id, fleet_key) {
        archived_at -> Nullable<BigInt>,
        id -> Text,
        delivery_enabled -> BigInt,
        label -> Text,
        controller_name -> Text,
        revision -> BigInt,
        updated_at -> BigInt,
        owner_id -> Text,
        fleet_key -> Text,
        created_at -> BigInt,
    }
}

diesel::table! {
    fleet_connection (fleet_id) {
        fleet_id -> Text,
        connection_id -> Text,
        credential_id -> Text,
        last_seen_at -> BigInt,
        expires_at -> BigInt,
        closed_at -> Nullable<BigInt>,
    }
}

diesel::table! {
    fleet_controller_metadata (fleet_id, key) {
        fleet_id -> Text,
        key -> Text,
        value -> Text,
    }
}

diesel::table! {
    fleet_credential (id) {
        id -> Text,
        fleet_id -> Text,
        secret_hash -> Text,
        created_at -> BigInt,
        revoked_at -> Nullable<BigInt>,
    }
}

diesel::table! {
    fleet_instance (owner_id, fleet_key, instance_key) {
        retired_at -> Nullable<BigInt>,
        owner_id -> Text,
        fleet_key -> Text,
        instance_key -> Text,
        agent_id -> Text,
    }
}

diesel::table! {
    fleet_instance_permission (agent_id, permission_code) {
        agent_id -> Text,
        permission_code -> Text,
        grant_scope -> Text,
    }
}

diesel::table! {
    fleet_instance_policy (agent_id) {
        agent_id -> Text,
        approved_by_member_id -> Text,
        approved_at -> BigInt,
    }
}

diesel::table! {
    fleet_message (id) {
        id -> Text,
        fleet_id -> Text,
        author_principal_id -> Nullable<Text>,
        author_credential_id -> Nullable<Text>,
        body -> Text,
        created_at -> BigInt,
        expires_at -> BigInt,
    }
}

diesel::table! {
    fleet_message_delivery (message_id, agent_id) {
        message_id -> Text,
        agent_id -> Text,
        status -> Text,
        completed_at -> Nullable<BigInt>,
        error_message -> Nullable<Text>,
    }
}

diesel::table! {
    fleet_native_stop (agent_id, receipt_id) {
        agent_id -> Text,
        receipt_id -> Text,
        sequence -> BigInt,
        fleet_id -> Text,
        run_id -> Text,
        connection_id -> Text,
        credential_id -> Text,
        native_stopped_at -> BigInt,
        invalidated_at -> Nullable<BigInt>,
    }
}

diesel::table! {
    fleet_runtime_operation (id) {
        id -> Text,
        fleet_id -> Text,
        agent_id -> Nullable<Text>,
        author_principal_id -> Text,
        action -> Text,
        expected_revision -> BigInt,
        status -> Text,
        created_at -> BigInt,
        completed_at -> Nullable<BigInt>,
        error_message -> Nullable<Text>,
        connection_id -> Nullable<Text>,
        credential_id -> Nullable<Text>,
    }
}
