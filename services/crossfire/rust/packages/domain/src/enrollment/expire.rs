use super::{port::EnrollmentRepository, values::State};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
pub fn expire(repo: &mut impl EnrollmentRepository, now: i64) -> Result<()> {
    for mut request in repo.expired_enrollments(now)? {
        repo.remove_request_names(&request.id)?;
        request.state = State::Expired;
        request.revision = increment(request.revision)?;
        repo.save_enrollment_request(&request, false)?;
    }
    Ok(())
}
pub(crate) fn increment(revision: i64) -> Result<i64> {
    revision
        .checked_add(1)
        .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Revision exceeds native range"))
}
