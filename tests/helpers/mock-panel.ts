import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const TEST_CLIENT_KEY = "ptlc_test_client_key_1234567890";
export const TEST_APPLICATION_KEY = "ptla_test_application_key_1234567890";

export interface MockServerDefinition {
  identifier: string;
  name: string;
  uuid?: string;
  state?: string;
  suspended?: boolean;
  memoryBytes?: number;
  memoryLimitBytes?: number;
  diskBytes?: number;
  diskLimitBytes?: number;
  cpuAbsolute?: number;
  uptimeMs?: number;
  startupCommand?: string;
  dockerImage?: string;
  variables?: Array<{ envVariable: string; serverValue: string; name?: string }>;
  files?: Record<string, string | string[]>;
  backups?: Array<{
    uuid: string;
    name?: string;
    bytes?: number;
    createdAt?: string | null;
    successful?: boolean;
    locked?: boolean;
  }>;
  databases?: Array<{ id: number; name: string; username?: string; hostAddress?: string; hostPort?: number }>;
  schedules?: Array<{ id: number; name: string; active?: boolean; tasks?: Array<{ action: string; payload: string }> }>;
  allocations?: Array<{ id: number; ip: string; port: number; primary?: boolean }>;
  subusers?: Array<{ uuid: string; username?: string; email: string; permissions?: string[] }>;
  node?: string;
  git?: { branch: string; revision: string; remote?: string; dirty?: string[]; commits?: string[] };
}

export interface MockPanelOptions {
  servers?: MockServerDefinition[];
  clientKey?: string;
  applicationKey?: string | null;
  requireAuth?: boolean;
  defaultState?: string;
}

interface CapturedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: string | null;
  authorization: string | null;
}

export class MockPanel {
  readonly requests: CapturedRequest[] = [];
  private failCount = 0;
  private failStatus = 500;
  private delayMs = 0;
  private server: Server;
  readonly url: string;
  readonly clientKey: string;
  readonly applicationKey: string | null;
  readonly servers: Map<string, MockServerDefinition>;
  private readonly files: Map<string, Record<string, string | string[]>>;
  private readonly backupState = new Map<
    string,
    Array<{ uuid: string; name?: string; bytes?: number; createdAt?: string | null; successful?: boolean; locked?: boolean }>
  >();
  private readonly databaseState = new Map<
    string,
    Array<{ id: number; name: string; username?: string; hostAddress?: string; hostPort?: number }>
  >();
  private readonly scheduleState = new Map<
    string,
    Array<{ id: number; name: string; active?: boolean; tasks?: Array<{ action: string; payload: string }> }>
  >();
  private readonly allocationState = new Map<
    string,
    Array<{ id: number; ip: string; port: number; primary?: boolean }>
  >();
  private readonly subuserState = new Map<
    string,
    Array<{ uuid: string; username?: string; email: string; permissions?: string[] }>
  >();

  private constructor(options: MockPanelOptions, server: Server, url: string) {
    this.server = server;
    this.url = url;
    this.clientKey = options.clientKey ?? TEST_CLIENT_KEY;
    this.applicationKey =
      options.applicationKey === undefined ? TEST_APPLICATION_KEY : options.applicationKey;
    this.servers = new Map(
      (options.servers ?? [defaultServerDefinition()]).map((definition) => [
        definition.identifier,
        definition,
      ]),
    );
    this.files = new Map();
    for (const definition of this.servers.values()) {
      this.files.set(definition.identifier, definition.files ?? defaultFiles());
      if (definition.backups) this.backupState.set(definition.identifier, [...definition.backups]);
      if (definition.databases) this.databaseState.set(definition.identifier, [...definition.databases]);
      if (definition.schedules) this.scheduleState.set(definition.identifier, [...definition.schedules]);
      if (definition.allocations) this.allocationState.set(definition.identifier, [...definition.allocations]);
      if (definition.subusers) this.subuserState.set(definition.identifier, [...definition.subusers]);
    }
    this.requireAuth = options.requireAuth ?? true;
    void this.server;
  }

  private readonly requireAuth: boolean;

  static async start(options: MockPanelOptions = {}): Promise<MockPanel> {
    return new Promise((resolve) => {
      let panel: MockPanel;
      const server = createServer((req, res) => {
        void handle(panel, req, res);
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        panel = new MockPanel(options, server, `http://127.0.0.1:${String(port)}`);
        resolve(panel);
      });
    });
  }

  failNext(count: number, status = 500): void {
    this.failCount = count;
    this.failStatus = status;
  }

  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  setState(identifier: string, state: string): void {
    const definition = this.servers.get(identifier);
    if (definition) definition.state = state;
  }

  setResources(
    identifier: string,
    resources: { memoryBytes?: number; cpuAbsolute?: number; diskBytes?: number },
  ): void {
    const definition = this.servers.get(identifier);
    if (!definition) return;
    if (resources.memoryBytes !== undefined) definition.memoryBytes = resources.memoryBytes;
    if (resources.cpuAbsolute !== undefined) definition.cpuAbsolute = resources.cpuAbsolute;
    if (resources.diskBytes !== undefined) definition.diskBytes = resources.diskBytes;
  }

  requestsFor(pathFragment: string): CapturedRequest[] {
    return this.requests.filter((request) => request.path.includes(pathFragment));
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handleFiles(
    res: ServerResponse,
    identifier: string,
    directory: string,
    file: string | null,
  ): void {
    const files = this.files.get(identifier) ?? {};
    if (file !== null) {
      const content = files[file];
      if (typeof content === "string") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(content);
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ errors: [{ code: "NotFound", detail: "file not found" }] }));
      return;
    }
    const listing = files[directory];
    if (!Array.isArray(listing)) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ errors: [{ code: "NotFound", detail: "directory not found" }] }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: listing.map((name) => ({
          object: "file_object",
          attributes: {
            name,
            mode: "rw-r--r--",
            size: typeof files[`${directory === "/" ? "" : directory}/${name}`] === "string" ? 128 : 0,
            is_file: typeof files[`${directory === "/" ? "" : directory}/${name}`] === "string",
            is_directory: Array.isArray(files[`${directory === "/" ? "" : directory}/${name}`]),
            is_symlink: false,
            mimetype: name.endsWith(".jar")
              ? "application/java-archive"
              : "application/octet-stream",
            modified_at: new Date().toISOString(),
          },
        })),
      }),
    );
  }

  async respond(
    req: IncomingMessage,
    res: ServerResponse,
    captured: CapturedRequest,
  ): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.failCount > 0) {
      this.failCount -= 1;
      res.writeHead(this.failStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({ errors: [{ code: "MockFailure", detail: "injected failure" }] }));
      return;
    }
    if (this.requireAuth) {
      const expected = [
        this.clientKey ? `Bearer ${this.clientKey}` : null,
        this.applicationKey ? `Bearer ${this.applicationKey}` : null,
      ].filter(Boolean);
      if (!captured.authorization || !expected.includes(captured.authorization)) {
        sendJson(res, 401, { errors: [{ code: "Unauthorized", detail: "invalid api key" }] });
        return;
      }
    }

    const path = captured.path;
    const isApplication = path.startsWith("/api/application");

    if (path === "/api/client") {
      const definitions = [...this.servers.values()];
      sendJson(res, 200, {
        object: "list",
        data: definitions.map((definition) => ({
          object: "server",
          attributes: this.serverAttributes(definition),
        })),
        meta: { pagination: { total: definitions.length, count: definitions.length, per_page: 100, current_page: 1, total_pages: 1 } },
      });
      return;
    }

    const clientServerMatch = /^\/api\/client\/servers\/([^/]+)$/.exec(path);
    if (clientServerMatch) {
      const definition = this.servers.get(clientServerMatch[1]!);
      if (!definition) {
        sendJson(res, 404, { errors: [{ code: "NotFound", detail: "server not found" }] });
        return;
      }
      const allocations =
        definition.allocations && definition.allocations.length > 0
          ? definition.allocations
          : [{ id: 1, ip: "127.0.0.1", port: 25565, primary: true }];
      sendJson(res, 200, {
        object: "server",
        attributes: {
          ...this.serverAttributes(definition),
          relationships:
            captured.query.include?.includes("allocations") === true
              ? {
                  allocations: {
                    object: "list",
                    data: allocations.map((allocation) => ({
                      object: "allocation",
                      attributes: {
                        id: allocation.id,
                        ip: allocation.ip,
                        port: allocation.port,
                        is_default: allocation.primary ?? false,
                      },
                    })),
                  },
                }
              : undefined,
        },
      });
      return;
    }

    const resourcesMatch = /^\/api\/client\/servers\/([^/]+)\/resources$/.exec(path);
    if (resourcesMatch) {
      const definition = this.servers.get(resourcesMatch[1]!);
      if (!definition) {
        sendJson(res, 404, { errors: [{ code: "NotFound", detail: "server not found" }] });
        return;
      }
      sendJson(res, 200, {
        object: "stats",
        attributes: {
          current_state: definition.state ?? "running",
          is_suspended: definition.suspended ?? false,
          resources: {
            memory_bytes: definition.memoryBytes ?? 512 * 1024 * 1024,
            memory_limit_bytes: definition.memoryLimitBytes ?? 2 * 1024 * 1024 * 1024,
            cpu_absolute: definition.cpuAbsolute ?? 12.5,
            disk_bytes: definition.diskBytes ?? 1024 * 1024 * 1024,
            disk_limit_bytes: definition.diskLimitBytes ?? 10 * 1024 * 1024 * 1024,
            network_rx_bytes: 1000,
            network_tx_bytes: 2000,
            uptime: definition.uptimeMs ?? 3_600_000,
          },
        },
      });
      return;
    }

    const startupMatch = /^\/api\/client\/servers\/([^/]+)\/startup$/.exec(path);
    if (startupMatch) {
      const definition = this.servers.get(startupMatch[1]!);
      sendJson(res, 200, {
        object: "list",
        data: (definition?.variables ?? []).map((variable) => ({
          object: "server_variable",
          attributes: {
            name: variable.name ?? variable.envVariable,
            description: "",
            env_variable: variable.envVariable,
            default_value: "",
            server_value: variable.serverValue,
            is_editable: true,
          },
        })),
        meta: {
          startup_command: definition?.startupCommand ?? "java -Xms128M -Xmx2048M -jar server.jar",
          raw_startup_command: definition?.startupCommand ?? "java -Xms128M -Xmx2048M -jar server.jar",
          docker_image: definition?.dockerImage ?? "ghcr.io/pterodactyl/yolks:java_21",
        },
      });
      return;
    }

    const commandMatch = /^\/api\/client\/servers\/([^/]+)\/command$/.exec(path);
    if (commandMatch && req.method === "POST") {
      sendJson(res, 204, null);
      return;
    }

    const powerMatch = /^\/api\/client\/servers\/([^/]+)\/power$/.exec(path);
    if (powerMatch && req.method === "POST") {
      sendJson(res, 204, null);
      return;
    }

    const filesMatch = /^\/api\/client\/servers\/([^/]+)\/files\/(list|contents|write)$/.exec(path);
    if (filesMatch) {
      const identifier = filesMatch[1]!;
      const action = filesMatch[2]!;
      if (action === "list") {
        this.handleFiles(res, identifier, captured.query.directory ?? "/", null);
        return;
      }
      if (action === "contents") {
        this.handleFiles(res, identifier, "/", captured.query.file ?? null);
        return;
      }
      this.setFile(identifier, captured.query.file ?? "/unnamed", captured.body ?? "");
      sendJson(res, 204, null);
      return;
    }

    const websocketMatch = /^\/api\/client\/servers\/([^/]+)\/websocket$/.exec(path);
    if (websocketMatch) {
      sendJson(res, 200, {
        data: {
          token: "mock.jwt.token",
          socket: `ws://127.0.0.1:1/api/servers/${websocketMatch[1]!}/ws`,
        },
      });
      return;
    }

    const backupsMatch = /^\/api\/client\/servers\/([^/]+)\/backups$/ .exec(path);
    if (backupsMatch) {
      const identifier = backupsMatch[1]!;
      const backups = this.backupState.get(identifier) ?? [];
      if (req.method === "GET") {
        sendJson(res, 200, {
          object: "list",
          data: backups.map((backup) => ({
            object: "backup",
            attributes: {
              uuid: backup.uuid,
              name: backup.name ?? "backup",
              ignored_files: [],
              sha256_hash: "deadbeef",
              bytes: backup.bytes ?? 1024 * 1024,
              created_at: backup.createdAt ?? new Date().toISOString(),
              completed_at: backup.createdAt ?? new Date().toISOString(),
              is_successful: backup.successful ?? true,
              is_locked: backup.locked ?? false,
            },
          })),
        });
        return;
      }
      const created = {
        uuid: `backup-${String(Date.now())}`,
        name: (asRecord(JSON.parse(captured.body ?? "{}"))?.name as string | undefined) ?? "backup",
        bytes: 1024 * 1024,
        createdAt: new Date().toISOString(),
        successful: true,
        locked: false,
      };
      backups.push(created);
      this.backupState.set(identifier, backups);
      sendJson(res, 200, {
        object: "backup",
        attributes: {
          uuid: created.uuid,
          name: created.name,
          bytes: created.bytes,
          created_at: created.createdAt,
          is_successful: true,
          is_locked: false,
        },
      });
      return;
    }

    const backupActionMatch = /^\/api\/client\/servers\/([^/]+)\/backups\/([^/]+)(?:\/(lock|unlock|restore))?$/.exec(path);
    if (backupActionMatch && req.method !== "GET") {
      sendJson(res, 204, null);
      return;
    }

    const databasesMatch = /^\/api\/client\/servers\/([^/]+)\/databases$/.exec(path);
    if (databasesMatch) {
      const identifier = databasesMatch[1]!;
      const databases = this.databaseState.get(identifier) ?? [];
      if (req.method === "GET") {
        sendJson(res, 200, {
          object: "list",
          data: databases.map((database) => ({
            object: "server_database",
            attributes: {
              id: database.id,
              host: { address: database.hostAddress ?? "db.internal", port: database.hostPort ?? 3306 },
              name: database.name,
              username: database.username ?? `u_${database.name}`,
              connections_from: "%",
              max_connections: 0,
              relationships: { password: { object: "database_password", attributes: { password: "secret-db-pass" } } },
            },
          })),
        });
        return;
      }
      const body = asRecord(JSON.parse(captured.body ?? "{}")) ?? {};
      const created = {
        id: databases.length + 1,
        name: String(body.database ?? "db"),
        username: `u_${String(body.database ?? "db")}`,
        hostAddress: "db.internal",
        hostPort: 3306,
      };
      databases.push(created);
      this.databaseState.set(identifier, databases);
      sendJson(res, 200, {
        object: "server_database",
        attributes: {
          id: created.id,
          host: { address: created.hostAddress, port: created.hostPort },
          name: created.name,
          username: created.username,
          connections_from: "%",
          max_connections: 0,
          relationships: { password: { object: "database_password", attributes: { password: "new-secret" } } },
        },
      });
      return;
    }

    const databaseActionMatch = /^\/api\/client\/servers\/([^/]+)\/databases\/(\d+)(?:\/rotate-password)?$/.exec(path);
    if (databaseActionMatch && req.method === "POST") {
      const identifier = databaseActionMatch[1]!;
      const id = Number(databaseActionMatch[2]);
      if (path.endsWith("/rotate-password")) {
        const databases = this.databaseState.get(identifier) ?? [];
        const database = databases.find((candidate) => candidate.id === id) ?? { id, name: "db" };
        sendJson(res, 200, {
          object: "server_database",
          attributes: {
            id,
            host: { address: "db.internal", port: 3306 },
            name: database.name,
            username: database.username ?? `u_${database.name}`,
            connections_from: "%",
            max_connections: 0,
            relationships: { password: { object: "database_password", attributes: { password: "rotated-secret" } } },
          },
        });
        return;
      }
      sendJson(res, 204, null);
      return;
    }
    if (databaseActionMatch && req.method === "DELETE") {
      sendJson(res, 204, null);
      return;
    }

    const schedulesMatch = /^\/api\/client\/servers\/([^/]+)\/schedules$/.exec(path);
    if (schedulesMatch) {
      const identifier = schedulesMatch[1]!;
      const schedules = this.scheduleState.get(identifier) ?? [];
      if (req.method === "GET") {
        sendJson(res, 200, {
          object: "list",
          data: schedules.map((schedule) => ({
            object: "server_schedule",
            attributes: {
              id: schedule.id,
              name: schedule.name,
              cron: { minute: "0", hour: "3", day_of_month: "*", month: "*", day_of_week: "*" },
              is_active: schedule.active !== false,
              is_processing: false,
              only_when_online: false,
              last_run_at: null,
              next_run_at: new Date(Date.now() + 3_600_000).toISOString(),
              relationships: {
                tasks: {
                  object: "list",
                  data: (schedule.tasks ?? []).map((task, index) => ({
                    object: "schedule_task",
                    attributes: { id: index + 1, action: task.action, payload: task.payload, time_offset: 0, continue_on_failure: false },
                  })),
                },
              },
            },
          })),
        });
        return;
      }
      const body = asRecord(JSON.parse(captured.body ?? "{}")) ?? {};
      const created = {
        id: schedules.length + 1,
        name: String(body.name ?? "schedule"),
        active: body.is_active !== false,
        tasks: [],
      };
      schedules.push(created);
      this.scheduleState.set(identifier, schedules);
      sendJson(res, 200, {
        object: "server_schedule",
        attributes: {
          id: created.id,
          name: created.name,
          cron: { minute: "0", hour: "3", day_of_month: "*", month: "*", day_of_week: "*" },
          is_active: created.active,
          is_processing: false,
          only_when_online: false,
          relationships: { tasks: { object: "list", data: [] } },
        },
      });
      return;
    }

    const scheduleActionMatch = /^\/api\/client\/servers\/([^/]+)\/schedules\/(\d+)(?:\/(execute|toggle))?$/.exec(path);
    if (scheduleActionMatch && (req.method === "POST" || req.method === "DELETE")) {
      sendJson(res, 204, null);
      return;
    }

    const allocationsMatch = /^\/api\/client\/servers\/([^/]+)\/network\/allocations$/.exec(path);
    if (allocationsMatch) {
      const identifier = allocationsMatch[1]!;
      const allocations = this.allocationState.get(identifier) ?? [];
      if (req.method === "GET") {
        sendJson(res, 200, {
          object: "list",
          data: allocations.map((allocation) => ({
            object: "allocation",
            attributes: {
              id: allocation.id,
              ip: allocation.ip,
              ip_alias: null,
              port: allocation.port,
              notes: null,
              is_default: allocation.primary ?? false,
            },
          })),
        });
        return;
      }
      const created = {
        id: allocations.length + 100,
        ip: "10.0.0.5",
        port: 25600 + allocations.length,
        primary: false,
      };
      allocations.push(created);
      this.allocationState.set(identifier, allocations);
      sendJson(res, 200, {
        object: "allocation",
        attributes: {
          id: created.id,
          ip: created.ip,
          ip_alias: null,
          port: created.port,
          notes: null,
          is_default: false,
        },
      });
      return;
    }

    const allocationActionMatch =
      /^\/api\/client\/servers\/([^/]+)\/network\/allocations\/(\d+)(?:\/(primary))?$/.exec(path);
    if (allocationActionMatch && (req.method === "POST" || req.method === "DELETE")) {
      sendJson(res, 204, null);
      return;
    }

    const usersMatch = /^\/api\/client\/servers\/([^/]+)\/users$/.exec(path);
    if (usersMatch) {
      const identifier = usersMatch[1]!;
      const subusers = this.subuserState.get(identifier) ?? [];
      if (req.method === "GET") {
        sendJson(res, 200, {
          object: "list",
          data: subusers.map((subuser) => ({
            object: "subuser",
            attributes: {
              uuid: subuser.uuid,
              username: subuser.username ?? "subuser",
              email: subuser.email,
              image: "",
              "2fa_enabled": false,
              created_at: new Date().toISOString(),
              permissions: subuser.permissions ?? [],
            },
          })),
        });
        return;
      }
      const body = asRecord(JSON.parse(captured.body ?? "{}")) ?? {};
      const created = {
        uuid: `subuser-${String(Date.now())}`,
        username: "invited",
        email: String(body.email ?? "user@example.com"),
        permissions: Array.isArray(body.permissions) ? body.permissions.map(String) : [],
      };
      subusers.push(created);
      this.subuserState.set(identifier, subusers);
      sendJson(res, 200, {
        object: "subuser",
        attributes: {
          uuid: created.uuid,
          username: created.username,
          email: created.email,
          "2fa_enabled": false,
          created_at: new Date().toISOString(),
          permissions: created.permissions,
        },
      });
      return;
    }

    const subuserActionMatch = /^\/api\/client\/servers\/([^/]+)\/users\/([^/]+)$/.exec(path);
    if (subuserActionMatch && (req.method === "POST" || req.method === "DELETE")) {
      sendJson(res, 204, null);
      return;
    }

    const startupVariableMatch = /^\/api\/client\/servers\/([^/]+)\/startup\/variable$/.exec(path);
    if (startupVariableMatch && req.method === "PUT") {
      const body = asRecord(JSON.parse(captured.body ?? "{}")) ?? {};
      const identifier = startupVariableMatch[1]!;
      const definition = this.servers.get(identifier);
      if (definition) {
        const variables = definition.variables ?? [];
        const key = String(body.key ?? "");
        const existing = variables.find((variable) => variable.envVariable === key);
        if (existing) {
          existing.serverValue = String(body.value ?? "");
        } else {
          variables.push({ envVariable: key, serverValue: String(body.value ?? "") });
        }
        definition.variables = variables;
      }
      sendJson(res, 204, null);
      return;
    }

    const pullMatch = /^\/api\/client\/servers\/([^/]+)\/files\/pull$/.exec(path);
    if (pullMatch && req.method === "POST") {
      sendJson(res, 200, { object: "null_resource" });
      return;
    }

    if (isApplication && path === "/api/application/servers") {
      const definitions = [...this.servers.values()];
      sendJson(res, 200, {
        object: "list",
        data: definitions.map((definition, index) => ({
          object: "server",
          attributes: {
            ...this.serverAttributes(definition),
            id: index + 1,
            external_id: null,
            user: 1,
            allocation: 1,
          },
        })),
        meta: { pagination: { total: definitions.length, count: definitions.length, per_page: 100, current_page: 1, total_pages: 1 } },
      });
      return;
    }

    if (isApplication && path === "/api/application/nodes") {
      sendJson(res, 200, {
        object: "list",
        data: [
          {
            object: "node",
            attributes: {
              id: 1,
              name: "node-1",
              fqdn: "node-1.example.com",
              scheme: "https",
              maintenance_mode: false,
              memory: 16384,
              disk: 102400,
              memory_overallocate: 0,
              disk_overallocate: 0,
              servers_count: this.servers.size,
              relationships: { allocations: { object: "list", data: [] } },
            },
          },
        ],
        meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } },
      });
      return;
    }

    if (isApplication && path === "/api/application/users") {
      sendJson(res, 200, {
        object: "list",
        data: [
          {
            object: "user",
            attributes: {
              id: 1,
              external_id: null,
              username: "admin",
              email: "admin@example.com",
              root_admin: true,
              servers_count: this.servers.size,
            },
          },
        ],
        meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } },
      });
      return;
    }

    if (isApplication && path === "/api/application/nests") {
      sendJson(res, 200, {
        object: "list",
        data: [
          {
            object: "nest",
            attributes: { id: 1, name: "Minecraft", description: "Minecraft eggs", egg_count: 1 },
          },
        ],
        meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } },
      });
      return;
    }

    if (isApplication && (path === "/api/application/eggs" || /^\/api\/application\/nests\/\d+\/eggs$/.test(path))) {
      sendJson(res, 200, {
        object: "list",
        data: [
          {
            object: "egg",
            attributes: {
              id: 1,
              nest: 1,
              name: "Paper",
              description: "Paper server",
              docker_images: { java_21: "ghcr.io/pterodactyl/yolks:java_21" },
              startup: "java -jar server.jar",
            },
          },
        ],
        meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } },
      });
      return;
    }

    sendJson(res, 404, { errors: [{ code: "NotFound", detail: `mock has no route for ${path}` }] });
  }

  private serverAttributes(definition: MockServerDefinition): Record<string, unknown> {
    return {
      server_owner: true,
      identifier: definition.identifier,
      internal_id: 1,
      uuid: definition.uuid ?? "11111111-2222-3333-4444-555555555555",
      name: definition.name,
      node: definition.node ?? "mock-node",
      is_node_under_maintenance: false,
      description: "mock server",
      limits: {
        memory: 2048,
        swap: 0,
        disk: 10240,
        io: 500,
        cpu: 100,
        threads: null,
      },
      invocation: definition.startupCommand ?? "java -jar server.jar",
      docker_image: definition.dockerImage ?? "ghcr.io/pterodactyl/yolks:java_21",
      feature_limits: { databases: 1, allocations: 1, backups: 1 },
      status: definition.state ?? "running",
      is_suspended: definition.suspended ?? false,
      is_installing: false,
      is_transferring: false,
    };
  }

  readFile(identifier: string, path: string): string | undefined {
    const files = this.files.get(identifier);
    const content = files?.[path];
    return typeof content === "string" ? content : undefined;
  }

  setFile(identifier: string, path: string, content: string): void {
    const files = this.files.get(identifier) ?? {};
    files[path] = content;
    this.files.set(identifier, files);
  }
}

function defaultServerDefinition(): MockServerDefinition {
  return {
    identifier: "survival",
    name: "Survival",
    uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    state: "running",
  };
}

export function defaultFiles(): Record<string, string | string[]> {
  return {
    "/": ["server.properties", "server.jar", "plugins", "logs"],
    "/server.properties": [
      "motd=A Minecraft Server",
      "max-players=20",
      "server-port=25565",
    ].join("\n"),
    "/plugins": ["EssentialsX-2.20.1.jar", "LuckPerms-5.4.102.jar"],
  };
}

async function handle(
  panel: MockPanel,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");
  const url = new URL(req.url ?? "/", "http://localhost");
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) query[key] = value;
  const captured: CapturedRequest = {
    method: req.method ?? "GET",
    path: url.pathname,
    query,
    body: body === "" ? null : body,
    authorization: req.headers.authorization ?? null,
  };
  panel.requests.push(captured);
  await panel.respond(req, res, captured);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (payload === null) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
