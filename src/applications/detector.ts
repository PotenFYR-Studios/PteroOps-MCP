import type { Logger } from "../observability/logger.js";
import type { EvidenceItem } from "../shared/types.js";
import { ApplicationProfileRegistry } from "./profiles/index.js";
import { detectMinecraft } from "./detectors/minecraft.js";
import { detectNodeJs } from "./detectors/nodejs.js";
import { detectPython } from "./detectors/python.js";
import {
  detectGenericContainer,
  detectGenericJava,
  detectGo,
  detectRust,
} from "./detectors/compiled-and-generic.js";
import {
  detectComposeWorkload,
  detectGameServer,
  detectPhp,
  detectRuby,
} from "./detectors/game-php-ruby.js";
import type {
  ApplicationDetectorPlugin,
  DetectionResult,
  DetectionSignals,
  DetectorOutput,
} from "./types.js";

export const DEFAULT_DETECTORS: ApplicationDetectorPlugin[] = [
  { id: "minecraft", label: "Minecraft (all distributions)", detect: detectMinecraft },
  { id: "game-server", label: "Generic game server", detect: detectGameServer },
  { id: "compose-workload", label: "Docker Compose workload", detect: detectComposeWorkload },
  { id: "nodejs", label: "Node.js", detect: detectNodeJs },
  { id: "python", label: "Python", detect: detectPython },
  { id: "php", label: "PHP", detect: detectPhp },
  { id: "ruby", label: "Ruby", detect: detectRuby },
  { id: "go", label: "Go", detect: detectGo },
  { id: "rust", label: "Rust", detect: detectRust },
  { id: "java-generic", label: "Generic Java", detect: detectGenericJava },
  { id: "container", label: "Generic container", detect: detectGenericContainer },
];

const GENERIC_IDS = new Set(["java-generic", "container"]);

export interface ApplicationDetectorDeps {
  profiles?: ApplicationProfileRegistry;
  logger?: Logger;
  clock?: () => number;
}

export class ApplicationDetector {
  private readonly profiles: ApplicationProfileRegistry;
  private readonly detectors: ApplicationDetectorPlugin[];
  private readonly clock: () => number;

  constructor(
    private readonly deps: ApplicationDetectorDeps = {},
    detectors: ApplicationDetectorPlugin[] = DEFAULT_DETECTORS,
  ) {
    this.profiles = deps.profiles ?? new ApplicationProfileRegistry();
    this.detectors = detectors;
    this.clock = deps.clock ?? Date.now;
  }

  detect(signals: DetectionSignals): DetectionResult {
    const outputs: Array<{ detectorId: string; output: DetectorOutput }> = [];
    for (const detector of this.detectors) {
      try {
        const output = detector.detect(signals);
        if (output) outputs.push({ detectorId: detector.id, output });
      } catch (error) {
        this.deps.logger?.warn("detector failed", {
          detector: detector.id,
          error: (error as Error).message,
        });
      }
    }

    if (outputs.length === 0) {
      return {
        runtime: "unknown",
        application: "unknown",
        confidence: 0,
        evidence: [],
        profileId: "unknown",
        detectedAt: this.clock(),
      };
    }

    const byConfidence = (a: (typeof outputs)[number], b: (typeof outputs)[number]) =>
      b.output.confidence - a.output.confidence;
    const specific = outputs.filter((entry) => !GENERIC_IDS.has(entry.detectorId)).sort(byConfidence);
    const generic = outputs.filter((entry) => GENERIC_IDS.has(entry.detectorId)).sort(byConfidence);
    const winner = specific[0] ?? generic[0]!;
    const evidence = dedupeEvidence(
      outputs
        .filter((entry) => entry.output.confidence >= winner.output.confidence - 0.3)
        .flatMap((entry) => entry.output.evidence),
    );
    const profile = this.profiles.lookup(winner.output.application, winner.output.distribution);

    return {
      runtime: winner.output.runtime,
      application: winner.output.application,
      ...(winner.output.distribution ? { distribution: winner.output.distribution } : {}),
      ...(winner.output.version ? { version: winner.output.version } : {}),
      confidence: Math.min(0.98, Number(winner.output.confidence.toFixed(2))),
      evidence: evidence.slice(0, 12),
      profileId: profile.id,
      detectedAt: this.clock(),
    };
  }
}

function dedupeEvidence(evidence: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  for (const item of evidence) {
    const key = `${item.source}:${item.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
}
