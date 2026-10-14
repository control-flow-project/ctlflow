import assert from 'node:assert/strict';
import test from 'node:test';
import { csharpReferenceViolations, csharpSourceViolations } from './verify-csharp-architecture.mjs';

test('C# domains use pure values and ports, not contract or implementation owners', () => {
  for (const project of ['Crossfire.Domain', 'Fleetd.Domain']) {
    assert.deepEqual(csharpSourceViolations(project, 'using Crossfire.Kernel; using Crossfire.AgentCore; namespace ' + project + ';'), []);
    for (const dependency of ['Crossfire.Contracts', 'Crossfire.AdapterSqlite', 'Fleetd.Storage', 'Microsoft.AspNetCore.Http', 'Microsoft.EntityFrameworkCore', 'System.Net.Http']) assert.equal(csharpSourceViolations(project, 'using ' + dependency + ';').length, 1, dependency);
    for (const implementation of ['ListenerControl', 'ListenerReceiver', 'OwnerObservation', 'HistoryQueries']) assert.equal(csharpSourceViolations(project, 'private ' + implementation + ' implementation;').length, 1, implementation);
  }
  assert.deepEqual(csharpSourceViolations('Crossfire.Kernel', 'namespace Crossfire.Kernel;'), []);
  assert.equal(csharpSourceViolations('Crossfire.Kernel', 'using Crossfire.Contracts;').length, 1);
});

test('C# project references preserve pure layers and build-only dependency closure', () => {
  const project = (name, kind = 'packages') => ({ name, kind });
  assert.deepEqual(csharpReferenceViolations(project('Crossfire.Contracts'), project('Crossfire.Domain')), []);
  assert.deepEqual(csharpReferenceViolations(project('Fleetd.Domain'), project('Crossfire.AgentCore')), []);
  assert.equal(csharpReferenceViolations(project('Fleetd.Domain'), project('Crossfire.Contracts')).length, 1);
  assert.equal(csharpReferenceViolations(project('Crossfire.Domain'), project('Crossfire.AdapterSqlite')).length, 1);
  assert.equal(csharpReferenceViolations(project('Crossfire.AdapterSqlite'), project('Crossfire.EfCompiler', 'build')).length, 1);
  assert.equal(csharpReferenceViolations(project('Fleet.Cli', 'apps'), project('Fleetd.Daemon', 'apps')).length, 1);
  assert.deepEqual(csharpReferenceViolations(project('Crossfire.Storage.Tests', 'tests'), project('Crossfire.Server', 'apps')), []);
  assert.deepEqual(csharpReferenceViolations(project('Crossfire.EfHost', 'build'), project('Crossfire.EfCompiler', 'build')), []);
});
