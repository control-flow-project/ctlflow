#!/bin/bash
# Host prerequisites only. This does not create VMs or configure ctlflow agents.
set -Eeuo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

readonly PACKER_VERSION=1.16.2
readonly PACKER_SHA256=abbfe0cf74985084112659b53e3565f264f70a20914c3b7c4f789f54f61c2414
readonly QEMU_PLUGIN_VERSION=1.1.7
vm_user=''
runtime_users=()
check_only=false
download_dir=''

usage() {
    cat <<'USAGE'
Usage: sudo /absolute/path/setup-vm-host.sh --user IMAGE_OPERATOR [--runtime-user FLEET_USER]...
       sudo /absolute/path/setup-vm-host.sh --check --user IMAGE_OPERATOR [--runtime-user FLEET_USER]...

Supported hosts: Ubuntu 26.04 LTS, x86_64, systemd, cgroup v2, enabled AppArmor.

Installs QEMU/KVM, libvirt, virtiofsd, OVMF, cloud-image/ISO tools,
Packer 1.16.2, and the official QEMU Packer plugin 1.1.7.
Adds the named non-root users to kvm and verifies KVM access as those users.
All accounts receive KVM access only, never libvirt administration.
Only the image operator receives the image-building plugin; fleet runtime
accounts remain separate OS users. Runtime libvirt helpers are private to
each bounded execution; no shared libvirt daemon is configured or started.

Does not create/start VMs, build images, add custom networks/firewall rules,
change memory/swap/overcommit settings, reboot, restart agents,
touch .codex/history/application data, or modify fleet configuration.
Package installation can update listed packages and start/reload distro
services. Existing shared libvirt configuration and networks are untouched.
USAGE
}

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
note() { printf '\n[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
cleanup() {
    # Only this invocation's mktemp directory; never an existing user directory.
    if [[ -n "$download_dir" ]]; then rm -rf -- "$download_dir"; fi
}
trap cleanup EXIT
trap 'printf "ERROR: setup failed at line %s; completed changes remain. Correct the error and rerun.\n" "$LINENO" >&2' ERR

while (($#)); do
    case "$1" in
        --user)
            (($# >= 2)) || fail '--user requires a value'
            [[ -z "$vm_user" ]] || fail '--user was supplied twice'
            vm_user=$2
            shift 2
            ;;
        --check) check_only=true; shift ;;
        --runtime-user)
            (($# >= 2)) || fail '--runtime-user requires a value'
            runtime_users+=("$2")
            shift 2
            ;;
        --help|-h) usage; exit 0 ;;
        *) fail "Unknown argument: $1" ;;
    esac
done

validate_account() {
    [[ "$1" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || fail 'Supply an existing local non-root account'
    getent passwd "$1" >/dev/null || fail "Account does not exist: $1"
    [[ "$(id -u "$1")" != 0 ]] || fail 'Choose a non-root account'
}
validate_account "$vm_user"
for account in "${runtime_users[@]}"; do
    validate_account "$account"
    [[ "$account" != "$vm_user" ]] || fail 'The image operator and fleet runtime accounts must be separate'
done
for ((index=0; index<${#runtime_users[@]}; index++)); do
    for ((earlier=0; earlier<index; earlier++)); do
        [[ "${runtime_users[index]}" != "${runtime_users[earlier]}" ]] || fail 'Duplicate --runtime-user'
    done
done
if ! $check_only; then
    ((EUID == 0)) || fail 'Run setup with sudo, or use --check for read-only checks'
elif ((EUID != 0)) && [[ "$(id -un)" != "$vm_user" ]]; then
    fail 'Unprivileged --check must name the current user'
fi
if ((EUID != 0 && ${#runtime_users[@]} != 0)); then
    fail 'Checking other runtime accounts requires sudo'
fi

# /etc/os-release is administrator-owned OS metadata, not project input.
# shellcheck disable=SC1091
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 26.04 ]] || fail 'This script targets Ubuntu 26.04 LTS'
[[ "$(dpkg --print-architecture)" == amd64 ]] || fail 'This script targets x86_64 hosts'
[[ -d /run/systemd/system ]] || fail 'A running systemd host is required'
[[ -f /sys/fs/cgroup/cgroup.controllers ]] || fail 'cgroup v2 is required'
for controller in cpu memory pids; do
    [[ " $(cat /sys/fs/cgroup/cgroup.controllers) " == *" $controller "* ]] || fail "Missing cgroup controller: $controller"
done
[[ -r /sys/module/apparmor/parameters/enabled ]] || fail 'The host kernel must enable AppArmor'
[[ "$(cat /sys/module/apparmor/parameters/enabled)" == Y ]] || fail 'AppArmor is disabled; enable it through host administration first'

as_account() {
    local account=$1
    shift
    if ((EUID == 0)); then
        runuser -u "$account" -- "$@"
    else
        "$@"
    fi
}
as_user() { as_account "$vm_user" "$@"; }

verify_kvm() {
    as_account "$1" python3 -c 'import fcntl, os; fd = os.open("/dev/kvm", os.O_RDWR | os.O_CLOEXEC); version = fcntl.ioctl(fd, 0xAE00, 0); os.close(fd); assert version == 12, f"Unexpected KVM API {version}"; print("KVM access: OK (API 12; no VM created)")'
}

verify_host() {
    note "Checking installed tools and operator access for $vm_user"
    for tool in qemu-system-x86_64 qemu-img virsh cloud-localds xorriso curl unzip python3 packer openssl ssh ssh-keygen nc; do
        command -v "$tool" >/dev/null || fail "Missing executable: $tool"
    done
    local virtiofs_binary
    virtiofs_binary=$(dpkg-query -L virtiofsd | while IFS= read -r file; do
        if [[ "$file" == */virtiofsd && -f "$file" && -x "$file" ]]; then printf '%s\n' "$file"; break; fi
    done)
    [[ -n "$virtiofs_binary" ]] || fail 'The virtiofsd package has no executable'
    "$virtiofs_binary" --version
    qemu-system-x86_64 --version
    qemu-img --version
    virsh --version
    for firmware in /usr/share/OVMF/OVMF_CODE_4M.fd /usr/share/OVMF/OVMF_VARS_4M.fd; do
        [[ -r "$firmware" ]] || fail "Missing VM firmware: $firmware"
    done
    [[ "$(/usr/local/bin/packer version | head -n 1)" == "Packer v$PACKER_VERSION" ]] || fail 'The pinned Packer version is not installed in /usr/local/bin'
    /usr/local/bin/packer version

    # KVM_GET_API_VERSION opens KVM but does not create a VM or reserve guest RAM.
    verify_kvm "$vm_user"
    /usr/sbin/libvirtd --version
    /usr/sbin/virtlogd --version
    as_user /usr/local/bin/packer plugins installed |
        python3 -c 'import sys; s = sys.stdin.read(); assert "github.com/hashicorp/qemu/" in s and "_v1.1.7_" in s, "Pinned QEMU Packer plugin is missing"; print("Packer QEMU plugin 1.1.7: OK")'
    systemctl is-active --quiet apparmor.service || fail 'AppArmor service is not active'
    printf 'cgroup v2 controllers: %s\n' "$(cat /sys/fs/cgroup/cgroup.controllers)"
    printf 'Host overcommit mode (unchanged): %s\n' "$(cat /proc/sys/vm/overcommit_memory)"
    printf 'Host memory / available:\n'
    awk '/^(MemTotal|MemAvailable):/ {print}' /proc/meminfo
    for account in "${runtime_users[@]}"; do
        note "Checking fleet runtime account $account"
        verify_kvm "$account"
        printf 'Supplementary groups: %s\n' "$(id -nG "$account")"
    done
    note 'Host prerequisites verified. No VM or model turn was started.'
}

if $check_only; then
    verify_host
    exit 0
fi

note 'Installing the VM-host and image-build prerequisites'
export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=120 update
apt-get -o DPkg::Lock::Timeout=120 install -y --no-install-recommends \
    qemu-system-x86 qemu-utils libvirt-daemon libvirt-daemon-driver-qemu \
    libvirt-clients virtiofsd ovmf-generic cloud-image-utils xorriso \
    apparmor apparmor-utils \
    ca-certificates curl unzip python3 openssl openssh-client netcat-openbsd libxml2-utils

note 'Enabling KVM access'
modprobe kvm
if grep -qE '^vendor_id[[:space:]]*: GenuineIntel$' /proc/cpuinfo; then
    modprobe kvm_intel
elif grep -qE '^vendor_id[[:space:]]*: AuthenticAMD$' /proc/cpuinfo; then
    modprobe kvm_amd
else
    fail 'Cannot identify the x86 KVM CPU vendor'
fi
[[ -c /dev/kvm ]] || fail 'KVM is unavailable; check BIOS/nested-virtualization settings'
usermod --append --groups kvm "$vm_user"
for account in "${runtime_users[@]}"; do
    usermod --append --groups kvm "$account"
done

note "Installing verified Packer $PACKER_VERSION"
download_dir=$(mktemp -d /tmp/ctlflow-vm-host.XXXXXXXX)
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --connect-timeout 15 --max-time 180 --retry 3 \
    "https://releases.hashicorp.com/packer/$PACKER_VERSION/packer_${PACKER_VERSION}_linux_amd64.zip" \
    --output "$download_dir/packer.zip"
printf '%s  %s\n' "$PACKER_SHA256" "$download_dir/packer.zip" | sha256sum --check --strict -
unzip -q "$download_dir/packer.zip" packer -d "$download_dir"
install -o root -g root -m 0755 "$download_dir/packer" /usr/local/bin/packer

note "Installing the official QEMU Packer plugin $QEMU_PLUGIN_VERSION for $vm_user"
# The fresh user process receives the newly assigned supplementary groups.
# It owns its normal Packer plugin directory; no root-owned plugin files in HOME.
cd /
as_user /usr/local/bin/packer plugins install github.com/hashicorp/qemu "$QEMU_PLUGIN_VERSION"

verify_host
printf '\nSetup complete for %s. Existing login processes keep their old groups.\n' "$vm_user"
printf 'A new login gets KVM access. Existing agents and shared host services were not restarted.\n'
printf 'Build and explicitly configure fleet images before selecting VM execution.\n'
