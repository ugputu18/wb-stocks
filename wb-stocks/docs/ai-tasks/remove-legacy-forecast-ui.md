# Удаление legacy forecast UI (`/legacy`)

## Что сделано

Полностью удалён старый vanilla-экран forecast UI, который раньше отдавался по
**`/legacy`** (и его статика по **`/static/*`**). Этот экран был оставлен как
fallback / reference после миграции на Preact SPA, но больше не использовался
для работы — все сценарии живут в основном UI на **`/`** и кастомных SPA-путях
(`/redistribution`, `/regional-stocks`, `/warehouse-region-audit`,
`/regional-demand-diagnostics`).

## Удалённые артефакты

- Каталог `wb-stocks/public/forecast-ui/`:
  - `index.html`, `app.js`, `styles.css` — сам legacy-экран и его статика.
- Маршруты HTTP-сервера в `wb-stocks/src/server/forecast-ui/handlers/spaStaticRoutes.ts`:
  - `GET /legacy` и `GET /legacy/` → `public/forecast-ui/index.html`.
  - `GET /static/*` — раздача legacy-статики (`styles.css`, `app.js`).
- Константа `STATIC_DIR` в `wb-stocks/src/server/forecast-ui/staticPaths.ts`
  (указывала на `public/forecast-ui`). Остался только `STATIC_DIR_NEXT`
  (`public/forecast-ui-next`, сборка Vite/Preact).
- Поле `static: STATIC_DIR` в стартовом логе `startForecastUiServer`
  (`wb-stocks/src/server/forecastUiServer.ts`).
- Ссылка «Старый экран (reference): `/legacy`» в шапке Preact-приложения
  (`wb-stocks/forecast-ui-client/src/App.tsx`).
- Кейс `isKnownForecastRoute("/legacy") === false` в
  `wb-stocks/test/forecastUiRoutes.test.ts` — больше не релевантен, так как
  `/legacy` не существует как маршрут вообще.
- Упоминания `/legacy`, «legacy UI», `public/forecast-ui/styles.css` и т.п. в
  документации (`docs/forecast-ui.md`, `ReadmeAI.md`) и в комментарии заголовка
  `forecast-ui-client/src/forecast-ui-theme.css`.

Маршрут редиректа **`/next` → `/`** и раздача SPA-ассетов под **`/next/*`**
сохранены — они относятся к Preact-сборке, а не к legacy-экрану.

## Ключевые решения

- `STATIC_DIR_NEXT` оставлен как есть (Preact-сборка живёт там же,
  `public/forecast-ui-next/`).
- Порядок маршрутов в `createSpaStaticRoutes()` сохранён по отношению к
  оставшимся записям; убраны только два блока (`/legacy` и `/static/*`).
- В `App.tsx` удалена только ссылка на `/legacy`; остальная шапка и навигация
  по SPA не трогалась.
- Комментарии в коде, где «legacy» означает «как было в старом `app.js` /
  серверной обработке» (например, `client.ts` про CSV, `urlState.ts`,
  `forecastFormat.ts`), оставлены — это исторический контекст для конкретной
  логики, а не признак, что код больше не нужен.

## Как проверить

В каталоге `wb-stocks`:

```bash
pnpm build:forecast-ui-client
pnpm serve:forecast-ui
```

- `http://127.0.0.1:3847/` — открывается Preact SPA (как раньше).
- `http://127.0.0.1:3847/legacy` — теперь возвращает `404 Not found`
  (JSON ответ forecast UI сервера), как и любые запросы под `/static/*`.
- Существующие SPA-маршруты (`/redistribution`, `/regional-stocks`,
  `/warehouse-region-audit`, `/regional-demand-diagnostics`) и
  редирект `/next` → `/` продолжают работать.

Тесты:

```bash
pnpm test --filter ./test/forecastUiRoutes.test.ts
```

(или общая `pnpm test`) — кейсы `isKnownForecastRoute` обновлены, проверка
`/legacy` удалена.
