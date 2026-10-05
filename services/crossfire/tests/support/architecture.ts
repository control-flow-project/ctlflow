import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

export type PackageManifest = { name: string; dependencies?: Record<string, string>; exports?: Record<string, unknown> };
export type Dependency = { name: string; typeOnly: boolean };

function typeImport(node: ts.ImportDeclaration): boolean {
  return node.importClause?.isTypeOnly === true || !!node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
    && !node.importClause.name && node.importClause.namedBindings.elements.length > 0 && node.importClause.namedBindings.elements.every(element => element.isTypeOnly);
}
function typeExport(node: ts.ExportDeclaration): boolean {
  return node.isTypeOnly || !!node.exportClause && ts.isNamedExports(node.exportClause)
    && node.exportClause.elements.length > 0 && node.exportClause.elements.every(element => element.isTypeOnly);
}

export function imports(source: ts.SourceFile): { dependencies: Dependency[]; failures: string[] } {
  const dependencies: Dependency[] = [], failures: string[] = [];
  function literal(node: ts.Node | undefined, typeOnly: boolean): void {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) dependencies.push({ name: node.text, typeOnly });
    else failures.push('Dependency names must be static string literals');
  }
  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) failures.push('Strict types prohibit any');
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) failures.push('Functional modules prohibit classes');
    if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) failures.push('Use named exports');
    if (ts.isExportAssignment(node) || ts.isExportDeclaration(node) && node.exportClause && ts.isNamespaceExport(node.exportClause)
      && node.exportClause.name.text === 'default') failures.push('Use named exports');
    if (ts.isExportSpecifier(node) && node.name.text === 'default') failures.push('Use named exports');
    if (ts.isImportDeclaration(node)) literal(node.moduleSpecifier, typeImport(node));
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) literal(node.moduleSpecifier, typeExport(node));
    if (ts.isImportTypeNode(node)) {
      literal(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined, true);
    }
    if (ts.isImportEqualsDeclaration(node)) {
      failures.push('Use ESM imports, not import-equals');
      if (ts.isExternalModuleReference(node.moduleReference)) literal(node.moduleReference.expression, node.isTypeOnly);
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) literal(node.arguments[0], false);
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        failures.push('Use ESM imports, not require'); literal(node.arguments[0], false);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source); return { dependencies, failures };
}

function sourceTarget(manifest: PackageManifest, subpath: string): string | undefined {
  for (const [key, value] of Object.entries(manifest.exports ?? {}).sort(([left], [right]) =>
    Number(left.includes('*')) - Number(right.includes('*')) || right.indexOf('*') - left.indexOf('*') || right.length - left.length)) {
    const [prefix, suffix] = key.split('*');
    if (suffix === undefined ? key !== subpath : !subpath.startsWith(prefix!) || !subpath.endsWith(suffix)) continue;
    const target = typeof value === 'string' ? value : value && typeof value === 'object'
      ? (value as Record<string, unknown>).source ?? (value as Record<string, unknown>).types : undefined;
    if (typeof target !== 'string') return undefined;
    return suffix === undefined ? target : target.replace('*', subpath.slice(prefix!.length, subpath.length - suffix.length));
  }
  return undefined;
}

function pureValues(file: string): boolean {
  if (!existsSync(file)) return false;
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  function value(node: ts.Expression): boolean {
    return ts.isLiteralExpression(node) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)
      || ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.TildeToken].includes(node.operator) && value(node.operand)
      || ts.isBinaryExpression(node) && (node.operatorToken.kind < ts.SyntaxKind.FirstAssignment || node.operatorToken.kind > ts.SyntaxKind.LastAssignment)
        && node.operatorToken.kind !== ts.SyntaxKind.CommaToken && value(node.left) && value(node.right)
      || ts.isArrayLiteralExpression(node) && node.elements.every(element => ts.isExpression(element) && value(element))
      || ts.isObjectLiteralExpression(node) && node.properties.every(property => ts.isPropertyAssignment(property)
        && (!ts.isComputedPropertyName(property.name) || value(property.name.expression)) && value(property.initializer))
      || (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) && value(node.expression);
  }
  return source.statements.every(statement => ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)
    || ts.isImportDeclaration(statement) && typeImport(statement)
    || ts.isExportDeclaration(statement) && typeExport(statement)
    || ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
      && statement.declarationList.declarations.every(declaration => ts.isIdentifier(declaration.name) && declaration.initializer && value(declaration.initializer)));
}

export function auditSource(root: string, owner: string, file: string, text: string, manifests: ReadonlyMap<string, PackageManifest>): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true), parsed = imports(source);
  const failures = [...parsed.failures], manifest = manifests.get(owner)!;
  const byName = new Map([...manifests].map(([path, entry]) => [entry.name, { path, manifest: entry }]));
  const kind = owner.split('/')[3]!, service = owner.split('/')[1]!;
  for (const dependency of parsed.dependencies) {
    const name = dependency.name;
    if (name.startsWith('.')) {
      if (!/\.(js|json|css)$/u.test(name)) failures.push('Relative imports require explicit runtime extensions: ' + name);
      const target = relative(root, resolve(dirname(file), name)).split('/').slice(0, 4).join('/');
      if (target !== owner) failures.push('Use declared package exports, not source reach-through: ' + name);
      continue;
    }
    if (name.startsWith('node:')) {
      if (kind === 'domain' || kind === 'kernel' || kind === 'contracts') failures.push('Pure domain/value/contracts layers cannot import native platform APIs: ' + name);
      continue;
    }
    const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]!;
    if (!Object.hasOwn(manifest.dependencies ?? {}, packageName)) failures.push('Declare the dependency: ' + packageName);
    const target = byName.get(packageName);
    if (!target) {
      if (kind === 'domain' || kind === 'kernel') failures.push('Pure domain/kernel layers cannot consume external implementations: ' + name);
      continue;
    }
    if (target.path.includes('/apps/')) failures.push('Application composition roots cannot be package dependencies: ' + name);
    if (service === 'crossfire' && target.path.split('/')[1] !== 'crossfire') failures.push('Crossfire cannot depend on a fleet product: ' + name);
    const subpath = name === packageName ? '.' : '.' + name.slice(packageName.length);
    const exported = sourceTarget(target.manifest, subpath);
    if (subpath.split('/').some(part => part === '..' || part === '') || !exported
      || relative(resolve(root, target.path), resolve(root, target.path, exported)).startsWith('..')
      || !existsSync(resolve(root, target.path, exported))) failures.push('Use an existing declared package export: ' + name);
    const targetKind = target.path.split('/')[3]!;
    if (kind === 'kernel' && targetKind !== 'kernel') failures.push('Kernel cannot depend on a higher product layer: ' + name);
    if (kind === 'contracts' && !['contracts', 'kernel', 'domain'].includes(targetKind)) failures.push('Wire contracts cannot depend on runtime ports or concrete implementations: ' + name);
    if (kind === 'domain' && (targetKind === 'contracts' || targetKind.startsWith('adapter-') || targetKind === 'test-support')) failures.push('Domain cannot depend on transport, storage, adapters or fixtures: ' + name);
    if ((kind === 'contracts' || kind === 'agent-core' || kind === 'domain' && target.path !== owner)
      && targetKind === 'domain' && (!exported || !pureValues(resolve(root, target.path, exported)))) failures.push('Consume only pure domain values, not use cases or repositories: ' + name);
    if (kind === 'agent-core' && (targetKind.startsWith('adapter-') || targetKind === 'test-support')) failures.push('Core ports cannot depend on concrete adapters: ' + name);
    if (kind === 'domain' && targetKind === 'agent-core'
      && (!exported || !pureValues(resolve(root, target.path, exported)))) failures.push('Domain consumes pure core ports and values, not executable core logic: ' + name);
  }
  return failures;
}
