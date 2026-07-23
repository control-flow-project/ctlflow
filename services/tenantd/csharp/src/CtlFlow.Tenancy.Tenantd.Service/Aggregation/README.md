# Aggregated administration placeholder

This directory will own the private Kubernetes API aggregation surface for
Tenant and Workspace administration. It is a separate listener and
authentication boundary from direct kernel gRPC.

Resource CRUD, lifecycle transitions, list/watch behavior, and optimistic
concurrency are added together with their normative schemas and canonical
evidence; no direct gRPC operation substitutes for them.
