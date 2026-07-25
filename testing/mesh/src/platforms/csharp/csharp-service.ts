import type {
  CSharpServicePublication
} from "./csharp-service-publication.js";

export interface CSharpServiceOptions {
  readonly publication: CSharpServicePublication;
  readonly grpcHost: string;
  readonly grpcPort: number;
  readonly probeHost: string;
  readonly probePort: number;
  readonly environment: Readonly<Record<string, string>>;
}

export interface CSharpService {
  readonly executablePath: string;
  readonly diagnostics: () => string;
  readonly restart: (
    environment?: Readonly<Record<string, string>>
  ) => Promise<void>;
  readonly stop: () => Promise<void>;
}
