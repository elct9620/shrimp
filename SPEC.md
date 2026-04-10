# Shrimp

超微型背景代理人（Ultra-minimal background agent），以 Event-Driven 方式自動處理 Todoist 任務。

## 目的（Purpose）

Shrimp 讓 Todoist 任務清單在無人監督的情況下持續被推進：每次被 Heartbeat 喚醒時，挑選最優先的任務，交由 AI Agent 執行，並回報進度至任務留言。

## 使用者（Users）

使用者（開發者 / 個人用戶）：部署 Shrimp 實例、設定 Todoist Board 和 AI Provider，讓背景任務自動被處理。

## 成功標準（Success Criteria）

| 標準 | 通過條件 |
|------|----------|
| Heartbeat 觸發任務選取 | 呼叫 `/heartbeat` 後，代理人選出一項任務並開始執行 |
| 優先度正確 | 有 In Progress 任務時，優先繼續處理；否則從 Backlog 取新任務 |
| 進度回報 | 代理人在任務上留言說明目前狀態 |
| 任務完成 | 代理人判斷任務完成後，更新任務狀態至 Done |
| Health Check | `/health` 回傳正常，Docker 容器保持 healthy |

## 非目標（Non-goals）

- 不支援同時並行處理多項任務
- 不提供 Web UI 或儀表板
- 不管理 Todoist Project 結構（僅讀取指定 Board）
- 不支援跨 Board 或多 Board 整合
