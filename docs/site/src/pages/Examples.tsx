import { Pre } from '../components/Code';

interface Scenario {
  title: string;
  problems: string;
  calls: string;
  outcome: string;
}

const SCENARIOS: Scenario[] = [
  {
    title: 'Triage a crash loop at 03:12',
    problems: 'A Minecraft server restarts every few minutes. Nobody was awake to watch the console.',
    calls: `ptero_detect_application   { "server": "survival-1" }
ptero_analyze_logs         { "server": "survival-1", "window": "6h" }
ptero_console_query        { "server": "survival-1", "from": "03:05", "to": "03:20" }
ptero_debug_context        { "server": "survival-1" }
ptero_diagnose             { "server": "survival-1" }`,
    outcome: `diagnosis: crash-loop · cause: OutOfMemoryError during world save
confidence: 0.86 · evidence: process_events (7 restarts), stack frame -> plugins/…
missing evidence: heap sizing in startup variables (checked: none set)`,
  },
  {
    title: 'Explain a change-correlated outage',
    problems: 'A deploy went out tonight and the site is down. Something changed — but what?',
    calls: `ptero_get_change_history  { "server": "web-1", "since": "24h" }
ptero_compare_known_good   { "server": "web-1" }
ptero_git_history          { "server": "web-1", "limit": 10 }
ptero_run_tests            { "server": "web-1" }
ptero_diagnose             { "server": "web-1" }`,
    outcome: `correlation: incident opened 4 min after git pull of "config: rotate db url" (web-1)
diagnosis: startup failure · evidence: config diff, failed health probe, console trace
suggested next step: inspect the changed file before any restart`,
  },
  {
    title: 'Remediate under policy, with rollback',
    problems: 'The diagnosis is clear and a restart is the right move — but only after it is simulated and approved.',
    calls: `ptero_propose_remediation  { "server": "web-1", "action": "restart" }
ptero_simulate_remediation { "planId": "prem_..." }
ptero_get_risk             { "action": "restart" }
ptero_approve_action       { "approvalId": "appr_...", "decision": "approve" }
ptero_execute_remediation  { "planId": "prem_..." }
ptero_run_health_check     { "server": "web-1" }

# if verification fails, the plan rolls back automatically:
ptero_rollback_remediation { "planId": "prem_..." }`,
    outcome: `plan: preflight backup -> restart -> health wait -> stabilization window
verification: healthy after 42s · effectiveness stats updated
rollback path armed the whole time; nothing ran without an approval record`,
  },
];

export default function Examples() {
  return (
    <main className="mx-auto max-w-[1100px] px-5 pb-20 pt-9 sm:px-7">
      <p className="mono-label mb-3">PteroOps examples</p>
      <h1 className="text-[clamp(1.9em,3.6vw,2.6em)] font-extrabold leading-tight tracking-[-0.02em]">
        <span className="grad-text">Real sessions</span>
      </h1>
      <p className="mt-3 max-w-[720px] text-[1.04em] leading-[1.75] text-muted">
        Three worked scenarios, abridged. Tool calls are as an agent would make them; outputs are trimmed to the
        lines that drive the next decision.
      </p>

      <div className="mt-12 space-y-10">
        {SCENARIOS.map((s, i) => (
          <section key={s.title}>
            <p className="mono-label mb-2">Scenario {i + 1} · {s.problems}</p>
            <h2 className="text-[1.3em] font-bold text-white">{s.title}</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Pre lang="json">{s.calls}</Pre>
              <div>
                <Pre lang="text">{s.outcome}</Pre>
                <p className="mt-2 text-[12.5px] text-faint">Result excerpt — real responses include full evidence ids.</p>
              </div>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
