diesel::table! {
    instance_policy (id) {
        id -> Text,
        revision -> BigInt,
        max_owner_agents -> BigInt,
        max_agents -> BigInt,
        max_pending -> BigInt,
        enrollment_seconds -> BigInt,
        reconcile_seconds -> BigInt,
        max_message_bytes -> BigInt,
        fleet_idle_timeout_seconds -> BigInt,
        agent_instructions -> Text,
        signup_mode -> Text,
        invitation_issuers -> Text,
    }
}

diesel::table! {
    member (principal_id) {
        principal_id -> Text,
        principal_kind -> Text,
        display_name -> Text,
    }
}

diesel::table! {
    member_invitation (id) {
        id -> Text,
        created_by_member_id -> Text,
        claim_hash -> Text,
        role_code -> Text,
        principal_kind -> Text,
        created_at -> BigInt,
        expires_at -> BigInt,
        consumed_by_member_id -> Nullable<Text>,
        revoked_at -> Nullable<BigInt>,
        claim_backend_user_id -> Nullable<Text>,
        claim_display_name -> Nullable<Text>,
        claim_fingerprint -> Nullable<Text>,
    }
}

diesel::table! {
    member_session (secret_hash) {
        secret_hash -> Text,
        member_id -> Text,
        csrf_secret -> Text,
        native_access_token -> Text,
        created_at -> BigInt,
        expires_at -> BigInt,
    }
}

diesel::table! {
    permission (code) {
        code -> Text,
        grant_scope -> Text,
        description -> Text,
    }
}

diesel::table! {
    principal (id) {
        id -> Text,
        backend_user_id -> Text,
        kind -> Text,
        status -> Text,
        revision -> BigInt,
        created_at -> BigInt,
    }
}

diesel::table! {
    principal_application (principal_id) {
        principal_id -> Text,
        applied_revision -> Nullable<BigInt>,
        applied_intent_hash -> Nullable<Text>,
        applied_status -> Nullable<Text>,
        native_display_name -> Nullable<Text>,
        last_attempt_at -> Nullable<BigInt>,
        last_success_at -> Nullable<BigInt>,
        next_check_at -> BigInt,
        error_code -> Nullable<Text>,
        error_message -> Nullable<Text>,
    }
}

diesel::table! {
    principal_role (principal_id) {
        principal_id -> Text,
        principal_kind -> Text,
        role_code -> Text,
        assigned_by_member_id -> Nullable<Text>,
        assigned_at -> BigInt,
    }
}

diesel::table! {
    role (code) {
        code -> Text,
        principal_kind -> Text,
        label -> Text,
    }
}

diesel::table! {
    role_permission (role_code, permission_code) {
        role_code -> Text,
        permission_code -> Text,
        grant_scope -> Text,
    }
}
