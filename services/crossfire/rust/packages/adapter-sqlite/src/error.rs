use crossfire_kernel::{Failure, failure::ErrorCode};
use diesel::result::{DatabaseErrorKind, Error};

pub fn failure(error: Error) -> Failure {
    match error {
        Error::NotFound => Failure::new(ErrorCode::Missing, "Stored record not found"),
        Error::DatabaseError(DatabaseErrorKind::UniqueViolation, _) => {
            Failure::new(ErrorCode::Conflict, "Unique state conflict")
        }
        Error::DatabaseError(
            DatabaseErrorKind::ForeignKeyViolation
            | DatabaseErrorKind::CheckViolation
            | DatabaseErrorKind::NotNullViolation,
            _,
        ) => Failure::new(
            ErrorCode::Conflict,
            "Stored state violates an integrity constraint",
        ),
        Error::DatabaseError(_, information)
            if information.message().contains("database or disk is full") =>
        {
            Failure::new(ErrorCode::Capacity, "Management storage is full")
        }
        Error::DatabaseError(_, information)
            if information.message().contains("database is locked") =>
        {
            Failure::new(ErrorCode::Unavailable, "Management storage is busy")
        }
        _ => Failure::new(ErrorCode::Unavailable, "Management storage failed"),
    }
}
