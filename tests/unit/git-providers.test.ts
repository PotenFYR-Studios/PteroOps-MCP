import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  credentialsFromGitConfig,
  extractRemote,
  GitHubProvider,
  GitLabProvider,
  resolveGitProvider,
} from "../../src/git/providers.js";
import { createLogger } from "../../src/observability/logger.js";

interface RecordedRequest {
  path: string;
  headers: Record<string, string | string[] | undefined>;
}

const requests: RecordedRequest[] = [];
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      requests.push({ path: req.url ?? "", headers: req.headers });
      const url = req.url ?? "";
      res.setHeader("content-type", "application/json");
      if (url.startsWith("/repos/acme/web/commits")) {
        res.end(
          JSON.stringify([
            {
              sha: "a".repeat(40),
              html_url: "https://github.com/acme/web/commit/aaaa",
              commit: {
                message: "fix memory leak\n\nmore detail",
                author: { name: "Dev One", date: "2026-01-01T10:00:00Z" },
              },
            },
            {
              sha: "b".repeat(40),
              html_url: "https://github.com/acme/web/commit/bbbb",
              commit: {
                message: "bump plugin",
                author: { name: "Dev Two", date: "2026-01-02T10:00:00Z" },
              },
            },
          ]),
        );
        return;
      }
      if (url.startsWith("/repos/acme/web/compare/")) {
        res.end(
          JSON.stringify({
            files: [{ filename: "config.yml" }, { filename: "server.properties" }],
            commits: [
              {
                sha: "c".repeat(40),
                commit: { message: "between", author: { name: "Dev Three", date: "2026-01-03T10:00:00Z" } },
              },
            ],
          }),
        );
        return;
      }
      if (url.startsWith("/api/v4/projects/acme%2Fgl/repository/commits")) {
        res.end(
          JSON.stringify([
            {
              id: "d".repeat(40),
              title: "initial commit",
              author_name: "GL Dev",
              created_at: "2026-01-04T10:00:00Z",
              web_url: "https://gitlab.example.com/acme/gl/-/commit/dddd",
            },
          ]),
        );
        return;
      }
      if (url.startsWith("/api/v4/projects/acme%2Fgl/repository/compare")) {
        res.end(
          JSON.stringify({
            diffs: [{ new_path: "a" }, { new_path: "b" }],
            commits: [{ id: "e".repeat(40), title: "range commit", author_name: "GL Dev", created_at: "2026-01-05T10:00:00Z" }],
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      baseUrl = `http://127.0.0.1:${String(port)}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("remote parsing", () => {
  it("parses GitHub https and ssh remotes", () => {
    expect(extractRemote("https://github.com/acme/web.git")).toEqual({
      provider: "github",
      host: "github.com",
      path: "acme/web",
    });
    expect(extractRemote("git@github.com:acme/web.git")).toEqual({
      provider: "github",
      host: "github.com",
      path: "acme/web",
    });
  });

  it("parses GitLab remotes on self-hosted hosts", () => {
    const parsed = extractRemote("https://gitlab.example.com/acme/gl.git");
    expect(parsed?.provider).toBe("gitlab");
    expect(parsed?.path).toBe("acme/gl");
  });

  it("returns null for non-repository remotes", () => {
    expect(extractRemote("https://example.com/only-one-segment")).toBeNull();
    expect(extractRemote("")).toBeNull();
  });

  it("resolves providers only when a token is configured", () => {
    expect(resolveGitProvider("https://github.com/acme/web.git", {})).toBeNull();
    const provider = resolveGitProvider("https://github.com/acme/web.git", {
      githubToken: "ghp_test",
      githubApiBase: baseUrl,
    });
    expect(provider?.name).toBe("github");
  });

  it("builds credentials from nested config", () => {
    const credentials = credentialsFromGitConfig({
      tokens: { github: "ghp_x" },
      apiBase: { github: baseUrl },
    });
    expect(credentials.githubToken).toBe("ghp_x");
    expect(credentials.githubApiBase).toBe(baseUrl);
  });
});

describe("GitHubProvider", () => {
  it("lists commits with the auth header", async () => {
    const provider = new GitHubProvider("acme/web", "ghp_test", baseUrl, createLogger({ level: "error", sink: () => undefined }));
    const commits = await provider.listCommits({ limit: 5 });
    expect(commits).toHaveLength(2);
    expect(commits[0]!.revision).toBe("a".repeat(12));
    expect(commits[0]!.subject).toBe("fix memory leak");
    expect(commits[0]!.author).toBe("Dev One");
    expect(commits[0]!.date).toBe(Date.parse("2026-01-01T10:00:00Z"));
    const last = requests[requests.length - 1]!;
    expect(String(last.headers.authorization)).toContain("ghp_test");
    expect(last.path).toContain("per_page=5");
  });

  it("compares revisions", async () => {
    const provider = new GitHubProvider("acme/web", "ghp_test", baseUrl);
    const result = await provider.compare("v1.0.0", "v1.0.1");
    expect(result.filesChanged).toBe(2);
    expect(result.commits[0]!.subject).toBe("between");
  });
});

describe("GitLabProvider", () => {
  it("lists commits with the PRIVATE-TOKEN header", async () => {
    const provider = new GitLabProvider("acme/gl", "glpat_test", baseUrl);
    const commits = await provider.listCommits({ limit: 3 });
    expect(commits).toHaveLength(1);
    expect(commits[0]!.subject).toBe("initial commit");
    const last = requests[requests.length - 1]!;
    expect(String(last.headers["private-token"])).toContain("glpat_test");
  });

  it("compares revisions", async () => {
    const provider = new GitLabProvider("acme/gl", "glpat_test", baseUrl);
    const result = await provider.compare("main", "feature");
    expect(result.filesChanged).toBe(2);
    expect(result.commits[0]!.subject).toBe("range commit");
  });

  it("returns empty results on provider errors instead of throwing", async () => {
    const provider = new GitLabProvider("acme/missing", "glpat_test", baseUrl);
    expect(await provider.listCommits({})).toHaveLength(0);
    expect((await provider.compare("a", "b")).filesChanged).toBeNull();
  });
});
