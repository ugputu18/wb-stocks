# Деплой `wb-stocks` в GCP (одна VM + IAP)

## Что сделано

Добавлен набор инфраструктурных файлов и runbook для разворачивания
`wb-stocks` в Google Cloud Platform по схеме:

```
Google user → HTTPS LB (managed cert) → Cloud IAP →
              backend-service → GCE VM (Debian 12) →
              nginx :80 → forecast-ui :3847 (Node) → SQLite на persistent disk
                       ↑
                       └── systemd timers: import:stocks (час), supplies (день),
                           tariffs (неделя), forecast:sales-mvp (день)
```

Всё новое лежит в [`deploy/gcp/`](../../deploy/gcp/). Без миграции БД, без
Cloud Run, без замены `better-sqlite3`. Готово к запуску по шагам из
[`deploy/gcp/README.md`](../../deploy/gcp/README.md).

## Файлы

- [`deploy/gcp/README.md`](../../deploy/gcp/README.md) — пошаговый runbook
  с `gcloud`-командами: bootstrap проекта, service account, секреты,
  диск, VM, firewall, HTTPS LB, IAP, верификация, бэкапы, обновления.
- [`deploy/gcp/cloud-init.yaml`](../../deploy/gcp/cloud-init.yaml) —
  startup-скрипт VM: ставит Node 22 (NodeSource), pnpm, build-essential
  (нужен для нативной сборки `better-sqlite3`), nginx, Ops Agent;
  форматирует и монтирует data-диск под `/srv/wb-stocks/data`;
  клонирует репозиторий, собирает SPA (`pnpm build:forecast-ui-client`);
  тянет секреты; устанавливает и запускает systemd-юниты.
- [`deploy/gcp/nginx/forecast-ui.conf`](../../deploy/gcp/nginx/forecast-ui.conf)
  — reverse-proxy `80 → 127.0.0.1:3847` с пробросом `X-Forwarded-*`
  и IAP-заголовков.
- `deploy/gcp/systemd/forecast-ui.service` — UI HTTP-сервер,
  `Restart=on-failure`, runs as `wbstocks`.
- `deploy/gcp/systemd/wb-import-stocks.{service,timer}` — `OnCalendar=*-*-* *:05:00`
  (раз в час, импорт стоков WB).
- `deploy/gcp/systemd/wb-update-supplies.{service,timer}` —
  `OnCalendar=*-*-* 03:15:00` (раз в день).
- `deploy/gcp/systemd/wb-update-tariffs.{service,timer}` —
  `OnCalendar=Mon *-*-* 02:30:00` (раз в неделю).
- `deploy/gcp/systemd/wb-forecast-recalc.{service,timer}` —
  `OnCalendar=*-*-* 04:00:00` (раз в день, после supplies).
- [`deploy/gcp/scripts/fetch-secrets.sh`](../../deploy/gcp/scripts/fetch-secrets.sh)
  — пишет `/etc/wb-stocks.env` (0640 root:wbstocks) из Secret Manager
  (`WB_TOKEN`, `FORECAST_UI_TOKEN`).
- [`deploy/gcp/scripts/deploy.sh`](../../deploy/gcp/scripts/deploy.sh) —
  обновление кода: `gcloud compute ssh --tunnel-through-iap`,
  `git pull`, `pnpm install --frozen-lockfile`, ребилд SPA,
  `systemctl restart forecast-ui.service`.

## Ключевые решения

### Single-VM на GCE, без Cloud Run

`better-sqlite3` — нативный модуль, и приложение пишет в локальный SQLite
файл (`./data/wb-stocks.sqlite`). Cloud Run требует stateless-контейнеры
и горизонтального масштабирования, что плохо сочетается с SQLite-writer.
GCE VM с persistent disk даёт ровно ту же модель, что и локальная
машина разработчика, плюс zero-touch снапшоты диска для бэкапа.

### SQLite остаётся

Миграция на Cloud SQL (Postgres) — отдельный большой шаг (новый driver,
новый диалект миграций, переписать все `prepare/iterate` вызовы).
Пользователь явно выбрал «минимум изменений в коде», поэтому в первой
итерации SQLite остаётся, файл лежит на отдельном persistent disk,
который мы снапшотим политикой `snapshot-schedule` (см. README §11).

### IAP перед HTTPS LB

Внутренний инструмент, доступ нужен только сотрудникам с
Google-аккаунтами. IAP — это нативный для GCP способ закрыть весь backend
одним кликом и управлять списком пользователей через IAM. Никакой
собственной системы аутентификации мы не пишем.

`FORECAST_UI_TOKEN` (Bearer) оставлен как defense-in-depth, потому что
SPA уже умеет с ним работать (поля «Bearer (FORECAST_UI_TOKEN)» в
`FiltersForm`, `RedistributionControlsSection` и др.). Если IAP когда-то
ошибётся, прямого пути к API без токена не будет.

### nginx между LB и Node

Node-сервер слушает `127.0.0.1:3847` (как в dev — см.
[`src/config/env.ts`](../../src/config/env.ts), default
`FORECAST_UI_HOST=127.0.0.1`). На VM nginx слушает `:80` и проксирует в
loopback. Это даёт:

- Стандартные access/error логи.
- Возможность поднять предохранители (`client_max_body_size`,
  `proxy_read_timeout` для долгих экспортов и `recalculate`).
- Никаких изменений в коде сервера для прод-деплоя.

### systemd timers, не cron

Все периодические задачи — нативные `*.timer`. Преимущества против `cron`:

- stdout/stderr автоматически попадают в journald → Ops Agent →
  Cloud Logging без extra-конфига.
- `Persistent=true` отрабатывает пропущенные запуски (если VM была
  выключена).
- Single source of truth для PATH, юзера, ограничений (`NoNewPrivileges`,
  `ReadWritePaths` и т.п.).
- `OnCalendar` синтаксис типобезопаснее `crontab`-строк.

### Прямой вызов `node`, без `pnpm` в systemd

Скрипты `pnpm` ожидают `.env` файл в CWD (`node --env-file=.env`).
Чтобы не копировать секреты в репо-директорию, юниты вызывают
`node --env-file=/etc/wb-stocks.env --import tsx <path>` напрямую.
Это убирает зависимость от `pnpm` в рантайме и явно показывает, какой
скрипт запускает таймер.

## Как запустить

См. полный runbook в [`deploy/gcp/README.md`](../../deploy/gcp/README.md).
Сокращённо:

```bash
# 1. Выставить переменные (PROJECT_ID, REGION, ZONE, DOMAIN, REPO_URL).
# 2. Создать проект, включить API, создать service account, секреты, диск.
# 3. Создать VM с cloud-init.yaml — VM сама склонирует репо и поднимет всё.
gcloud compute instances create wb-stocks-1 \
  --machine-type=e2-small --image-family=debian-12 --image-project=debian-cloud \
  --disk=name=wb-stocks-data,device-name=wb-stocks-data \
  --service-account=wb-stocks-vm@${PROJECT_ID}.iam.gserviceaccount.com \
  --scopes=cloud-platform --tags=iap-backend \
  --metadata=wb-stocks-repo-url=...,wb-stocks-git-ref=main \
  --metadata-from-file=user-data=wb-stocks/deploy/gcp/cloud-init.yaml

# 4. Поднять LB + managed SSL + включить IAP, выдать доступ людям.
# 5. Открыть https://$DOMAIN — IAP → forecast UI.
```

Обновление кода после деплоя:

```bash
./wb-stocks/deploy/gcp/scripts/deploy.sh wb-stocks-1 europe-west4-a
```

## Что отложено

- **CSV-файлы `store/`** для `import:own-stocks` — оператор пока запускает
  их локально. Когда понадобится в облаке — поднимем GCS-бакет и
  `gcsfuse`-mount на `/srv/store`, или будем `gsutil rsync` перед
  запуском импорта.
- **Postgres / Cloud SQL** — отдельный проект; см. план миграции в
  [`ReadmeAI.md`](../../ReadmeAI.md) §11.
- **Terraform** — runbook сейчас использует только `gcloud`-команды.
  Когда инфра стабилизируется, можно завернуть в TF-модуль; никаких
  блокеров для этого нет.
- **Multi-instance** — `better-sqlite3` write-once-only, поэтому
  горизонтальное масштабирование сейчас не поддерживается. UI можно
  читать с реплики (read-only SQLite snapshot), но не первая итерация.
