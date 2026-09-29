import type { EvidenceItem } from "../shared/types.js";

export interface DetectionSignals {
  serverName: string;
  startupCommand: string | null;
  dockerImage: string | null;
  invocation: string | null;
  eggName: string | null;
  nestName: string | null;
  variables: Array<{ name: string; value: string }>;
  rootFiles: string[];
  directoryFiles: Record<string, string[]>;
  configFiles: Record<string, string>;
  consoleLines: string[];
}

export interface DetectorOutput {
  runtime: string;
  application: string;
  distribution?: string;
  version?: string;
  confidence: number;
  evidence: EvidenceItem[];
}

export interface ApplicationDetectorPlugin {
  id: string;
  label: string;
  detect(signals: DetectionSignals): DetectorOutput | null;
}

export interface DetectionResult {
  runtime: string;
  application: string;
  distribution?: string;
  version?: string;
  confidence: number;
  evidence: EvidenceItem[];
  profileId: string | null;
  detectedAt: number;
}

export function emptySignals(serverName: string): DetectionSignals {
  return {
    serverName,
    startupCommand: null,
    dockerImage: null,
    invocation: null,
    eggName: null,
    nestName: null,
    variables: [],
    rootFiles: [],
    directoryFiles: {},
    configFiles: {},
    consoleLines: [],
  };
}
