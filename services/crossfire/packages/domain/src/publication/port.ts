import type { Result } from '@crossfire/kernel/result';
import type { BinaryInput } from '@crossfire/kernel/bytes';
import type { Page } from '../port/directory.js';
import type { Publication, PublicationFile, PublicationQuery, PublicationBudget } from './values.js';
export type PublicationRecord = { publication: Publication; agentName: string; ownerId: string; ownerName: string };
export type PublicationRepository = {
  find(id: string): Result<PublicationRecord | null>;
  files(id: string): Result<PublicationFile[]>;
  insert(publication: Publication, files: PublicationFile[]): Result<void>;
  uploaded(publicationId: string, fileId: string): Result<void>;
  publish(id: string, expectedRevision: number, now: number): Result<void>;
  fence(id: string, expectedRevision: number, now: number): Result<void>;
  cleaned(id: string, now: number): Result<void>;
  usage(agentId: string): Result<{ instanceBytes: number; agentBytes: number; instanceCount: number; agentCount: number }>;
  page(input: PublicationQuery): Result<Page<PublicationRecord>>;
  maintenance(now: number, limit: number): Result<Publication[]>;
  publicFile(publicKey: string, path: string): Result<{ publication: Publication; file: PublicationFile } | null>;
};
export type PublicationStore = {
  exclusive<T>(id: string, operation: () => Promise<Result<T>>): Promise<Result<T>>;
  upload(id: string, file: PublicationFile, input: BinaryInput, signal: AbortSignal): Promise<Result<void>>;
  verify(id: string, files: PublicationFile[]): Promise<Result<void>>;
  read(id: string, file: PublicationFile): Promise<Result<{ chunks: AsyncIterable<Uint8Array>; close(): Promise<void> }>>;
  remove(id: string): Promise<Result<void>>;
  close(): void;
};
export type PublicationService = { repository: PublicationRepository; store: PublicationStore; origin: string; budget: PublicationBudget };
