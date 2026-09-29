import { executeDelete, executeInsert, executeSelect, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import { schema, type Store, type Tables } from './database.js';

export function nameClaim(store: Store, name: string) {
  return executeSelect(store, schema, (query, params) => query.from('name_claims').where(row => row.name === params.name).firstOrDefault(), { name });
}
export function claimName(store: Store, name: string, enrollment: string): void {
  executeInsert(store, schema, (query, params) => query.insertInto('name_claims').values({ name: params.name, enrollment: params.enrollment, agent: null }), { name, enrollment });
}
export function approveName(store: Store, enrollment: string, agent: string): void {
  executeUpdate(store, schema, (query, params) => query.update('name_claims').set({ agent: params.agent, enrollment: null })
    .where(row => row.enrollment === params.enrollment), { enrollment, agent });
}
export function releaseName(store: Store, enrollment: string): void {
  executeDelete(store, schema, (query, params) => query.deleteFrom('name_claims').where(row => row.enrollment === params.enrollment), { enrollment });
}
export function fleetBinding(store: Store, owner: string, fleet: string, instance: string) {
  return executeSelect(store, schema, (query, params) => query.from('fleet_bindings')
    .where(row => row.owner === params.owner && row.fleet === params.fleet && row.instance === params.instance).firstOrDefault(), { owner, fleet, instance });
}
export function bindFleet(store: Store, input: Tables['fleet_bindings']): void {
  executeInsert(store, schema, (query, params) => query.insertInto('fleet_bindings').values({ owner: params.owner, fleet: params.fleet, instance: params.instance, agent: params.agent }), input);
}
export function fleetRequest(store: Store, id: string) {
  return executeSelect(store, schema, (query, params) => query.from('fleet_enrollments').where(row => row.id === params.id).firstOrDefault(), { id });
}
export function fleetRequests(store: Store, owner: string, administrator: boolean) {
  return executeSelect(store, schema, (query, params) => query.from('fleet_enrollments')
    .where(row => params.administrator === true || row.owner === params.owner).orderBy(row => row.id).take(1000), { owner, administrator });
}
export function insertFleetRequest(store: Store, input: Tables['fleet_enrollments']): void {
  executeInsert(store, schema, (query, params) => query.insertInto('fleet_enrollments').values({
    id: params.id, owner: params.owner, fleet: params.fleet, code: params.code, secretHash: params.secretHash,
    digest: params.digest, outcomes: params.outcomes, status: params.status, expires: params.expires,
  }), input);
}
export function decideFleetRequest(store: Store, id: string, status: 'approved' | 'rejected', outcomes: string): number {
  return executeUpdate(store, schema, (query, params) => query.update('fleet_enrollments').set({ status: params.status, outcomes: params.outcomes })
    .where(row => row.id === params.id && row.status === 'pending'), { id, status, outcomes });
}
export function pruneFleets(store: Store, now: number): void {
  executeDelete(store, schema, (query, params) => query.deleteFrom('fleet_enrollments').where(row => row.expires <= params.now), { now });
}
