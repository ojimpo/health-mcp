// CLIモード: MCPを介さず直接health-ojimpo APIに問い合わせる。動作確認・デバッグ用。
//   node build/index.js status
//   node build/index.js history [1m|3m|1y] [music,sleep,...]
//   node build/index.js recent [n]
//   node build/index.js sources
//   node build/index.js records <from> <to> [source] [category] [week|month]
import {
  getDashboard,
  getIngestStatus,
  getRecords,
  getSources,
  formatHistory,
  formatRecent,
  formatRecords,
  formatSources,
  formatStatus,
} from "./health.js";

export async function runCli(args: string[]): Promise<void> {
  const [cmd, ...rest] = args;
  if (cmd === "status") {
    const [dash, ingest] = await Promise.all([getDashboard("1m"), getIngestStatus()]);
    console.log(formatStatus(dash, ingest));
  } else if (cmd === "history") {
    const [range, cats] = rest;
    const dash = await getDashboard(range || "3m");
    console.log(formatHistory(dash, cats ? cats.split(",").filter(Boolean) : []));
  } else if (cmd === "recent") {
    const [n] = rest;
    const dash = await getDashboard("1m");
    console.log(formatRecent(dash.recent_activities, n ? parseInt(n, 10) : 8));
  } else if (cmd === "sources") {
    console.log(formatSources(await getSources()));
  } else if (cmd === "records") {
    const [from, to, source, category, groupBy] = rest;
    if (!from || !to) {
      console.error("usage: health-mcp records <from> <to> [source] [category] [week|month]");
      process.exit(1);
    }
    const res = await getRecords({
      from,
      to,
      source: source || undefined,
      category: category || undefined,
      group_by: groupBy || undefined,
    });
    console.log(formatRecords(res));
  } else {
    console.error(
      `unknown command: ${cmd ?? "(none)"}\ncommands:\n  status\n  history [1m|3m|1y] [cat,cat,...]\n  recent [n]\n  sources\n  records <from> <to> [source] [category] [week|month]`,
    );
    process.exit(1);
  }
}
