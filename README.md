# health-mcp

[health.ojimpo.com](https://health.ojimpo.com)（Cultural Health Dashboard）の健康・文化活動データを Claude から会話で扱えるようにする**読み取り専用 MCP サーバー**です。

## 背景・動機

health-ojimpo は、音楽・読書・運動・SNS などの日常の文化的活動を外部サービスから自動収集し、個人の基準値に対するスコアとして可視化することで、メンタルヘルスの変調を早期に察知するダッシュボードです。

ダッシュボードは「眺める」には良いのですが、「先月と比べて音楽が減ってるのはなぜ？」「この1年で読書が多かった月は？」のような**問いかけ**にはAIとの対話のほうが向いています。そこでダッシュボードのデータをMCPツールとして公開し、claude.ai / Claude Code のどちらからでも自然言語で健康データを分析できるようにしました。

同じ構成の自作MCPサーバー [otp-mcp](https://github.com/ojimpo)（乗換案内）・cosense-mcp（Cosense）に続く3つ目で、足場（stdio/HTTP両対応のトランスポート層）はそれらから流用しています。

## 設計思想

- **読み取り専用**: データの取り込みや設定変更は載せない。MCP経由での誤操作リスクをゼロにし、認証なし運用（後述）を許容できるようにする
- **バックエンドに寄生しない**: health-ojimpo の REST API を叩くだけの薄いクライアント。スコアリングロジックはバックエンド側の単一実装のまま
- **出力サイズを制御**: スコア履歴のカテゴリ列はオプトイン、生データは件数上限 + 週/月集計モードで、LLMのコンテキストを溢れさせない
- **stdio と Streamable HTTP の両対応**: ローカルの Claude Code からは stdio、claude.ai からは Cloudflare Tunnel 経由の HTTP で同じサーバーに接続する

## ツール

| ツール | 説明 |
|---|---|
| `get_current_status` | 現在の健康/文化スコア・ステータス、カテゴリ別の今週vs先週、コンディション（睡眠/Readiness/ストレス等）、トレンドコメント |
| `get_score_history` | スコアの時系列（1m/3m=日次、1y=週次）。カテゴリ列は必要な分だけ指定 |
| `get_recent_activities` | 直近の具体的なアクティビティ（聴いた曲、運動、観た映画など） |
| `list_sources` | 設定済みデータソース一覧（カテゴリ・分類・基準値）。query_records の引数探索用 |
| `query_records` | 生の日次レコードを日付範囲で取得。source/categoryフィルタ、week/month集計対応 |

## 構成

```
claude.ai ──HTTPS──> Cloudflare Tunnel ──> localhost:4102 ──> health-mcp(Docker)
Claude Code ──stdio──> node build/index.js                        │ HTTP (docker network)
                                              health-ojimpo backend (FastAPI) <──┘
```

- health-mcp コンテナは health-ojimpo の Docker ネットワーク（`health-ojimpo_default`）に相乗りし、`http://backend:8000` でAPIに到達します
- stdio モード（Claude Code）はホストの `http://localhost:8400`（backendのlocalhost公開ポート）を使います

## セットアップ

### ビルド

```bash
npm install
npm run build
```

### CLI（動作確認用）

```bash
export HEALTH_API_BASE_URL=http://localhost:8400
node build/index.js status
node build/index.js history 3m music,sleep
node build/index.js recent 5
node build/index.js sources
node build/index.js records 2026-06-01 2026-06-30 lastfm '' week
```

### Docker（HTTP モード）

```bash
docker compose up -d --build
curl http://localhost:4102/health   # {"status":"ok"}
```

※ health-ojimpo のスタックが先に起動している必要があります（externalネットワーク参照のため）。

### Claude Code への登録（stdio）

```bash
claude mcp add --scope user health \
  --env HEALTH_API_BASE_URL=http://localhost:8400 \
  -- node /path/to/health-mcp/build/index.js
```

### claude.ai への登録（リモートコネクタ）

1. Cloudflare Tunnel の ingress に `health-mcp.example.com → http://localhost:4102` を追加
2. claude.ai → Settings → Connectors → **Add custom connector** → URL に `https://health-mcp.example.com/mcp` を指定

## 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `HEALTH_API_BASE_URL` | `http://localhost:8400` | health-ojimpo バックエンドのベースURL（Docker内は `http://backend:8000`） |
| `TRANSPORT` | `stdio` | `http` で Streamable HTTP サーバーとして起動 |
| `PORT` | `3000` | HTTPモードのリッスンポート |
| `MCP_AUTH_TOKEN` | （空） | 設定すると `/mcp` にBearer認証を要求。claude.aiカスタムコネクタは静的トークン未対応のため通常は空 |

## 将来の展望

- 主観フィードバック（気分の記録）ツール — バックエンド側にエンドポイントができたら書き込み系として追加検討
- スコア変動の要因分解ツール（どのソースがスコアを下げているかの内訳）
