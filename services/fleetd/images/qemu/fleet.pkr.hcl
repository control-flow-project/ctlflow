packer {
  required_version = "= 1.16.2"
  required_plugins {
    qemu = {
      version = "= 1.1.7"
      source  = "github.com/hashicorp/qemu"
    }
  }
}

variable "base_image_url" {
  type = string
}
variable "base_image_checksum" {
  type = string
  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.base_image_checksum))
    error_message = "Supply the publisher's exact SHA256 digest as sha256:<digest>."
  }
}
variable "output_directory" {
  type = string
}
variable "provision_script" {
  type = string
}
variable "build_password" {
  type      = string
  sensitive = true
  validation {
    condition     = length(var.build_password) >= 24
    error_message = "Use a random disposable image-build password of at least 24 characters."
  }
}

source "qemu" "fleet" {
  accelerator       = "kvm"
  machine_type      = "q35"
  disk_image        = true
  iso_url           = var.base_image_url
  iso_checksum      = var.base_image_checksum
  output_directory  = var.output_directory
  vm_name           = "fleet.qcow2"
  format            = "qcow2"
  disk_size         = "8G"
  disk_interface    = "virtio"
  net_device        = "virtio-net"
  cpus              = 2
  memory            = 1024
  headless          = true
  efi_boot          = true
  efi_firmware_code = "/usr/share/OVMF/OVMF_CODE_4M.fd"
  efi_firmware_vars = "/usr/share/OVMF/OVMF_VARS_4M.fd"
  ssh_username      = "packer"
  ssh_password      = var.build_password
  ssh_timeout       = "10m"
  shutdown_command  = "sudo -n /usr/bin/systemctl poweroff"
  http_bind_address = "127.0.0.1"
  http_content = {
    "/meta-data" = jsonencode({ "instance-id" = "ctlflow-image-build", "local-hostname" = "ctlflow-image-build" })
    "/user-data" = "#cloud-config\n${jsonencode({
      ssh_pwauth = true
      users      = [{ name = "packer", shell = "/bin/bash", groups = ["sudo"], sudo = "ALL=(ALL) NOPASSWD:ALL", lock_passwd = false }]
      chpasswd   = { expire = false, users = [{ name = "packer", password = var.build_password, type = "text" }] }
    })}"
  }
  qemuargs = [
    ["-smbios", "type=1,serial=ds=nocloud;s=http://10.0.2.2:{{.HTTPPort}}/"],
    ["-netdev", "user,id=user.0,hostfwd=tcp:127.0.0.1:{{.SSHHostPort}}-:22"],
  ]
}

build {
  sources = ["source.qemu.fleet"]
  provisioner "shell" {
    inline = [
      "set -eu",
      "sudo -n /usr/bin/env DEBIAN_FRONTEND=noninteractive /usr/bin/apt-get update",
      "sudo -n /usr/bin/env DEBIAN_FRONTEND=noninteractive /usr/bin/apt-get install --yes openssh-server ca-certificates curl python3 procps iproute2 kmod udev",
    ]
  }
  provisioner "shell" {
    script = var.provision_script
  }
  provisioner "shell" {
    inline = [
      "set -eu",
      "sudo -n /usr/bin/systemctl disable ssh.service ssh.socket",
      "sudo -n /usr/bin/systemctl mask ssh.service ssh.socket",
      "sudo -n /usr/bin/cloud-init clean --logs --seed",
      "sudo -n /usr/bin/rm -f /etc/ssh/ssh_host_* /root/.bash_history /home/packer/.bash_history",
      "sudo -n /usr/bin/rm -rf /home/packer/.ssh",
      "sudo -n /usr/sbin/usermod --lock packer",
      "sudo -n /usr/bin/apt-get clean",
    ]
  }
}
