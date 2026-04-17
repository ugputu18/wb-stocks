(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let lastRows = [];
  let lastTotalRows = 0;
  let lastSupplierRowCount = 0;

  function todayYmd() {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function authHeaders() {
    const t = $("apiToken").value.trim();
    return t ? { Authorization: "Bearer " + t } : {};
  }

  function humanFetchError(err) {
    const m = err && err.message ? String(err.message) : String(err);
    if (m === "Failed to fetch" || m === "NetworkError when attempting to fetch resource.") {
      return new Error(
        "Не удалось связаться с сервером (сеть, другой порт или процесс остановлен).",
      );
    }
    return err instanceof Error ? err : new Error(m);
  }

  async function api(path, options = {}) {
    const headers = {
      Accept: "application/json",
      ...authHeaders(),
      ...(options.headers || {}),
    };
    let res;
    try {
      res = await fetch(path, { ...options, headers });
    } catch (err) {
      throw humanFetchError(err);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(
        "Ответ сервера не JSON (код " +
          res.status +
          "). Проверьте URL и что поднят `pnpm serve:forecast-ui`.",
      );
    }
    if (!res.ok) {
      let msg =
        data && typeof data.error === "string"
          ? data.error
          : res.status === 401
            ? "Нужен заголовок авторизации: введите Bearer-токен (FORECAST_UI_TOKEN)."
            : res.statusText || "Ошибка запроса";
      if (res.status === 503 && data && data.code === "WB_TOKEN_MISSING") {
        msg =
          data.error ||
          "Не задан WB_TOKEN на сервере: пересчёт без него недоступен (импорт заказов из WB).";
      }
      const err = new Error(msg);
      if (data && data.code) err.code = data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const THEAD_WB_TOTAL = `<tr>
          <th class="th-risk-wb-total" scope="col" title="Бакет риска по дням запаса WB (агрегат сети)">Риск</th>
          <th class="th-vendor-wb-total" scope="col" title="vendor_code">vendor</th>
          <th>nm_id</th>
          <th>Размер</th>
          <th title="Сумма (start_stock + incoming) по всем складам WB">WB ∑</th>
          <th title="Наш склад (own CSV)">Own</th>
          <th title="WB∑ + own">System</th>
          <th title="Покрытие по сети: WB∑ / Σ спрос">Дн. WB</th>
          <th title="Σ forecast_daily_demand по сети">Спрос/день Σ</th>
          <th title="max(0, спрос×дни − WB∑ по сети)">На WB</th>
          <th title="Та же формула, что в блоке закупки">У пр-ля</th>
          <th title="MIN(stockout_date) по складам">OOS (WB)</th>
        </tr>`;

  const THEAD_WAREHOUSES = `<tr>
            <th>Risk</th>
            <th title="Система · WB · локальный склад">Риск<br/>уровней</th>
            <th>Склад WB</th>
            <th>nm_id</th>
            <th>vendor</th>
            <th>Дней запаса</th>
            <th>Спрос/день</th>
            <th title="Наш склад + все WB">System</th>
            <th title="Сумма по складам WB">WB ∑</th>
            <th title="Этот склад WB">WB лок.</th>
            <th title="Склад: max(0, спрос×дни − WB∑)">На WB</th>
            <th>Сток снимок</th>
          </tr>`;

  function renderTableHeader(viewMode) {
    const thead = $("gridThead");
    if (!thead) return;
    thead.innerHTML =
      viewMode === "wbWarehouses" ? THEAD_WAREHOUSES : THEAD_WB_TOTAL;
    const grid = $("grid");
    if (grid) {
      grid.classList.toggle("grid-wb-total", viewMode !== "wbWarehouses");
    }
  }

  function updateMainTableHint(viewMode) {
    const el = $("mainTableHintText");
    if (!el) return;
    if (viewMode === "wbWarehouses") {
      el.innerHTML =
        "Режим <strong>по складам WB</strong>: строка = склад × SKU. System = все WB + наш склад; WB ∑ = сумма по сети; WB лок. = этот склад. S/W/L — риск по уровням. " +
        "Колонка «На WB» — довоз с учётом network-запаса; закупка у производителя — в таблице ниже.";
    } else {
      el.innerHTML =
        "Режим по умолчанию: <strong>WB в целом</strong> — одна строка на SKU по сети; риск и дни запаса — по агрегату сети (read-side GROUP BY). " +
        "Сортировка по умолчанию: <strong>daysOfStockWB</strong> по возрастанию (хуже запас — выше), затем <strong>forecastDailyDemandTotal</strong> по убыванию. «На WB» и «У пр-ля» — как в supplier-таблице ниже.";
    }
  }

  function queryParams() {
    const snapshotDate = $("snapshotDate").value;
    const horizonDays = $("horizonDays").value;
    const warehouseKey = $("warehouseKey").value;
    const q = $("q").value.trim();
    const riskStockout = $("riskStockout").value;
    const targetCoverageDays = $("targetCoverageDays").value;
    const replenishmentMode = $("replenishmentMode").value;
    const ownWarehouseCode = $("ownWarehouseCode").value.trim();
    const leadTimeDays = String($("leadTimeDays").value || "45").trim();
    const coverageDays = String($("coverageDays").value || "90").trim();
    const safetyDays = String(
      $("safetyDays").value !== "" ? $("safetyDays").value : "0",
    ).trim();
    const viewMode = $("viewMode").value;
    const p = new URLSearchParams({
      snapshotDate,
      horizonDays,
      riskStockout,
      targetCoverageDays,
      replenishmentMode,
      leadTimeDays,
      coverageDays,
      safetyDays,
      viewMode,
    });
    if (warehouseKey) p.set("warehouseKey", warehouseKey);
    if (q) p.set("q", q);
    if (ownWarehouseCode) p.set("ownWarehouseCode", ownWarehouseCode);
    return p;
  }

  function rowsQueryParams() {
    const p = queryParams();
    p.set("limit", $("rowLimit").value);
    return p;
  }

  /** Без riskStockout — для supplier SKU-витрины (как на сервере). */
  function supplierQueryParams() {
    const snapshotDate = $("snapshotDate").value;
    const horizonDays = $("horizonDays").value;
    const warehouseKey = $("warehouseKey").value;
    const q = $("q").value.trim();
    const targetCoverageDays = $("targetCoverageDays").value;
    const replenishmentMode = $("replenishmentMode").value;
    const ownWarehouseCode = $("ownWarehouseCode").value.trim();
    const leadTimeDays = String($("leadTimeDays").value || "45").trim();
    const coverageDays = String($("coverageDays").value || "90").trim();
    const safetyDays = String(
      $("safetyDays").value !== "" ? $("safetyDays").value : "0",
    ).trim();
    const viewMode = $("viewMode").value;
    const p = new URLSearchParams({
      snapshotDate,
      horizonDays,
      targetCoverageDays,
      replenishmentMode,
      leadTimeDays,
      coverageDays,
      safetyDays,
      viewMode,
    });
    if (warehouseKey) p.set("warehouseKey", warehouseKey);
    if (q) p.set("q", q);
    if (ownWarehouseCode) p.set("ownWarehouseCode", ownWarehouseCode);
    return p;
  }

  function setStatus(msg) {
    $("status").textContent = msg || "";
  }

  function fallbackWbCsvName() {
    const d = $("snapshotDate").value;
    const h = $("horizonDays").value;
    return `wb-replenishment-${d}-h${h}.csv`;
  }

  function fallbackSupplierCsvName() {
    const d = $("snapshotDate").value;
    const h = $("horizonDays").value;
    return `supplier-replenishment-${d}-h${h}.csv`;
  }

  async function downloadCsv(path, fallbackFilename) {
    const headers = {
      Accept: "text/csv,*/*",
      ...authHeaders(),
    };
    let res;
    try {
      res = await fetch(path, { headers });
    } catch (err) {
      throw humanFetchError(err);
    }
    let filename = fallbackFilename;
    const cd = res.headers.get("Content-Disposition");
    if (cd) {
      const m = /filename="([^"]+)"/.exec(cd);
      if (m) filename = m[1];
    }
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText || "Ошибка экспорта";
      try {
        const j = JSON.parse(text);
        if (j && typeof j.error === "string") msg = j.error;
      } catch (_) {
        if (text && text.trim()) msg = text.trim().slice(0, 300);
      }
      if (res.status === 401) {
        msg =
          "Нужен заголовок авторизации: введите Bearer-токен (FORECAST_UI_TOKEN).";
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  async function downloadWbCsv() {
    setStatus("Экспорт WB CSV…");
    try {
      const p = queryParams();
      await downloadCsv(`/api/forecast/export-wb?${p}`, fallbackWbCsvName());
      setStatus("CSV скачан (WB).");
    } catch (e) {
      setStatus("Ошибка: " + (e && e.message ? e.message : String(e)));
    }
  }

  async function downloadSupplierCsv() {
    setStatus("Экспорт Supplier CSV…");
    try {
      const p = supplierQueryParams();
      await downloadCsv(`/api/forecast/export-supplier?${p}`, fallbackSupplierCsvName());
      setStatus("CSV скачан (supplier).");
    } catch (e) {
      setStatus("Ошибка: " + (e && e.message ? e.message : String(e)));
    }
  }

  function updateExportButtons() {
    const wb = $("btnExportWbCsv");
    const sup = $("btnExportSupplierCsv");
    if (wb) wb.disabled = lastTotalRows === 0;
    if (sup) sup.disabled = lastSupplierRowCount === 0;
  }

  function renderSummary(data) {
    const el = $("summary");
    const r = data.risk || {};
    const vm = data.viewMode === "wbWarehouses" ? "wbWarehouses" : "wbTotal";
    const rowLabel =
      vm === "wbWarehouses"
        ? "Всего строк (склад × SKU по фильтру)"
        : "Всего строк (SKU по сети WB по фильтру)";
    const cells = [
      cell(rowLabel, data.totalRows),
      cell("Critical · запас &lt; 7 дн.", r.critical, "risk-critical"),
      cell("Warning · [7, 14) дн.", r.warning, "risk-warning"),
      cell("Attention · [14, 30) дн.", r.attention, "risk-attention"),
      cell("OK ≥30", r.ok, "risk-ok"),
    ];
    const rep = data.replenishment;
    if (rep && typeof rep.recommendedToWBTotal === "number") {
      const mode = rep.replenishmentMode || "wb";
      const primary =
        mode === "supplier" ? rep.recommendedFromSupplierTotal : rep.recommendedToWBTotal;
      cells.push(
        cell(
          "KPI по режиму (" + mode + "), шт.",
          primary,
          "",
        ),
      );
      const wbSumLabel =
        vm === "wbWarehouses"
          ? "Σ на WB (по строкам склад×SKU, network−спрос)"
          : "Σ на WB (SKU по сети, сумма рекомендаций «На WB»)";
      cells.push(cell(wbSumLabel, rep.recommendedToWBTotal, ""));
      cells.push(
        cell(
          "Σ у производителя (уникальные SKU, см. таблицу ниже)",
          rep.recommendedFromSupplierTotal,
          "",
        ),
      );
      if (typeof rep.recommendedOrderQtyTotal === "number") {
        cells.push(
          cell(
            "Σ заказ (план lead time + покрытие после прихода)",
            rep.recommendedOrderQtyTotal,
            "",
          ),
        );
      }
      if (rep.ownWarehouseCode) {
        cells.push(cell("own warehouse_code", rep.ownWarehouseCode, ""));
      }
    }
    const staleLabel =
      vm === "wbWarehouses"
        ? "Устаревший сток (строк склад×SKU)"
        : "Устаревший сток (строк SKU по сети)";
    cells.push(
      cell(staleLabel, data.staleStockRowCount),
      cell("Сток snapshot min", data.oldestStockSnapshotAt ?? "—"),
      cell("Сток snapshot max", data.newestStockSnapshotAt ?? "—"),
    );
    el.innerHTML = cells.join("");
  }

  function cell(label, value, cls) {
    const v =
      typeof value === "number"
        ? String(value)
        : value == null
          ? "—"
          : String(value);
    return `<div class="cell"><span class="muted">${label}</span><strong class="${cls || ""}">${v}</strong></div>`;
  }

  function badgeClass(risk) {
    const m = {
      critical: "badge-critical",
      warning: "badge-warning",
      attention: "badge-attention",
      ok: "badge-ok",
    };
    return m[risk] || "badge-ok";
  }

  /** Крупные латинские метки в первой колонке режима «WB в целом». */
  function riskLabelWbTotal(risk) {
    const m = {
      critical: "CRITICAL",
      warning: "WARNING",
      attention: "ATTENTION",
      ok: "OK",
    };
    return m[risk] ?? String(risk ?? "").toUpperCase();
  }

  function formatInt(x) {
    if (x == null || Number.isNaN(x)) return "—";
    if (typeof x === "number") return String(Math.round(x));
    return String(x);
  }

  function riskStripHtml(inv) {
    if (!inv) {
      return "—";
    }
    const s = inv.systemRisk ? "on" : "";
    const w = inv.wbRisk ? "on" : "";
    const l = inv.localRisk ? "on" : "";
    const rd = inv.regionalDeficit
      ? ' <span class="reg-def" title="Региональный дефицит: на этом WB пусто, запас есть elsewhere">РД</span>'
      : "";
    return (
      `<div class="risk-strip" title="Красный=система, оранжевый=WB∑, жёлтый=локальный WB">` +
      `<span class="risk-dot risk-sys ${s}">S</span>` +
      `<span class="risk-dot risk-wb ${w}">W</span>` +
      `<span class="risk-dot risk-loc ${l}">L</span>` +
      `</div>${rd}`
    );
  }

  function formatNum(x) {
    if (x == null || Number.isNaN(x)) return "—";
    if (typeof x === "number") return x.toFixed(4).replace(/\.?0+$/, "");
    return String(x);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderRows(rows, viewMode) {
    lastRows = rows;
    const tb = $("tbody");
    const vm = viewMode === "wbWarehouses" ? "wbWarehouses" : "wbTotal";
    if (vm === "wbWarehouses") {
      tb.innerHTML = rows
        .map((row, idx) => {
          const inv = row.inventoryLevels;
          const rep = row.replenishment;
          return `<tr class="tr-row tr-risk-${row.risk || "ok"}" data-idx="${idx}" tabindex="0" title="Клик — детали расчёта">
          <td class="risk-cell"><span class="badge ${badgeClass(row.risk)}">${escapeHtml(String(row.risk ?? ""))}</span></td>
          <td class="risk-strip-cell">${riskStripHtml(inv)}</td>
          <td>${escapeHtml(row.warehouseNameRaw || row.warehouseKey || "")}</td>
          <td>${escapeHtml(String(row.nmId ?? ""))}</td>
          <td>${escapeHtml(String(row.vendorCode ?? ""))}</td>
          <td>${formatNum(row.daysOfStock)}</td>
          <td>${formatNum(row.forecastDailyDemand)}</td>
          <td>${formatInt(inv ? inv.systemAvailable : null)}</td>
          <td>${formatInt(inv ? inv.wbAvailable : null)}</td>
          <td>${formatInt(inv ? inv.localAvailable : null)}</td>
          <td>${formatInt(rep ? rep.recommendedToWB : null)}</td>
          <td>${escapeHtml(String(row.stockSnapshotAt ?? ""))}</td>
        </tr>`;
        })
        .join("");
    } else {
      tb.innerHTML = rows
        .map((row, idx) => {
          const inv = row.inventoryLevels;
          const rep = row.replenishment;
          return `<tr class="tr-row tr-risk-${row.risk || "ok"}" data-idx="${idx}" tabindex="0" title="Клик — детали по SKU (сеть WB)">
          <td class="risk-cell risk-cell-wb-total"><span class="badge badge-wb-total ${badgeClass(row.risk)}">${escapeHtml(riskLabelWbTotal(row.risk))}</span></td>
          <td class="col-vendor-wb-total">${escapeHtml(String(row.vendorCode ?? ""))}</td>
          <td>${escapeHtml(String(row.nmId ?? ""))}</td>
          <td>${escapeHtml(String(row.techSize ?? ""))}</td>
          <td>${formatInt(row.wbAvailableTotal)}</td>
          <td>${formatInt(row.ownStock)}</td>
          <td>${formatInt(inv ? inv.systemAvailable : null)}</td>
          <td>${formatNum(row.daysOfStockWB)}</td>
          <td>${formatNum(row.forecastDailyDemandTotal)}</td>
          <td>${formatInt(rep ? rep.recommendedToWB : null)}</td>
          <td>${formatInt(row.recommendedFromSupplier)}</td>
          <td>${escapeHtml(String(row.stockoutDateWB ?? ""))}</td>
        </tr>`;
        })
        .join("");
    }
    $("detailPanel").hidden = false;
    $("detailHint").hidden = false;
    $("detailDl").innerHTML = "";
  }

  function formatDetailVal(v) {
    if (v == null) return "—";
    if (typeof v === "number") return formatNum(v);
    return escapeHtml(String(v));
  }

  function renderDetail(row) {
    if (!row) {
      $("detailHint").hidden = false;
      $("detailDl").innerHTML = "";
      return;
    }
    $("detailHint").hidden = true;
    if (row.viewKind === "wbTotal") {
      const inv = row.inventoryLevels;
      const rep = row.replenishment;
      const pairs = [
        ["Режим строки", "WB в целом (одна строка на SKU по сети)"],
        ["Bucket риска (по дням запаса WB, сеть)", row.risk],
        ["nm_id", row.nmId],
        ["Размер", row.techSize],
        ["vendor_code", row.vendorCode],
        ["WB ∑ доступно (start+incoming по сети)", formatInt(row.wbAvailableTotal)],
        ["Спрос/день Σ по сети", formatNum(row.forecastDailyDemandTotal)],
        ["Дней запаса WB (сеть)", formatNum(row.daysOfStockWB)],
        ["Дата OOS (MIN по складам)", row.stockoutDateWB ?? "—"],
        ["Сток snapshot (MIN по складам)", row.stockSnapshotAtWB ?? "—"],
        ["ownStock", formatInt(row.ownStock)],
        ["systemAvailable", formatInt(inv ? inv.systemAvailable : null)],
        ["Рекомендация на WB (сеть)", formatInt(rep ? rep.recommendedToWB : null)],
        ["Рекомендация у производителя (SKU)", formatInt(row.recommendedFromSupplier)],
      ];
      $("detailDl").innerHTML = pairs
        .map(
          ([k, v]) =>
            `<dt>${escapeHtml(k)}</dt><dd>${
              typeof v === "number" ? formatDetailVal(v) : escapeHtml(String(v))
            }</dd>`,
        )
        .join("");
      return;
    }
    const pairs = [
      ["Bucket риска", row.risk],
      ["Склад (как в WB)", row.warehouseNameRaw || row.warehouseKey],
      ["nm_id", row.nmId],
      ["Размер", row.techSize],
      ["vendor_code", row.vendorCode],
      ["Штрихкод", row.barcode],
      ["Продажи 7д / 30д (шт.)", [row.units7, row.units30].filter((x) => x != null).join(" / ")],
      [
        "Средний спрос 7д / 30д",
        [formatNum(row.avgDaily7), formatNum(row.avgDaily30)].join(" / "),
      ],
      ["Базовый спрос (сглаж.)", formatDetailVal(row.baseDailyDemand)],
      [
        "Тренд (сырой / clamp)",
        [formatNum(row.trendRatio), formatNum(row.trendRatioClamped)].join(" / "),
      ],
      ["Прогноз спроса/день (в симуляции)", formatDetailVal(row.forecastDailyDemand)],
      ["Сток (срез WB)", row.stockSnapshotAt ?? "—"],
      [
        "start_stock → end_stock",
        [formatNum(row.startStock), formatNum(row.endStock)].join(" → "),
      ],
      ["Входящие поставки (шт., горизонт)", formatDetailVal(row.incomingUnits)],
    ];
    const inv = row.inventoryLevels;
    if (inv) {
      pairs.push(
        ["— Запасы (read-side)", ""],
        ["systemAvailable (WB∑ + own)", formatInt(inv.systemAvailable)],
        ["wbAvailable (сумма по складам WB)", formatInt(inv.wbAvailable)],
        ["localAvailable (этот склад WB)", formatInt(inv.localAvailable)],
        ["ownStock (наш склад по vendor)", formatInt(inv.ownStock)],
        ["systemRisk / wbRisk / localRisk", [inv.systemRisk, inv.wbRisk, inv.localRisk].join(" / ")],
        ["regionalDeficit (локально пусто, запас есть)", inv.regionalDeficit ? "да" : "нет"],
      );
    }
    const rep = row.replenishment;
    if (rep) {
      pairs.push(
        ["— Поставка на WB (эта строка склада)", ""],
        ["targetCoverageDays", rep.targetCoverageDays],
        ["targetDemandWB (спрос/день×дни на этом WB)", formatDetailVal(rep.targetDemandWB)],
        ["wbAvailableTotal (сеть WB, тот же WB∑)", formatInt(rep.wbAvailableTotal)],
        ["recommendedToWB", formatInt(rep.recommendedToWB)],
        ["Закупка у пр-ля по SKU — см. таблицу «Закупка у производителя»", ""],
      );
    }
    pairs.push(
      ["Прогноз продаж (шт., горизонт)", formatDetailVal(row.forecastUnits)],
      ["Дней запаса (целых)", formatDetailVal(row.daysOfStock)],
      ["Дата исчерпания (если есть)", row.stockoutDate ?? "—"],
      ["computed_at", row.computedAt ?? "—"],
    );
    $("detailDl").innerHTML = pairs
      .map(
        ([k, v]) =>
          `<dt>${escapeHtml(k)}</dt><dd>${
            typeof v === "number" ? formatDetailVal(v) : escapeHtml(String(v))
          }</dd>`,
      )
      .join("");
  }

  function selectRow(idx) {
    if (idx < 0 || idx >= lastRows.length) return;
    document.querySelectorAll("#tbody tr").forEach((tr) => tr.classList.remove("tr-selected"));
    const tr = document.querySelector(`#tbody tr[data-idx="${idx}"]`);
    if (tr) tr.classList.add("tr-selected");
    renderDetail(lastRows[idx] || null);
  }

  async function loadWarehouses() {
    const p = queryParams();
    const data = await api(`/api/forecast/warehouse-keys?${p}`);
    const sel = $("warehouseKey");
    const current = sel.value;
    sel.innerHTML = '<option value="">Все</option>';
    for (const k of data.warehouseKeys || []) {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = k;
      sel.appendChild(o);
    }
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  }

  function renderSupplierRows(rows) {
    const tb = $("supplierTbody");
    if (!tb) return;
    tb.innerHTML = (rows || [])
      .map(
        (r) =>
          `<tr>
          <td>${escapeHtml(String(r.nmId ?? ""))}</td>
          <td>${escapeHtml(String(r.techSize ?? ""))}</td>
          <td>${escapeHtml(String(r.vendorCode ?? ""))}</td>
          <td>${formatNum(r.sumForecastDailyDemand)}</td>
          <td>${
            r.daysUntilStockout == null || Number.isNaN(r.daysUntilStockout)
              ? "—"
              : formatNum(r.daysUntilStockout)
          }</td>
          <td>${formatInt(r.targetDemandSystem)}</td>
          <td>${formatInt(r.wbAvailableTotal)}</td>
          <td>${formatInt(r.ownStock)}</td>
          <td>${formatInt(r.systemAvailable)}</td>
          <td><strong>${formatInt(r.recommendedFromSupplier)}</strong></td>
          <td>${formatNum(r.stockAtArrival)}</td>
          <td><strong>${formatInt(r.recommendedOrderQty)}</strong></td>
          <td>${r.willStockoutBeforeArrival ? '<span class="badge badge-critical">да</span>' : "нет"}</td>
        </tr>`,
      )
      .join("");
  }

  async function loadTable() {
    const sumP = queryParams();
    const rowP = rowsQueryParams();
    setStatus("Загрузка…");
    let sum;
    let rowsPayload;
    try {
      [sum, rowsPayload] = await Promise.all([
        api(`/api/forecast/summary?${sumP}`),
        api(`/api/forecast/rows?${rowP}`),
      ]);
    } catch (e) {
      setStatus("Ошибка: " + (e && e.message ? e.message : String(e)));
      throw e;
    }
    let supPayload = { rows: [] };
    try {
      supPayload = await api(
        `/api/forecast/supplier-replenishment?${supplierQueryParams()}`,
      );
    } catch (_) {
      /* таблица SKU — опционально */
    }
    const viewMode =
      rowsPayload.viewMode === "wbWarehouses" ? "wbWarehouses" : "wbTotal";
    renderTableHeader(viewMode);
    updateMainTableHint(viewMode);
    renderSummary({ ...sum, viewMode });
    const list = rowsPayload.rows || [];
    renderRows(list, viewMode);
    renderSupplierRows(supPayload.rows);
    const total = sum.totalRows ?? 0;
    lastTotalRows = total;
    lastSupplierRowCount = (supPayload.rows || []).length;
    updateExportButtons();
    const shown = list.length;
    const limit = rowsPayload.limit ?? shown;
    let msg = `OK · в таблице ${shown} строк`;
    if (total > shown) {
      msg += ` из ${total} по фильтру (лимит ответа ${limit}; сузьте поиск/склад или увеличьте лимит)`;
    } else {
      msg += total ? ` (все ${total} по фильтру)` : "";
    }
    setStatus(msg);
  }

  async function recalculate() {
    const snapshotDate = $("snapshotDate").value;
    const horizonDays = Number($("horizonDays").value);
    setStatus("Пересчёт…");
    $("btnRecalculate").disabled = true;
    try {
      const body = {
        snapshotDate,
        horizons: [horizonDays],
        dryRun: false,
      };
      await api("/api/forecast/recalculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await loadWarehouses();
      await loadTable();
    } catch (e) {
      const m = e && e.message ? e.message : String(e);
      setStatus("Пересчёт: " + m);
    } finally {
      $("btnRecalculate").disabled = false;
    }
  }

  function wireTableClicks() {
    $("tbody").addEventListener("click", (ev) => {
      const tr = ev.target.closest("tr[data-idx]");
      if (!tr) return;
      selectRow(parseInt(tr.dataset.idx, 10));
    });
    $("tbody").addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const tr = ev.target.closest("tr[data-idx]");
      if (!tr) return;
      ev.preventDefault();
      selectRow(parseInt(tr.dataset.idx, 10));
    });
  }

  $("snapshotDate").value = todayYmd();
  renderTableHeader($("viewMode").value);
  updateMainTableHint($("viewMode").value);

  $("btnRefresh").addEventListener("click", () => {
    loadWarehouses()
      .then(loadTable)
      .catch((e) => setStatus(e && e.message ? e.message : String(e)));
  });
  $("btnRecalculate").addEventListener("click", () => {
    recalculate().catch(() => {});
  });
  $("btnExportWbCsv").addEventListener("click", () => {
    downloadWbCsv();
  });
  $("btnExportSupplierCsv").addEventListener("click", () => {
    downloadSupplierCsv();
  });
  [
    "snapshotDate",
    "horizonDays",
    "warehouseKey",
    "q",
    "rowLimit",
    "riskStockout",
    "targetCoverageDays",
    "replenishmentMode",
    "ownWarehouseCode",
    "leadTimeDays",
    "coverageDays",
    "safetyDays",
    "viewMode",
  ].forEach((id) => {
    $(id).addEventListener("change", () => {
      loadWarehouses()
        .then(loadTable)
        .catch((e) => setStatus(e && e.message ? e.message : String(e)));
    });
  });

  wireTableClicks();

  loadWarehouses()
    .then(loadTable)
    .catch((e) => setStatus(e && e.message ? e.message : String(e)));
})();
