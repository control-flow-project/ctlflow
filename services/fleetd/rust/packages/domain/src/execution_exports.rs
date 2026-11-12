use crate::execution::Mount;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::path::{Path, PathBuf};

fn absolute(path: &Path) -> bool {
    path.to_str().is_some_and(|path| {
        path.starts_with('/')
            && path != "/"
            && path.encode_utf16().count() <= 4096
            && !path.contains('\\')
            && !path.chars().any(char::is_control)
            && path
                .split('/')
                .skip(1)
                .all(|part| !part.is_empty() && part != "." && part != "..")
    })
}
fn overlap(left: &Path, right: &Path) -> bool {
    left.starts_with(right) || right.starts_with(left)
}

// Preserve native paths; approved exports never broaden host or peer authority.
pub fn plan(
    state: &Path,
    workspace: &Path,
    control: &Path,
    protected: &[PathBuf],
    additional: &[Mount],
) -> Result<Vec<Mount>> {
    if ![state, workspace, control].into_iter().all(absolute)
        || protected.iter().any(|path| !absolute(path))
        || additional.iter().any(|mount| !absolute(&mount.path))
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "VM exports require absolute normalized directory paths",
        ));
    }
    let mut mounts = if workspace.starts_with(state) {
        vec![Mount {
            path: state.to_owned(),
            read_only: false,
        }]
    } else if state.starts_with(workspace) {
        vec![Mount {
            path: workspace.to_owned(),
            read_only: false,
        }]
    } else {
        vec![
            Mount {
                path: state.to_owned(),
                read_only: false,
            },
            Mount {
                path: workspace.to_owned(),
                read_only: false,
            },
        ]
    };
    for mount in additional {
        if mounts.iter().any(|other| overlap(&other.path, &mount.path)) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "VM exports cannot duplicate or overlap another export",
            ));
        }
        mounts.push(mount.clone());
    }
    if mounts.iter().any(|mount| {
        overlap(control, &mount.path)
            || protected.iter().any(|path| overlap(path, &mount.path))
            || ["/proc", "/sys", "/dev", "/run"]
                .iter()
                .any(|path| overlap(Path::new(path), &mount.path))
    }) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "VM exports cannot expose host control, credentials or peer workareas",
        ));
    }
    Ok(mounts)
}
