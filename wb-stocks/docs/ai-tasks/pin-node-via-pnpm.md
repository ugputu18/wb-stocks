# Pin Node.js версии через `pnpm` (а не только `nvm`)

## Проблема

`pnpm test` (и любой `pnpm run …`) периодически валился с ошибкой:

```
Error: The module '.../better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 127. This version of Node.js requires
NODE_MODULE_VERSION 108. Please try re-compiling or re-installing
the module (for instance, using `npm rebuild` or `npm install`).
```

Причина — рассинхрон между:

- системным `node` на `PATH` (на macOS обычно Homebrew, **v18.x** = NODE_MODULE_VERSION 108);
- Node-ом, под который собран нативный модуль `better-sqlite3` при последнем
  `pnpm install` из терминала с активным `nvm` (`.nvmrc=22` → Node 22.x =
  NODE_MODULE_VERSION 127).

`.nvmrc` помогает только если пользователь руками сделал `nvm use` в текущей
сессии. Любой другой shell (cron, deploy, ассистент, CI без `actions/setup-node`)
запускает скрипты под системным node и падает.

## Решение: `use-node-version` в `.npmrc`

`pnpm` умеет сам качать и использовать нужный Node для всех своих команд через
настройку `use-node-version` в `.npmrc` ([pnpm docs](https://pnpm.io/settings#use-node-version)):

> Specifies which exact Node.js version should be used for the project's
> runtime. pnpm will automatically install the specified version of Node.js
> and use it for running `pnpm run` commands or the `pnpm node` command.
> This may be used instead of `.nvmrc` and `nvm`.

В проекте сделали:

```ini
# wb-stocks/.npmrc
use-node-version=22.21.1
```

После этого:

- `pnpm install` сам качает Node 22.21.1 (если ещё нет) в свой store и
  пересобирает нативные модули под него.
- `pnpm run test` / `pnpm run serve:forecast-ui` / `pnpm rebuild` и т.д.
  запускаются под Node 22.21.1 **независимо** от `which node` в текущем
  shell.
- `.nvmrc` оставили (`22`) — для людей, которые любят `nvm use` руками; pnpm
  его не читает, но это полезный сигнал.

## Что было сделано

1. Создан `wb-stocks/.npmrc` со строкой `use-node-version=22.21.1`.
2. Выполнен `pnpm install` → pnpm скачал Node 22.21.1.
3. Выполнен `pnpm rebuild better-sqlite3` → нативный модуль пересобран под
   Node 22 (после нативного ребилда тесты, дергающие `openDatabase`, перестали
   падать с `NODE_MODULE_VERSION`).
4. Обновлён `README.md`: убран ручной `nvm use` из quick-start, добавлено
   описание двух пинов (`.nvmrc` для людей, `.npmrc` для pnpm).
5. В `package.json` уже есть удобный скрипт `rebuild:native` — оставлен на
   случай ручного восстановления (например, если Node всё же подменили
   из-под pnpm).

## Как обновлять версию Node

При апгрейде Node-LTS:

1. Поменять major в `.nvmrc`.
2. Поменять точную версию в `.npmrc` (`use-node-version=<X.Y.Z>`).
3. `pnpm install` (pnpm сам подтянет новый Node + пересоберёт нативные
   зависимости).
4. `pnpm test` для проверки.

## Как проверить, что pnpm реально использует пин

```bash
cd wb-stocks
pnpm node -v                  # должно быть 22.21.1
pnpm exec node -p "process.versions.modules"   # 127 (NODE_MODULE_VERSION для Node 22)
pnpm test
```

Если `pnpm node -v` показывает что-то другое — у вас слишком старая
версия pnpm; обновитесь до `pnpm@>=10` (см. `package.json`).

## Что это не решает

- Production / systemd unit-ы на GCE VM (`deploy/gcp/systemd/*.service`) не
  идут через `pnpm`. Там Node ставится отдельно (см. `deploy/gcp/cloud-init.yaml`);
  версию там нужно согласовывать самостоятельно.
- Глобальные CLI-инструменты вне `pnpm` (например, `tsc` из PATH) — тоже
  не управляются `use-node-version`. Используйте `pnpm exec tsc …` /
  `pnpm typecheck` вместо прямого `tsc`.
