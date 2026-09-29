import type { TopologyEdgeRecord, TopologyNodeRecord } from "../models.js";
import type { SqlDatabase } from "../sql.js";
import { fromJson, toJson } from "./helpers.js";

interface NodeRow {
  id: string;
  tenant: string;
  kind: string;
  ref: string;
  label: string;
  attrs: string | null;
  updated_at: number;
}

interface EdgeRow {
  src: string;
  dst: string;
  relation: string;
  attrs: string | null;
  updated_at: number;
}

export class TopologyRepository {
  constructor(private readonly db: SqlDatabase) {}

  async replaceTenantGraph(
    tenant: string,
    nodes: TopologyNodeRecord[],
    edges: TopologyEdgeRecord[],
    now = Date.now(),
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const nodeIds = new Set(nodes.map((node) => node.id));
      const previous = await tx.all<{ id: string }>(
        `SELECT id FROM topology_nodes WHERE tenant = ?`,
        tenant,
      );
      for (const row of previous) {
        if (!nodeIds.has(row.id)) {
          await tx.run(`DELETE FROM topology_edges WHERE src = ? OR dst = ?`, row.id, row.id);
          await tx.run(`DELETE FROM topology_nodes WHERE id = ?`, row.id);
        }
      }
      for (const node of nodes) {
        await tx.run(
          `INSERT INTO topology_nodes (id, tenant, kind, ref, label, attrs, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             tenant = excluded.tenant,
             kind = excluded.kind,
             ref = excluded.ref,
             label = excluded.label,
             attrs = excluded.attrs,
             updated_at = excluded.updated_at`,
          node.id,
          node.tenant,
          node.kind,
          node.ref,
          node.label,
          toJson(node.attrs),
          now,
        );
      }
      for (const edge of edges) {
        await tx.run(
          `INSERT INTO topology_edges (src, dst, relation, attrs, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (src, dst, relation) DO UPDATE SET attrs = excluded.attrs, updated_at = excluded.updated_at`,
          edge.src,
          edge.dst,
          edge.relation,
          toJson(edge.attrs),
          now,
        );
      }
    });
  }

  async nodes(tenant?: string): Promise<TopologyNodeRecord[]> {
    const rows = tenant
      ? await this.db.all<NodeRow>(`SELECT * FROM topology_nodes WHERE tenant = ? ORDER BY kind, id`, tenant)
      : await this.db.all<NodeRow>(`SELECT * FROM topology_nodes ORDER BY kind, id`);
    return rows.map((row) => ({
      id: row.id,
      tenant: row.tenant,
      kind: row.kind as TopologyNodeRecord["kind"],
      ref: row.ref,
      label: row.label,
      attrs: fromJson<Record<string, unknown>>(row.attrs),
    }));
  }

  async edges(tenant?: string): Promise<TopologyEdgeRecord[]> {
    const rows = tenant
      ? await this.db.all<EdgeRow>(
          `SELECT e.src, e.dst, e.relation, e.attrs, e.updated_at FROM topology_edges e
           JOIN topology_nodes n ON n.id = e.src
           WHERE n.tenant = ?`,
          tenant,
        )
      : await this.db.all<EdgeRow>(`SELECT src, dst, relation, attrs, updated_at FROM topology_edges`);
    return rows.map(mapEdgeRow);
  }

  async edgesFrom(src: string, relation?: string): Promise<TopologyEdgeRecord[]> {
    const rows = relation
      ? await this.db.all<EdgeRow>(`SELECT * FROM topology_edges WHERE src = ? AND relation = ?`, src, relation)
      : await this.db.all<EdgeRow>(`SELECT * FROM topology_edges WHERE src = ?`, src);
    return rows.map(mapEdgeRow);
  }

  async edgesTo(dst: string, relation?: string): Promise<TopologyEdgeRecord[]> {
    const rows = relation
      ? await this.db.all<EdgeRow>(`SELECT * FROM topology_edges WHERE dst = ? AND relation = ?`, dst, relation)
      : await this.db.all<EdgeRow>(`SELECT * FROM topology_edges WHERE dst = ?`, dst);
    return rows.map(mapEdgeRow);
  }

  async lastUpdated(): Promise<number | null> {
    const row = await this.db.get<{ updated_at: number | string | null }>(
      `SELECT MAX(updated_at) as updated_at FROM topology_nodes`,
    );
    return row?.updated_at === null || row?.updated_at === undefined ? null : Number(row.updated_at);
  }
}

function mapEdgeRow(row: EdgeRow): TopologyEdgeRecord {
  return {
    src: row.src,
    dst: row.dst,
    relation: row.relation,
    attrs: fromJson<Record<string, unknown>>(row.attrs),
  };
}
