(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let lastRows = [];

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

  function queryParams() {
    const snapshotDate = $("snapshotDate").value;
    const horizonDays = $("horizonDays").value;
    const warehouseKey = $("warehouseKey").value;
    const q = $("q").value.trim();
    const riskStockout = $("riskStockout").value;
    const targetCoverageDays = $("targetCoverageDays").value;
    const replenishmentMode = $("replenishmentMode").value;
    const ownWarehouseCode = $("ownWarehouseCode").value.trim();
    const p = new URLSearchParams({
      snapshotDate,
      horizonDays,
      riskStockout,
      targetCoverageDays,
      replenishmentMode,
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
    const p = new URLSearchParams({
      snapshotDate,
      horizonDays,
      targetCoverageDays,
      replenishmentMode,
    });
    if (warehouseKey) p.set("warehouseKey", warehouseKey);
    if (q) p.set("q", q);
    if (ownWarehouseCode) p.set("ownWarehouseCode", ownWarehouseCode);
    return p;
  }

  function setStatus(msg) {
    $("status").textContent = msg || "";
  }

  function renderSummary(data) {
    const el = $("summary");
    const r = data.risk || {};
    const cells = [
      cell("Всего строк (по фильтру)", data.totalRows),
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
      cells.push(
        cell(
          "Σ на WB (складские строки, network−спрос)",
          rep.recommendedToWBTotal,
          "",
        ),
      );
      cells.push(
        cell(
          "Σ у производителя (уникальные SKU, см. таблицу ниже)",
          rep.recommendedFromSupplierTotal,
          "",
        ),
      );
      if (rep.ownWarehouseCode) {
        cells.push(cell("own warehouse_code", rep.ownWarehouseCode, ""));
      }
    }
    cells.push(
      cell("Устаревший сток (строк)", data.staleStockRowCount),
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

  function renderRows(rows) {
    lastRows = rows;
    const tb = $("tbody");
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
          <td>${formatInt(r.targetDemandSystem)}</td>
          <td>${formatInt(r.wbAvailableTotal)}</td>
          <td>${formatInt(r.ownStock)}</td>
          <td>${formatInt(r.systemAvailable)}</td>
          <td><strong>${formatInt(r.recommendedFromSupplier)}</strong></td>
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
    renderSummary(sum);
    const list = rowsPayload.rows || [];
    renderRows(list);
    renderSupplierRows(supPayload.rows);
    const total = sum.totalRows ?? 0;
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

  $("btnRefresh").addEventListener("click", () => {
    loadWarehouses()
      .then(loadTable)
      .catch((e) => setStatus(e && e.message ? e.message : String(e)));
  });
  $("btnRecalculate").addEventListener("click", () => {
    recalculate().catch(() => {});
  });
  ["snapshotDate", "horizonDays", "warehouseKey", "q", "rowLimit", "riskStockout", "targetCoverageDays", "replenishmentMode", "ownWarehouseCode"].forEach((id) => {
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
