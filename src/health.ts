// health-ojimpo バックエンド（FastAPI）へのRESTクライアントとテキスト整形。
// フォーマッタは純関数にして、MCPハンドラとCLIの両方から使う（otp-mcpのotp.tsと同じ構造）。

const API_BASE = process.env.HEALTH_API_BASE_URL || "http://localhost:8400";

// backend/app/models/schemas.py の ACTIVITY_CATEGORIES / STATE_CATEGORIES と揃える
export const ACTIVITY_CATEGORIES = [
  "music", "exercise", "reading", "movie", "sns", "coding", "calendar",
  "live", "shopping", "vitality", "outing_activity", "cd", "podcast",
  "game", "like", "study", "photo",
];
export const STATE_CATEGORIES = ["sleep", "readiness", "stress", "weight", "outing", "ctl"];

export interface StatusInfo {
  status: string;
  score: number;
  message: string;
}

export interface CategoryCard {
  key: string;
  label: string;
  current: number;
  previous: number;
  change: number;
}

export interface StateCard {
  key: string;
  label: string;
  current: number | null;
  previous: number | null;
  change: number | null;
}

export interface TrendComment {
  text: string;
  type: string;
}

export interface RecentActivity {
  time: string;
  text: string;
  detail: string | null;
}

// date + カテゴリ別スコア + 全体スコア（フィールドはbackendが動的生成）
export type ChartPoint = { date: string } & Record<string, number | string | null>;

export interface DashboardResponse {
  health_status: StatusInfo;
  cultural_status: StatusInfo;
  activity_chart: ChartPoint[];
  condition_chart: ChartPoint[];
  category_cards: CategoryCard[];
  state_cards: StateCard[];
  trend_comments: TrendComment[];
  recent_activities: RecentActivity[];
}

export interface SourceSetting {
  id: string;
  name: string;
  category: string;
  display_type: string;
  classification: string;
  status: string;
  base_value: number;
  base_unit: string;
  aggregation_period: number;
  sort_order: number;
}

export interface IngestStatus {
  last_run: string | null;
  records_total: number;
  status: string;
  next_scheduled: string | null;
}

export interface RecordItem {
  id: number;
  date: string;
  source: string;
  category: string;
  minutes: number;
  raw_value: number;
  raw_unit: string;
  metadata: string | null;
}

export interface RecordsAggregate {
  period: string;
  source: string;
  category: string;
  minutes: number;
  raw_value: number;
  days: number;
}

export interface RecordsResponse {
  total: number;
  returned: number;
  truncated: boolean;
  records: RecordItem[];
  aggregates: RecordsAggregate[];
}

async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(path, API_BASE);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (body?.detail) detail = ` — ${JSON.stringify(body.detail)}`;
    } catch {
      // JSONでないエラーボディは無視
    }
    throw new Error(`health API HTTP ${res.status} (${url.pathname})${detail}`);
  }
  return (await res.json()) as T;
}

export async function getDashboard(range: string): Promise<DashboardResponse> {
  return apiGet<DashboardResponse>("/api/dashboard", { range });
}

export async function getSources(): Promise<SourceSetting[]> {
  return apiGet<SourceSetting[]>("/api/settings/sources");
}

export async function getIngestStatus(): Promise<IngestStatus> {
  return apiGet<IngestStatus>("/api/ingest/status");
}

export async function getRecords(params: {
  from: string;
  to: string;
  source?: string;
  category?: string;
  group_by?: string;
  limit?: number;
}): Promise<RecordsResponse> {
  return apiGet<RecordsResponse>("/api/records", params);
}

// --- formatters ---

const r1 = (n: number | null | undefined): string =>
  n === null || n === undefined ? "-" : String(Math.round(n * 10) / 10);

const signed = (n: number | null | undefined): string =>
  n === null || n === undefined ? "-" : `${n >= 0 ? "+" : ""}${r1(n)}`;

function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}

export function formatStatus(dash: DashboardResponse, ingest: IngestStatus): string {
  const out: string[] = [];
  out.push(
    `HEALTH: ${dash.health_status.status} (${r1(dash.health_status.score)}) — ${dash.health_status.message}`,
  );
  out.push(
    `CULTURAL: ${dash.cultural_status.status} (${r1(dash.cultural_status.score)}) — ${dash.cultural_status.message}`,
  );
  if (dash.category_cards.length) {
    out.push("");
    out.push("## Categories (this week vs previous week)");
    out.push(
      table(
        ["category", "current", "previous", "change"],
        dash.category_cards.map((c) => [c.label, r1(c.current), r1(c.previous), signed(c.change)]),
      ),
    );
  }
  if (dash.state_cards.length) {
    out.push("");
    out.push("## Condition states");
    out.push(
      table(
        ["state", "current", "previous", "change"],
        dash.state_cards.map((c) => [c.label, r1(c.current), r1(c.previous), signed(c.change)]),
      ),
    );
  }
  if (dash.trend_comments.length) {
    out.push("");
    out.push("## Trends");
    for (const t of dash.trend_comments) out.push(`- [${t.type}] ${t.text}`);
  }
  out.push("");
  out.push(
    `data freshness: last ingest ${ingest.last_run ?? "unknown"} (${ingest.status}), ${ingest.records_total} records total`,
  );
  return out.join("\n");
}

export function formatHistory(dash: DashboardResponse, categories: string[]): string {
  const invalid = categories.filter(
    (c) => !ACTIVITY_CATEGORIES.includes(c) && !STATE_CATEGORIES.includes(c),
  );
  if (invalid.length) {
    throw new Error(
      `Unknown categories: ${invalid.join(", ")}. Valid activity: ${ACTIVITY_CATEGORIES.join(", ")}. Valid state: ${STATE_CATEGORIES.join(", ")}.`,
    );
  }
  // activity_chart と condition_chart は同じ日付列を持つ。dateでマージして1表にする。
  const byDate = new Map<string, ChartPoint>();
  for (const p of dash.activity_chart) byDate.set(p.date, { ...p });
  for (const p of dash.condition_chart) {
    byDate.set(p.date, { ...(byDate.get(p.date) ?? { date: p.date }), ...p });
  }
  const points = [...byDate.values()];
  const header = ["date", "health", "cultural", ...categories];
  const rows = points.map((p) => [
    p.date,
    r1(p.health_score as number | null),
    r1(p.cultural_score as number | null),
    ...categories.map((c) => r1(p[c] as number | null)),
  ]);
  return table(header, rows);
}

export function formatRecent(activities: RecentActivity[], limit: number): string {
  const items = activities.slice(0, limit);
  if (!items.length) return "No recent activities.";
  return items
    .map((a) => `- [${a.time}] ${a.text}${a.detail ? ` (${a.detail})` : ""}`)
    .join("\n");
}

export function formatSources(sources: SourceSetting[]): string {
  const rows = [...sources]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => [
      s.id,
      s.name,
      s.category,
      s.display_type,
      s.classification,
      s.status,
      `${r1(s.base_value)} ${s.base_unit}/${s.aggregation_period}d`,
    ]);
  return table(
    ["id", "name", "category", "display_type", "classification", "status", "baseline"],
    rows,
  );
}

export function formatRecords(res: RecordsResponse): string {
  const out: string[] = [];
  out.push(
    `total=${res.total} returned=${res.returned}` +
      (res.truncated
        ? " (TRUNCATED — narrow the date range, add a source/category filter, or use group_by)"
        : ""),
  );
  if (res.aggregates.length) {
    out.push(
      table(
        ["period", "source", "category", "minutes", "raw_value", "days"],
        res.aggregates.map((a) => [
          a.period, a.source, a.category, r1(a.minutes), r1(a.raw_value), String(a.days),
        ]),
      ),
    );
  } else if (res.records.length) {
    out.push(
      table(
        ["date", "source", "category", "minutes", "raw_value", "unit"],
        res.records.map((r) => [
          r.date, r.source, r.category, r1(r.minutes), r1(r.raw_value), r.raw_unit,
        ]),
      ),
    );
  } else {
    out.push("No records in the given range.");
  }
  return out.join("\n");
}
