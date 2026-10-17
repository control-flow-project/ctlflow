diesel::table! {
    publication (id) {
        id -> Text,
        agent_id -> Text,
        public_key -> Text,
        title -> Text,
        state -> Text,
        revision -> BigInt,
        created_at -> BigInt,
        expires_at -> BigInt,
        published_at -> Nullable<BigInt>,
        deleted_at -> Nullable<BigInt>,
        cleaned_at -> Nullable<BigInt>,
        total_bytes -> BigInt,
        file_count -> BigInt,
    }
}

diesel::table! {
    publication_file (id) {
        id -> Text,
        publication_id -> Text,
        path -> Text,
        media_type -> Text,
        bytes -> BigInt,
        sha256 -> Text,
        uploaded -> BigInt,
    }
}
