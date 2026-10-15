import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export function timingViolations(text, path) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const pauses = new Set(), timers = new Set(['setTimeout']), namespaces = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (statement.moduleSpecifier.text === 'node:timers/promises') {
      if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
        if ((binding.propertyName ?? binding.name).text === 'setTimeout') pauses.add(binding.name.text);
      }
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    }
    if (statement.moduleSpecifier.text === 'node:timers' && bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) if ((binding.propertyName ?? binding.name).text === 'setTimeout') timers.add(binding.name.text);
    }
  }
  function polling(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      const condition = ts.isWhileStatement(parent) || ts.isDoStatement(parent) ? parent.expression
        : ts.isForStatement(parent) ? parent.condition : undefined;
      if (condition && condition.kind !== ts.SyntaxKind.TrueKeyword && condition.kind !== ts.SyntaxKind.NumericLiteral) return true;
      if (ts.isForStatement(parent) && !condition) {
        let observation = false, bounded = false;
        function inspect(child) {
          if (ts.isFunctionLike(child)) return;
          if (ts.isBreakStatement(child) || ts.isReturnStatement(child)) observation = true;
          if (ts.isBinaryExpression(child) && [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
            ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(child.operatorToken.kind)
            && [child.left, child.right].some(value => ts.isIdentifier(value) && /deadline/iu.test(value.text))) bounded = true;
          ts.forEachChild(child, inspect);
        }
        inspect(parent.statement);
        if (observation && bounded) return true;
      }
    }
    return false;
  }
  const violations = [];
  function report(node) { violations.push(path + ':' + (source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)); }
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'waitForTimeout') report(node);
    if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)) {
      const callee = node.expression.expression;
      if ((ts.isIdentifier(callee) && pauses.has(callee.text)
        || ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
          && namespaces.has(callee.expression.text) && callee.name.text === 'setTimeout') && !polling(node)) report(node);
    }
    if (ts.isAwaitExpression(node) && ts.isNewExpression(node.expression) && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'Promise' && !polling(node)) {
      const callback = node.expression.arguments?.[0];
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        const resolve = callback.parameters[0]?.name;
        if (resolve && ts.isIdentifier(resolve)) {
          function findTimer(child) {
            if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && timers.has(child.expression.text)
              && child.arguments[0] && ts.isIdentifier(child.arguments[0]) && child.arguments[0].text === resolve.text) report(node);
            ts.forEachChild(child, findTimer);
          }
          findTimer(callback.body);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...new Set(violations)];
}

export function verifyTestTiming(root) {
  assert.equal(timingViolations("import {setTimeout as delay} from 'node:timers/promises'; await delay(5000)", 'proof.ts').length, 1);
  assert.equal(timingViolations('await new Promise(resolve => setTimeout(resolve, 5000))', 'proof.ts').length, 1);
  assert.equal(timingViolations('await page.waitForTimeout(5000)', 'proof.ts').length, 1);
  assert.equal(timingViolations("import {setTimeout as delay} from 'node:timers/promises'; while (!ready) { assert(now() < deadline); await delay(10) }", 'proof.ts').length, 0);
  assert.equal(timingViolations("import {setTimeout as delay} from 'node:timers/promises'; for (;;) await delay(5000)", 'proof.ts').length, 1);
  assert.equal(timingViolations("import {setTimeout as delay} from 'node:timers/promises'; for (;;) { if (ready) break; assert(now() < deadline); await delay(10) }", 'proof.ts').length, 0);
  assert.equal(timingViolations('await new Promise((resolve, reject) => { setTimeout(() => reject(new Error()), 5000); once(child, "close").then(resolve) })', 'proof.ts').length, 0);
  const violations = [];
  let files = 0;
  for (const service of ['crossfire', 'fleetd', 'fleet']) for (const directory of ['tests', 'node/tests', 'node/scripts', 'node/packages/test-support/src']) {
    const base = join(root, 'services', service, directory);
    if (!existsSync(base)) continue;
    for (const file of readdirSync(base, { recursive: true }).filter(file => file.endsWith('.ts'))) {
      const path = join(base, file); files++;
      violations.push(...timingViolations(readFileSync(path, 'utf8'), path));
    }
  }
  assert.deepEqual(violations, [], 'Unconditional test sleeps are prohibited; use controlled clocks or bounded observations');
  console.log('Test timing verified: ' + files + ' source files; no unconditional sleeps or browser timeout waits.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) verifyTestTiming(fileURLToPath(new URL('../', import.meta.url)));
