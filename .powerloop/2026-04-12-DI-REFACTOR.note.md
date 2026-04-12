---
goal: |
  使用 /refactor 將缺失的 tsyringe 依賴加回來。
  限制：
  (1) Entity / Use Case 不引入 @inject，必須在外層（Composition Root / adapter）組裝好依賴後再呼叫 Use Case
  (2) 測試環境使用 setup 機制統一引入 reflect-metadata，禁止在個別檔案內重複 import
  (3) 引入 DI 後預期整體複雜度應下降；若某處改動反而讓程式更複雜，應回頭檢討設計而非強行套用
current_phase: completed
started_at: 2026-04-12T00:00:00+08:00
interval: 10m
cron_id: cf73193c
execute_skills: /refactor → /review → /refactor → /git:commit
review_skills: /review → /refactor → /git:commit
sample_passes: 5/5
review_cycles: 5
---

# DI-REFACTOR — 引入 tsyringe DI 容器

## Context Snapshot（2026-04-12）

- `tsyringe` / `reflect-metadata` 目前**皆未**存在於 `package.json`
- `src/container.ts` 為純手動組裝的 `composeApp()`，11 個編號步驟順序建構
- `tsconfig.json` 未啟用 `experimentalDecorators` / `emitDecoratorMetadata`
- 沒有 vitest setup 檔；`vitest.config.ts` 僅設定 `include`
- Entity：`src/entities/*`（Task、Comment、Priority、Section、task-selector）無外部依賴
- Use Case：`src/use-cases/processing-cycle.ts`、`prompt-assembler.ts`、`ports/*`，皆為純類別或函式
- Infrastructure 類別（皆為 constructor injection）：
  - `PinoLogger`（`infrastructure/logger/pino-logger.ts`，工廠 `createPinoLogger` 同時回傳 `LoggerPort` 與底層 `pino.Logger`）
  - `TodoistClient`、`TodoistBoardRepository`
  - `AiSdkMainAgent`
  - `McpToolLoader`（工廠可注入）
  - `InMemoryTaskQueue`
- Adapter：
  - `ToolRegistry`（constructor 接收 input bundle + logger）
  - Built-in tools 為 factory function（`createGetTasksTool` 等），不需要變成類別
  - HTTP routes 為 `createHealthRoute` / `createHeartbeatRoute` factory
- Tests 5199 行，`tests/container.test.ts` 依賴 `composeApp(overrides)` 的介面

## Design Decisions

1. **DI 容器放置位置**：保留 `src/container.ts` 為 Composition Root，內部用 tsyringe `container` 管理 infrastructure/adapter，Use Case 與 HTTP route 在 root 手動 `new` 並傳入 `container.resolve(...)` 結果。
2. **Port → Token 對應**：新增 `src/infrastructure/container/tokens.ts`，用 `Symbol` 作為 `LoggerPort`、`BoardRepository`、`MainAgent`、`TaskQueue`、`ToolProvider`、`LanguageModel`、`EnvConfig`、`McpConfig` 的 token。
3. **Value providers**：`EnvConfig`、`LanguageModel`、`LoggerPort`（由 `createPinoLogger` 產生）、`McpConfig` 使用 `container.register(TOKEN, { useValue })`。
4. **Decorator 僅套在 Infrastructure/Adapter 類別**：`InMemoryTaskQueue`、`McpToolLoader`、`AiSdkMainAgent`。`TodoistClient`、`TodoistBoardRepository`、`ToolRegistry` 採 Option C（見 Decision 10 / 11），不套裝飾子。
5. **Entity / Use Case 零污染**：禁止 `@injectable` / `@inject`，禁止從 `tsyringe` import。
6. **reflect-metadata 集中引入**：
   - Runtime：只在 `src/server.ts` 最頂端 `import 'reflect-metadata'`
   - Tests：新增 `tests/setup.ts`（內容僅 `import 'reflect-metadata'`），在 `vitest.config.ts` 加入 `setupFiles`
7. **tsconfig**：啟用 `experimentalDecorators` 與 `emitDecoratorMetadata`。tsdown 已使用 rolldown — 視情況在 `tsdown.config.ts` 調整。
8. **Overrides 相容性**：`composeApp(overrides)` 介面保留，改以「在 resolve 之前先 `container.register` 或 `container.registerInstance` override 的 token」實作。
9. **複雜度下降驗證**：以 `container.ts` 的 LOC 與「新增一個 infrastructure 元件所需修改行數」為粗指標；若 DI 版本反而上升，需回頭重新思考結構。
10. **TodoistClient / TodoistBoardRepository — Option C（useFactory，零裝飾子）**：兩個類別皆含 scalar config deps（`baseUrl: string`、`token: string`、`projectId: string`），這類 scalar 依賴不適合 tsyringe 的 symbol-token auto-resolution。
    - Option A（scalar value tokens + `@inject`）：+6 LOC `tokens.ts`、+6 LOC composeApp 的 register、+16 LOC 兩個類別的 `@injectable` + `@inject` 裝飾，合計 ~28 LOC；類別與容器耦合、增加 ceremony。
    - Option B（`@injectable` + `useFactory`）：裝飾子形同裝飾，factory 仍不可免；~16 LOC，無實質收益。
    - Option C（純 `useFactory`，無裝飾）：類別零修改；composeApp 只增 ~12 LOC（兩個 `useFactory` 各 ~6 行）；`new TodoistClient(...)` 直接 testable，不需容器；符合「DI 應降低複雜度」原則。
    - **結論：採 Option C。本 item 無程式碼修改；`useFactory` 接線延後至 item 6 的 composeApp 改寫。**
11. **ToolRegistry — Option C（useFactory，零裝飾子）**：`ToolRegistry` 的 `input` 是一個 async-loaded bundle（`mcpTools` / `mcpDescriptions` 需等 `McpToolLoader.load()` 完成），且 `builtInTools` / `builtInDescriptions` 由 `BoardRepository` + logger 動態產生。此類 "bundle" 依賴和 scalar deps 一樣不適合 tsyringe auto-resolution。
    - Option A（`TOKENS.ToolRegistryInput` + `@inject`）：+2 LOC `tokens.ts`（新 symbol + TokenRegistry entry）、+4 LOC `tool-registry.ts`（`@injectable` + `@inject` ×2）、+~8 LOC composeApp（`container.register(TOKENS.ToolRegistryInput, { useValue })` 非同步段落）；合計 ~14 LOC，但仍需 composeApp 裡的 async build 邏輯，container 只是多一層轉接，零收益。`ToolRegistry` 變成 container-coupled，`new ToolRegistry(input, logger)` 測試寫法仍可行但需注意 metadata。
    - Option B（`@injectable` + `useFactory`）：裝飾子形同裝飾，`useFactory` 仍須在 composeApp 內組裝 bundle；~4 LOC 增加但無任何 complexity 減少。
    - Option C（純 `useFactory`，無裝飾）：`tool-registry.ts` 零修改；composeApp 新增約 ~8 LOC（async bundle build + `container.register({ useFactory })`）；`new ToolRegistry(input, logger)` 對 `tool-registry.test.ts` 完全透明，無容器耦合；LOC delta 最小。
    - LOC comparison（tokens.ts / tool-registry.ts / composeApp delta）：A ≈ +2 / +4 / +8 = 14；B ≈ 0 / +4 / +8 = 12；C ≈ 0 / 0 / +8 = 8。Option C 以最少改動完成任務，符合 constraint (3) 複雜度下降原則。
    - **結論：採 Option C。本 item 無程式碼修改；`useFactory` 接線延後至 item 6 的 composeApp 改寫。**
12. **Agent Tool 組裝走 Factory Method pattern（社群慣例）**：
    - 用戶指示：偏好 useFactory 或 Factory Method 從 DI 取得依賴再組裝；設計參考社群慣例（tsyringe/Inversify/NestJS `useFactory`、GoF Factory Method）而非自創 pattern。
    - 動機：Agent tool 可能保存 session-based 暫時狀態，因此每次 ProcessingCycle 應取得全新 tool set 而非共用。
    - 實作方向：
      - 建立 `BuiltInToolFactory`（@injectable adapter，@inject BoardRepository + Logger；expose `create(): { tools, descriptions }`）
      - 建立 `ToolProviderFactory` port interface（`src/use-cases/ports/tool-provider-factory.ts`，純 interface，不 import tsyringe），定義 `create(): ToolProvider`
      - 實作 `ToolProviderFactoryImpl`（@injectable adapter，constructor 接 `BuiltInToolFactory` + MCP 預載結果；`create()` 每次呼叫 `BuiltInToolFactory.create()` 組新 ToolProvider）
      - `ProcessingCycle` 改收 `ToolProviderFactory` port（不是 `ToolProvider`），在 `run()` 內呼叫 `factory.create()`
    - MCP tools：startup-once 載入，存在 ToolProviderFactoryImpl；built-in tools：per-cycle fresh（透過 BuiltInToolFactory.create()）
    - Session 參數：目前 `create()` 不帶 session arg（YAGNI），日後需要時再擴充
13. **移除 `composeApp` wrapper，改用 tsyringe root container**：
    - tsyringe 已有 singleton root container，`composeApp` 等於在 container 外再套一層 factory，不符合社群慣例。
    - 同步 provider（env、logger、language model、class registrations）在 `src/container.ts` 模組層直接註冊到 root container。
    - 非同步行為（MCP 載入）採 Factory Method 注入：註冊一個 async bootstrap factory 或在 `server.ts` main() 內 await 後 registerInstance 結果。用戶確認此做法可接受。
    - `server.ts` 的 `main()` 做 bootstrap：resolve 所需元件（Hono app、mcpToolLoader for shutdown、logger）。
    - `ComposeOverrides` / `ComposedApp` 型別移除；測試改用 `container.createChildContainer()` + `registerInstance` 做 override。
    - Hono app 組裝（routes + middleware）可抽為一個 `createApp()` utility 或放在 adapter 層。

## Progress Table

| # | Item | Execute | Review | Sample | Notes |
|---|------|---------|--------|--------|-------|
| 1 | 加入 tsyringe + reflect-metadata 基礎設施 | done | done | pending | tsyringe 4.10.0 + reflect-metadata 0.2.2；tsdown/rolldown 無需額外設定即可處理 emitDecoratorMetadata；commit 09b26ad |
| 2 | 定義 DI tokens (Symbol.for + TokenRegistry) | done | done | pending | commit 226de5c；未替具象類別建立 symbol，符合 tsyringe 慣例 |
| 3 | TodoistClient/TodoistBoardRepository → useFactory 設計決策 | done | done | pending | 採 Option C：無裝飾子、無程式碼修改；`useFactory` 接線延後至 item 7；理由見 Decision 10 |
| 4 | 為 `InMemoryTaskQueue`、`McpToolLoader`、`AiSdkMainAgent` 加上 `@injectable()` 與 `@inject(LOGGER)`；`AiSdkMainAgent` 的 `model` 以 `@inject(LANGUAGE_MODEL)` 取得。 | done | done | pending | commit ae77b95；`McpToolLoader.factory` 保留 default |
| 5 | 評估 `ToolRegistry` 的 DI 策略：`input` 為 async-loaded bundle，無法 auto-resolve；判斷 `@injectable` + value token 或 `useFactory` 哪個真正降低複雜度；在 Design Decisions 記錄結論。 | done | done | pending | 採 Option C；理由見 Decision 11 |
| 6 | 引入 Factory Method 模式：(a) `BuiltInToolFactory`（@injectable adapter），(b) `ToolProviderFactory` port（use-cases/ports/），(c) `ToolProviderFactoryImpl`（plain adapter），(d) `ProcessingCycle` 改收 `ToolProviderFactory`，(e) `TOKENS.ToolProviderFactory` 取代 `TOKENS.ToolProvider`。 | done | done | pending | commit fdd241c；container.ts 有暫時 bridge `{ create: () => toolProvider }`；item 7 須替換為正式 DI 註冊；processing-cycle.test.ts 有對應 bridge，item 8 更新 |
| 7 | 重寫 `src/container.ts` 的 `composeApp`：tsyringe child container 隔離每次 compose；env/logger/model 以 registerInstance 註冊；scalar-dep 類別以 useFactory 註冊；overrides 在 factory 內 fallback 處理。LOC 191→187。 | done | done | pending | commit 34c7bcc；BuiltInToolFactory auto-resolve + ToolProviderFactoryImpl useFactory；override 走 factory closure 非 post-register |
| 8 | 更新 `tests/use-cases/processing-cycle.test.ts`（mock ToolProviderFactory 取代 ToolProvider）；新增 `tests/adapters/tools/tool-provider-factory-impl.test.ts`（4 tests）。 | done | done | pending | commit 35f2a15；301→305 tests；BuiltInToolFactory 太薄不另測 |
| 9 | 移除 `composeApp`：module-level factory registrations + `bootstrap()` async 初始化 + `server.ts` 直接 resolve。`ComposedApp` / `ComposeOverrides` 移除。 | done | done | pending | commit 16404a2；container.ts 145 LOC（-42）；server.ts 65 LOC；FactoryProvider 不支援 Lifecycle.Singleton，靠 production 只 resolve 一次保證 singleton；7 test failures（預期：container.test.ts 引用 composeApp） |
| 10 | 重寫 `tests/container.test.ts`：child container + registerInstance override；抽取 `src/adapters/http/app.ts` createApp()；`server.ts` 改用 createApp。7 old tests → 6 new tests，全綠。 | done | done | pending | commit 96f4ac2；304 tests pass；discovery: pino-http 需 real pino instance 不能 vi.fn() mock；`'PinoInstance'` string token 應改 Symbol（item 11 清理） |
| 11 | 最終掃描 + cleanup：`TOKENS.PinoInstance` Symbol.for 修正 + 所有 grep gates 通過 + typecheck/test/build 全綠。container.ts + server.ts 合計 196 LOC（pre-DI ~220，-11%）。 | done | done | pending | commit 1e7ebcb；304 tests / 22 files；30.78 kB bundle |
| 12 | 引入 MSW 模擬 Todoist API：移除 mock BoardRepository，改由真實 useFactory（TodoistClient → TodoistBoardRepository）走 DI 解析 + MSW 攔截 HTTP。 | done | done | pending |
| 13 | 移除 3 個不必要的 useFactory：logger.child() 移入 class constructor，改 useClass auto-resolve。container.ts 151→132 LOC（-19）。 | done | done | pending | Review 發現：mock 粒度過高跳過 useFactory wiring 驗證；用戶指示必須下推到外部 API 呼叫 |

## Completeness Check

- [x] DI 容器本體（tsyringe）依賴加入 → item 1
- [x] reflect-metadata 集中化（runtime + test） → item 1
- [x] tsconfig decorators → item 1
- [x] Token 定義 → item 2
- [x] Infrastructure 類別 @injectable → items 3, 4, 5
- [x] Factory Method pattern for tools → item 6 (Decision 12)
- [x] Composition Root 改寫 → item 7 (composeApp 暫行版)
- [x] 移除 composeApp → item 9 (改用 root container + server.ts bootstrap)
- [x] Use Case / Entity 零污染驗證 → item 11
- [x] 測試改用 child container → item 10
- [x] 複雜度下降驗證 → items 9, 11

Plan 覆蓋目標（含 composeApp 移除），繼續 execute 階段。
