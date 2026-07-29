export interface EgressdProductionService {
  readonly bindingName: string;
  readonly endpoint: string;
  readonly diagnostics: () => string;
  readonly suspend: () => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly stop: () => Promise<void>;
}
