(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let lastRows = [];
  let lastTotalRows = 0;
  let lastSupplierRowCount = 0;
  /** Строки витрины supplier-replenishment последней загрузки — для расшифровки заказа по SKU в «Детали строки». */
  let lastSupplierRows = [];

  /** Склад из URL — применяется один раз при следующем `loadWarehouses` (опции ещё не построены). */
  let pendingWarehouseKeyFromUrl = null;

  const ALLOWED_HORIZON = new Set(["30", "60", "90"]);
  const ALLOWED_LIMIT = new Set(["250", "500", "1000", "2000"]);
  const ALLOWED_RISK = new Set([
    "all",
    "lt7",
    "lt14",
    "lt30",
    "lt45",
    "lt60",
  ]);
  const ALLOWED_TARGET_COV = new Set(["30", "45", "60"]);
  /** Совпадает с `MAX_SUPPLIER_LEAD_DAYS` на сервере и `max` у `#leadTimeDays`. */
  const SUPPLIER_LEAD_TIME_MIN = 1;
  const SUPPLIER_LEAD_TIME_MAX = 1000;

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

  function parseViewModeParam(raw) {
    const t = (raw ?? "").trim().toLowerCase();
    if (t === "wbwarehouses" || t === "warehouses" || t === "by-warehouse") {
      return "wbWarehouses";
    }
    if (t === "wbtotal" || t === "wb" || t === "wb-network") {
      return "wbTotal";
    }
    if (
      t === "" ||
      t === "systemtotal" ||
      t === "system" ||
      t === "system-stock" ||
      t === "stocks"
    ) {
      return "systemTotal";
    }
    return "wbTotal";
  }

  function parseSystemQuickFilterParam(raw, viewMode) {
    if (viewMode !== "systemTotal") return "all";
    const t = (raw ?? "").trim().toLowerCase();
    if (t === "systemrisk" || t === "system_risk") return "systemRisk";
    if (
      t === "supplierorder" ||
      t === "supplier" ||
      t === "from_supplier"
    ) {
      return "supplierOrder";
    }
    if (t === "wbreplenish" || t === "towb" || t === "on_wb") {
      return "wbReplenish";
    }
    return "all";
  }

  function clampIntStr(raw, min, max, fallback) {
    const n = Number(String(raw ?? "").trim());
    if (!Number.isInteger(n) || n < min || n > max) return String(fallback);
    return String(n);
  }

  /** Синхронизирует `#leadTimeDays` с допустимым диапазоном и возвращит строку для query. */
  function leadTimeDaysFromForm() {
    const ltEl = $("leadTimeDays");
    const v = clampIntStr(
      ltEl ? ltEl.value : "45",
      SUPPLIER_LEAD_TIME_MIN,
      SUPPLIER_LEAD_TIME_MAX,
      45,
    );
    if (ltEl) ltEl.value = v;
    return v;
  }

  /**
   * Восстанавливает поля формы из `window.location.search`.
   * Невалидные значения → текущие дефолты UI (как до синхронизации URL).
   */
  function applyFormFromUrl() {
    const params = new URLSearchParams(window.location.search);

    const sd = params.get("snapshotDate")?.trim();
    if (sd && /^\d{4}-\d{2}-\d{2}$/.test(sd)) {
      $("snapshotDate").value = sd;
    } else {
      $("snapshotDate").value = todayYmd();
    }

    const h = params.get("horizonDays")?.trim();
    $("horizonDays").value = ALLOWED_HORIZON.has(h) ? h : "30";

    $("viewMode").value = parseViewModeParam(params.get("viewMode"));
    const vm = $("viewMode").value;
    $("systemQuickFilter").value = parseSystemQuickFilterParam(
      params.get("systemQuickFilter"),
      vm,
    );

    const wkParam = params.get("warehouseKey");
    pendingWarehouseKeyFromUrl = wkParam !== null ? wkParam.trim() : null;

    const r = params.get("riskStockout")?.trim();
    $("riskStockout").value = ALLOWED_RISK.has(r) ? r : "all";

    $("replenishmentMode").value =
      params.get("replenishmentMode")?.trim() === "supplier" ? "supplier" : "wb";

    const tc = params.get("targetCoverageDays")?.trim();
    $("targetCoverageDays").value = ALLOWED_TARGET_COV.has(tc) ? tc : "30";

    const ownP = params.get("ownWarehouseCode");
    $("ownWarehouseCode").value = ownP !== null ? ownP.trim() : "";

    const lim = params.get("limit")?.trim();
    $("rowLimit").value = ALLOWED_LIMIT.has(lim) ? lim : "500";

    $("leadTimeDays").value = clampIntStr(
      params.get("leadTimeDays"),
      SUPPLIER_LEAD_TIME_MIN,
      SUPPLIER_LEAD_TIME_MAX,
      45,
    );
    $("coverageDays").value = clampIntStr(
      params.get("coverageDays"),
      1,
      730,
      90,
    );
    $("safetyDays").value = clampIntStr(
      params.get("safetyDays"),
      0,
      365,
      0,
    );

    const qRaw = params.get("q");
    $("q").value = qRaw != null ? String(qRaw) : "";

    const ts = params.get("techSize");
    const tsf = $("techSizeFilter");
    if (tsf) tsf.value = ts != null ? String(ts) : "";
  }

  /** Параметры таблицы + KPI в одном объекте (как у API-запросов). */
  function buildForecastUrlSearchParams() {
    const p = queryParams();
    p.set("limit", $("rowLimit").value);
    return p;
  }

  /** Обновляет адресную строку без перезагрузки; `push` — отдельный шаг истории (drilldown). */
  function syncUrlFromForm(mode) {
    const path = window.location.pathname || "/";
    const qs = buildForecastUrlSearchParams().toString();
    const next = qs ? `${path}?${qs}` : path;
    const cur = window.location.pathname + window.location.search;
    if (next === cur) return;
    if (mode === "push") {
      history.pushState(null, "", next);
    } else {
      history.replaceState(null, "", next);
    }
  }

  const THEAD_WB_TOTAL = `<tr>
          <th class="th-risk-wb-total" scope="col" title="Бакет риска по дням запаса WB (агрегат сети); те же пороги 7/14/30 дней, что и для складского режима.">Риск</th>
          <th class="th-vendor-wb-total" scope="col" title="Артикул поставщика (vendor_code) из среза WB.">vendor</th>
          <th scope="col" title="Идентификатор номенклатуры на маркетплейсе.">nm_id</th>
          <th scope="col" title="Размер (tech_size) в связке с nm_id.">Размер</th>
          <th title="Сумма доступного на WB по сети: start_stock + incoming_units по всем складам для этого SKU.">WB ∑</th>
          <th title="Остаток на нашем складе из own CSV (vendor_code → quantity).">Own</th>
          <th title="Общий пул: WB∑ по сети + own; база для «системного» риска и закупки у поставщика.">System</th>
          <th title="Дней покрытия по сети WB: WB∑ / Σ спроса в день (агрегат); при нулевом спросе — особые правила в домене.">Дн. WB</th>
          <th title="Сумма прогнозных продаж в день (forecast_daily_demand) по всем складам WB для артикула×размера.">Спрос/день Σ</th>
          <th title="Рекомендуемый довоз на WB: max(0, ceil(спрос×целевые дни − WB∑ по сети)) при выбранном targetCoverageDays.">На WB</th>
          <th title="Рекомендация закупки у производителя для SKU (тот же пул system, что и в таблице закупки ниже).">У пр-ля</th>
          <th title="Ранняя дата исчерпания по складам: MIN(stockout_date) в срезе; не фактическая дата отгрузки.">OOS (WB)</th>
          <th class="th-drill-wb-total" scope="col" title="Переключить вид на склады и отфильтровать этот nm_id (+ tech_size в URL); удобный drilldown.">Склады</th>
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

  /** Одна строка на SKU: риск и дни запаса по пулу system (WB∑+own); заказ (LT) как в supplier-витрине. */
  const THEAD_SYSTEM_TOTAL = `<tr>
          <th class="th-risk-wb-total" scope="col" title="Бакет по дням покрытия system: (WB∑+own) / Σ спрос (те же пороги 7/14/30 дн.)">Риск</th>
          <th class="th-vendor-wb-total" scope="col" title="vendor_code">vendor</th>
          <th scope="col" title="nm_id">nm_id</th>
          <th scope="col" title="tech_size">Размер</th>
          <th title="Сумма доступного на WB по сети">WB ∑</th>
          <th title="Наш склад (own)">Own</th>
          <th title="System = WB∑ + own — общий пул товара">System</th>
          <th title="Сумма forecast_daily_demand по складам WB">Спрос/день Σ</th>
          <th title="Дней покрытия по system: systemAvailable / Σспрос">Дн. system</th>
          <th title="System-level оценка: дата среза + floor(дней system) календарных дней при постоянном Σ-спросе; согласовано с «Дн. system». Не MIN(stockout_date) по складам WB и не посуточная симуляция.">OOS (system)</th>
          <th title="Довоз на WB (сеть)">На WB</th>
          <th title="Простая закупка у поставщика (targetCoverage), как в supplier «Заказать»">Заказать</th>
          <th title="План заказа с lead time — как в supplier «Заказ (LT)»">Заказ (LT)</th>
          <th class="th-drill-wb-total" scope="col" title="Разбивка по складам WB">Склады</th>
        </tr>`;

  function renderTableHeader(viewMode) {
    const thead = $("gridThead");
    if (!thead) return;
    let html = THEAD_WB_TOTAL;
    if (viewMode === "wbWarehouses") {
      html = THEAD_WAREHOUSES;
    } else if (viewMode === "systemTotal") {
      html = THEAD_SYSTEM_TOTAL;
    }
    thead.innerHTML = html;
    const grid = $("grid");
    if (grid) {
      grid.classList.toggle("grid-wb-total", viewMode !== "wbWarehouses");
    }
    const sqLab = $("systemQuickFilterLabel");
    if (sqLab) sqLab.hidden = viewMode !== "systemTotal";
  }

  function updateMainTableHint(viewMode) {
    const el = $("mainTableHintText");
    if (!el) return;
    if (viewMode === "wbWarehouses") {
      el.innerHTML =
        "Режим <strong>по складам WB</strong>: строка = склад × SKU. System = все WB + наш склад; WB ∑ = сумма по сети; WB лок. = этот склад. S/W/L — риск по уровням. " +
        "Колонка «На WB» — довоз с учётом network-запаса; закупка у производителя — в таблице ниже.";
    } else if (viewMode === "systemTotal") {
      el.innerHTML =
        "<strong>Запасы в целом</strong> — одна строка на SKU: пул <strong>system = WB по сети + наш склад (own)</strong>. Риск и фильтр «Дней запаса» считаются по <strong>дням system</strong> (не путать с режимом «WB в целом», где риск только по WB). " +
        "Колонки «Заказать» / «Заказ (LT)» совпадают по смыслу с таблицей закупки ниже. Сортировка: <strong>daysOfStockSystem</strong> ↑.";
    } else {
      el.innerHTML =
        "Режим <strong>WB в целом</strong> — одна строка на SKU по сети; клик по <strong>vendor / nm_id / размеру</strong> или кнопка <strong>«По складам»</strong> переключает вид на склады с фильтром по SKU (<code>q</code> + <code>techSize</code>). " +
        "Сортировка: <strong>daysOfStockWB</strong> ↑, затем <strong>forecastDailyDemandTotal</strong> ↓.";
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
    const leadTimeDays = leadTimeDaysFromForm();
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
    if (viewMode === "systemTotal") {
      const sqf = $("systemQuickFilter").value;
      if (sqf && sqf !== "all") p.set("systemQuickFilter", sqf);
    }
    if (warehouseKey) p.set("warehouseKey", warehouseKey);
    if (q) p.set("q", q);
    const tsf = $("techSizeFilter");
    const ts = tsf && tsf.value.trim();
    if (ts) p.set("techSize", ts);
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
    const leadTimeDays = leadTimeDaysFromForm();
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
    const tsf = $("techSizeFilter");
    const ts = tsf && tsf.value.trim();
    if (ts) p.set("techSize", ts);
    if (ownWarehouseCode) p.set("ownWarehouseCode", ownWarehouseCode);
    return p;
  }

  function drillDownToWarehousesFromWbTotal(nmId, techSize) {
    $("viewMode").value = "wbWarehouses";
    $("q").value = String(nmId);
    const tsf = $("techSizeFilter");
    if (tsf) tsf.value = techSize != null ? String(techSize) : "";
    setStatus("Переключение на склады WB по выбранному SKU…");
    syncUrlFromForm("push");
    loadWarehouses()
      .then(() => loadTable({ skipUrl: true }))
      .catch((e) => setStatus(e && e.message ? e.message : String(e)));
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
    const vm =
      data.viewMode === "wbWarehouses"
        ? "wbWarehouses"
        : data.viewMode === "systemTotal"
          ? "systemTotal"
          : "wbTotal";
    const rowLabel =
      vm === "wbWarehouses"
        ? "Всего строк (склад × SKU по фильтру)"
        : vm === "systemTotal"
          ? "Всего строк (SKU, запасы system по фильтру)"
          : "Всего строк (SKU по сети WB по фильтру)";
    const cells = [
      cell(
        rowLabel,
        data.totalRows,
        "",
        vm === "wbWarehouses"
          ? "Число строк warehouse×SKU после фильтров (как в основной таблице)."
          : vm === "systemTotal"
            ? "Число строк SKU в режиме «Запасы в целом» (как в таблице)."
            : "Число строк SKU (nm_id×размер) в режиме WB в целом после фильтров.",
      ),
      cell(
        "Critical · запас &lt; 7 дн.",
        r.critical,
        "risk-critical",
        `Строк с целыми днями запаса &lt; 7 (${vm === "systemTotal" ? "по system" : "в текущем виде"}) и фильтре (bucket critical).`,
      ),
      cell(
        "Warning · [7, 14) дн.",
        r.warning,
        "risk-warning",
        "Строк в диапазоне [7; 14) дней покрытия (bucket warning).",
      ),
      cell(
        "Attention · [14, 30) дн.",
        r.attention,
        "risk-attention",
        "Строк в диапазоне [14; 30) дней покрытия (bucket attention).",
      ),
      cell(
        "OK ≥30",
        r.ok,
        "risk-ok",
        "Строк с покрытием не менее 30 дней (bucket ok).",
      ),
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
          mode === "supplier"
            ? "Суммарная рекомендация «Заказать» у поставщика по уникальным SKU (витрина ниже); для режима wb здесь была бы сумма «На WB»."
            : "Сумма рекомендаций довоза на WB по строкам текущего вида (в режиме WB в целом — по SKU-сети).",
        ),
      );
      const wbSumLabel =
        vm === "wbWarehouses"
          ? "Σ на WB (по строкам склад×SKU, network−спрос)"
          : vm === "systemTotal"
            ? "Σ на WB (SKU, сеть WB — те же строки, что в таблице)"
            : "Σ на WB (SKU по сети, сумма рекомендаций «На WB»)";
      cells.push(
        cell(
          wbSumLabel,
          rep.recommendedToWBTotal,
          "",
          "Сумма столбца «На WB» по полному фильтру (без лимита таблицы): max(0, ceil( спрос×targetCoverage − WB∑ сети )) на строку.",
        ),
      );
      cells.push(
        cell(
          "Σ у производителя (уникальные SKU, см. таблицу ниже)",
          rep.recommendedFromSupplierTotal,
          "",
          "Сумма recommendedFromSupplier по SKU-витрине; riskStockout к supplier-списку не применяется.",
        ),
      );
      if (typeof rep.recommendedOrderQtyTotal === "number") {
        cells.push(
          cell(
            "Σ заказ (план lead time + покрытие после прихода)",
            rep.recommendedOrderQtyTotal,
            "",
            "Сумма recommendedOrderQty по тем же SKU и leadTime/coverage/safety, что в таблице закупки.",
          ),
        );
      }
      if (rep.ownWarehouseCode) {
        cells.push(
          cell(
            "own warehouse_code",
            rep.ownWarehouseCode,
            "",
            "Код строки own_stock_snapshots, использованный в расчёте own и system.",
          ),
        );
      }
    }
    const staleLabel =
      vm === "wbWarehouses"
        ? "Устаревший сток (строк склад×SKU)"
        : vm === "systemTotal"
          ? "Устаревший сток (строк SKU, system)"
          : "Устаревший сток (строк SKU по сети)";
    cells.push(
      cell(
        staleLabel,
        data.staleStockRowCount,
        "",
        "Строк, у которых дата stock_snapshot_at старше выбранной snapshotDate (построчно или по SKU в режиме WB в целом — см. сервер).",
      ),
      cell(
        "Сток snapshot min",
        data.oldestStockSnapshotAt ?? "—",
        "",
        "Минимальная отметка времени снимка остатка среди строк, попавших в KPI.",
      ),
      cell(
        "Сток snapshot max",
        data.newestStockSnapshotAt ?? "—",
        "",
        "Максимальная отметка времени снимка остатка среди строк KPI.",
      ),
    );
    el.innerHTML = cells.join("");
  }

  function cell(label, value, cls, title) {
    const v =
      typeof value === "number"
        ? String(value)
        : value == null
          ? "—"
          : String(value);
    const titleAttr =
      title != null && String(title).length > 0
        ? ` title="${escapeHtml(String(title))}"`
        : "";
    return `<div class="cell"${titleAttr}><span class="muted">${label}</span><strong class="${cls || ""}">${v}</strong></div>`;
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

  function clearExplainHighlights() {
    document.querySelectorAll(".explain-highlight-wb").forEach((el) => {
      el.classList.remove("explain-highlight-wb");
    });
    document.querySelectorAll(".explain-highlight-supplier").forEach((el) => {
      el.classList.remove("explain-highlight-supplier");
    });
  }

  /**
   * Подсветка ячеек в таблицах под выбранный тип расчёта.
   * @param {"wb"|"supplier"|null} explainFocus
   */
  function applyExplainHighlights(rowIdx, explainFocus) {
    clearExplainHighlights();
    if (explainFocus == null) return;
    const row = lastRows[rowIdx];
    if (!row) return;
    const trMain = document.querySelector(`#tbody tr[data-idx="${rowIdx}"]`);
    if (explainFocus === "wb" && trMain) {
      trMain.querySelector(".col-explain-wb")?.classList.add("explain-highlight-wb");
      return;
    }
    if (explainFocus === "supplier") {
      if (row.nmId == null) return;
      const supTr = findSupplierTableRowEl(row.nmId, row.techSize);
      supTr?.querySelector(".col-explain-supplier-order")?.classList.add("explain-highlight-supplier");
    }
  }

  function supplierRowKey(nmId, techSize) {
    return String(nmId ?? "") + "|" + encodeURIComponent(normTs(techSize));
  }

  function findSupplierTableRowEl(nmId, techSize) {
    const want = supplierRowKey(nmId, techSize);
    for (const tr of document.querySelectorAll("#supplierTbody tr[data-sup-key]")) {
      if (tr.getAttribute("data-sup-key") === want) return tr;
    }
    return null;
  }

  function renderRows(rows, viewMode) {
    clearExplainHighlights();
    lastRows = rows;
    const tb = $("tbody");
    const vm =
      viewMode === "wbWarehouses"
        ? "wbWarehouses"
        : viewMode === "systemTotal"
          ? "systemTotal"
          : "wbTotal";
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
          <td class="col-explain-wb col-metric-click" title="Клик — расчёт «На WB»">${formatInt(rep ? rep.recommendedToWB : null)}</td>
          <td>${escapeHtml(String(row.stockSnapshotAt ?? ""))}</td>
        </tr>`;
        })
        .join("");
    } else if (vm === "systemTotal") {
      tb.innerHTML = rows
        .map((row, idx) => {
          const inv = row.inventoryLevels;
          const rep = row.replenishment;
          const tsEnc = encodeURIComponent(String(row.techSize ?? ""));
          return `<tr class="tr-row tr-risk-${row.risk || "ok"}" data-idx="${idx}" data-drill-nm="${row.nmId}" data-drill-ts="${tsEnc}" tabindex="0" title="Запасы в целом по SKU; клик по ячейке — детали или расчёт">
          <td class="risk-cell risk-cell-wb-total"><span class="badge badge-wb-total ${badgeClass(row.risk)}">${escapeHtml(riskLabelWbTotal(row.risk))}</span></td>
          <td class="col-vendor-wb-total"><button type="button" class="wb-drill-link js-wb-drill" title="Показать строки по складам WB для этого SKU">${escapeHtml(String(row.vendorCode ?? ""))}</button></td>
          <td class="td-drill-nm"><button type="button" class="wb-drill-link tabular js-wb-drill" title="Показать строки по складам WB для этого SKU">${escapeHtml(String(row.nmId ?? ""))}</button></td>
          <td class="td-drill-size"><button type="button" class="wb-drill-link js-wb-drill" title="Показать строки по складам WB для этого SKU">${escapeHtml(String(row.techSize ?? ""))}</button></td>
          <td>${formatInt(row.wbAvailableTotal)}</td>
          <td>${formatInt(row.ownStock)}</td>
          <td>${formatInt(inv ? inv.systemAvailable : null)}</td>
          <td>${formatNum(row.forecastDailyDemandTotal)}</td>
          <td>${formatNum(row.daysOfStockSystem)}</td>
          <td>${escapeHtml(String(row.systemStockoutDateEstimate ?? ""))}</td>
          <td class="col-explain-wb col-metric-click" title="Клик — расчёт «На WB»">${formatInt(rep ? rep.recommendedToWB : null)}</td>
          <td class="col-explain-supplier-agg col-metric-click" title="Клик — закупка у производителя">${formatInt(row.recommendedFromSupplier)}</td>
          <td>${formatInt(row.recommendedOrderQty)}</td>
          <td class="td-drill-action"><button type="button" class="btn-drill-warehouses js-wb-drill" title="Показать этот SKU по складам WB">По складам</button></td>
        </tr>`;
        })
        .join("");
    } else {
      tb.innerHTML = rows
        .map((row, idx) => {
          const inv = row.inventoryLevels;
          const rep = row.replenishment;
          const tsEnc = encodeURIComponent(String(row.techSize ?? ""));
          return `<tr class="tr-row tr-risk-${row.risk || "ok"}" data-idx="${idx}" data-drill-nm="${row.nmId}" data-drill-ts="${tsEnc}" tabindex="0" title="Строка: детали; vendor / nm / размер / «По складам» — разбивка по складам">
          <td class="risk-cell risk-cell-wb-total"><span class="badge badge-wb-total ${badgeClass(row.risk)}">${escapeHtml(riskLabelWbTotal(row.risk))}</span></td>
          <td class="col-vendor-wb-total"><button type="button" class="wb-drill-link js-wb-drill" title="Показать строки по складам WB для этого SKU">${escapeHtml(String(row.vendorCode ?? ""))}</button></td>
          <td class="td-drill-nm"><button type="button" class="wb-drill-link tabular js-wb-drill" title="Показать строки по складам WB для этого SKU">${escapeHtml(String(row.nmId ?? ""))}</button></td>
          <td class="td-drill-size"><button type="button" class="wb-drill-link js-wb-drill" title="Показать строки по складам WB для этого SKU">${escapeHtml(String(row.techSize ?? ""))}</button></td>
          <td>${formatInt(row.wbAvailableTotal)}</td>
          <td>${formatInt(row.ownStock)}</td>
          <td>${formatInt(inv ? inv.systemAvailable : null)}</td>
          <td>${formatNum(row.daysOfStockWB)}</td>
          <td>${formatNum(row.forecastDailyDemandTotal)}</td>
          <td class="col-explain-wb col-metric-click" title="Клик — расчёт «На WB»">${formatInt(rep ? rep.recommendedToWB : null)}</td>
          <td class="col-explain-supplier-agg col-metric-click" title="Клик — закупка у производителя (как «У пр-ля»)">${formatInt(row.recommendedFromSupplier)}</td>
          <td>${escapeHtml(String(row.stockoutDateWB ?? ""))}</td>
          <td class="td-drill-action"><button type="button" class="btn-drill-warehouses js-wb-drill" title="Показать этот SKU по складам WB">По складам</button></td>
        </tr>`;
        })
        .join("");
    }
    $("detailPanel").hidden = false;
    $("detailHint").hidden = false;
    $("detailDl").innerHTML = "";
    setDetailExplain("");
  }

  function formatDetailVal(v) {
    if (v == null) return "—";
    if (typeof v === "number") return formatNum(v);
    return escapeHtml(String(v));
  }

  function normTs(ts) {
    return String(ts ?? "");
  }

  function findSupplierRow(nmId, techSize) {
    const want = normTs(techSize);
    for (const r of lastSupplierRows) {
      if (r && r.nmId === nmId && normTs(r.techSize) === want) return r;
    }
    return null;
  }

  /**
   * @param {object} rep replenishment
   * @param {{ forecastDailyDemand: number|null|undefined, ownStock: *, systemAvailable: * }} ctx
   */
  function htmlWbReplenishExplain(rep, ctx) {
    if (!rep) return "";
    const fd = Number(ctx.forecastDailyDemand);
    const tc = Number(rep.targetCoverageDays);
    if (!Number.isFinite(fd) || !Number.isFinite(tc) || tc <= 0) return "";
    const target = Number(rep.targetDemandWB);
    const wbSum = Number(rep.wbAvailableTotal);
    const rawGap = target - wbSum;
    const rec = Number(rep.recommendedToWB);
    const ownNum = Number(ctx.ownStock);
    const interpret =
      rec > 0
        ? `<div class="explain-callout explain-warning" role="status"><strong>⚠️ Не хватает товара на WB.</strong> Нужно довезти <strong>${formatInt(rec)}</strong> шт. Это покрывает <strong>${formatDetailVal(tc)}</strong> дн. при текущем спросе/день.</div>`
        : `<div class="explain-callout explain-success" role="status">✅ Запаса на WB достаточно для целевого покрытия.</div>`;
    const itog = `<div class="explain-result explain-result-itog" title="Та же цифра, что в колонке «На WB» основной таблицы"><span class="explain-itog-label">ИТОГ:</span> На WB → <strong class="explain-result-num">${formatInt(rec)}</strong> шт.</div>`;
    const ownNote =
      Number.isFinite(ownNum) && ownNum > 0
        ? `<p class="explain-own-note explain-muted"><strong>Важно:</strong> в расчёте «На WB» учитывается только запас на WB. Наш склад (ownStock) не влияет на эту рекомендацию.</p>`
        : "";
    return (
      `<section class="detail-explain detail-explain-wb" aria-label="Расчёт рекомендации На WB">` +
      `<div class="detail-explain-title">Расчёт «На WB» · <span class="explain-table-ref">колонка «На WB»</span></div>` +
      interpret +
      itog +
      `<p class="explain-formula">recommendedToWB = max(0, ceil(forecastDailyDemand × targetCoverageDays − wbAvailableTotal))</p>` +
      `<ol class="explain-steps">` +
      `<li><span class="explain-k">Спрос/день</span> — <strong>${formatNum(fd)}</strong></li>` +
      `<li><span class="explain-k">Целевое покрытие</span> — <strong>${formatDetailVal(tc)}</strong> дн.</li>` +
      `<li><span class="explain-k">Нужно на WB (цель)</span> — ${formatNum(fd)} × ${formatDetailVal(tc)} = <strong>${formatNum(target)}</strong> шт.</li>` +
      `<li><span class="explain-k">Уже на WB по сети</span> — <strong>${formatInt(wbSum)}</strong> шт.</li>` +
      `<li><span class="explain-k">Разрыв до цели</span> — ${formatNum(target)} − ${formatInt(wbSum)} = ${formatNum(rawGap)} → округление вверх при необходимости</li>` +
      `</ol>` +
      ownNote +
      `</section>`
    );
  }

  function htmlSupplierOrderExplain(s) {
    if (!s) return "";
    const d = Number(s.systemDailyDemand);
    const lt = Number(s.leadTimeDays);
    const cov = Number(s.orderCoverageDays);
    const safe = Number(s.safetyDays ?? 0);
    const wb = Number(s.wbAvailableTotal);
    const own = Number(s.ownStock);
    const sysNow = Number(s.systemAvailable);
    const cons = d * lt;
    const stockArr = Number(s.stockAtArrival);
    const reqAfter = d * (cov + safe);
    const gap = reqAfter - stockArr;
    const stockout = Boolean(s.willStockoutBeforeArrival);
    const covLabel = cov;
    const daysX = s.daysUntilStockout;
    const xOk = daysX != null && Number.isFinite(Number(daysX));
    const xNum = xOk ? Number(daysX) : null;
    let interpretLead = "";
    if (stockout) {
      let extra = "";
      if (xOk && Number.isFinite(lt)) {
        const deficitD = lt - xNum;
        extra = `<br />Дефицит: <strong>${formatNum(deficitD)}</strong> дн. (разница срока поставки <strong>${formatInt(lt)}</strong> дн. и запаса <strong>${formatNum(xNum)}</strong> дн.).`;
      } else if (!xOk) {
        extra = `<br />Оценка дней до OOS недоступна (нулевой спрос или нет данных).`;
      }
      interpretLead =
        `<div class="explain-callout explain-warning" role="status"><strong>⚠️ Дефицит до прихода поставки</strong><br />` +
        `Запас закончится через <strong>${xOk ? formatNum(xNum) : "—"}</strong> дн., поставка через <strong>${formatInt(lt)}</strong> дн.${extra}</div>`;
    } else {
      interpretLead = `<div class="explain-callout explain-success" role="status">✅ Запаса хватит до прихода поставки</div>`;
    }
    const itogSimple = `<div class="explain-result explain-result-itog explain-result-supplier" title="Колонка «Заказать» в таблице закупки ниже"><span class="explain-itog-label">ИТОГ:</span> Заказать → <strong class="explain-result-num">${formatInt(s.recommendedFromSupplier)}</strong> шт.</div>`;
    const itogLt = `<div class="explain-result explain-result-itog explain-result-supplier explain-result-supplier-secondary" title="Колонка «Заказ (LT)» — план с lead time и покрытием после прихода"><span class="explain-itog-label">ИТОГ:</span> Заказ (LT) → <strong class="explain-result-num">${formatInt(s.recommendedOrderQty)}</strong> шт.</div>`;
    return (
      `<section class="detail-explain detail-explain-supplier" aria-label="Расчёт заказа у поставщика">` +
      `<div class="detail-explain-title">Закупка у поставщика · <span class="explain-table-ref">колонки «Заказать» и «Заказ (LT)»</span></div>` +
      interpretLead +
      itogSimple +
      itogLt +
      `<p class="explain-formula">` +
      `consumptionDuringLeadTime = systemDailyDemand × leadTimeDays; ` +
      `stockAtArrival = systemAvailableNow − consumptionDuringLeadTime; ` +
      `requiredAfterArrival = systemDailyDemand × (coverageDays + safetyDays); ` +
      `recommendedOrderQty = max(0, ceil(requiredAfterArrival − stockAtArrival))` +
      `</p>` +
      `<dl class="explain-inputs">` +
      `<dt>Входы</dt><dd>systemDailyDemand ${formatNum(d)} · leadTime ${formatDetailVal(lt)} д · coverageDays ${formatDetailVal(covLabel)} · safetyDays ${formatDetailVal(safe)} · WB∑ ${formatInt(wb)} · ownStock ${formatInt(own)} · systemAvailableNow ${formatInt(sysNow)}</dd>` +
      `</dl>` +
      `<ol class="explain-steps">` +
      `<li><span class="explain-k">Списание за lead time</span> — ${formatNum(d)} × ${formatDetailVal(lt)} = <strong>${formatNum(cons)}</strong> шт. «сгорит» до прихода</li>` +
      `<li><span class="explain-k">На момент прихода</span> — systemAvailableNow − списание = ${formatInt(sysNow)} − ${formatNum(cons)} = <strong>${formatNum(stockArr)}</strong> (stockAtArrival)</li>` +
      `<li class="${stockout ? "explain-warn" : ""}"><span class="explain-k">До прихода хватит?</span> — ${
        stockout
          ? "<strong>Нет</strong> — запас к приходу отрицательный (риск обрыва на линии WB)."
          : "Да, остаток при приходе ≥ 0."
      }</li>` +
      `<li><span class="explain-k">Нужно после прихода</span> — ${formatNum(d)} × (${formatDetailVal(covLabel)} + ${formatDetailVal(safe)}) = <strong>${formatNum(reqAfter)}</strong> шт.</li>` +
      `<li><span class="explain-k">Разрыв до цели после прихода</span> — ${formatNum(reqAfter)} − ${formatNum(stockArr)} = ${formatNum(gap)}</li>` +
      `</ol>` +
      `<p class="explain-muted explain-supplier-foot">«Заказать» — простая рекомендация по targetCoverage; «Заказ (LT)» — учёт lead time и цели после прихода (как в формулах выше).</p>` +
      `</section>`
    );
  }

  function setDetailExplain(html) {
    const el = $("detailExplain");
    if (!el) return;
    if (!html) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML = html;
  }

  /** Расшифровка плана поставщика или короткая подсказка, если строка не в загруженной витрине. */
  function supplierExplainBlock(sup) {
    if (sup) return htmlSupplierOrderExplain(sup);
    return `<div class="explain-missing-block"><p class="explain-muted explain-missing"><strong>Нет данных по поставщику для этого SKU</strong> — возможно, SKU не попал в текущий фильтр.</p><p class="explain-muted">→ попробуйте сбросить фильтр или увеличить limit.</p></div>`;
  }

  function renderDetail(row, explainFocus) {
    if (!row) {
      clearExplainHighlights();
      $("detailHint").hidden = false;
      $("detailDl").innerHTML = "";
      setDetailExplain("");
      return;
    }
    $("detailHint").hidden = true;
    const focus = explainFocus === "wb" || explainFocus === "supplier" ? explainFocus : null;
    const sup =
      row.nmId != null ? findSupplierRow(row.nmId, row.techSize) : null;
    if (row.viewKind === "systemTotal") {
      const inv = row.inventoryLevels;
      const rep = row.replenishment;
      const pairs = [
        ["Режим строки", "Запасы в целом (system = WB∑ + own по SKU)"],
        ["Bucket риска (по дням запаса system)", row.risk],
        ["nm_id", row.nmId],
        ["Размер", row.techSize],
        ["vendor_code", row.vendorCode],
        ["WB ∑ (сеть)", formatInt(row.wbAvailableTotal)],
        ["ownStock", formatInt(row.ownStock)],
        ["systemAvailable", formatInt(inv ? inv.systemAvailable : null)],
        ["Спрос/день Σ", formatNum(row.forecastDailyDemandTotal)],
        ["Дней запаса (system)", formatNum(row.daysOfStockSystem)],
        [
          "OOS (system) — оценка: snapshot + floor(дней system)",
          row.systemStockoutDateEstimate ?? "—",
        ],
        ["Сток snapshot (MIN по складам)", row.stockSnapshotAtSystem ?? "—"],
        [
          "wbRisk / systemRisk",
          inv ? [inv.wbRisk, inv.systemRisk].join(" / ") : "—",
        ],
        ["Рекомендация на WB (сеть)", formatInt(rep ? rep.recommendedToWB : null)],
        ["Заказать (простой)", formatInt(row.recommendedFromSupplier)],
        ["Заказ (LT)", formatInt(row.recommendedOrderQty)],
        ["Риск до прихода (план LT)", row.willStockoutBeforeArrival ? "да" : "нет"],
      ];
      $("detailDl").innerHTML = pairs
        .map(
          ([k, v]) =>
            `<dt>${escapeHtml(k)}</dt><dd>${
              typeof v === "number" ? formatDetailVal(v) : escapeHtml(String(v))
            }</dd>`,
        )
        .join("");
      setDetailExplainForFocus("systemTotal", focus, rep, {
        forecastDailyDemand: row.forecastDailyDemandTotal,
        ownStock: row.ownStock,
        systemAvailable: inv ? inv.systemAvailable : null,
        sup,
      });
      return;
    }
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
      setDetailExplainForFocus("wbTotal", focus, rep, {
        forecastDailyDemand: row.forecastDailyDemandTotal,
        ownStock: row.ownStock,
        systemAvailable: inv ? inv.systemAvailable : null,
        sup,
      });
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
    const invWh = row.inventoryLevels;
    setDetailExplainForFocus("wbWarehouses", focus, rep, {
      forecastDailyDemand: row.forecastDailyDemand,
      ownStock: invWh ? invWh.ownStock : null,
      systemAvailable: invWh ? invWh.systemAvailable : null,
      sup,
    });
  }

  /**
   * Секция расчёта только при клике на метрику; порядок: расчёт → детали (разметка в HTML).
   * @param {"wbTotal"|"systemTotal"|"wbWarehouses"} viewKind
   * @param {"wb"|"supplier"|null} focus
   */
  function setDetailExplainForFocus(viewKind, focus, rep, ctx) {
    if (focus == null) {
      setDetailExplain("");
      return;
    }
    if (focus === "wb") {
      const h = htmlWbReplenishExplain(rep, {
        forecastDailyDemand: ctx.forecastDailyDemand,
        ownStock: ctx.ownStock,
        systemAvailable: ctx.systemAvailable,
      });
      setDetailExplain(
        h ||
          `<p class="explain-muted explain-missing">Расчёт «На WB» недоступен: нет replenishment или не задано целевое покрытие (targetCoverageDays).</p>`,
      );
      return;
    }
    if (focus === "supplier") {
      if (viewKind === "wbWarehouses") {
        setDetailExplain(
          `<p class="explain-muted explain-missing">Закупка у производителя в этой таблице не показана — откройте режим «Запасы в целом» / «WB в целом» или таблицу закупки ниже.</p>`,
        );
        return;
      }
      setDetailExplain(supplierExplainBlock(ctx.sup));
    }
  }

  function selectRow(idx, explainFocus) {
    if (idx < 0 || idx >= lastRows.length) return;
    document.querySelectorAll("#tbody tr").forEach((tr) => tr.classList.remove("tr-selected"));
    const tr = document.querySelector(`#tbody tr[data-idx="${idx}"]`);
    if (tr) tr.classList.add("tr-selected");
    const row = lastRows[idx] || null;
    const xf =
      explainFocus === "wb" || explainFocus === "supplier" ? explainFocus : null;
    renderDetail(row, xf);
    applyExplainHighlights(idx, xf);
  }

  async function loadWarehouses() {
    const p = queryParams();
    const data = await api(`/api/forecast/warehouse-keys?${p}`);
    const sel = $("warehouseKey");
    const current = sel.value;
    const fromUrl = pendingWarehouseKeyFromUrl;
    pendingWarehouseKeyFromUrl = null;
    sel.innerHTML = '<option value="">Все</option>';
    for (const k of data.warehouseKeys || []) {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = k;
      sel.appendChild(o);
    }
    const prefer = fromUrl !== null ? fromUrl : current;
    if ([...sel.options].some((o) => o.value === prefer)) {
      sel.value = prefer;
    }
  }

  function renderSupplierRows(rows) {
    const tb = $("supplierTbody");
    if (!tb) return;
    tb.innerHTML = (rows || [])
      .map(
        (r) =>
          `<tr data-sup-key="${String(supplierRowKey(r.nmId, r.techSize)).replace(/"/g, "&quot;")}">
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
          <td class="col-explain-supplier-order"><strong>${formatInt(r.recommendedFromSupplier)}</strong></td>
          <td>${formatNum(r.stockAtArrival)}</td>
          <td><strong>${formatInt(r.recommendedOrderQty)}</strong></td>
          <td>${r.willStockoutBeforeArrival ? '<span class="badge badge-critical">да</span>' : "нет"}</td>
        </tr>`,
      )
      .join("");
  }

  async function loadTable(opts) {
    const skipUrl = opts && opts.skipUrl;
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
      rowsPayload.viewMode === "wbWarehouses"
        ? "wbWarehouses"
        : rowsPayload.viewMode === "systemTotal"
          ? "systemTotal"
          : "wbTotal";
    renderTableHeader(viewMode);
    updateMainTableHint(viewMode);
    renderSummary({ ...sum, viewMode });
    const list = rowsPayload.rows || [];
    renderRows(list, viewMode);
    lastSupplierRows = supPayload.rows || [];
    renderSupplierRows(lastSupplierRows);
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
    if (!skipUrl) {
      syncUrlFromForm("replace");
    }
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
      const drill = ev.target.closest(".js-wb-drill");
      if (drill) {
        ev.preventDefault();
        const tr = drill.closest("tr[data-drill-nm]");
        if (!tr) return;
        const rawNm = tr.getAttribute("data-drill-nm");
        const tsEnc = tr.getAttribute("data-drill-ts") || "";
        const nmId = rawNm != null ? Number(rawNm) : NaN;
        const techSize =
          tsEnc.length > 0 ? decodeURIComponent(tsEnc) : "";
        if (!Number.isFinite(nmId)) return;
        drillDownToWarehousesFromWbTotal(nmId, techSize);
        return;
      }
      const tr = ev.target.closest("tr[data-idx]");
      if (!tr) return;
      const idx = parseInt(tr.dataset.idx, 10);
      let explainFocus = null;
      if (ev.target.closest(".col-explain-wb")) {
        explainFocus = "wb";
      } else if (ev.target.closest(".col-explain-supplier-agg")) {
        explainFocus = "supplier";
      }
      selectRow(idx, explainFocus);
    });
    $("tbody").addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const tr = ev.target.closest("tr[data-idx]");
      if (!tr) return;
      ev.preventDefault();
      selectRow(parseInt(tr.dataset.idx, 10), null);
    });
  }

  applyFormFromUrl();
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
    "systemQuickFilter",
  ].forEach((id) => {
    $(id).addEventListener("change", () => {
      loadWarehouses()
        .then(loadTable)
        .catch((e) => setStatus(e && e.message ? e.message : String(e)));
    });
  });

  $("leadTimeDays").addEventListener("blur", leadTimeDaysFromForm);

  wireTableClicks();

  $("q").addEventListener("input", () => {
    const tsf = $("techSizeFilter");
    if (tsf) tsf.value = "";
  });

  window.addEventListener("popstate", () => {
    applyFormFromUrl();
    renderTableHeader($("viewMode").value);
    updateMainTableHint($("viewMode").value);
    loadWarehouses()
      .then(() => loadTable({ skipUrl: true }))
      .catch((e) => setStatus(e && e.message ? e.message : String(e)));
  });

  loadWarehouses()
    .then(loadTable)
    .catch((e) => setStatus(e && e.message ? e.message : String(e)));
})();
