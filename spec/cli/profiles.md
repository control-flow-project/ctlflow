---
title: Profiles
weight: 47
---

A Resource profile is immutable infrastructure-wide execution sizing selected by a Package.

```text
ctlflow profile list
ctlflow profile get PROFILE
ctlflow profile create -f FILE
```

```yaml
name: standard
cpu: "2"
memory: 4Gi
ephemeralStorage: 8Gi
```

Profiles express resource requirements, not placement. A sizing change creates a new profile;
existing Package contracts continue to resolve their original profile. Profiles are not updated or
deleted.
