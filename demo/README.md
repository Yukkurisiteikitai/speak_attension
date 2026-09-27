# Demo: Replay JSON Samples

会議記録をJSON形式で保存したサンプルです。これらのファイルをシステムに読み込むことで、会議の「決まったこと」「なぜ」「まだ分からないこと」「次にやること」の4セクションが自動抽出されます。

## サンプルファイル一覧

### 1. `sample-event-planning.json`
**シナリオ:** イベント企画打ち合わせ

**決まったこと:** 対戦ゲーム形式を採用  
**なぜ:** スマホで集客しやすい、来場者が少ないときの集客が課題  
**まだ分からないこと:**
- Wi-Fi負荷（未検証）
- ランキング機能（保留）
- ポスター・許可の取得担当（未割当）

**次にやること:** 鈴木がプロトタイプを来週金曜日までに作成

### 2. `sample-product-roadmap.json`
**シナリオ:** プロダクトロードマップ検討会

**決まったこと:**
- レイテンシー削減を優先（期限：10月末）
- UI刷新は次四半期に見送る

**なぜ:** 30%のユーザーが3秒以上待機、ユーザー満足度低下  
**まだ分からないこと:**
- データベース移行時のダウンタイム対策（ゼロダウンタイムで実現可能か未検証）
- ユーザー通知ポリシー（ダウンタイム時間未確定）

**次にやること:**
- 佐藤がDB移行検証を11月15日までに実施
- インフラチームが移行方式検証を実施

### 3. `sample-quick-standup.json`
**シナリオ:** 朝会 - プロジェクトA進捗確認

**決まったこと:**
- 昨日のスプリントタスク完了
- パフォーマンステストは本日中に実施
- デザイン案確定日：明日

**なぜ:** APIレスポンス性能が予想より低い  
**まだ分からないこと:**
- パフォーマンステスト結果（本日判明予定）
- ブランドカラー最終確認（未取得）

**次にやること:**
- 開発者Aがパフォーマンステストを本日完了
- デザイナーがブランドカラー確認を本日中に取得

## 使い方

### アプリで読み込む場合
1. アプリの「会議を読み込む」機能で、JSONファイルを選択
2. 自動的に4セクション形式で分類される

### テストで使用する場合
```javascript
import { buildMeetingStateDashboard } from "./src/utils/meetingStateDashboard";

const jsonData = require("./demo/sample-event-planning.json");
const segments = jsonData.segments;
const dashboard = buildMeetingStateDashboard(graph, [], null);
```

## JSON形式の仕様

```json
{
  "meetingId": "string (unique identifier)",
  "title": "string (meeting title)",
  "createdAt": "ISO 8601 timestamp",
  "segments": [
    {
      "id": "string (unique within meeting)",
      "text": "string (utterance text)",
      "createdAt": "number (milliseconds from start)",
      "source": "manual | voice | replay",
      "speaker": "string (optional speaker name)"
    }
  ]
}
```

## テスト実行

```bash
npm run check
```

すべてのテストが成功することを確認できます。
