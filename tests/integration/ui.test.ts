import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockPanel } from "../helpers/mock-panel.js";
import { createTestServices, type TestServicesHandle } from "../helpers/services.js";
import { startHttpTransport, type HttpTransportHandle } from "../../src/mcp/transports/http.js";
import { createMcpServer } from "../../src/mcp/server.js";

let panel: MockPanel;
let handle: TestServicesHandle;
let http: HttpTransportHandle;
const TOKEN = "test-ui-token-1234567890";

function base(): string {
  const address = http.address();
  return `http://127.0.0.1:${String(address.port)}`;
}

beforeEach(async () => {
  panel = await MockPanel.start({
    servers: [
      {
        identifier: "survival",
        name: "Survival <script>alert(1)</script>",
        state: "running",
      },
    ],
  });
  handle = await createTestServices({ panelUrl: panel.url });
  const ref = { tenant: "local", panel: "mock", serverId: "survival" };
  await handle.services.serverCache.upsert({
    ref,
    uuid: null,
    name: "Survival <script>alert(1)</script>",
    state: "running",
    application: "minecraft/paper",
    now: Date.now(),
  });
  await handle.services.incidentService.open({
    ref,
    title: "Crash <b>loop</b> detected",
    summary: "3 short exits",
    severity: "critical",
    fingerprint: "ui-test",
    evidence: [{ kind: "console", source: "console", summary: "OutOfMemoryError ×3" }],
  });
  http = await startHttpTransport({
    services: handle.services,
    createServer: () => createMcpServer(handle.services).server,
    logger: handle.services.logger,
    metrics: handle.services.metrics,
    config: { ...handle.services.config.http, enabled: true, port: 0, authToken: TOKEN },
    dashboard: handle.services.dashboard,
  });
});

afterEach(async () => {
  await http.close();
  await handle.close();
  await panel.close();
});

describe("dashboard UI", () => {
  it("requires a token and stores it in a cookie after the first visit", async () => {
    const unauthorized = await fetch(`${base()}/ui`);
    expect(unauthorized.status).toBe(401);

    const redirect = await fetch(`${base()}/ui?token=${TOKEN}`, { redirect: "manual" });
    expect(redirect.status).toBe(302);
    const cookie = redirect.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("pteroops_token=");
    expect(cookie).toContain("HttpOnly");

    const authorized = await fetch(`${base()}/ui`, { headers: { cookie: cookie.split(";")[0]! } });
    expect(authorized.status).toBe(200);
    const html = await authorized.text();
    expect(html).toContain("PteroOps");
    expect(html).toContain("minecraft/paper");
    expect(html).toContain("read-only console");
  });

  it("escapes hostile content from incidents and server names", async () => {
    const overview = await fetch(`${base()}/ui`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const overviewHtml = await overview.text();
    expect(overviewHtml).not.toContain("<script>alert(1)</script>");
    expect(overviewHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");

    const response = await fetch(`${base()}/ui/incidents`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const html = await response.text();
    expect(html).not.toContain("<b>loop</b>");
    expect(html).toContain("Crash &lt;b&gt;loop&lt;/b&gt; detected");
  });

  it("renders the overview, changes and policies pages", async () => {
    const overview = await fetch(`${base()}/ui`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(overview.status).toBe(200);
    const overviewHtml = await overview.text();
    expect(overviewHtml).toContain("Open incidents");
    expect(overviewHtml).toContain("critical");

    const changes = await fetch(`${base()}/ui/changes`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(await changes.text()).toContain("Change ledger");

    const policies = await fetch(`${base()}/ui/policies`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(await policies.text()).toContain("Effective policy");
  });

  it("shows a full incident page with evidence", async () => {
    const list = await fetch(`${base()}/ui/incidents`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const listing = await list.text();
    const id = /\/ui\/incident\?id=([^"]+)/.exec(listing)?.[1];
    expect(id).toBeDefined();
    const detail = await fetch(`${base()}/ui/incident?id=${id}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const html = await detail.text();
    expect(html).toContain("Probable causes");
    expect(html).toContain("Evidence");
    expect(html).toContain("OutOfMemoryError");
  });

  it("returns 404 for unknown pages", async () => {
    const response = await fetch(`${base()}/ui/nope`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(404);
  });
});
