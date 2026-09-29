import type { Logger } from "../observability/logger.js";

export interface GitCommit {
  revision: string;
  subject: string;
  author: string | null;
  date: number | null;
  url: string | null;
}

export interface GitCompareResult {
  commits: GitCommit[];
  filesChanged: number | null;
}

export interface GitProviderAdapter {
  name: "github" | "gitlab";
  repository: string;
  listCommits(options: { limit?: number; ref?: string }): Promise<GitCommit[]>;
  compare(base: string, head: string): Promise<GitCompareResult>;
}

export interface GitProviderCredentials {
  githubToken?: string;
  gitlabToken?: string;
  githubApiBase?: string;
  gitlabApiBase?: string;
}

const GH_API = "https://api.github.com";

export interface GitProviderConfigLike {
  tokens: { github?: string; gitlab?: string };
  apiBase: { github?: string; gitlab?: string };
}

export function credentialsFromGitConfig(config: GitProviderConfigLike): GitProviderCredentials {
  return {
    ...(config.tokens.github ? { githubToken: config.tokens.github } : {}),
    ...(config.tokens.gitlab ? { gitlabToken: config.tokens.gitlab } : {}),
    ...(config.apiBase.github ? { githubApiBase: config.apiBase.github } : {}),
    ...(config.apiBase.gitlab ? { gitlabApiBase: config.apiBase.gitlab } : {}),
  };
}

export function extractRemote(
  remoteUrl: string,
): { provider: "github" | "gitlab" | "unknown"; host: string; path: string } | null {
  const trimmed = remoteUrl.trim();
  if (trimmed === "") return null;
  const sshMatch = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/.exec(trimmed);
  if (sshMatch) {
    return classify(sshMatch[1]!, sshMatch[2]!);
  }
  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
    return classify(url.hostname, path);
  } catch {
    return null;
  }
}

function classify(
  host: string,
  path: string,
): { provider: "github" | "gitlab" | "unknown"; host: string; path: string } | null {
  if (!path || path.split("/").length < 2) return null;
  if (/github\.com$/i.test(host)) return { provider: "github", host, path };
  if (/gitlab/i.test(host)) return { provider: "gitlab", host, path };
  return { provider: "unknown", host, path };
}

export function resolveGitProvider(
  remoteUrl: string,
  credentials: GitProviderCredentials,
  logger?: Logger,
): GitProviderAdapter | null {
  const remote = extractRemote(remoteUrl);
  if (!remote) return null;
  if (remote.provider === "github" && credentials.githubToken) {
    return new GitHubProvider(
      remote.path,
      credentials.githubToken,
      credentials.githubApiBase ?? GH_API,
      logger,
    );
  }
  if (remote.provider === "gitlab" && credentials.gitlabToken) {
    const base = credentials.gitlabApiBase ?? `https://${remote.host}`;
    return new GitLabProvider(remote.path, credentials.gitlabToken, base, logger);
  }
  return null;
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  logger?: Logger,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "pteroops-mcp", ...headers },
      signal: controller.signal,
    });
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      logger?.debug("git provider request failed", { status: response.status, url: redactUrl(url) });
    }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    logger?.debug("git provider request error", {
      error: (error as Error).message,
      url: redactUrl(url),
    });
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

function redactUrl(url: string): string {
  return url.replace(/([?&](?:token|private_token|access_token)=)[^&]+/gi, "$1[REDACTED]");
}

export class GitHubProvider implements GitProviderAdapter {
  readonly name = "github" as const;

  constructor(
    readonly repository: string,
    private readonly token: string,
    private readonly apiBase: string,
    private readonly logger?: Logger,
  ) {}

  async listCommits(options: { limit?: number; ref?: string } = {}): Promise<GitCommit[]> {
    const limit = Math.min(options.limit ?? 10, 50);
    const url = new URL(`${this.apiBase}/repos/${this.repository}/commits`);
    url.searchParams.set("per_page", String(limit));
    if (options.ref) url.searchParams.set("sha", options.ref);
    const { ok, data } = await fetchJson(
      url.toString(),
      {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      this.logger,
    );
    if (!ok || !Array.isArray(data)) return [];
    return (data as Array<Record<string, unknown>>).map((entry) => {
      const commit = (entry.commit ?? {}) as Record<string, unknown>;
      const author = (commit.author ?? {}) as Record<string, unknown>;
      const message = String(commit.message ?? "");
      return {
        revision: String(entry.sha ?? "").slice(0, 12),
        subject: message.split("\n")[0]!.slice(0, 200),
        author: author.name === undefined ? null : String(author.name),
        date: typeof author.date === "string" ? Date.parse(author.date) : null,
        url: entry.html_url === undefined ? null : String(entry.html_url),
      };
    });
  }

  async compare(base: string, head: string): Promise<GitCompareResult> {
    const url = `${this.apiBase}/repos/${this.repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
    const { ok, data } = await fetchJson(
      url,
      {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
      },
      this.logger,
    );
    if (!ok || data === null || typeof data !== "object") {
      return { commits: [], filesChanged: null };
    }
    const record = data as Record<string, unknown>;
    const commits = Array.isArray(record.commits)
      ? (record.commits as Array<Record<string, unknown>>).map((entry) => {
          const commit = (entry.commit ?? {}) as Record<string, unknown>;
          const author = (commit.author ?? {}) as Record<string, unknown>;
          return {
            revision: String(entry.sha ?? "").slice(0, 12),
            subject: String(commit.message ?? "").split("\n")[0]!.slice(0, 200),
            author: author.name === undefined ? null : String(author.name),
            date: typeof author.date === "string" ? Date.parse(author.date) : null,
            url: entry.html_url === undefined ? null : String(entry.html_url),
          };
        })
      : [];
    return {
      commits,
      filesChanged: Array.isArray(record.files) ? record.files.length : null,
    };
  }
}

export class GitLabProvider implements GitProviderAdapter {
  readonly name = "gitlab" as const;

  constructor(
    readonly repository: string,
    private readonly token: string,
    private readonly apiBase: string,
    private readonly logger?: Logger,
  ) {}

  private projectId(): string {
    return encodeURIComponent(this.repository);
  }

  async listCommits(options: { limit?: number; ref?: string } = {}): Promise<GitCommit[]> {
    const limit = Math.min(options.limit ?? 10, 50);
    const url = new URL(`${this.apiBase}/api/v4/projects/${this.projectId()}/repository/commits`);
    url.searchParams.set("per_page", String(limit));
    if (options.ref) url.searchParams.set("ref_name", options.ref);
    const { ok, data } = await fetchJson(
      url.toString(),
      { "PRIVATE-TOKEN": this.token },
      this.logger,
    );
    if (!ok || !Array.isArray(data)) return [];
    return (data as Array<Record<string, unknown>>).map((entry) => ({
      revision: String(entry.id ?? "").slice(0, 12),
      subject: String(entry.title ?? "").slice(0, 200),
      author: entry.author_name === undefined ? null : String(entry.author_name),
      date: typeof entry.created_at === "string" ? Date.parse(entry.created_at) : null,
      url: entry.web_url === undefined ? null : String(entry.web_url),
    }));
  }

  async compare(base: string, head: string): Promise<GitCompareResult> {
    const url = new URL(`${this.apiBase}/api/v4/projects/${this.projectId()}/repository/compare`);
    url.searchParams.set("from", base);
    url.searchParams.set("to", head);
    const { ok, data } = await fetchJson(
      url.toString(),
      { "PRIVATE-TOKEN": this.token },
      this.logger,
    );
    if (!ok || data === null || typeof data !== "object") {
      return { commits: [], filesChanged: null };
    }
    const record = data as Record<string, unknown>;
    const commits = Array.isArray(record.commits)
      ? (record.commits as Array<Record<string, unknown>>).map((entry) => ({
          revision: String(entry.id ?? "").slice(0, 12),
          subject: String(entry.title ?? "").split("\n")[0]!.slice(0, 200),
          author: entry.author_name === undefined ? null : String(entry.author_name),
          date: typeof entry.created_at === "string" ? Date.parse(entry.created_at) : null,
          url: entry.web_url === undefined ? null : String(entry.web_url),
        }))
      : [];
    return {
      commits,
      filesChanged: Array.isArray(record.diffs) ? record.diffs.length : null,
    };
  }
}
