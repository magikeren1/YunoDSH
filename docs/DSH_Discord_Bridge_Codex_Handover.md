# DSH Discord Bridge — Codex Handover

> **文件用途：** 將目前討論過的需求、架構方向、已知 DSH / dc-bridge 能力、待驗證事項與接手工作交給 Codex，作為後續原始碼盤點及開發的共同基準。  
> **整理日期：** 2026-11-12  
> **文件狀態：** Architecture / Source-Audit Handover（不是已核准的完整技術規格，也不是實作指令）

---

## 0. Codex 開始前必讀

這份文件是目前討論的工作基準。請先理解本節，再開始 Repository 調查。

### 0.1 目前要做的是什麼

開發一個**以 DeepSeek Harness（DSH）為核心的 Discord Bridge**，讓使用者透過 Discord 與 DSH Agent 互動，並在 DSH 已有的 Agent、Session、Tool、Context、Background Job 等能力上，補足 Discord 入口、訊息批次、外部 ID 對應、群組上下文及個人記憶等整合需求。

### 0.2 專案定位不可改寫

- **不是取代 dc-bridge。** 這個專案與 dc-bridge 屬於同一類型：DSH Bridge。
- **DSH 是核心 Harness / Agent Runtime。** 不要另建一套 Agent Runtime，也不要重寫 DSH 已經具備的 Agent Loop、Tool Runtime、Session Event Log 或其他核心能力。
- **dc-bridge 是主要實作參考。** 使用者喜歡其中許多設計，希望完整評估其功能與解法；不要預先排除功能。
- 目標是依照本專案的資源預算及實際使用方式，重用 DSH 與 dc-bridge 能力；若原模組太重，應研究較輕量的替代實作，而不是直接刪除需求。
- DSH 原生 Discord Plugin（例如 `dsh-plugin-discord`）是可比較的整合選項／可能的最佳化方向，**不是已決定取代 dc-bridge 的主要基礎**。
- **Policy Layer 尚未討論。** 不得自行設計、命名、實作或預設它的邊界。若在原始碼中看到 permission / authorization / policy 機制，可以記錄其實際存在與 API，但不要替使用者決定如何組合。

### 0.3 不要把研究當成已驗證

請在所有報告、程式註解及設計文件中區分：

1. **Source-confirmed：** 已在指定 commit 的原始碼或型別中確認。
2. **Official-doc-confirmed：** 官方文件有記載，但尚未核對實作。
3. **Previous-discussion note：** 來自本文件／先前討論，尚待在目前 checkout 驗證。
4. **Needs-test：** 必須執行測試、故障注入或實機部署才能確認。
5. **Decision pending：** 使用者尚未決定，不可自行定案。

目前公開 GitHub 的 `main` / `master` 都是可變動分支。本文件記錄的是 **2026-11-12** 可查到的內容，不代表 Codex checkout 的 commit 一定相同。開始審查時先記錄 commit SHA、branch、tag、Node.js 版本及 lockfile 狀態。

---

## 1. 專案目標與使用情境

### 1.1 主要入口

- Discord 是主要入口。
- WhatsApp 是未來可能追加的入口，不是目前 MVP 必要條件。
- 預期 Discord 群組約 100 名成員，其中約 7–8 人會較常與 Agent 互動。
- Agent 可以觀察群組訊息及累積上下文，但不代表每則訊息都要回覆。
- 使用者接受明確指令、mention、reply 或 regex 類型的呼叫方式；不需要每則訊息都觸發模型。

### 1.2 互動與上下文需求

需要同時處理兩種不同層級的資訊：

1. **個人記憶（User Memory）**：依 Discord User ID 歸屬，保存個人偏好、興趣及持續中的活動等資訊。
2. **群組／頻道上下文（Channel Context / Channel Notes）**：保存群體共同討論、事件、決議及持續話題。

兩者不可混成同一份記憶，也不能把某位使用者說的話錯誤歸屬給其他使用者。

另外需要批次整理群組訊息（Digest / Summary），而不是每則訊息都呼叫 LLM：

- 依時間或訊息量門檻整理群組訊息。
- 把整理後的內容更新到群組脈絡／頻道筆記。
- 個人記憶與群組摘要應有不同的寫入及注入邏輯。
- 背景摘要不應阻塞即時聊天；需考慮排程、佇列、逾時、取消及重啟後恢復。

### 1.3 私人任務與 Coding

- Owner 的 Discord DM 是私人助理入口。
- Owner DM 需要支援私人工作、Coding、Flagship 等較高成本／較高能力任務。
- 一般群組用戶主要使用 Flash。
- **其他使用者的 DM 不會因此取得 Owner 權限。** DM 只是入口與上下文區隔，不等於身分授權。
- Owner 身分應以實際 Discord User ID 為依據；不可只看 DM / Channel 類型。
- 使用者不希望為每個模型建立一套不同工具矩陣；比較偏好模型共用工具介面／整體工具政策，而由執行端按身分處理 Owner-only Coding。這是需求方向，**具體 Policy Layer 還未討論，也不可自行設計**。

### 1.4 模型需求

- Flash 是一般互動的預設模型。
- Flagship 用於特定複雜工作或明確升級的任務。
- 需要研究 DSH Session 層級模型選擇 API，避免建立第二套模型執行引擎。
- 不應在已準備／執行中的 Model Step 中途切換模型；需確認 DSH API 的實際邊界。
- 先前提到的模型名稱與價格沒有完成官方查證，不要將舊對話中的模型名稱或價格直接寫入設定或成本估算。
- Deep Research 是獨立付費能力，不納入基本 Bridge 預算。

### 1.5 媒體需求

- FFmpeg 與 FFprobe 是使用者要求保留的必要系統依賴／能力。
- 儘可能以 subprocess 執行，不要因為需要 FFmpeg 就讓常駐 Bridge 長期持有大型媒體工作狀態。
- 需要評估 timeout、最大輸出、最大附件大小、併發上限、暫存檔清理及重啟行為。
- dc-bridge 文件已提到 FFmpeg 的圖片縮圖、媒體處理等用途；FFprobe 是否已在目前版本中使用，仍須在原始碼搜尋確認。
- 不要因 dc-bridge 文件將 FFmpeg 描述為選用，就把本專案的 FFmpeg / FFprobe 需求移除。

---

## 2. 部署與資源限制

目前規劃的目標環境：

| 項目 | 目前基準 |
|---|---|
| VPS | Singapore node |
| OS | Debian 12 Slim（可評估 Debian 13，但須確認相容性） |
| CPU | 1 vCPU |
| RAM | 1 GB |
| Swap | 2 GB |
| swappiness | 10 |
| SSD | 20 GB |
| Process management | `systemd` |
| Runtime / package | `uv` 已列入既有環境規劃；Node.js 版本須依當前 DSH / dc-bridge 需求確認 |
| Docker daemon | 目前部署方向是不預設常駐 Docker daemon；Sandbox 是否需要 Docker 必須另行評估 |

資源目標是低常駐用量、可預期的短時間尖峰，並且不要因背景摘要、媒體處理或 Coding 任務同時發生而 OOM。

**不要只用平均 RSS 評估。** 後續至少要量測：

- 無互動閒置時的常駐 RSS。
- 一般 Discord 聊天負載。
- 短時間大量訊息進入時的 CPU、RSS、佇列長度。
- Digest 與正常對話同時執行。
- FFmpeg / FFprobe 與聊天同時執行。
- Coding 子程序與其他工作同時執行（若納入 MVP / 部署方案）。
- DSH 或 Bridge 重啟後的恢復時間、暫存檔與佇列狀況。

預算曾以每月 US$10–15 作為初步參考，但不是鎖定上限；Flash 月用量曾粗估約 100 則訊息，也尚未驗證。成本估算需要實際模型、Token 分布、摘要頻率及工具用量，不能直接將舊估值當作事實。

---

## 3. 核心架構原則

### 3.1 責任分界（目前方向）

```text
Discord Gateway
      │
      ▼
DSH Bridge（以 dc-bridge 為主要實作參考）
  ├─ Discord event intake / output
  ├─ Discord ID ↔ DSH Session mapping
  ├─ Batcher / Turn Gate / queue coordination
  ├─ Channel context / User Memory / Channel Notes
  ├─ Flash / Flagship routing request
  └─ FFmpeg / FFprobe subprocess orchestration
      │
      ▼
DSH Host / Web API / Plugin Runtime
  ├─ Agent Loop
  ├─ Agent lifecycle
  ├─ Session Event Log / persistence
  ├─ Tool registry / tool execution
  ├─ Context assembly / compaction (依實際組態確認)
  └─ Background jobs / other native capabilities
```

此圖是責任分界的工作假設，不是最後部署拓樸。dc-bridge 現有方案是獨立 Discord Bridge 程序透過 DSH Web API 溝通；DSH 原生 Plugin 方案仍可比較，但尚未決定採用哪一種。

### 3.2 不重複實作 DSH

在寫新程式前，先確認 DSH 是否已有合適能力。至少檢查：

- Agent 建立、恢復、follow-up、steer、inject、cancel、idle wait。
- Session Event Log、持久化、歷史查詢、Event Follow / Projection。
- Session Model Selection。
- Tool Registry / Tool execution pipeline。
- Context injection / compaction。
- Background Jobs。
- Plugin / Cordis extension mechanism。

若 DSH 已有能力，Bridge 應使用該能力，不要複製 Agent Loop、工具執行器、Session history 或第二套任務生命週期。

### 3.3 Bridge 仍有自己的責任

DSH 有 Session Inbox 不代表 Bridge 不需要管理 Discord 訊息。兩者要明確分工：

- DSH Inbox：DSH Agent 尚未處理的輸入。
- Bridge Queue：尚未成功提交到 DSH 的 Discord 工作／訊息。
- Session Mapping：Discord Channel / DM 與 DSH Session ID 的持久化關係。
- User Memory / Channel Notes：屬於 Bridge 的外部上下文資料（除非後續找到更適合且已存在的 DSH 原生服務）。

需要避免 Bridge Queue 與 DSH Inbox 造成重複提交。

---

## 4. DSH 原生能力：目前已知資訊

> 下列資料於 2026-11-12 重新核對 DSH 公開 Repository 文件。Codex 仍須針對實際 checkout 的 commit 重新核對型別與實作。

### 4.1 Agent API

官方文件：

- [DSH Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [Agent Package README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/README.md)
- [Core Subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md)

目前官方文件說明 `dsh-agent` 提供 Agent Handle、建立／恢復 Agent、輸入投遞、Context Injection、取消與 idle wait 等操作；它需要 Agent Driver（例如 `dsh-agent-loop`）才會執行 Model Request。

注意：

- Agent API 與 Agent Loop 是相關但不同的組件。
- `Agent` 的 Initiator attribution 是 process-local；跨 Worker、程序、持久化佇列及 restart 必須明確傳遞身份資訊。
- process-local ambient initiator 不應被當作 liveness proof 或 authorization。

### 4.2 Session Controller

官方文件：

- [Session Controller README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/session-controller/README.md)
- [Session Subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md)

文件列出的能力包括 Session lifecycle、create、prompt、selectModel、history / events、follow、projections、state、queue update、cancel 等。確切方法簽名與 API envelope 請以目前 checkout 的 TypeScript 定義為準。

重要已知行為：

- Session 採用 append-only event log 概念，對話歷史由持久化事件衍生。
- `selectModel` 成功回應代表 Session-local selection 已記錄；模型更動作用於下一個 Step，已準備好的 Step 保留當時捕獲的模型選擇。
- Session API 的 prompt acceptance 不等於 Agent 已執行或完成；需釐清回應語意及重試 request identity。
- DSH 有 Event Follow / Projection 等能力，Bridge 不應只因為要顯示狀態就另外維護第二份 DSH 對話歷史。

### 4.3 Plugin / Cordis

官方架構文件描述 DSH 是以 Cordis Plugin 組合的 Harness。模型 Provider、Tool Registry、Session、Agent Loop 等服務由插件組合，外部整合可評估透過 Plugin 掛載。

這表示原生 Plugin 是技術上值得比較的選項，但不代表它一定比 dc-bridge 的獨立程序整合更好。需要比較：

- Discord Gateway 是否與 DSH Host 同程序執行。
- Host restart 對 Gateway 連線的影響。
- Plugin lifecycle、註冊／卸載與錯誤隔離。
- 是否增加 Host 記憶體與故障耦合。
- 是否能沿用 dc-bridge 的完整訊息批次、記憶、notes、media 等功能。

### 4.4 API 穩定性

DSH 文件中的公開 API 有 pre-stable / migration 注意事項。必須鎖定 DSH 版本或 commit，並把 DSH API adapter 的相容性測試納入專案；不要直接依賴 `master` 最新 API 而沒有版本記錄。

---

## 5. dc-bridge：目前已確認的參考功能

主要 Repository：<https://github.com/konnokai/dc-bridge>

主要文件：

- [Discord Guide](https://github.com/konnokai/dc-bridge/blob/main/docs/guides/DISCORD.md)
- [Folder Map](https://github.com/konnokai/dc-bridge/blob/main/docs/FOLDER_MAP.md)
- [DSH Client](https://github.com/konnokai/dc-bridge/blob/main/src/dsh-client.js)
- [Discord Bridge Entry](https://github.com/konnokai/dc-bridge/blob/main/src/discord-bridge.js)

### 5.1 Discord 整合形態

目前 Discord Guide 描述的資料流：

```text
Discord Gateway (discord.js 14 / messageCreate)
                │
                ▼
       src/discord-bridge.js
                │
                ▼
        DSH Web API (/api)
                │
                ▼
         DSH Agent / Session
                │
                └── turn / question / approval events
                    回到 Discord Bridge
```

文件也指出 Discord 入口使用 `src/dsh-client.js`，處理 Cookie、RPC 與 `/api/remote.mux` 事件流。這個部署模式要求 DSH Web 與 Bridge 可互通；目前文件所描述的本機 Cookie 鑄造路徑依賴本機 DSH credentials，因此不能把「獨立程序」誤解成「Bridge 可任意遠端使用同一套本機簽章材料」。

### 5.2 目前 Folder Map 列出的 Discord 模組

目前 `docs/FOLDER_MAP.md`（文件標示最後核對日 2026-10-28）列出的部分模組：

| 路徑 | 文件描述的責任 |
|---|---|
| `src/discord-bridge.js` | Discord Gateway 入口、批次、agent handlers、控制台 |
| `src/dsh-client.js` | DSH Web API Client（Cookie、RPC、事件流） |
| `src/mcp-discord.js` | Discord 工具（發訊、讀訊息、reaction、投票等） |
| `src/core/discord-core.mjs` | 設定正規化、長文切段、Session mapping |
| `src/core/discord-agent.mjs` | token 解析、每輪額度、send guard |
| `src/core/discord-batch.mjs` | Batcher、回合佇列、指令排隊、hold/rebase、prompt 組裝 |
| `src/core/discord-typing.mjs` | mention 模式補句窗口 |
| `src/core/discord-context.mjs` | 頻道上下文 |
| `src/core/discord-activity.mjs` | 發言頻率 |
| `src/core/discord-memory.mjs` | 群友個人記憶 |
| `src/core/discord-notes.mjs` | 頻道筆記與每日摘要 |
| `src/core/discord-followup.mjs` | 回訪排程 |
| `src/core/discord-media.mjs` | 圖片、連結預覽及媒體處理 |
| `src/core/discord-sandbox.mjs` | Docker `run_script` 沙箱 |
| `src/core/discord-security.mjs` | 白名單、敏感詞等既有安全相關功能 |
| `src/core/discord-usage.mjs` | 用量統計 |

**路徑修正：** `discord-core.mjs` 位於 `src/core/discord-core.mjs`，不是 `src/discord-core.mjs`。請以目前 checkout 的 Folder Map / 實際檔案樹為準，不要沿用錯誤路徑。

### 5.3 Batcher / Turn Gate 的文件預設值

目前 Discord Guide 記載：

| 設定 | 文件預設值 | 行為 |
|---|---:|---|
| `batch.debounceMs` | 20,000 ms | 一般訊息合批等待；mention / reply 使用 8 秒短等待 |
| `batch.maxWaitMs` | 30,000 ms | 從第一則訊息起算的最大等待時間 |
| `batch.maxMessages` | 20 | 單一批次訊息上限 |
| typing extension | 10 秒 | 觸發者在該批次打字時延長等待 |
| `queue.max` | 50 | DSH 連線中斷時，每個 Session 最多排隊幾批 |
| `queue.retryMs` | 10,000 ms | DSH 恢復後重試間隔 |

這些是 dc-bridge 文件目前記載的參數，不是本專案已確定採用的參數。需要確認目前原始碼的行為、queue 的持久性、不同類型任務如何排序，以及是否存在單一 Session 同時一個模型回合的保證。

### 5.4 個人記憶

Discord Guide 記載：

- 個人記憶以 Discord User ID 歸屬。
- 每人預設最多 20 條 facts；注入上限預設 800 chars。
- 推測性資訊可在 30 天未再次確認後過期；使用者直接陳述的資訊不使用相同過期方式。
- 每輪最多寫入 3 次（記憶與刪除合計）。
- 記憶資料存在 `state/discord-memory.json`。
- `/memory` 查閱、`/forget` 刪除；私聊不寫入該群友記憶機制。

以上只是 dc-bridge 文件中的既有設計參考，不代表本專案必須完全採用。Codex 應檢查實作、資料 schema、資料來源追蹤、錯誤恢復、清除方式與 prompt 注入方式。

### 5.5 Channel Notes / Daily Summary

`src/core/discord-notes.mjs` 是目前文件列出的頻道筆記與每日摘要模組。文件記載 notes 可以保存頻道文字與每日摘要，且每日摘要會額外消耗 Token。

本專案需要確認：

- 訊息如何累積、去重、摘要與過期。
- 每日摘要是否為獨立背景 Session / Job。
- 摘要失敗時是否會保留原始訊息或舊摘要。
- 個人記憶與頻道筆記如何避免混寫。
- 如何防止錯誤 speaker attribution。
- 在 1 GB RAM 下如何限制摘要併發與上下文大小。

### 5.6 Media / Sandbox / 附加功能

dc-bridge 目前文件列出媒體處理、FFmpeg 縮圖、Docker Sandbox、follow-up、Discord tools、usage、emoji / memes / notes 等模組。

不要因功能多就先整批排除。每一項應記錄：

1. 本專案是否有需求。
2. DSH 是否已有同等能力。
3. dc-bridge 模組是否可沿用。
4. 引入的依賴與常駐成本。
5. 是否可改為低併發 subprocess 或更輕量實作。
6. 對 1C1G 的風險。

Docker Sandbox 是特別需要評估的項目：它可能需要 Docker daemon、映像檔及額外資源，不能假設現有部署環境可直接承擔。

---

## 6. DSH 原生 Discord Plugin：比較對象，不是預設方案

Repository：<https://github.com/tjiisztiuv/dsh-plugin-discord>

目前公開 Repository 顯示它是 DSH Discord bridge/plugin，支援透過 Discord 與 DSH Workspace Session 互動、工具審批及模型提問回覆。先前討論中提到它將 Discord Gateway 放在 DSH Host 的 Plugin 環境，並使用 DSH 的 Session / Workspace 相關服務。

這個專案應作為比較對象，評估：

- 它是否能成為 `dc-bridge` 外部程序架構的低成本替代或補充。
- 能否支援我們所需的 User Memory / Channel Notes / Batcher / Digest。
- Session／Thread 的 mapping 與生命週期。
- Plugin 在 DSH Host 內常駐的 RAM、CPU 與 fault isolation。
- Owner DM / Group context 差異能否在既有 preset/session model 下表達（只記錄介面，不預先設計 Policy Layer）。

不要只因為它是原生 Plugin 就認定更好；也不要只因為 dc-bridge 是主要參考就拒絕比較。

---

## 7. 目前的初步整合判斷

這些是目前工作假設，仍需在指定 commit 的原始碼中確認：

| 功能 | DSH 已有能力 | dc-bridge 參考價值 | 目前方向 |
|---|---|---|---|
| Agent Loop | 有 | 不應重寫 | 沿用 DSH |
| Agent create / resume / control | 有 | 提供 Bridge 使用方式參考 | 沿用 DSH API |
| Session event log / history | 有 | 不應重複保存 Agent 對話歷史 | 沿用 DSH |
| Session Model Selection | 有 | 有路由整合可參考 | 透過 DSH API 使用 |
| Tool Registry / execution | 有 | Discord tools 可評估 | 沿用 DSH Runtime，補足 Discord adapter |
| Discord Gateway | DSH Plugin 可能提供 | dc-bridge 已有主要實作 | 以 dc-bridge 為主參考 |
| Discord ↔ DSH Session mapping | 非 Discord 專用 | dc-bridge 有實作 | 沿用／適配其模式 |
| Batcher / Turn Gate | DSH 有 Session Inbox，但不等於 Discord batching | dc-bridge 有實作 | 優先審查並重用概念／程式 |
| Offline Queue | DSH 有 Inbox | dc-bridge 有 Bridge queue | 兩者分工，避免重複提交 |
| User Memory | 需確認 DSH 是否有可直接使用的合適服務 | dc-bridge 有實作 | 主要參考 dc-bridge |
| Channel Notes / Digest | DSH 有 Background Jobs 能力需確認 | dc-bridge 有實作 | 主要參考 dc-bridge，評估 DSH Jobs |
| Media | DSH / Provider 能力需盤點 | dc-bridge 有 Discord media 模組 | 保留 FFmpeg / FFprobe 需求 |
| Resource protection | DSH 有部分底層機制；整體負載仍需量測 | dc-bridge 有 queue / subprocess limits 等設計 | 需針對 1C1G 整合 |

---

## 8. Policy Layer 狀態：明確暫緩

**目前尚未開始討論 Policy Layer 的需求、責任範圍或實作。**

Codex 不得：

- 自行新增一個 `policy/`、`policy-layer/` 或同義抽象作為既定架構。
- 預設 Policy Layer 管理身分、工具權限、模型路由、訊息觸發、資源預算或上下文。
- 將 dc-bridge 現有 whitelist、Owner IDs、preset、tool availability 等機制自動歸納成我們已決定的 Policy Layer。
- 因為 Owner DM Coding 是需求，就直接設計完整 Agent/Session 權限矩陣。

目前只允許在原始碼盤點階段：

- 記錄既有的權限、preset、authorization、whitelist、owner check、tool scope 等機制。
- 指出哪些地方在 DSH、dc-bridge 或 plugin 中實際執行。
- 記錄介面、資料流與限制。
- 等使用者開始討論 Policy Layer 後，再做架構設計。

---

## 9. MVP / 開發切分：MVP 1 與 MVP 2 可並行

先前提出的 MVP 1 / MVP 2 並非必須嚴格串行。使用者認為整合基礎與上下文功能可以同時推進；目前方向也同意採用兩個工作軸並行，但先要確認共用資料介面。

### Workstream A — Discord / DSH Integration

- Discord Gateway / event intake / event output。
- Session mapping（Guild / Channel / DM / User 相關 ID）。
- DSH Client / RPC / WebSocket event stream。
- Batcher / Turn Gate / queue coordination。
- Flash / Flagship 的 Session model selection。
- Reconnect、retry、cancel、restart recovery。

### Workstream B — Context / Memory

- Channel Context。
- User Memory。
- Channel Notes。
- Daily Summary / Digest。
- 記憶與摘要資料來源追蹤、刪除、TTL、去重。
- `/memory`、`/forget` 等互動需求。

### 並行前提

先定義最小共用資料介面，至少包含：

- Discord `guildId`（可能為 DM 空值／無 Guild）。
- `channelId`。
- `messageId`。
- `authorId`。
- `sessionId`。
- 收到／提交／完成時間與事件來源。
- 訊息批次 ID 或 request identity（實際 schema 需審查）。

此列表只是資料盤點起點，不是已核准的 schema。Codex 應先讀 dc-bridge 的 `discord-core.mjs` / `discord-batch.mjs` 與 DSH Session API，再提出最小必要 schema。

### Integration / Resource Validation

不必等所有功能完成才開始測試。應在 A、B 並行時逐步加入：

- 訊息事件到 Session Prompt 的端到端測試。
- Session mapping restart test。
- Queue 重試與重複提交測試。
- Digest 與正常對話同時運行。
- User Memory 的作者歸屬與資料刪除測試。
- 資源使用量測。

---

## 10. 已知風險與必須驗證的問題

### 10.1 DSH / dc-bridge 版本與 API drift

- DSH 公開 API 是 pre-stable，需固定 commit / release。
- dc-bridge `dsh-client.js` 有協定相容註解，記錄過 RPC 名稱、payload envelope、Cookie 與事件流協定演進。
- 不要只照註解中的舊版協定實作；要對照本次固定的 DSH commit。
- 每個 API call 都要核對 endpoint、payload shape、request identity、回應語意、錯誤格式與 reconnect behavior。

### 10.2 Event Follow / Reconnect

- DSH Session Controller 有 follow / event / projection 類能力。
- dc-bridge `dsh-client.js` 使用 `/api/remote.mux` 管理事件流與 Session Follow。
- 需要檢查：是否有 event cursor / sequence resume、Snapshot baseline、duplicate settlement handling、unknown stream、gap repair、reconnect 重訂閱及 race condition。
- 重新訂閱成功不等於斷線期間所有狀態都安全恢復；必須實測。

### 10.3 Queue / at-least-once vs exactly-once

- DSH prompt acceptance 不代表已完成。
- Bridge 可能在「提交成功但尚未收到確認」時斷線，這是可能重複提交的關鍵窗口。
- 需要檢查 DSH request identity 是否能讓 retry 去重、Bridge queue 如何標記 accepted / pending / completed。
- 不要宣稱 exactly-once，除非有清楚的端到端協定及測試證明。

### 10.4 Session 與 DM / Group mapping

- DM 與 Guild Channel 的 Session mapping 需分開釐清。
- 不同使用者的 DM 不可誤用 Owner Session。
- Group Thread Session 是否共用、如何分層、是否保留 speaker attribution，需跟隨原始碼確認。
- 先盤點現況，不要先設計 Policy Layer。

### 10.5 1C1G 資源風險

- DSH Host + 獨立 Node Bridge 是至少兩個常駐程序。
- Digest、媒體、Coding、子程序可能同時競爭記憶體與 CPU。
- Docker daemon / image cache 可能不適合此資源規模。
- SQLite 可避免額外 DB 服務，但不代表 Bridge 本身記憶體使用量低。
- 必須量測峰值而非只估常態。

---

## 11. 原始碼審查進度

### 11.1 已做的公開文件與來源核對（截至 2026-11-12）

- [x] 確認 dc-bridge 是 Discord ↔ DSH Bridge 專案，且 Discord 線有獨立入口。
- [x] 確認 Discord Guide 描述 `discord.js` 14 Gateway、`src/discord-bridge.js`、`src/dsh-client.js` 與 DSH Web API 的整合方式。
- [x] 確認 `docs/FOLDER_MAP.md` 列出 Discord 專用 `src/core/` 模組。
- [x] 確認 Batcher 文件預設值：20 秒 debounce、mention/reply 8 秒、30 秒 max wait、20 則 max messages、10 秒 typing extension。
- [x] 確認文件有記載 DSH Offline Queue 上限 50、retry interval 10 秒。
- [x] 確認 DSH 官方 Agent API、Session Controller、Session architecture 文件中有 Agent / Session / Model selection / Event Follow 等能力。
- [x] 確認 DSH Agent Initiator attribution 為 process-local，不能當跨 process / restart identity。
- [x] 確認 `dsh-plugin-discord` 是可比較的原生 Plugin 專案。

### 11.2 已初步讀取，但尚未完成逐行審查

- [ ] `dc-bridge/src/dsh-client.js`：約 1,072 lines / 49.2 KB（GitHub 頁面顯示值；以 checkout 為準）。
- [ ] `dc-bridge/src/discord-bridge.js`：GitHub 頁面顯示約 6,838 lines / 326 KB（以 checkout 為準）。
- [ ] `dc-bridge/src/core/discord-core.mjs`。
- [ ] `dc-bridge/src/core/discord-batch.mjs`。
- [ ] `dc-bridge/src/core/discord-context.mjs`。
- [ ] `dc-bridge/src/core/discord-memory.mjs`。
- [ ] `dc-bridge/src/core/discord-notes.mjs`。
- [ ] DSH `packages/core/agent/` 與 `packages/api/session-controller/` 實際 TypeScript implementation / tests。
- [ ] `dsh-plugin-discord` 的 Session / Workspace / event / permission integration。

### 11.3 尚未執行

- [ ] 未在目標 VPS 部署。
- [ ] 未執行 1 vCPU / 1 GB RAM 壓力測試。
- [ ] 未完成 FFmpeg / FFprobe 端到端測試。
- [ ] 未驗證斷線與重啟時是否漏訊／重複訊息。
- [ ] 未驗證 Discord 實際群組行為與 7–8 名活躍使用者負載。
- [ ] 未決定 Bridge 獨立程序 vs DSH Plugin 的最終拓樸。
- [ ] 未開始 Policy Layer 討論。

---

## 12. Codex 接手工作順序

### Step 1 — 固定來源與環境

1. Clone 或確認本地 DSH、dc-bridge、dsh-plugin-discord checkout。
2. 記錄 repo URL、branch、commit SHA、tag、working tree status。
3. 記錄 Node.js、package manager、lockfile、OS 版本。
4. 讀取各 repo 的 `AGENTS.md`、`CONTRIBUTING`、`package.json`、lockfile、測試指令及建置腳本。
5. 不要先更新依賴或大規模重構。

### Step 2 — 完成 DSH API source audit

優先審查：

- Agent create / resume / dispose / followup / steer / inject / cancel / whenIdle。
- Session Controller create / prompt / selectModel / updateQueue / cancel / events / follow / projections。
- Prompt request identity / acceptance / idempotency semantics。
- Session persistence / event sequence / recovery。
- Background Jobs API 與 plugin registration lifecycle。

輸出：每個 API 的實際 TypeScript type、source path、caller、錯誤行為及測試位置。

### Step 3 — 完成 dc-bridge DSH Client source audit

從 `src/dsh-client.js` 追蹤：

- Auth / cookie minting / token exchange。
- RPC transport、payload envelope、requestId。
- `remote.mux` websocket lifecycle。
- Session Follow open / close / resubscribe。
- Snapshot / event / projection parsing。
- Event sequence、cursor、gap repair。
- reconnect、401、network timeout、DSH restart。
- queue status read、abort signal、resource cleanup。

請用實際函式及行號（或 GitHub permalink）支撐結論，不能只摘要註解。

### Step 4 — 完成端到端 Discord message flow

沿著以下路徑追蹤，列出每個 function / module / state transition：

```text
Discord message event
  → filtering / classification
  → Guild / Channel / DM identity
  → Session mapping
  → context gathering
  → Batcher / Turn Gate
  → prompt construction
  → DSH session/prompt
  → DSH follow / event stream
  → turn / tool / question / approval handling
  → Discord message output
  → delivery acknowledgement / state cleanup
```

同時追蹤：

- mention、reply、普通聊天、DM 的不同路徑。
- message author / message ID 是否一路保留。
- Discord 發送失敗是否能重試而不重複貼文。
- Bridge restart 時 Session mapping、queue、pending question / approval、event follow 如何恢復。

### Step 5 — 審查記憶與 Digest 模組

依序審查：

- `discord-context.mjs`
- `discord-memory.mjs`
- `discord-notes.mjs`
- 相關 persistence / storage helper
- Background job / scheduler 整合

產出 User Memory 與 Channel Notes 的資料 schema、TTL、dedup、source attribution、injection point、read / delete behavior、token cost 與 failure recovery。

### Step 6 — 再評估 Plugin / External Bridge 取捨

根據已查證的資料比較：

- dc-bridge external Bridge 模式。
- DSH native Discord Plugin 模式。

比較項目：開發重用度、常駐 RAM、CPU、故障隔離、Gateway lifecycle、Session mapping、背景任務、記憶功能、API 相容性、部署／更新維護成本。

在比較完成前不要做拓樸定案，也不要先建獨立 Agent Runtime。

---

## 13. 每輪審查必須交付的格式

每次 Codex 完成一個模組的審查，請更新一份 audit note，至少包括：

1. **Scope**：審查哪些檔案及 commit。
2. **Current behavior**：實際資料流與狀態轉換。
3. **Evidence**：source path + symbol + line range，最好附 GitHub commit permalink。
4. **DSH capability overlap**：DSH 是否已有同等能力。
5. **dc-bridge reuse assessment**：直接沿用／適配／重寫／不採用，並解釋理由。
6. **Resource implications**：常駐服務、程序、CPU/RAM、併發、磁碟及 Token 成本。
7. **Failure cases**：timeout、reconnect、retry、restart、partial failure。
8. **Open questions**：不能從來源判斷的地方。
9. **Tests**：既有測試與建議補充的測試。
10. **Decision status**：source-confirmed / doc-confirmed / needs-test / decision pending。

不要只產出抽象架構圖或高階建議。此階段的價值是把實際程式與介面對起來。

---

## 14. 目前不允許 Codex 擅自做的事

- 不要開始大規模實作，除非使用者明確要求從審查轉入實作。
- 不要自行改寫 dc-bridge，不要把專案描述為「取代 dc-bridge」。
- 不要以「簡化 MVP」為由先刪除 dc-bridge 的功能；先盤點其需求、成本與替代方案。
- 不要重寫 DSH 已有的 Agent Loop、Session Log、Tool Runtime、Model Provider 或 Background Job 能力。
- 不要先做 Policy Layer，也不要猜測其責任邊界。
- 不要建立不必要的第二套 Agent Runtime / Task Runtime / Tool Runtime。
- 不要在沒有測試證據時宣稱 exactly-once、無訊息遺失、可無限擴展或 1 GB RAM 足夠。
- 不要將 process-local initiator 當成跨程序／重啟後的身份依據。
- 不要只看 README 就估算 RSS 或 CPU。
- 不要把模型價格、模型名稱、Token 月預算或 API 穩定性用未查證資料寫死。
- 不要在未確認 DSH / dc-bridge 相容性前升級主要依賴。

---

## 15. 初步驗收方向（尚非最終 Acceptance Criteria）

以下是未來整合測試應覆蓋的面向，不代表所有細節已經核准：

### Message / Session

- Discord 接受的訊息不會因 Bridge / DSH 斷線而無聲消失。
- retry 不應造成重複 prompt 或重複 Discord 回覆；需要明確 request identity / delivery semantics。
- 不同 Discord Channel / DM 的 Session 不會錯誤混用。
- Bridge / DSH 重啟後能恢復 mapping、必要的 queue 與事件訂閱。

### Context / Memory

- 個人記憶正確歸屬 Discord User ID。
- Channel Notes 只代表該頻道／群組脈絡，不會混入錯誤使用者個人資料。
- 能追蹤記憶來源、讀取及刪除。
- Digest 與即時對話併行時，不會阻塞正常訊息。

### Model / Tools

- Flash 預設路由正常。
- Flagship 升級是透過 DSH 支援的 Session Model Selection，不在已準備的 Step 中途切換。
- Owner-only Coding 的需求須保留，但完整授權設計等待 Policy Layer 討論；在那之前不得宣稱權限隔離已完成。

### Resources

- 在目標 1C1G 設定下執行一般聊天室與摘要併發測試。
- 測試尖峰 RSS、CPU、Swap、queue growth、child processes。
- FFmpeg / FFprobe 有 timeout、併發限制、輸出限制及清理機制。
- Background job / 子程序失敗不會讓 Bridge / DSH 永久卡死。

---

## 16. 參考來源

以下是 2026-11-12 公開來源核對時使用的網址。Codex 應在 checkout 後以實際 commit permalink 取代或補充 `main` / `master` URL。

### DSH

- Repository：<https://github.com/deepseek-ai/deepseek-harness>
- Agent API：<https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/README.md>
- Session Controller：<https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/session-controller/README.md>
- Architecture：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md>
- Core subsystem：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md>
- Session subsystem：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md>
- AGENTS.md（Repo 指引及 pre-stable API 注意事項）：<https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md>

### dc-bridge

- Repository：<https://github.com/konnokai/dc-bridge>
- Discord Guide：<https://github.com/konnokai/dc-bridge/blob/main/docs/guides/DISCORD.md>
- Folder Map：<https://github.com/konnokai/dc-bridge/blob/main/docs/FOLDER_MAP.md>
- DSH Client：<https://github.com/konnokai/dc-bridge/blob/main/src/dsh-client.js>
- Discord Bridge：<https://github.com/konnokai/dc-bridge/blob/main/src/discord-bridge.js>
- Discord Core：<https://github.com/konnokai/dc-bridge/blob/main/src/core/discord-core.mjs>
- Discord Batch：<https://github.com/konnokai/dc-bridge/blob/main/src/core/discord-batch.mjs>
- Discord Context：<https://github.com/konnokai/dc-bridge/blob/main/src/core/discord-context.mjs>
- Discord Memory：<https://github.com/konnokai/dc-bridge/blob/main/src/core/discord-memory.mjs>
- Discord Notes：<https://github.com/konnokai/dc-bridge/blob/main/src/core/discord-notes.mjs>

### Alternative Plugin reference

- DSH Discord Plugin：<https://github.com/tjiisztiuv/dsh-plugin-discord>

---

## 17. Handover 的最終提醒

目前工作階段是**原始碼盤點與整合可行性評估**，不是已進入正式開發。

最重要的原則只有四個：

1. **DSH 做核心，Bridge 做 Discord 與上下文整合。**
2. **dc-bridge 是主要實作參考；不要預先刪功能，也不要把它當成要被取代的產品。**
3. **MVP 1 / MVP 2 的整合與上下文工作可以並行，但先確認共用資料介面及 DSH API。**
4. **Policy Layer 尚未討論，保持暫緩。**

下一個最有價值的工作，是固定 Repository commit 後，完成 `dsh-client.js` 與 DSH Session Controller 的逐行對照，再從 `discord-bridge.js` 追完整的 Discord-to-DSH end-to-end message flow。
