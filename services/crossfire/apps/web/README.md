# Crossfire management UI

This private project owns the single React management UI. Backend language
selection does not select another UI, another API or another asset layout.
Browser helpers come from `@ctlflow/crossfire-client`; backend implementations
and Node platform APIs are prohibited by the architecture tests.

From the repository root, after installing the locked workspace dependencies:

```sh
npm run typecheck --workspace=@ctlflow/crossfire-web
npm run build --workspace=@ctlflow/crossfire-web
```

The default output is this project's `dist` directory. A release builder can
instead supply one absolute output directory:

```sh
npm run build --workspace=@ctlflow/crossfire-web -- /tmp/crossfire-management
```

The backend serves `index.html` for management views and `assets` at
`/manage/assets/`. JavaScript and stylesheet names contain content hashes;
Element translations retain their canonical
`/manage/assets/element-translations.json` URL. The product build invokes this
same project-owned build command; it does not maintain another bundler path.

The UI neither selects a runtime nor calls Node, C# or Rust processes. It calls
the existing Crossfire HTTP contract. Native backend readiness is separate from
UI build readiness; see the repository's native implementation report.
The [native implementation report](../../../../docs/architecture/native-implementations.md)
records the unfinished backend scope and its dependency decision.
