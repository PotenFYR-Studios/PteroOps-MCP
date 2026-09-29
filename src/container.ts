import { panelTenant, resolveDefaultPanel, type PteroOpsConfig } from "./config/index.js";
import { ApplicationDetector } from "./applications/detector.js";
import { ApplicationProfileRegistry } from "./applications/profiles/index.js";
import { ApplicationSignalCollector } from "./applications/signal-collector.js";
import { ApprovalService } from "./approvals/service.js";
import { ChangeLedger } from "./changes/ledger.js";
import { ConsoleService } from "./console/service.js";
import { DiagnosticEngine } from "./diagnostics/engine.js";
import { SafeFileEditor } from "./files/editor.js";
import { GitService } from "./git/service.js";
import { HealthService } from "./health/service.js";
import { IncidentService } from "./incidents/service.js";
import { BaselineService } from "./intelligence/baselines/service.js";
import { IncidentCorrelationEngine } from "./intelligence/correlation/correlator.js";
import { CrashLoopTracker } from "./intelligence/crash-loop/tracker.js";
import { DriftAnalyzer } from "./intelligence/drift/drift.js";
import { DebugContextBuilder } from "./intelligence/debug/debug-context.js";
import { KnownGoodService } from "./known-good/service.js";
import { Monitor } from "./monitoring/monitor.js";
import { DiagnosticsScheduler } from "./monitoring/scheduler.js";
import { ConsoleStreamerManager } from "./monitoring/streamer-manager.js";
import { NetworkDiagnosticEngine } from "./network/diagnostics.js";
import { createLogger, type Logger } from "./observability/logger.js";
import { MetricsRegistry } from "./observability/metrics.js";
import { ApprovalRepository } from "./persistence/repositories/approvals.js";
import { AuditRepository } from "./persistence/repositories/audit.js";
import { BaselineRepository, KnownGoodRepository } from "./persistence/repositories/baselines.js";
import { ChangeRepository } from "./persistence/repositories/changes.js";
import {
  ConsoleEventRepository,
  FingerprintRepository,
} from "./persistence/repositories/console-events.js";
import { IncidentRepository } from "./persistence/repositories/incidents.js";
import { MetricSampleRepository, ProcessEventRepository } from "./persistence/repositories/metrics.js";
import { RemediationRepository } from "./persistence/repositories/remediations.js";
import { ScheduleRepository } from "./persistence/repositories/schedules.js";
import { ServerCacheRepository } from "./persistence/repositories/servers.js";
import { FileSnapshotRepository } from "./persistence/repositories/snapshots.js";
import { TopologyRepository } from "./persistence/repositories/topology.js";
import { createDatabase } from "./persistence/database.js";
import type { SqlDatabase } from "./persistence/sql.js";
import { PterodactylApplicationApi } from "./pterodactyl/application-api.js";
import { PterodactylClientApi } from "./pterodactyl/client-api.js";
import { ConsoleCommandRunner } from "./pterodactyl/console-command.js";
import { createPanelConnection, PanelRegistry } from "./pterodactyl/panels.js";
import { BlastRadiusAnalyzer } from "./remediation/blast-radius.js";
import { CanaryService } from "./remediation/canary.js";
import { RemediationEffectiveness } from "./remediation/effectiveness.js";
import { RemediationExecutor } from "./remediation/executor.js";
import { RemediationPlanner } from "./remediation/planner.js";
import { RemediationSimulator } from "./remediation/simulator.js";
import { TestEngine } from "./remediation/verification.js";
import { AuditLog } from "./security/audit.js";
import { PolicyEngine } from "./security/policy.js";
import { RedactionEngine } from "./shared/redaction.js";
import { createLock, type DistributedLock } from "./shared/locks.js";
import { TopologyBuilder } from "./topology/builder.js";
import { DashboardService } from "./ui/service.js";

export interface Services {
  config: PteroOpsConfig;
  logger: Logger;
  metrics: MetricsRegistry;
  redactor: RedactionEngine;
  database: SqlDatabase;
  panels: PanelRegistry;
  defaultPanel: string;
  serverCache: ServerCacheRepository;
  consoleEventRepository: ConsoleEventRepository;
  fingerprintRepository: FingerprintRepository;
  metricSampleRepository: MetricSampleRepository;
  processEventRepository: ProcessEventRepository;
  incidentRepository: IncidentRepository;
  changeRepository: ChangeRepository;
  auditRepository: AuditRepository;
  approvalRepository: ApprovalRepository;
  remediationRepository: RemediationRepository;
  snapshotRepository: FileSnapshotRepository;
  baselineRepository: BaselineRepository;
  knownGoodRepository: KnownGoodRepository;
  scheduleRepository: ScheduleRepository;
  topologyRepository: TopologyRepository;
  consoleService: ConsoleService;
  detector: ApplicationDetector;
  profiles: ApplicationProfileRegistry;
  signalCollector: ApplicationSignalCollector;
  crashTracker: CrashLoopTracker;
  incidentService: IncidentService;
  changeLedger: ChangeLedger;
  auditLog: AuditLog;
  policyEngine: PolicyEngine;
  approvalService: ApprovalService;
  fileEditor: SafeFileEditor;
  planner: RemediationPlanner;
  executor: RemediationExecutor;
  testEngine: TestEngine;
  effectiveness: RemediationEffectiveness;
  simulator: RemediationSimulator;
  canary: CanaryService;
  baselines: BaselineService;
  knownGood: KnownGoodService;
  topology: TopologyBuilder;
  correlator: IncidentCorrelationEngine;
  network: NetworkDiagnosticEngine;
  git: GitService;
  drift: DriftAnalyzer;
  debugContext: DebugContextBuilder;
  consoleRunner: ConsoleCommandRunner;
  health: HealthService;
  diagnostics: DiagnosticEngine;
  streamerManager: ConsoleStreamerManager;
  monitor: Monitor;
  scheduler: DiagnosticsScheduler;
  lock: DistributedLock;
  dashboard: DashboardService;
}

export interface BuildServicesOptions {
  logger?: Logger;
  metrics?: MetricsRegistry;
  database?: SqlDatabase;
  startDatabase?: boolean;
}

export async function buildServices(
  config: PteroOpsConfig,
  options: BuildServicesOptions = {},
): Promise<Services> {
  const redactor = new RedactionEngine({
    extraPatterns: config.redaction.extraPatterns,
    extraSecrets: config.redaction.extraSecrets,
  });
  for (const panel of Object.values(config.panels)) {
    redactor.registerSecret(panel.clientKey);
    redactor.registerSecret(panel.applicationKey);
  }
  redactor.registerSecret(config.http.authToken);

  const logger =
    options.logger ??
    createLogger({
      level: config.log.level,
      pretty: config.log.pretty,
      redactor,
    });
  const metrics = options.metrics ?? new MetricsRegistry();

  const database = options.database ?? (await createDatabase(config.storage, logger));
  const lock = await createLock(config.storage.redisUrl, logger);

  const serverCache = new ServerCacheRepository(database);
  const consoleEventRepository = new ConsoleEventRepository(database);
  const fingerprintRepository = new FingerprintRepository(database);
  const metricSampleRepository = new MetricSampleRepository(database);
  const processEventRepository = new ProcessEventRepository(database);
  const incidentRepository = new IncidentRepository(database);
  const changeRepository = new ChangeRepository(database);
  const auditRepository = new AuditRepository(database);
  const approvalRepository = new ApprovalRepository(database);
  const remediationRepository = new RemediationRepository(database);
  const snapshotRepository = new FileSnapshotRepository(database);
  const baselineRepository = new BaselineRepository(database);
  const knownGoodRepository = new KnownGoodRepository(database);
  const scheduleRepository = new ScheduleRepository(database);
  const topologyRepository = new TopologyRepository(database);

  const panels = buildPanelRegistry(config, logger, metrics, redactor);

  const consoleService = new ConsoleService({
    consoleRepository: consoleEventRepository,
    fingerprintRepository,
    redactor,
    logger: logger.child({ component: "console" }),
    metrics,
    config: config.console,
  });

  const profiles = new ApplicationProfileRegistry();
  const detector = new ApplicationDetector({
    profiles,
    logger: logger.child({ component: "detector" }),
  });
  const signalCollector = new ApplicationSignalCollector({
    panels,
    consoleService,
    logger: logger.child({ component: "signals" }),
    maxFileSizeBytes: config.policy.maxFileSizeBytes,
  });

  const crashTracker = new CrashLoopTracker(
    processEventRepository,
    undefined,
    logger.child({ component: "crash-loop" }),
  );

  const incidentService = new IncidentService(
    incidentRepository,
    logger.child({ component: "incidents" }),
    Date.now,
    metrics,
  );
  const changeLedger = new ChangeLedger(changeRepository, logger.child({ component: "changes" }));
  const auditLog = new AuditLog(auditRepository, redactor, logger.child({ component: "audit" }));
  const policyEngine = PolicyEngine.fromConfig(config);

  const health = new HealthService({
    panels,
    detector,
    signalCollector,
    profiles,
    crashTracker,
    consoleService,
    metrics,
    logger: logger.child({ component: "health" }),
  });

  const debugContext = new DebugContextBuilder({
    panels,
    logger: logger.child({ component: "debug-context" }),
  });

  const diagnostics = new DiagnosticEngine({
    panels,
    consoleService,
    detector,
    signalCollector,
    profiles,
    crashTracker,
    incidentService,
    changeLedger,
    policyEngine,
    debugContext,
    logger: logger.child({ component: "diagnostics" }),
    config: config.diagnostics,
  });

  const approvalService = new ApprovalService(
    approvalRepository,
    config.approval,
    logger.child({ component: "approvals" }),
  );

  const fileEditor = new SafeFileEditor({
    panels,
    snapshots: snapshotRepository,
    changeLedger,
    policy: policyEngine,
    redactor,
    logger: logger.child({ component: "file-editor" }),
    maxSnapshotBytes: config.remediation.snapshotMaxBytes,
  });

  const effectiveness = new RemediationEffectiveness(
    remediationRepository,
  );
  const blastRadius = new BlastRadiusAnalyzer({
    topology: topologyRepository,
    logger: logger.child({ component: "blast-radius" }),
  });
  const planner = new RemediationPlanner({
    panels,
    editor: fileEditor,
    snapshots: snapshotRepository,
    policy: policyEngine,
    blastRadius,
    effectiveness,
    approvalConfig: config.approval,
    remediationConfig: config.remediation,
    logger: logger.child({ component: "planner" }),
  });
  const testEngine = new TestEngine({
    panels,
    consoleService,
    health,
    detector,
    signalCollector,
    profiles,
    crashTracker,
    logger: logger.child({ component: "tests" }),
  });
  const executor = new RemediationExecutor({
    panels,
    editor: fileEditor,
    approvals: approvalService,
    remediations: remediationRepository,
    incidents: incidentService,
    changes: changeLedger,
    health,
    crashTracker,
    policy: policyEngine,
    tests: testEngine,
    config: config.remediation,
    metrics,
    logger: logger.child({ component: "executor" }),
  });
  const simulator = new RemediationSimulator({
    panels,
    editor: fileEditor,
    profiles,
    policy: policyEngine,
    logger: logger.child({ component: "simulator" }),
  });
  const canary = new CanaryService({
    executor,
    approvals: approvalService,
    logger: logger.child({ component: "canary" }),
  });

  const baselines = new BaselineService({
    metrics: metricSampleRepository,
    baselines: baselineRepository,
    logger: logger.child({ component: "baselines" }),
  });
  const knownGood = new KnownGoodService({
    panels,
    detector,
    signalCollector,
    health,
    repository: knownGoodRepository,
    logger: logger.child({ component: "known-good" }),
  });
  const topology = new TopologyBuilder({
    panels,
    serverCache,
    topology: topologyRepository,
    logger: logger.child({ component: "topology" }),
  });
  const correlator = new IncidentCorrelationEngine({
    panels,
    serverCache,
    health,
    crashTracker,
    consoleService,
    changeLedger,
    incidentService,
    topology: topologyRepository,
    logger: logger.child({ component: "correlator" }),
  });
  const network = new NetworkDiagnosticEngine({
    panels,
    consoleService,
    profiles,
    serverCache,
    redactor,
    logger: logger.child({ component: "network" }),
    networkProbeAllowed: config.policy.networkProbeAllowed,
    networkProbeTargets: config.policy.networkProbeTargets,
  });

  const consoleRunner = new ConsoleCommandRunner({
    consoleService,
    logger: logger.child({ component: "console-runner" }),
  });
  const git = new GitService({
    panels,
    consoleService,
    runner: consoleRunner,
    policy: policyEngine,
    changeLedger,
    redactor,
    gitConfig: config.git,
    logger: logger.child({ component: "git" }),
  });
  const drift = new DriftAnalyzer({
    panels,
    signalCollector,
    logger: logger.child({ component: "drift" }),
  });

  const streamerManager = new ConsoleStreamerManager({
    panels,
    consoleService,
    crashTracker,
    logger: logger.child({ component: "console-stream" }),
    metrics,
  });

  const monitor = new Monitor({
    panels,
    config: config.monitoring,
    serverCache,
    metricRepository: metricSampleRepository,
    processEventRepository,
    crashTracker,
    consoleService,
    streamerManager,
    incidentService,
    lock,
    logger: logger.child({ component: "monitor" }),
    metrics,
  });

  const scheduler = new DiagnosticsScheduler({
    scheduleRepository,
    configSchedules: config.schedules,
    groups: config.groups,
    panels,
    serverCache,
    health,
    diagnostics,
    incidentService,
    consoleService,
    baselines,
    snapshots: snapshotRepository,
    metricRepository: metricSampleRepository,
    processEventRepository,
    auditRepository,
    changeRepository,
    incidentRepository,
    retention: {
      metricRetentionHours: config.monitoring.metricsRetentionHours,
      processEventsRetentionDays: config.monitoring.processEventsRetentionDays,
      snapshotRetentionDays: config.remediation.snapshotRetentionDays,
      auditDays: config.retention.preset === "compliance" ? 0 : config.retention.auditDays,
      changesDays: config.retention.preset === "compliance" ? 0 : config.retention.changesDays,
      resolvedIncidentDays:
        config.retention.preset === "compliance" ? 0 : config.retention.resolvedIncidentDays,
    },
    lock,
    logger: logger.child({ component: "scheduler" }),
    metrics,
  });

  const dashboard = new DashboardService({
    panels,
    serverCache,
    changeRepository,
    health,
    incidentService,
    metricRepository: metricSampleRepository,
    topology: topologyRepository,
    logger: logger.child({ component: "dashboard" }),
  });

  return {
    config,
    logger,
    metrics,
    redactor,
    database,
    panels,
    defaultPanel: resolveDefaultPanel(config),
    serverCache,
    consoleEventRepository,
    fingerprintRepository,
    metricSampleRepository,
    processEventRepository,
    incidentRepository,
    changeRepository,
    auditRepository,
    approvalRepository,
    remediationRepository,
    snapshotRepository,
    baselineRepository,
    knownGoodRepository,
    scheduleRepository,
    topologyRepository,
    consoleService,
    detector,
    profiles,
    signalCollector,
    crashTracker,
    incidentService,
    changeLedger,
    auditLog,
    policyEngine,
    approvalService,
    fileEditor,
    planner,
    executor,
    testEngine,
    effectiveness,
    simulator,
    canary,
    baselines,
    knownGood,
    topology,
    correlator,
    network,
    git,
    drift,
    debugContext,
    consoleRunner,
    health,
    diagnostics,
    streamerManager,
    monitor,
    scheduler,
    lock,
    dashboard,
  };
}

function buildPanelRegistry(
  config: PteroOpsConfig,
  logger: Logger,
  metrics: MetricsRegistry,
  redactor: RedactionEngine,
): PanelRegistry {
  const connections = Object.entries(config.panels).map(([name, panelConfig]) => {
    const tenant = panelTenant(config, name);
    const panelLogger = logger.child({ panel: name, component: "pterodactyl" });
    const clientApi = panelConfig.clientKey
      ? new PterodactylClientApi({
          panel: name,
          baseUrl: panelConfig.url,
          apiKey: panelConfig.clientKey,
          timeoutMs: panelConfig.timeoutMs,
          maxRetries: panelConfig.maxRetries,
          logger: panelLogger,
          metrics,
          redactor,
        })
      : null;
    const applicationApi = panelConfig.applicationKey
      ? new PterodactylApplicationApi({
          panel: name,
          baseUrl: panelConfig.url,
          apiKey: panelConfig.applicationKey,
          timeoutMs: panelConfig.timeoutMs,
          maxRetries: panelConfig.maxRetries,
          logger: panelLogger,
          metrics,
          redactor,
        })
      : null;
    return createPanelConnection({
      name,
      tenant,
      url: panelConfig.url,
      credentials: {
        ...(panelConfig.clientKey ? { clientKey: panelConfig.clientKey } : {}),
        ...(panelConfig.applicationKey ? { applicationKey: panelConfig.applicationKey } : {}),
      },
      clientApi,
      applicationApi,
    });
  });
  return new PanelRegistry(connections, resolveDefaultPanel(config));
}
