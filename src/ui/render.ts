export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #0f1115; color: #d7dae0; }
  header { display: flex; align-items: center; gap: 16px; padding: 14px 20px;
    border-bottom: 1px solid #23262d; background: #12141a; position: sticky; top: 0; }
  header h1 { font-size: 15px; margin: 0; letter-spacing: 0.04em; }
  header nav a { color: #8b93a1; text-decoration: none; margin-right: 12px; }
  header nav a:hover { color: #e8ebf0; }
  main { padding: 20px; max-width: 1200px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #8b93a1; margin: 24px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #1d2027; font-size: 13px; vertical-align: top; }
  th { color: #8b93a1; font-weight: 500; }
  a { color: #7aa2f7; }
  .muted { color: #6b7280; }
  .chip { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; border: 1px solid #2c3038; }
  .chip.healthy, .chip.resolved { color: #7ee2a8; border-color: #2f5d45; }
  .chip.degraded, .chip.starting, .chip.detected { color: #f5c76e; border-color: #5d522f; }
  .chip.unhealthy, .chip.crash_loop, .chip.failed, .chip.critical { color: #f28f8f; border-color: #5d2f2f; }
  .chip.suppressed, .chip.rolled_back { color: #b3b8c2; border-color: #3a3f49; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .card { border: 1px solid #23262d; border-radius: 6px; padding: 12px 14px; background: #12141a; }
  .card .value { font-size: 22px; margin-top: 4px; }
  pre { background: #12141a; border: 1px solid #23262d; border-radius: 6px; padding: 12px; overflow: auto; }
  .footer { margin-top: 32px; color: #4b5563; font-size: 12px; }
`;

function layout(title: string, bodyHtml: string, options: { refreshSeconds?: number } = {}): string {
  const refresh = options.refreshSeconds
    ? `<meta http-equiv="refresh" content="${String(options.refreshSeconds)}">`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — PteroOps</title>
${refresh}
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>PteroOps</h1>
  <nav>
    <a href="/ui">Overview</a>
    <a href="/ui/incidents">Incidents</a>
    <a href="/ui/changes">Changes</a>
    <a href="/ui/topology">Topology</a>
    <a href="/ui/policies">Policies</a>
  </nav>
</header>
<main>
${bodyHtml}
<div class="footer">read-only console · data cached briefly · secrets are redacted · <a href="/metrics">metrics</a></div>
</main>
</body>
</html>`;
}

export interface OverviewServer {
  server: string;
  name: string;
  state: string | null;
  application: string | null;
  health: string;
  score: number;
}

export interface OverviewData {
  generatedAt: number;
  panels: number;
  servers: OverviewServer[];
  incidentsOpen: number;
  incidents: Array<{ id: string; title: string; severity: string; state: string; server: string; detectedAt: number }>;
  changes: Array<{ id: string; server: string; action: string; target: string; actor: string; ts: number; result: string }>;
  healthCounts: Record<string, number>;
}

export function renderOverview(data: OverviewData): string {
  const healthCards = Object.entries(data.healthCounts)
    .map(
      ([status, count]) =>
        `<div class="card"><div class="muted">${escapeHtml(status)}</div><div class="value">${String(count)}</div></div>`,
    )
    .join("");
  const serverRows = data.servers
    .map(
      (server) => `<tr>
        <td>${escapeHtml(server.server)}</td>
        <td>${escapeHtml(server.name)}</td>
        <td><span class="chip ${escapeHtml(server.health)}">${escapeHtml(server.health)}</span></td>
        <td>${String(server.score)}</td>
        <td>${escapeHtml(server.state ?? "unknown")}</td>
        <td>${escapeHtml(server.application ?? "—")}</td>
      </tr>`,
    )
    .join("");
  const incidentRows = data.incidents
    .map(
      (incident) => `<tr>
        <td><a href="/ui/incident?id=${encodeURIComponent(incident.id)}">${escapeHtml(incident.id)}</a></td>
        <td><span class="chip ${escapeHtml(incident.severity)}">${escapeHtml(incident.severity)}</span></td>
        <td>${escapeHtml(incident.title)}</td>
        <td>${escapeHtml(incident.server)}</td>
        <td>${escapeHtml(new Date(incident.detectedAt).toISOString())}</td>
      </tr>`,
    )
    .join("");
  const changeRows = data.changes
    .slice(0, 10)
    .map(
      (change) => `<tr>
        <td>${escapeHtml(new Date(change.ts).toISOString())}</td>
        <td>${escapeHtml(change.server)}</td>
        <td>${escapeHtml(change.action)}</td>
        <td>${escapeHtml(change.target)}</td>
        <td>${escapeHtml(change.actor)}</td>
        <td>${escapeHtml(change.result)}</td>
      </tr>`,
    )
    .join("");

  return layout(
    "Overview",
    `
    <h2>Fleet</h2>
    <div class="grid">
      <div class="card"><div class="muted">panels</div><div class="value">${String(data.panels)}</div></div>
      <div class="card"><div class="muted">servers</div><div class="value">${String(data.servers.length)}</div></div>
      <div class="card"><div class="muted">open incidents</div><div class="value">${String(data.incidentsOpen)}</div></div>
      ${healthCards}
    </div>
    <h2>Servers</h2>
    <table><thead><tr><th>server</th><th>name</th><th>health</th><th>score</th><th>state</th><th>application</th></tr></thead>
    <tbody>${serverRows || '<tr><td colspan="6" class="muted">no servers cached yet</td></tr>'}</tbody></table>
    <h2>Open incidents</h2>
    <table><thead><tr><th>id</th><th>severity</th><th>title</th><th>server</th><th>detected</th></tr></thead>
    <tbody>${incidentRows || '<tr><td colspan="5" class="muted">no open incidents</td></tr>'}</tbody></table>
    <h2>Recent changes</h2>
    <table><thead><tr><th>time</th><th>server</th><th>action</th><th>target</th><th>actor</th><th>result</th></tr></thead>
    <tbody>${changeRows || '<tr><td colspan="6" class="muted">no recorded changes</td></tr>'}</tbody></table>
    <div class="muted" style="margin-top:12px">generated ${escapeHtml(new Date(data.generatedAt).toISOString())}</div>
    `,
    { refreshSeconds: 30 },
  );
}

export function renderIncident(incident: {
  id: string;
  title: string;
  summary: string;
  severity: string;
  state: string;
  server: string;
  detectedAt: number;
  resolvedAt: number | null;
  application: string | null;
  probableCauses: Array<{ cause: string; confidence: number; kind: string }>;
  symptoms: string[];
  notes: Array<{ ts: number; actor: string; note: string }>;
  evidence: Array<{ ts: number; kind: string; source: string; summary: string }>;
}): string {
  const causes = incident.probableCauses
    .map(
      (cause) =>
        `<tr><td>${escapeHtml(cause.cause)}</td><td>${cause.confidence.toFixed(2)}</td><td>${escapeHtml(cause.kind)}</td></tr>`,
    )
    .join("");
  const evidence = incident.evidence
    .map(
      (item) =>
        `<tr><td>${escapeHtml(new Date(item.ts).toISOString())}</td><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.summary)}</td></tr>`,
    )
    .join("");
  const notes = incident.notes
    .map(
      (note) =>
        `<tr><td>${escapeHtml(new Date(note.ts).toISOString())}</td><td>${escapeHtml(note.actor)}</td><td>${escapeHtml(note.note)}</td></tr>`,
    )
    .join("");
  return layout(
    incident.id,
    `
    <h2>Incident ${escapeHtml(incident.id)}</h2>
    <p>
      <span class="chip ${escapeHtml(incident.severity)}">${escapeHtml(incident.severity)}</span>
      <span class="chip ${escapeHtml(incident.state)}">${escapeHtml(incident.state)}</span>
      ${escapeHtml(incident.server)} · detected ${escapeHtml(new Date(incident.detectedAt).toISOString())}
      ${incident.resolvedAt ? ` · resolved ${escapeHtml(new Date(incident.resolvedAt).toISOString())}` : ""}
    </p>
    <h2>Title</h2>
    <p>${escapeHtml(incident.title)}</p>
    <h2>Summary</h2>
    <pre>${escapeHtml(incident.summary)}</pre>
    ${incident.symptoms.length > 0 ? `<h2>Symptoms</h2><ul>${incident.symptoms.map((symptom) => `<li>${escapeHtml(symptom)}</li>`).join("")}</ul>` : ""}
    <h2>Probable causes</h2>
    <table><thead><tr><th>cause</th><th>confidence</th><th>kind</th></tr></thead><tbody>${causes || '<tr><td colspan="3" class="muted">none recorded</td></tr>'}</tbody></table>
    <h2>Evidence</h2>
    <table><thead><tr><th>time</th><th>kind</th><th>source</th><th>summary</th></tr></thead><tbody>${evidence || '<tr><td colspan="4" class="muted">none</td></tr>'}</tbody></table>
    <h2>Notes</h2>
    <table><thead><tr><th>time</th><th>actor</th><th>note</th></tr></thead><tbody>${notes || '<tr><td colspan="3" class="muted">none</td></tr>'}</tbody></table>
    `,
  );
}

export function renderIncidentsList(
  incidents: Array<{ id: string; title: string; severity: string; state: string; server: string; detectedAt: number }>,
): string {
  const rows = incidents
    .map(
      (incident) => `<tr>
        <td><a href="/ui/incident?id=${encodeURIComponent(incident.id)}">${escapeHtml(incident.id)}</a></td>
        <td><span class="chip ${escapeHtml(incident.severity)}">${escapeHtml(incident.severity)}</span></td>
        <td><span class="chip ${escapeHtml(incident.state)}">${escapeHtml(incident.state)}</span></td>
        <td>${escapeHtml(incident.title)}</td>
        <td>${escapeHtml(incident.server)}</td>
        <td>${escapeHtml(new Date(incident.detectedAt).toISOString())}</td>
      </tr>`,
    )
    .join("");
  return layout(
    "Incidents",
    `
    <h2>Incidents</h2>
    <table><thead><tr><th>id</th><th>severity</th><th>state</th><th>title</th><th>server</th><th>detected</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted">no incidents recorded</td></tr>'}</tbody></table>
    `,
    { refreshSeconds: 60 },
  );
}

export function renderChanges(
  changes: Array<{ id: string; server: string; action: string; target: string; actor: string; ts: number; result: string; beforeHash: string | null; afterHash: string | null }>,
): string {
  const rows = changes
    .map(
      (change) => `<tr>
        <td>${escapeHtml(new Date(change.ts).toISOString())}</td>
        <td>${escapeHtml(change.server)}</td>
        <td>${escapeHtml(change.action)}</td>
        <td>${escapeHtml(change.target)}</td>
        <td>${escapeHtml(change.actor)}</td>
        <td>${escapeHtml(change.result)}</td>
        <td class="muted">${escapeHtml(change.beforeHash?.slice(0, 10) ?? "—")} → ${escapeHtml(change.afterHash?.slice(0, 10) ?? "—")}</td>
      </tr>`,
    )
    .join("");
  return layout(
    "Changes",
    `
    <h2>Change ledger</h2>
    <table><thead><tr><th>time</th><th>server</th><th>action</th><th>target</th><th>actor</th><th>result</th><th>hash</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="muted">no recorded changes</td></tr>'}</tbody></table>
    `,
    { refreshSeconds: 60 },
  );
}

export function renderTopology(graph: {
  nodes: Array<{ id: string; kind: string; label: string }>;
  edges: Array<{ src: string; dst: string; relation: string }>;
}): string {
  const labelOf = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const nodes = graph.nodes
    .map(
      (node) => `<tr><td>${escapeHtml(node.kind)}</td><td>${escapeHtml(node.label)}</td><td class="muted">${escapeHtml(node.id)}</td></tr>`,
    )
    .join("");
  const edges = graph.edges
    .map(
      (edge) =>
        `<tr><td>${escapeHtml(labelOf.get(edge.src) ?? edge.src)}</td><td>${escapeHtml(edge.relation)}</td><td>${escapeHtml(labelOf.get(edge.dst) ?? edge.dst)}</td></tr>`,
    )
    .join("");
  return layout(
    "Topology",
    `
    <h2>Nodes (${String(graph.nodes.length)})</h2>
    <table><thead><tr><th>kind</th><th>label</th><th>id</th></tr></thead><tbody>${nodes || '<tr><td colspan="3" class="muted">topology not built yet — run ptero_get_topology with rebuild</td></tr>'}</tbody></table>
    <h2>Edges (${String(graph.edges.length)})</h2>
    <table><thead><tr><th>from</th><th>relation</th><th>to</th></tr></thead><tbody>${edges || '<tr><td colspan="3" class="muted">none</td></tr>'}</tbody></table>
    `,
    { refreshSeconds: 120 },
  );
}

export function renderPolicies(policy: Record<string, unknown>): string {
  return layout(
    "Policies",
    `
    <h2>Effective policy</h2>
    <pre>${escapeHtml(JSON.stringify(policy, null, 2))}</pre>
    `,
  );
}
