import type {
  OriginRequestEvidence
} from "./origin-request-evidence.js";

export interface OriginState {
  readonly evidence: OriginRequestEvidence[];
  available: boolean;
}
