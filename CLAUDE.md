# health-mcp — health-ojimpo 読み取り専用MCPサーバー

## 概要

health-ojimpo（`~/dev/health-ojimpo`、FastAPI backend）の健康・文化活動データを公開する読み取り専用MCPサーバー。otp-mcp / cosense-mcp と同じ足場（TypeScript + @modelcontextprotocol/sdk、stdio/Streamable HTTP両対応）。

## 構成

- `src/index.ts` — エントリポイント + ツール定義5本（get_current_status / get_score_history / get_recent_activities / list_sources / query_records）
- `src/health.ts` — health-ojimpo REST APIクライアント + テキストフォーマッタ（純関数、CLIと共用）
- `src/http-server.ts` — 汎用Streamable HTTPトランスポート（otp-mcpからコピー、ほぼ流用）
- `src/cli.ts` — デバッグ用CLI（`node build/index.js status` 等）

## 運用情報

- **ホストポート**: 4102（コンテナ内3000）。4100=cosense-mcp、4101=otp-mcp
- **Dockerネットワーク**: `health-ojimpo_default` にexternal参加 → `http://backend:8000` でAPI到達
  - health-ojimpo スタックが先に起動している必要あり
- **公開URL**: `https://health-mcp.ojimpo.com/mcp`（Cloudflare Tunnel `arigato-nas`、`/etc/cloudflared/config.yml` にingress、編集はsudo必要）
- **認証**: なし（MCP_AUTH_TOKEN空）。読み取り専用なので許容。otp-mcp/cosense-mcpと同じ運用
- **依存API**: backend の `/api/dashboard` `/api/settings/sources` `/api/ingest/status` `/api/records`
  - `/api/records` はこのMCPのために追加した生データエンドポイント（health-ojimpo側 `backend/app/routers/records.py`）

## 登録

- Claude Code: userスコープで登録済み（`claude mcp add --scope user health --env HEALTH_API_BASE_URL=http://localhost:8400 -- node .../build/index.js`）
- claude.ai: Settings → Connectors → カスタムコネクタ、名前 `Health`、URL `https://health-mcp.ojimpo.com/mcp`

## 開発

```bash
npm run build                 # tsc → build/
node build/index.js status    # CLIスモークテスト（要 HEALTH_API_BASE_URL=http://localhost:8400）
docker compose up -d --build  # HTTPモードで起動
```

- カテゴリ一覧（ACTIVITY_CATEGORIES / STATE_CATEGORIES）は backend の `backend/app/models/schemas.py` と手動同期。backend側に新カテゴリを足したら `src/health.ts` も更新すること
- ツールdescriptionは英語、コード内コメントは日本語、結果はフォーマット済みテキスト（otp-mcpの流儀）
