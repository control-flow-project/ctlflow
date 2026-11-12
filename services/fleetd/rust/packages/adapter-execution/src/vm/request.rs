use crossfire_adapter_filesystem::{
    PrivateDirectory,
    owned::{DirectoryAccess, OwnedFile, validate_directory},
};
use crossfire_adapter_runtime::placement::LeaseRequest;
use crossfire_contracts::validation as check;
use crossfire_domain::runtime::values::Runtime;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::{
    execution::{Catalog, Image, Mount, Placement, Profile},
    model::{Configuration, Instance},
};
use serde_json::{Value, json};
use std::path::PathBuf;

#[derive(Clone)]
pub struct Request {
    pub id: String,
    pub directory: PathBuf,
    pub fleet: PathBuf,
    pub instance: String,
    pub digest: String,
    pub native: LeaseRequest,
    pub listener_port: Option<u16>,
}
pub struct Selection {
    pub catalog: Catalog,
    pub image: Image,
    pub profile: Profile,
    pub mounts: Vec<Mount>,
}
pub fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}
impl Request {
    pub fn file(&self) -> Result<PathBuf> {
        Ok(self.scratch()?.join("request.json"))
    }
    pub fn scratch(&self) -> Result<PathBuf> {
        super::execution_files::scratch(&self.id)
    }
    pub fn ready(&self) -> PathBuf {
        self.native
            .state_directory
            .join(format!(".ctlflow-vm-{}.ready", self.id))
    }
    pub fn unit(&self) -> String {
        format!("ctlflow-execution-{}.service", self.id)
    }
    pub fn write(&self) -> Result<()> {
        let mut value = json!({"id":self.id,"directory":self.directory,"fleet":self.fleet,"instance":self.instance,"digest":self.digest,
            "ownership":self.native.directory,"workspace":self.native.workspace,"state":self.native.state_directory,"home":self.native.home});
        if let Some(port) = self.listener_port {
            value["listenerPort"] = json!(port);
        }
        PrivateDirectory::open(&super::execution_files::scratch(&self.id)?, false)?.write_atomic(
            "request.json",
            &serde_json::to_vec(&value).map_err(|_| invalid("Cannot encode VM request"))?,
        )
    }
    pub fn read(file: &std::path::Path) -> Result<Self> {
        let input =
            OwnedFile::open(file, 32768)?.ok_or_else(|| invalid("VM request is missing"))?;
        input.private_permissions()?;
        let value: Value = serde_json::from_slice(&input.configuration(32768)?)
            .map_err(|_| invalid("Invalid VM request JSON"))?;
        let value = check::object(
            &value,
            &[
                "id",
                "directory",
                "fleet",
                "instance",
                "digest",
                "ownership",
                "workspace",
                "state",
                "home",
            ],
            &["listenerPort"],
        )?;
        let text =
            |key: &str| -> Result<String> { Ok(check::text(&value[key], 1, 4096)?.to_owned()) };
        let request = Self {
            id: text("id")?,
            directory: text("directory")?.into(),
            fleet: text("fleet")?.into(),
            instance: text("instance")?,
            digest: text("digest")?,
            native: LeaseRequest {
                directory: text("ownership")?.into(),
                workspace: text("workspace")?.into(),
                state_directory: text("state")?.into(),
                home: text("home")?.into(),
            },
            listener_port: value
                .get("listenerPort")
                .map(|port| check::integer(port, 1, 65535).map(|port| port as u16))
                .transpose()?,
        };
        if request.file()? != file {
            return Err(invalid(
                "VM request must remain in its private execution directory",
            ));
        }
        Ok(request)
    }
    pub fn select(&self) -> Result<Selection> {
        check::identifier(&json!(self.id))?;
        if self.directory != super::execution_files::runtime(&self.id)?
            || self.listener_port == Some(0)
        {
            return Err(invalid(
                "Invalid VM supervisor identity, directory or listener port",
            ));
        }
        PrivateDirectory::open(&self.directory, false)?;
        PrivateDirectory::open(&super::execution_files::scratch(&self.id)?, false)?;
        let configuration = fleetd_storage::configuration::load(&self.fleet, None)?;
        if configuration.digest != self.digest {
            return Err(invalid(
                "Fleet configuration changed before VM admission; refresh before retrying",
            ));
        }
        let instance = configuration
            .roster
            .instances
            .iter()
            .find(|instance| instance.key == self.instance)
            .ok_or_else(|| invalid("VM request does not select a fleet instance"))?;
        self.select_instance(&configuration, instance)
    }
    fn select_instance(
        &self,
        configuration: &Configuration,
        instance: &Instance,
    ) -> Result<Selection> {
        let Placement::Vm { image, profile } = &instance.execution else {
            return Err(invalid("Instance does not select VM execution"));
        };
        let catalog = configuration
            .execution
            .as_ref()
            .ok_or_else(|| invalid("Fleet VM catalog is missing"))?;
        let image = catalog
            .images
            .get(image)
            .ok_or_else(|| invalid("Selected VM image is missing"))?;
        let profile = catalog
            .profiles
            .get(profile)
            .ok_or_else(|| invalid("Selected VM profile is missing"))?;
        let state = self.fleet.join(&instance.workarea);
        let workspace = instance.workspace.as_ref().unwrap_or(&state);
        let home = match configuration.definitions[&instance.definition].runtime {
            Runtime::Codex => ".codex",
            Runtime::Pi => ".pi",
        };
        if self.native.directory != fleetd_storage::ownership::directory(&state)?
            || &self.native.workspace != workspace
            || !self.native.state_directory.starts_with(&state)
            || self.native.home != self.native.state_directory.join(home)
            || !self
                .native
                .state_directory
                .to_str()
                .is_some_and(fleetd_contracts::configuration::absolute_path)
        {
            return Err(invalid(
                "VM request differs from the instance's exact native workspace and state ownership",
            ));
        }
        if self
            .native
            .state_directory
            .to_str()
            .is_none_or(|path| path.chars().any(char::is_control))
        {
            return Err(invalid("VM state path contains control characters"));
        }
        PrivateDirectory::open(&state, false)?;
        PrivateDirectory::open(&self.native.state_directory, false)?;
        let user = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| invalid("Native execution requires HOME"))?;
        let mut protected: Vec<_> = configuration
            .roster
            .instances
            .iter()
            .filter(|peer| peer.key != instance.key)
            .map(|peer| self.fleet.join(&peer.workarea))
            .collect();
        protected.extend(catalog.images.values().map(|image| image.path.clone()));
        protected.extend([
            self.directory
                .parent()
                .ok_or_else(|| invalid("Invalid VM runtime directory"))?
                .to_owned(),
            super::execution_files::cache_root()?,
            self.fleet.join(".fleet"),
            fleetd_storage::authentication::root()?.join("ctlflow"),
            std::env::var_os("CODEX_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| user.join(".codex")),
            std::env::var_os("PI_CODING_AGENT_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| user.join(".pi")),
            user.join(".ssh"),
            user.join(".secrets"),
        ]);
        let mounts = fleetd_domain::execution_exports::plan(
            &state,
            workspace,
            &self.native.directory,
            &protected,
            &profile.mounts,
        )?;
        for mount in &mounts {
            validate_directory(
                &mount.path,
                if mount.read_only {
                    DirectoryAccess::ReadOnly
                } else {
                    DirectoryAccess::Workspace
                },
            )?;
        }
        Ok(Selection {
            catalog: catalog.clone(),
            image: image.clone(),
            profile: profile.clone(),
            mounts,
        })
    }
}
