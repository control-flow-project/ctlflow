import type { Result } from '@crossfire/kernel/result';
import type { RuntimeAttachment } from '@crossfire/agent-core/terminal';
import type { Configuration, Registration, Roster, Operation, Approval, Instance, Controller } from './model.js';
export type Registry = {
  registrations(): Result<Registration[]>;
  saveRegistrations(values: Registration[]): Result<void>;
  operations(): Result<Operation[]>;
  saveOperations(values: Operation[]): Result<void>;
  load(directory: string): Result<Configuration>;
  writeRoster(configuration: Configuration, roster: Roster): Result<Configuration>;
};
export type Running = { sessionId: string; signal: AbortSignal; attachment: RuntimeAttachment; close(): Promise<void> };
export type Execution = {
  validate(configuration: Configuration): Result<void>;
  prepare(configuration: Configuration, controller: Controller, signal: AbortSignal, approval: (approval: Approval) => void): Promise<Result<{ failed: { instanceKey: string; code: string; message: string }[] }>>;
  start(configuration: Configuration, instance: Instance, signal: AbortSignal): Promise<Result<Running>>;
  detach(configuration: Configuration, instance: Instance): Promise<Result<void>>;
};
export type Services = { registry: Registry; execution: Execution; controller: Controller; now(): number; id(): string };
