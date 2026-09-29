import type { RemediationRepository } from "../persistence/repositories/remediations.js";
import type { RemediationPlan } from "./types.js";

export interface EffectivenessStats {
  action: string;
  attempts: number;
  succeeded: number;
  failed: number;
  rolledBack: number;
  successRate: number;
  lastAt: number | null;
}

export class RemediationEffectiveness {
  constructor(
    private readonly repository: RemediationRepository,
    private readonly clock: () => number = Date.now,
  ) {}

  async stats(
    options: { sinceDays?: number; tenant?: string; limit?: number } = {},
  ): Promise<EffectivenessStats[]> {
    const since = this.clock() - (options.sinceDays ?? 90) * 86_400_000;
    const records = await this.repository.list({
      since,
      limit: options.limit ?? 500,
      ...(options.tenant ? { tenant: options.tenant } : {}),
    });
    const byAction = new Map<string, EffectivenessStats>();
    for (const record of records) {
      const actions = extractActionTypes(record.plan);
      for (const action of actions) {
        const entry =
          byAction.get(action) ??
          {
            action,
            attempts: 0,
            succeeded: 0,
            failed: 0,
            rolledBack: 0,
            successRate: 0,
            lastAt: null,
          };
        entry.attempts += 1;
        if (record.state === "succeeded") entry.succeeded += 1;
        if (record.state === "rolled_back") entry.rolledBack += 1;
        if (record.state === "failed") entry.failed += 1;
        entry.lastAt = Math.max(entry.lastAt ?? 0, record.startedAt);
        byAction.set(action, entry);
      }
    }
    const stats = [...byAction.values()].map((entry) => ({
      ...entry,
      successRate:
        entry.attempts === 0 ? 0 : Math.round((entry.succeeded / entry.attempts) * 100) / 100,
    }));
    return stats.sort((a, b) => b.attempts - a.attempts);
  }

  async hintFor(actions: RemediationPlan["actions"]): Promise<string | null> {
    const types = [...new Set(actions.map((action) => action.type))];
    const stats = await this.stats({ sinceDays: 90 });
    const relevant = stats.filter((entry) =>
      types.includes(entry.action as RemediationPlan["actions"][number]["type"]),
    );
    if (relevant.length === 0) return null;
    const parts = relevant.map(
      (entry) =>
        `${entry.action}: ${entry.succeeded}/${entry.attempts} succeeded, ${entry.rolledBack} rolled back`,
    );
    return `historical effectiveness (90d): ${parts.join("; ")}`;
  }
}

function extractActionTypes(plan: RemediationPlan): string[] {
  if (!plan || !Array.isArray(plan.actions)) return [];
  return plan.actions.map((action) => String(action.type));
}
