use crate::tables::{listener_stat_flow, listener_stat_interval};

diesel::allow_columns_to_appear_in_same_group_by_clause!(
    listener_stat_interval::agent_id,
    listener_stat_flow::room_id,
    listener_stat_flow::sender_backend_user_id,
    listener_stat_flow::message_type
);
