# Fleet VM execution

This source feature is unreleased. The published 0.1.26 archives do not contain
it. Host and VM are explicit per-instance execution selections; a VM failure
never runs the agent on the host.

## Ownership and lifecycle

```text
fleet runtime.toml + execution.toml
                 |
          fleetd, own OS user
                 |
       eligible message / explicit inspection
                 |
       serialized fleet memory admission
                 |
       finite transient user execution service
          |          |                  |
     host lease   private libvirt    SSH controller
                     |
                 QEMU / KVM
                     |
               selected fleet image
                     |
               native Codex / Pi
                     |
             approved host filesystem exports
```

The fleet listener and controller stay on the host. Constructing a runtime
factory or restoring a sleeping fleet starts no VM and makes no model turn.
Explicit native capability inspection may boot a VM without inference.
Creating the first approved native history also uses the selected execution,
then closes it without submitting a model turn.

One execution owns one host native-writer lease, one disposable VM, one private
libvirt connection and one pinned, key-authenticated SSH connection over a
private virtio-serial channel. It exposes no guest SSH listening port on the
host network. Native commands and terminal attachment use that existing SSH
master; loss of the master is an error, not a new connection or host fallback.
The forwarding target comes from the host listener's in-memory endpoint.
Guest-writable `listener.json` is discovery information for agent tools and
never authority for selecting a host forwarding target.

The host lease lives under the OS-user configuration directory at
`ctlflow/native-ownership/<sha256-of-instance-state-path>`. Its SQLite locking
file and execution receipt are never guest exports. A surviving execution
cgroup fences replacement even if its supervisor was killed. Cross-kernel
filesystem locks are not used to establish native writer ownership.

Controller EOF or shutdown closes the SSH master, libvirt connection and private
helpers. Libvirt's autodestroy connection owns guest lifetime. The transient
service also uses `KillMode=control-group`; a killed main process cannot leave
an accepted replacement overlapping its remaining children. Cleanup verifies
that the group is empty before clearing its execution fence. Failed startup
keeps the host lease until the requesting runtime closes its lifetime pipe.

Native `.codex` or `.pi` directories, exact native sessions, rollouts and approved
workspace/data directories remain on the host at their original absolute paths.
There is no native-history export/import, reconstruction or second history
format. Keep the same instance state path when changing its execution selection.
Stop its existing writer before changing placement.

## Configuration

`runtime.toml` selects the image and profile for an instance:

```toml
[[instances]]
key = "analyst"
name = "analyst"
definition = "research"
workarea = "agents/research/workarea/analyst"

[instances.execution]
kind = "vm"
image = "research"
profile = "restricted"
```

For host execution use `execution = { kind = "host" }`, or omit `execution`.
This is an intentional host selection, never error recovery for a VM.

`execution.toml` in the same fleet directory owns its catalog:

```toml
memory_budget_mib = 4096
host_reserve_mib = 2048

[images.research]
path = "/absolute/fleet-images/research.qcow2"
sha256 = "replace-with-the-64-character-lowercase-sha256"

[profiles.restricted]
cpus = 2
memory_mib = 512
maximum_memory_mib = 1024
network = "disabled"
mounts = [{ path = "/absolute/research-originals", read_only = true }]
```

The instance state and selected workspace are automatic writable exports. If
one contains the other, they use one export. Explicit mounts add existing
directories and cannot overlap any other export.
An export cannot include host ownership, controller configuration, peer state,
images, runtime control, disposable VM cache or the global native login homes.
Symlinks and paths that escape these boundaries fail admission. Writable exports
must be owned by the runtime OS user and not world-writable. Readonly exports may
be administrator-owned. Guest remounting cannot make a readonly host export writable.

Every selected image is an owned, mode-0600, single-link, nonsymlink qcow2 file.
fleetd verifies its SHA256 and actual QEMU metadata before use. Images with
external backing/data files, encryption, corruption or a dirty flag fail.
The image is immutable input; each execution creates a disposable overlay.
Fleet users retain separate OS identities and separate image copies/ownership.

The image must contain the selected native harness and its dependencies at the
configured executable paths, systemd, Python 3, OpenSSH server, cloud-init, kmod, udev
and ordinary Linux filesystem tools. Its kernel must support virtiofs and
virtio-serial. Bootstrap waits for the initialized virtio device before opening
the SSH channel. Tools used by agents must also exist in the image or
approved mounts. Host executable discovery does not install software in a guest.
Cloud-init queues one transient guest bootstrap service and returns immediately;
it does not wait for the SSH lifetime. Outbound execution starts that service
after the guest's network-online target. Disabled networking has no such dependency.

Guest commands start with a clean environment. Only the managed native-home,
project and agent-name contract variables are forwarded. A Codex provider's
explicit `env_key` in trusted host configuration may select its one provider key;
the guest-writable managed configuration cannot select other host keys. Its value uses encrypted SSH
channel environment, never host command arguments, prompts or a global home export.
Other ambient host variables, SSH agents and the controller credential are not forwarded. Managed native
authentication files are visible to that agent inside its own exported home;
VM execution does not isolate an agent from its own provider login.
Do not place another agent's credentials in its exports or fleet image.

`network = "disabled"` creates no network interface. The own listener still
works through its single authenticated SSH reverse forward. `network = "outbound"`
selects QEMU user networking, without inbound host port mappings. This permits
network access, including reachable host/LAN services; it is not an egress
allowlist or an isolation boundary for network services. Apply site network
policy separately when those services must be inaccessible.

## Memory and temporary storage

The fleet has one hashed user slice. Its memory cap includes all of that fleet's
VMs and helpers. The fleet slice and each execution have a 1,024-task limit;
each execution also has its own finite memory cap. Swap is disabled for these
execution groups. Each admitted target counts
its guest target plus 512 MiB of helper headroom against the fleet budget.
Admission is serialized and checks current available host memory and the configured
host reserve. A populated fleet budget cannot be changed while guests use it.

The guest target and maximum are distinct. Maximums may overcommit the fleet cap;
this does not reserve physical RAM or promise that every guest can peak together.
Other host processes can consume memory after admission. Resource limits contain
the execution; they do not prove that an OOM can never happen. KSM, global swap
settings and kernel overcommit settings are not changed.

Only sockets and short control paths use `$XDG_RUNTIME_DIR/cfvm-<execution-id>`.
Disks, seed, firmware variables, boot files and helper data use
`$XDG_CACHE_HOME/ctlflow/vm/<execution-id>`; the cache default is `$HOME/.cache`.
These are disposable and are removed after confirmed closure. A later VM owner
may clean the exact prior closed execution after acquiring the host lease.
The durable `vm-receipt.json` records identity, start/readiness/end timestamps and
failure text in the host ownership directory. Required native histories and
workspace files are not cache and are not deleted during VM cleanup.

## Host prerequisites and fleet images

The supported host is Ubuntu 26.04 x86-64 with KVM, cgroup v2, a user systemd
manager and AppArmor. The implementation uses QEMU's `q35` machine, not its
`microvm` machine. Runtime services require no Docker daemon. Server Docker
deployment remains independent.

The distributed `vm/setup-vm-host.sh` installs the prescribed host packages and
pinned Packer/QEMU image-builder tools. Its `--user` account is the trusted image
operator. That account and repeated `--runtime-user` accounts receive KVM
membership only, never libvirt administration. The helper neither configures nor
starts a shared libvirt daemon or network. Review `--help` before running it with sudo. New group
membership requires a new login/user-manager session; an existing manager keeps
its old supplementary groups. Do not restart a shared user manager while other
work uses it.

The script configures standard distribution prerequisites. It does not install
a ctlflow system service, change fleet selections, start agents, perform provider
login or reserve guest memory. Execution services are transient per-execution
resource containers, not installed/autostart fleet services.

Use the distributed `vm/fleet.pkr.hcl` as the ordinary Packer recipe. Supply a
publisher-verified base image URL/SHA256, a new output directory, a fleet-owned
provisioning script and a random disposable build password. Packer 1.16.2 and
the official QEMU plugin 1.1.7 are pinned. The build account is locked; its SSH
authorized keys, cloud-init seed and SSH host keys are removed from the finished
image. The build uses a loopback-only
HTTP NoCloud seed and loopback-only SSH forwarding; runtime VMs use the private
virtio channel described above. The finished image masks the ordinary network
SSH service and socket; cloud-init cannot enable them on the next boot. Never bake provider credentials
or live native homes into an image. Hash the resulting qcow2 and set its exact
path/digest in the fleet catalog.

Install the built image into the runtime user's private image directory with
mode `0600` before hashing/configuration; builder outputs need not have private
permissions. For an image used by the current OS user:

```sh
install -d -m 0700 /absolute/fleet-images
install -m 0600 /absolute/packer-output/fleet.qcow2 /absolute/fleet-images/research.qcow2
sha256sum /absolute/fleet-images/research.qcow2
```

## Verification

Shared configuration fixtures cover TypeScript, C# and Rust. Native tests cover
image metadata/digest validation, export planning, SSH placement, lazy factory
construction, finite services, serialized fleet admission and host-only ownership.
The executable supervisor assertion bank uses the same checks for managed C#,
NativeAOT and Rust, including failed startup, controller EOF and supervisor death.

Successful real-VM verification must additionally exercise current repository
boot generation, native session resumption, readonly exports, own-listener
forwarding, resource containment and complete teardown. XML validation,
unavailable-image tests and older prototype receipts do not certify these cases.
No test requires a paid provider call or waking an enrolled agent.

Run the same executable bank for the explicit native implementation matrix with
`npm run verify:vm -- /absolute/implementation-matrix.json /absolute/vm-fixture.json`
inside a finite test cgroup. The fixture declares `image` (`path`, `sha256`,
readonly `mounts`) and absolute `binaries` (`codex`, `node`, `pi`). Use disposable
test homes; never use enrolled agent state or real provider credentials. Native
binaries and dependencies must exist in the image or declared readonly mounts.
Missing KVM, firmware, image or a native target fails the gate rather than
skipping a scenario. Each test VM has its own finite 1.25-GiB service inside a
1.5-GiB fixture fleet budget. Native targets run serially, with one test VM at a
time; the coordinating test process also needs finite
memory, swap and task limits. These are caps, not memory reservations.
