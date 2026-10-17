use crossfire_agent_core::runtime::Approval;
use crossfire_contracts::validation as check;
use crossfire_domain::runtime::values::Setting;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Serialize, Serializer, ser::SerializeStruct};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sandbox {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}
impl Sandbox {
    pub fn code(self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::WorkspaceWrite => "workspace-write",
            Self::DangerFullAccess => "danger-full-access",
        }
    }
    pub fn native_type(self) -> &'static str {
        match self {
            Self::ReadOnly => "readOnly",
            Self::WorkspaceWrite => "workspaceWrite",
            Self::DangerFullAccess => "dangerFullAccess",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalPolicy {
    Untrusted,
    OnFailure,
    OnRequest,
    Never,
}
impl ApprovalPolicy {
    pub fn code(self) -> &'static str {
        match self {
            Self::Untrusted => "untrusted",
            Self::OnFailure => "on-failure",
            Self::OnRequest => "on-request",
            Self::Never => "never",
        }
    }
    pub fn routing(self) -> Approval {
        if self == Self::Never {
            Approval::None
        } else {
            Approval::Listener
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub model: Option<String>,
    pub effort: Option<String>,
    pub sandbox: Sandbox,
    pub approval_policy: ApprovalPolicy,
    pub bypass: Option<bool>,
    pub features: Option<Features>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Features {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_mode_request_user_input: Option<bool>,
}

pub fn parse(value: &Value) -> Result<Options> {
    let value = check::object(
        value,
        &[],
        &[
            "model",
            "model_reasoning_effort",
            "sandbox_mode",
            "approval_policy",
            "dangerously_bypass_approvals_and_sandbox",
            "features",
        ],
    )?;
    let model = value
        .get("model")
        .map(|value| check::text(value, 1, 200).map(str::to_owned))
        .transpose()?;
    let effort = value
        .get("model_reasoning_effort")
        .map(|value| {
            check::choice(
                value,
                &[
                    "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
                ],
            )
            .map(str::to_owned)
        })
        .transpose()?;
    let mut sandbox = match value
        .get("sandbox_mode")
        .map(|value| {
            check::choice(
                value,
                &["read-only", "workspace-write", "danger-full-access"],
            )
        })
        .transpose()?
    {
        Some("read-only") => Sandbox::ReadOnly,
        Some("workspace-write") => Sandbox::WorkspaceWrite,
        _ => Sandbox::DangerFullAccess,
    };
    let mut approval_policy = match value
        .get("approval_policy")
        .map(|value| check::choice(value, &["untrusted", "on-failure", "on-request", "never"]))
        .transpose()?
    {
        Some("untrusted") => ApprovalPolicy::Untrusted,
        Some("on-failure") => ApprovalPolicy::OnFailure,
        Some("never") => ApprovalPolicy::Never,
        _ => ApprovalPolicy::OnRequest,
    };
    let bypass = value
        .get("dangerously_bypass_approvals_and_sandbox")
        .map(check::boolean)
        .transpose()?;
    if bypass == Some(true) {
        if value.contains_key("sandbox_mode") && sandbox != Sandbox::DangerFullAccess
            || value.contains_key("approval_policy") && approval_policy != ApprovalPolicy::Never
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "dangerously_bypass_approvals_and_sandbox requires danger-full-access and never; remove conflicting sandbox or approval settings",
            ));
        }
        sandbox = Sandbox::DangerFullAccess;
        approval_policy = ApprovalPolicy::Never;
    }
    let features = value
        .get("features")
        .map(|value| {
            let fields = check::object(value, &[], &["default_mode_request_user_input"])?;
            Ok(Features {
                default_mode_request_user_input: fields
                    .get("default_mode_request_user_input")
                    .map(check::boolean)
                    .transpose()?,
            })
        })
        .transpose()?;
    Ok(Options {
        model,
        effort,
        sandbox,
        approval_policy,
        bypass,
        features,
    })
}

pub struct NativeOptions<'a>(pub &'a Options);
impl Serialize for NativeOptions<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut value = serializer.serialize_struct(
            "Options",
            2 + usize::from(self.0.model.is_some())
                + usize::from(self.0.effort.is_some())
                + usize::from(self.0.features.is_some()),
        )?;
        if let Some(model) = &self.0.model {
            value.serialize_field("model", model)?;
        }
        if let Some(effort) = &self.0.effort {
            value.serialize_field("model_reasoning_effort", effort)?;
        }
        value.serialize_field("sandbox_mode", self.0.sandbox.code())?;
        value.serialize_field("approval_policy", self.0.approval_policy.code())?;
        if let Some(features) = &self.0.features {
            value.serialize_field("features", features)?;
        }
        value.end()
    }
}

pub fn configured(value: &Options) -> Vec<Setting> {
    let mut result = Vec::with_capacity(5);
    for (name, setting) in [
        ("model", value.model.clone()),
        ("model_reasoning_effort", value.effort.clone()),
        ("sandbox_mode", Some(value.sandbox.code().to_owned())),
        (
            "approval_policy",
            Some(value.approval_policy.code().to_owned()),
        ),
        (
            "dangerously_bypass_approvals_and_sandbox",
            value.bypass.map(|value| value.to_string()),
        ),
    ] {
        if setting.is_some() {
            result.push(Setting {
                name: name.to_owned(),
                configured: setting,
                effective: None,
            });
        }
    }
    result
}

pub fn native_approval(value: &Value) -> Result<Approval> {
    if let Some(value) = value.as_str() {
        return match value {
            "never" => Ok(Approval::None),
            "untrusted" | "on-failure" | "on-request" => Ok(Approval::Listener),
            _ => Err(unsupported_approval()),
        };
    }
    let outer = check::object(value, &["granular"], &[]).map_err(|_| unsupported_approval())?;
    let granular = check::object(
        &outer["granular"],
        &[
            "sandbox_approval",
            "rules",
            "skill_approval",
            "request_permissions",
            "mcp_elicitations",
        ],
        &[],
    )
    .map_err(|_| unsupported_approval())?;
    let mut allowed = false;
    for value in granular.values() {
        allowed |= value.as_bool().ok_or_else(unsupported_approval)?;
    }
    Ok(if allowed {
        Approval::Listener
    } else {
        Approval::None
    })
}

fn unsupported_approval() -> Failure {
    Failure::new(
        ErrorCode::Native,
        "Codex did not report a supported native approval policy",
    )
}

pub fn version(value: &str) -> Result<()> {
    let invalid = || {
        Failure::new(
            ErrorCode::Invalid,
            "Stock Codex 0.158.0 or newer is required",
        )
    };
    let value = value.strip_prefix("codex-cli ").ok_or_else(invalid)?;
    let parts: Vec<_> = value.split('.').collect();
    let [major, minor, patch] = parts.as_slice() else {
        return Err(invalid());
    };
    let parse = |part: &str| {
        if !part.is_empty() && part.bytes().all(|value| value.is_ascii_digit()) {
            part.parse::<u32>().map_err(|_| invalid())
        } else {
            Err(invalid())
        }
    };
    let (major, minor, _) = (parse(major)?, parse(minor)?, parse(patch)?);
    if major == 0 && minor < 158 {
        return Err(invalid());
    }
    Ok(())
}

pub fn question_capability(value: &str) -> Result<()> {
    let entries: Vec<_> = value
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>())
        .filter(|parts| parts.first() == Some(&"default_mode_request_user_input"))
        .collect();
    if entries.len() != 1
        || entries[0].len() < 3
        || !entries[0]
            .last()
            .is_some_and(|value| matches!(*value, "true" | "false"))
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "This Codex binary does not expose features.default_mode_request_user_input; install a native release that supports it",
        ));
    }
    Ok(())
}
