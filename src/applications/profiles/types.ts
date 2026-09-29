export interface FatalSignature {
  id: string;
  pattern: RegExp;
  label: string;
  commonCauses: string[];
}

export interface ExpectedPort {
  port: number;
  protocol: "tcp" | "udp";
  purpose: string;
}

export interface ApplicationProfile {
  id: string;
  application: string;
  distribution?: string;
  runtime: string;
  displayName: string;
  expectedPorts: ExpectedPort[];
  readyMarkers: RegExp[];
  healthyStartupPatterns: RegExp[];
  fatalSignatures: FatalSignature[];
  expectedStartupMs: number;
  gracefulStopCommand: string | null;
  configLocations: string[];
  dependencyManifests: string[];
  diagnosticCommands: string[];
  backupTargets: string[];
  commonFailureModes: string[];
}
