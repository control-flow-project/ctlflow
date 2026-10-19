diesel::table! {
    enrollment_controller_metadata (enrollment_id, key) {
        enrollment_id -> Text,
        key -> Text,
        value -> Text,
    }
}

diesel::table! {
    enrollment_item (request_id, instance_key) {
        request_id -> Text,
        instance_key -> Text,
        requested_name -> Text,
        outcome -> Text,
        agent_id -> Nullable<Text>,
    }
}

diesel::table! {
    enrollment_item_permission (request_id, instance_key, permission_code) {
        request_id -> Text,
        instance_key -> Text,
        permission_code -> Text,
        grant_scope -> Text,
    }
}

diesel::table! {
    enrollment_item_policy (request_id, instance_key) {
        request_id -> Text,
        instance_key -> Text,
        wake_mode -> Text,
        expected_agent_revision -> Nullable<BigInt>,
    }
}

diesel::table! {
    enrollment_item_wake_sender (request_id, instance_key, sender_principal_id) {
        request_id -> Text,
        instance_key -> Text,
        sender_principal_id -> Text,
        include_agents -> BigInt,
    }
}

diesel::table! {
    enrollment_request (id) {
        controller_name -> Text,
        controller_credential_hash -> Text,
        id -> Text,
        owner_id -> Text,
        fleet_key -> Text,
        verification_code -> Text,
        claim_hash -> Text,
        roster_digest -> Text,
        status -> Text,
        revision -> BigInt,
        created_at -> BigInt,
        expires_at -> BigInt,
        decided_by_member_id -> Nullable<Text>,
        decided_at -> Nullable<BigInt>,
    }
}
