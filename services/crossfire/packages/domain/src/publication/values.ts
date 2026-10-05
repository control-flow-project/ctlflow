export const PUBLICATION_LIMITS = { files: 512, fileBytes: 8 * 1024 * 1024, bundleBytes: 32 * 1024 * 1024,
  stagingMilliseconds: 3600_000, instanceBytes: 1024 * 1024 * 1024, agentBytes: 128 * 1024 * 1024,
  instanceCount: 4096, agentCount: 128, uploads: 8 } as const;
export const PUBLICATION_MEDIA = {
  html: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', pdf: 'application/pdf',
} as const;
export type PublicationState = 'staging' | 'published' | 'deleted';
export type PublicationFileInput = { path: string; mediaType: string; bytes: number; sha256: string };
export type PublicationCreation = { title: string; files: PublicationFileInput[] };
export type Publication = { id: string; agentId: string; publicKey: string; title: string; state: PublicationState;
  revision: number; createdAt: number; expiresAt: number; publishedAt: number | null; deletedAt: number | null;
  cleanedAt: number | null; totalBytes: number; fileCount: number };
export type PublicationFile = PublicationFileInput & { id: string; publicationId: string; uploaded: boolean };
export type PublicationSummary = Omit<Publication, 'publicKey' | 'cleanedAt'> & { agentName: string; ownerId: string;
  ownerName: string; url: string | null; allowedActions: string[] };
export type PublicationDetails = PublicationSummary & { files: Omit<PublicationFile, 'publicationId'>[] };
export type PublicationQuery = { page: number; pageSize: number; search: string; state?: PublicationState; agentId?: string; ownerId?: string };
export type PublicationBudget = { instanceBytes: number; agentBytes: number; instanceCount: number; agentCount: number; uploads: number };
