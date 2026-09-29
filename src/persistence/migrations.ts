import type { Migration } from "./sql.js";

const CORE_SQLITE = `
  CREATE TABLE IF NOT EXISTS servers (
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    uuid TEXT,
    name TEXT NOT NULL,
    state TEXT,
    application TEXT,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    PRIMARY KEY (tenant, panel, server_id)
  );
  CREATE INDEX IF NOT EXISTS idx_servers_uuid ON servers(uuid);

  CREATE TABLE IF NOT EXISTS console_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    raw TEXT NOT NULL,
    normalized TEXT NOT NULL,
    severity TEXT NOT NULL,
    subsystem TEXT,
    exception_type TEXT,
    fingerprint TEXT,
    incident_id TEXT,
    correlation_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_console_server_ts
    ON console_events(tenant, panel, server_id, ts);
  CREATE INDEX IF NOT EXISTS idx_console_fingerprint
    ON console_events(tenant, panel, server_id, fingerprint, ts);
  CREATE INDEX IF NOT EXISTS idx_console_severity
    ON console_events(tenant, panel, server_id, severity, ts);

  CREATE TABLE IF NOT EXISTS log_fingerprints (
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    exception_type TEXT,
    severity TEXT NOT NULL,
    subsystem TEXT,
    count INTEGER NOT NULL DEFAULT 1,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    sample TEXT NOT NULL,
    incident_id TEXT,
    PRIMARY KEY (tenant, panel, server_id, fingerprint)
  );
  CREATE INDEX IF NOT EXISTS idx_fingerprints_last_seen
    ON log_fingerprints(tenant, panel, server_id, last_seen);

  CREATE TABLE IF NOT EXISTS metric_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    state TEXT,
    cpu_percent REAL NOT NULL DEFAULT 0,
    memory_bytes INTEGER NOT NULL DEFAULT 0,
    memory_limit_bytes INTEGER NOT NULL DEFAULT 0,
    disk_bytes INTEGER NOT NULL DEFAULT 0,
    disk_limit_bytes INTEGER NOT NULL DEFAULT 0,
    net_rx_bytes INTEGER NOT NULL DEFAULT 0,
    net_tx_bytes INTEGER NOT NULL DEFAULT 0,
    uptime_ms INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_metrics_server_ts
    ON metric_samples(tenant, panel, server_id, ts);

  CREATE TABLE IF NOT EXISTS process_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    exit_code INTEGER,
    runtime_ms INTEGER,
    source TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_process_events_server_ts
    ON process_events(tenant, panel, server_id, ts);

  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    parent_id TEXT,
    application TEXT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    severity TEXT NOT NULL,
    state TEXT NOT NULL,
    fingerprint TEXT,
    confidence REAL,
    detected_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_incidents_tenant_state
    ON incidents(tenant, state);
  CREATE INDEX IF NOT EXISTS idx_incidents_server
    ON incidents(tenant, panel, server_id, detected_at);
  CREATE INDEX IF NOT EXISTS idx_incidents_fingerprint
    ON incidents(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_incidents_parent
    ON incidents(parent_id);

  CREATE TABLE IF NOT EXISTS incident_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id TEXT NOT NULL,
    tenant TEXT NOT NULL,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT,
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_incident_evidence_incident
    ON incident_evidence(incident_id, ts);

  CREATE TABLE IF NOT EXISTS incident_relationships (
    parent_id TEXT NOT NULL,
    child_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (parent_id, child_id, relation)
  );

  CREATE TABLE IF NOT EXISTS change_events (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    actor TEXT NOT NULL,
    origin TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    before_hash TEXT,
    after_hash TEXT,
    before_ref TEXT,
    after_ref TEXT,
    incident_id TEXT,
    reason TEXT,
    approval_id TEXT,
    risk TEXT,
    result TEXT NOT NULL,
    details TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_changes_server
    ON change_events(tenant, panel, server_id, ts);
  CREATE INDEX IF NOT EXISTS idx_changes_incident
    ON change_events(incident_id);
  CREATE INDEX IF NOT EXISTS idx_changes_tenant_ts
    ON change_events(tenant, ts);

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    ts INTEGER NOT NULL,
    tenant TEXT NOT NULL,
    actor TEXT NOT NULL,
    tool TEXT NOT NULL,
    target TEXT,
    action TEXT NOT NULL,
    decision TEXT NOT NULL,
    approval_id TEXT,
    success INTEGER NOT NULL,
    error TEXT,
    correlation_id TEXT,
    details TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_tenant_ts ON audit_events(tenant, ts);
  CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_events(correlation_id);
  CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit_events(tool, ts);
`;

const CORE_POSTGRES = `
  CREATE TABLE IF NOT EXISTS servers (
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    uuid TEXT,
    name TEXT NOT NULL,
    state TEXT,
    application TEXT,
    first_seen BIGINT NOT NULL,
    last_seen BIGINT NOT NULL,
    PRIMARY KEY (tenant, panel, server_id)
  );
  CREATE INDEX IF NOT EXISTS idx_servers_uuid ON servers(uuid);

  CREATE TABLE IF NOT EXISTS console_events (
    id BIGSERIAL PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    ts BIGINT NOT NULL,
    raw TEXT NOT NULL,
    normalized TEXT NOT NULL,
    severity TEXT NOT NULL,
    subsystem TEXT,
    exception_type TEXT,
    fingerprint TEXT,
    incident_id TEXT,
    correlation_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_console_server_ts
    ON console_events(tenant, panel, server_id, ts);
  CREATE INDEX IF NOT EXISTS idx_console_fingerprint
    ON console_events(tenant, panel, server_id, fingerprint, ts);
  CREATE INDEX IF NOT EXISTS idx_console_severity
    ON console_events(tenant, panel, server_id, severity, ts);

  CREATE TABLE IF NOT EXISTS log_fingerprints (
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    exception_type TEXT,
    severity TEXT NOT NULL,
    subsystem TEXT,
    count INTEGER NOT NULL DEFAULT 1,
    first_seen BIGINT NOT NULL,
    last_seen BIGINT NOT NULL,
    sample TEXT NOT NULL,
    incident_id TEXT,
    PRIMARY KEY (tenant, panel, server_id, fingerprint)
  );
  CREATE INDEX IF NOT EXISTS idx_fingerprints_last_seen
    ON log_fingerprints(tenant, panel, server_id, last_seen);

  CREATE TABLE IF NOT EXISTS metric_samples (
    id BIGSERIAL PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    ts BIGINT NOT NULL,
    state TEXT,
    cpu_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
    memory_bytes BIGINT NOT NULL DEFAULT 0,
    memory_limit_bytes BIGINT NOT NULL DEFAULT 0,
    disk_bytes BIGINT NOT NULL DEFAULT 0,
    disk_limit_bytes BIGINT NOT NULL DEFAULT 0,
    net_rx_bytes BIGINT NOT NULL DEFAULT 0,
    net_tx_bytes BIGINT NOT NULL DEFAULT 0,
    uptime_ms BIGINT
  );
  CREATE INDEX IF NOT EXISTS idx_metrics_server_ts
    ON metric_samples(tenant, panel, server_id, ts);

  CREATE TABLE IF NOT EXISTS process_events (
    id BIGSERIAL PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    ts BIGINT NOT NULL,
    kind TEXT NOT NULL,
    exit_code INTEGER,
    runtime_ms BIGINT,
    source TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_process_events_server_ts
    ON process_events(tenant, panel, server_id, ts);

  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    parent_id TEXT,
    application TEXT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    severity TEXT NOT NULL,
    state TEXT NOT NULL,
    fingerprint TEXT,
    confidence DOUBLE PRECISION,
    detected_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    resolved_at BIGINT,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_incidents_tenant_state
    ON incidents(tenant, state);
  CREATE INDEX IF NOT EXISTS idx_incidents_server
    ON incidents(tenant, panel, server_id, detected_at);
  CREATE INDEX IF NOT EXISTS idx_incidents_fingerprint
    ON incidents(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_incidents_parent
    ON incidents(parent_id);

  CREATE TABLE IF NOT EXISTS incident_evidence (
    id BIGSERIAL PRIMARY KEY,
    incident_id TEXT NOT NULL,
    tenant TEXT NOT NULL,
    ts BIGINT NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT,
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_incident_evidence_incident
    ON incident_evidence(incident_id, ts);

  CREATE TABLE IF NOT EXISTS incident_relationships (
    parent_id TEXT NOT NULL,
    child_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (parent_id, child_id, relation)
  );

  CREATE TABLE IF NOT EXISTS change_events (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    ts BIGINT NOT NULL,
    actor TEXT NOT NULL,
    origin TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    before_hash TEXT,
    after_hash TEXT,
    before_ref TEXT,
    after_ref TEXT,
    incident_id TEXT,
    reason TEXT,
    approval_id TEXT,
    risk TEXT,
    result TEXT NOT NULL,
    details TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_changes_server
    ON change_events(tenant, panel, server_id, ts);
  CREATE INDEX IF NOT EXISTS idx_changes_incident
    ON change_events(incident_id);
  CREATE INDEX IF NOT EXISTS idx_changes_tenant_ts
    ON change_events(tenant, ts);

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    ts BIGINT NOT NULL,
    tenant TEXT NOT NULL,
    actor TEXT NOT NULL,
    tool TEXT NOT NULL,
    target TEXT,
    action TEXT NOT NULL,
    decision TEXT NOT NULL,
    approval_id TEXT,
    success INTEGER NOT NULL,
    error TEXT,
    correlation_id TEXT,
    details TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_tenant_ts ON audit_events(tenant, ts);
  CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_events(correlation_id);
  CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit_events(tool, ts);
`;

const SNAPSHOTS_SQLITE = `
  CREATE TABLE IF NOT EXISTS file_snapshots (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    path TEXT NOT NULL,
    hash TEXT NOT NULL,
    size INTEGER NOT NULL,
    content TEXT,
    created_at INTEGER NOT NULL,
    reason TEXT,
    incident_id TEXT,
    remediation_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_file
    ON file_snapshots(tenant, panel, server_id, path, created_at);
`;

const SNAPSHOTS_POSTGRES = `
  CREATE TABLE IF NOT EXISTS file_snapshots (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    path TEXT NOT NULL,
    hash TEXT NOT NULL,
    size BIGINT NOT NULL,
    content TEXT,
    created_at BIGINT NOT NULL,
    reason TEXT,
    incident_id TEXT,
    remediation_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_file
    ON file_snapshots(tenant, panel, server_id, path, created_at);
`;

const REMEDIATION_SQLITE = `
  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    incident_id TEXT,
    remediation_id TEXT,
    state TEXT NOT NULL,
    risk TEXT NOT NULL,
    plan TEXT NOT NULL,
    reason TEXT,
    proposed_by TEXT NOT NULL,
    decided_by TEXT,
    decision_note TEXT,
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    executed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_approvals_tenant_state
    ON approvals(tenant, state, created_at);
  CREATE INDEX IF NOT EXISTS idx_approvals_server
    ON approvals(tenant, panel, server_id, created_at);

  CREATE TABLE IF NOT EXISTS remediations (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    incident_id TEXT,
    approval_id TEXT,
    plan TEXT NOT NULL,
    state TEXT NOT NULL,
    risk TEXT NOT NULL,
    rollback_strategy TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    result TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_remediations_server
    ON remediations(tenant, panel, server_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_remediations_incident
    ON remediations(incident_id);

  CREATE TABLE IF NOT EXISTS remediation_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remediation_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_remediation_steps
    ON remediation_steps(remediation_id, seq);

  CREATE TABLE IF NOT EXISTS baselines (
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    stats TEXT NOT NULL,
    window_ms INTEGER NOT NULL,
    samples INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant, panel, server_id, metric)
  );

  CREATE TABLE IF NOT EXISTS known_good_states (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    health_score INTEGER NOT NULL,
    application TEXT,
    config_hashes TEXT,
    startup_vars_hash TEXT,
    dependency_hash TEXT,
    git_revision TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_known_good_server
    ON known_good_states(tenant, panel, server_id, ts);

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    scope TEXT NOT NULL,
    every_ms INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run INTEGER,
    next_run INTEGER,
    last_result TEXT
  );

  CREATE TABLE IF NOT EXISTS topology_nodes (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    label TEXT NOT NULL,
    attrs TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_topology_nodes_tenant
    ON topology_nodes(tenant, kind);

  CREATE TABLE IF NOT EXISTS topology_edges (
    src TEXT NOT NULL,
    dst TEXT NOT NULL,
    relation TEXT NOT NULL,
    attrs TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (src, dst, relation)
  );
`;

const REMEDIATION_POSTGRES = `
  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    incident_id TEXT,
    remediation_id TEXT,
    state TEXT NOT NULL,
    risk TEXT NOT NULL,
    plan TEXT NOT NULL,
    reason TEXT,
    proposed_by TEXT NOT NULL,
    decided_by TEXT,
    decision_note TEXT,
    expires_at BIGINT,
    created_at BIGINT NOT NULL,
    decided_at BIGINT,
    executed_at BIGINT
  );
  CREATE INDEX IF NOT EXISTS idx_approvals_tenant_state
    ON approvals(tenant, state, created_at);
  CREATE INDEX IF NOT EXISTS idx_approvals_server
    ON approvals(tenant, panel, server_id, created_at);

  CREATE TABLE IF NOT EXISTS remediations (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    incident_id TEXT,
    approval_id TEXT,
    plan TEXT NOT NULL,
    state TEXT NOT NULL,
    risk TEXT NOT NULL,
    rollback_strategy TEXT NOT NULL,
    started_at BIGINT NOT NULL,
    finished_at BIGINT,
    result TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_remediations_server
    ON remediations(tenant, panel, server_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_remediations_incident
    ON remediations(incident_id);

  CREATE TABLE IF NOT EXISTS remediation_steps (
    id BIGSERIAL PRIMARY KEY,
    remediation_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    ts BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_remediation_steps
    ON remediation_steps(remediation_id, seq);

  CREATE TABLE IF NOT EXISTS baselines (
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    stats TEXT NOT NULL,
    window_ms BIGINT NOT NULL,
    samples INTEGER NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (tenant, panel, server_id, metric)
  );

  CREATE TABLE IF NOT EXISTS known_good_states (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    panel TEXT NOT NULL,
    server_id TEXT NOT NULL,
    ts BIGINT NOT NULL,
    health_score INTEGER NOT NULL,
    application TEXT,
    config_hashes TEXT,
    startup_vars_hash TEXT,
    dependency_hash TEXT,
    git_revision TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_known_good_server
    ON known_good_states(tenant, panel, server_id, ts);

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    scope TEXT NOT NULL,
    every_ms BIGINT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run BIGINT,
    next_run BIGINT,
    last_result TEXT
  );

  CREATE TABLE IF NOT EXISTS topology_nodes (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    label TEXT NOT NULL,
    attrs TEXT,
    updated_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_topology_nodes_tenant
    ON topology_nodes(tenant, kind);

  CREATE TABLE IF NOT EXISTS topology_edges (
    src TEXT NOT NULL,
    dst TEXT NOT NULL,
    relation TEXT NOT NULL,
    attrs TEXT,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (src, dst, relation)
  );
`;

export const MIGRATIONS: Migration[] = [
  { id: 1, name: "core", sqlite: CORE_SQLITE, postgres: CORE_POSTGRES },
  { id: 2, name: "file-snapshots", sqlite: SNAPSHOTS_SQLITE, postgres: SNAPSHOTS_POSTGRES },
  { id: 3, name: "remediation-baselines-topology", sqlite: REMEDIATION_SQLITE, postgres: REMEDIATION_POSTGRES },
];
