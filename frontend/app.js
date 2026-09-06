(function () {
  "use strict";

  /* ================= کمکی‌ها ================= */
  var $ = function (id) { return document.getElementById(id); };
  var FA = "۰۱۲۳۴۵۶۷۸۹";

  function fa(value) { return String(value).replace(/\d/g, function (d) { return FA[d]; }); }
  function group(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "٬"); }
  function faNum(n) { return fa(group(n)); }

  function money(n) {
    if (!n) return { v: "—", u: "" };
    // یک رقم اعشار تا صد واحد، تا ۲۴٫۵ به «۲۵» گرد نشود.
    if (n >= 1e12) return { v: fa(trim(n / 1e12)), u: "هزار میلیارد" };
    if (n >= 1e9) return { v: fa(trim(n / 1e9)), u: "میلیارد" };
    if (n >= 1e6) return { v: fa((n / 1e6).toFixed(0)), u: "میلیون" };
    return { v: faNum(n), u: "" };
  }

  function trim(x) {
    return (x < 100 ? x.toFixed(1) : x.toFixed(0)).replace(/\.0$/, "").replace(".", "٫");
  }

  function faDate(s) { return s ? fa(s) : "—"; }

  function bytes(n) {
    if (n < 1024) return fa(n) + " بایت";
    if (n < 1048576) return fa((n / 1024).toFixed(0)) + " کیلوبایت";
    return fa((n / 1048576).toFixed(1)) + " مگابایت";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    var date = new Intl.DateTimeFormat("fa-IR-u-ca-persian",
      { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    var time = new Intl.DateTimeFormat("fa-IR",
      { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    return date + " — " + time;
  }

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)cs_csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  var toastTimer = null;
  function toast(message, kind) {
    var el = $("toast");
    el.textContent = message;
    el.className = "toast" + (kind === "err" ? " err" : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, kind === "err" ? 7000 : 3500);
  }

  /* ================= لایه ارتباط با سرور ================= */
  async function api(path, options) {
    options = options || {};
    var headers = options.headers || {};
    if (options.body && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    if ((options.method || "GET") !== "GET") headers["X-CSRF-Token"] = csrf();

    var res = await fetch(path, Object.assign({}, options, { headers: headers }));
    if (res.status === 401) { window.location.replace("/login"); throw new Error("نشست منقضی شد."); }
    if (res.status === 204) return null;

    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.detail) || "خطای غیرمنتظره رخ داد.");
    return data;
  }

  /* ================= وضعیت صفحه ================= */
  var state = {
    me: null,
    section: null,
    rows: [],
    total: 0,
    page: 1,
    perPage: 50,
    editing: null,     // قرارداد در حال ویرایش، یا null برای ثبت جدید
    viewing: null,
    importFile: null,
  };

  var SECTION_FA = { technical: "فنی", financial: "امور مالی", hr: "منابع انسانی" };
  var STATUS_FA = { live: "جاری", soon: "رو به انقضا", over: "منقضی", unknown: "نامشخص" };

  var FIELDS = [
    ["contract_number", "شماره قرارداد/تفاهم‌نامه", "text", true],
    ["party", "طرف قرارداد", "text", false],
    ["subject", "موضوع", "textarea", false],
    ["unit_name", "واحد مربوطه", "text", false],
    ["numbered_on", "تاریخ شماره‌گذاری", "date", false],
    ["start", "تاریخ شروع", "date", false],
    ["duration_text", "مدت", "text", false],
    ["end", "تاریخ پایان", "date", false],
    ["amount_rial", "مبلغ / تأمین مالی (ریال)", "text", false],
    ["guarantees", "تضامین قرارداد", "textarea", false],
    ["counterparty_people", "عوامل طرف قرارداد", "textarea", false],
    ["site", "ساختگاه / محل اجرا", "text", false],
    ["capacity", "ظرفیت", "text", false],
    ["storage_location", "محل نگهداری اصل", "text", false],
    ["addendum", "الحاقیه", "textarea", false],
    ["scan_link", "لینک اسکن (ارجاع خارجی)", "text", false],
    ["notes", "سایر موارد", "textarea", false],
  ];

  /* ================= بارگذاری و رندر ================= */
  async function loadMe() {
    state.me = await api("/api/auth/me");
    if (state.me.must_change_password) { window.location.replace("/login"); return; }

    $("whoami").innerHTML = "<b>" + esc(state.me.full_name || state.me.username) + "</b> — " +
      esc({ admin: "مدیر سامانه", editor: "کارشناس", viewer: "مشاهده‌گر" }[state.me.role]);

    var canWrite = state.me.role === "admin" || state.me.role === "editor";
    $("newBtn").hidden = !canWrite;
    $("importBtn").hidden = !canWrite;
    $("usersBtn").hidden = state.me.role !== "admin";
    $("auditBtn").hidden = state.me.role !== "admin";

    var tabs = $("tabs");
    tabs.innerHTML = state.me.sections.map(function (s) {
      return '<button class="tab" data-section="' + s + '">' + esc(SECTION_FA[s]) + "</button>";
    }).join("");
    if (!state.me.sections.length) {
      tabs.innerHTML = '<span class="tab">هیچ بخشی به شما تخصیص نیافته است</span>';
      return;
    }
    state.section = state.me.sections[0];
    tabs.addEventListener("click", function (ev) {
      var btn = ev.target.closest(".tab[data-section]");
      if (!btn) return;
      state.section = btn.getAttribute("data-section");
      state.page = 1;
      refresh();
    });
  }

  function params() {
    var p = new URLSearchParams();
    p.set("section", state.section);
    p.set("page", state.page);
    p.set("per_page", state.perPage);
    var q = $("q").value.trim();
    if (q) p.set("q", q);
    if ($("fKind").value) p.set("kind", $("fKind").value);
    if ($("fStatus").value) p.set("status", $("fStatus").value);
    if ($("sort").value) p.set("sort", $("sort").value);
    return p;
  }

  async function refresh() {
    if (!state.section) return;
    Array.prototype.forEach.call(document.querySelectorAll(".tab[data-section]"), function (t) {
      t.classList.toggle("active", t.getAttribute("data-section") === state.section);
    });
    var data = await api("/api/contracts?" + params().toString());
    state.rows = data.items;
    state.total = data.total;
    renderTiles();
    renderTable();
  }

  function tile(cls, k, v, n) {
    return '<div class="tile ' + cls + '"><span class="k">' + esc(k) + '</span>' +
      '<span class="v">' + esc(v) + '</span><span class="n">' + esc(n) + "</span></div>";
  }

  function renderTiles() {
    var rows = state.rows;
    var count = function (s) { return rows.filter(function (r) { return r.status === s; }).length; };
    var sum = rows.reduce(function (a, r) { return a + r.amount_rial; }, 0);
    var m = money(sum);
    var contracts = rows.filter(function (r) { return r.kind === "contract"; }).length;
    $("tiles").innerHTML =
      tile("t-total", "اسناد این بخش", fa(rows.length),
           fa(contracts) + " قرارداد · " + fa(rows.length - contracts) + " تفاهم‌نامه") +
      tile("t-over", "منقضی‌شده", fa(count("over")), "نیازمند تعیین تکلیف") +
      tile("t-soon", "رو به انقضا", fa(count("soon")), "کمتر از ۹۰ روز تا پایان") +
      tile("t-live", "جاری", fa(count("live")), "بدون هشدار مهلت") +
      tile("t-sum", "مجموع تعهدات", m.v, (m.u ? m.u + " ریال" : "ریال"));
  }

  function renderTable() {
    var body = $("tbody");
    $("count").textContent = "نمایش " + fa(state.rows.length) + " از " + fa(state.total) + " سند";
    $("empty").hidden = state.rows.length > 0;

    body.innerHTML = state.rows.map(function (r) {
      var m = money(r.amount_rial);
      var remain = r.days_remaining == null ? "—"
        : (r.days_remaining < 0 ? fa(Math.abs(r.days_remaining)) + " روز گذشته"
                                : fa(r.days_remaining) + " روز مانده");
      var flags = "";
      if (r.addendum) flags += '<span class="flag">الحاقیه</span>';
      if (r.attachments.length) flags += '<span class="flag">' + fa(r.attachments.length) + " پیوست</span>";

      return '<tr class="s-' + r.status + '" data-id="' + r.id + '" tabindex="0">' +
        '<td class="stripe"><span class="pill p-' + r.status + '">' + esc(r.status_fa) + "</span></td>" +
        '<td class="c-num">' + esc(r.contract_number) + "</td>" +
        '<td><span class="chip ' + (r.kind === "contract" ? "k-contract" : "k-mou") + '">' +
          esc(r.kind_fa) + "</span></td>" +
        '<td class="c-strong">' + esc(r.party || "—") + '<div class="flags">' + flags + "</div></td>" +
        '<td class="c-wide">' + esc(r.subject || "—") + "</td>" +
        '<td class="c-amount">' + (r.amount_rial
          ? esc(m.v) + ' <span class="unit">' + esc(m.u) + "</span>"
          : '<span class="unit">بدون تعهد مالی</span>') + "</td>" +
        '<td><div class="dates"><b>' + esc(faDate(r.start_jalali)) + "</b><span>←</span><b>" +
          esc(faDate(r.end_jalali)) + "</b></div>" +
          (r.percent_elapsed != null
            ? '<div class="bar"><span style="width:' + Math.min(r.percent_elapsed, 100) + '%"></span></div>'
            : "") +
          '<div class="remain">' + esc(remain) + (r.duration_text ? " · " + esc(r.duration_text) : "") +
        "</div></td></tr>";
    }).join("");
  }

  /* ================= کشوی مشاهده ================= */
  function dl(label, value, muted) {
    return "<dt>" + esc(label) + "</dt><dd" + (muted ? ' class="muted"' : "") + ">" +
      (value || "—") + "</dd>";
  }

  function openView(id) {
    var r = state.rows.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    state.viewing = r;

    var canWrite = state.me.role === "admin" || state.me.role === "editor";
    $("viewTitle").textContent = r.subject || r.contract_number;
    $("editBtn").hidden = !canWrite;
    $("deleteBtn").hidden = !canWrite;

    var m = money(r.amount_rial);
    var remain = r.days_remaining == null ? "—"
      : (r.days_remaining < 0 ? fa(Math.abs(r.days_remaining)) + " روز از پایان گذشته"
                              : fa(r.days_remaining) + " روز تا پایان");
    var elapsed = (r.days_total != null && r.percent_elapsed != null)
      ? fa(r.days_elapsed) + " روز از " + fa(r.days_total) + " روز (٪" + fa(r.percent_elapsed) + ")"
      : "—";

    var files = r.attachments.length
      ? '<div class="files">' + r.attachments.map(function (a) {
          return '<div class="file-row" data-att="' + a.id + '">' +
            '<span class="nm">' + esc(a.filename) + "</span>" +
            '<span class="sz">' + esc(bytes(a.size_bytes)) + "</span>" +
            '<button class="btn btn-sm" data-act="preview">پیش‌نمایش</button>' +
            '<a class="btn btn-sm" href="/api/attachments/' + a.id + '/download">دریافت</a>' +
            (canWrite ? '<button class="btn btn-sm btn-danger" data-act="rm">حذف</button>' : "") +
            "</div>";
        }).join("") + "</div>"
      : '<p class="note">هنوز اسکنی برای این سند بارگذاری نشده است.</p>';

    $("viewBody").innerHTML =
      '<div class="sect">شناسه سند</div><dl class="dl">' +
        dl("بخش", esc(r.section_fa)) +
        dl("نوع", '<span class="chip ' + (r.kind === "contract" ? "k-contract" : "k-mou") + '">' +
          esc(r.kind_fa) + "</span>") +
        dl("شماره", esc(r.contract_number)) +
        dl("تاریخ شماره‌گذاری", esc(faDate(r.numbered_on_jalali))) +
        dl("واحد مربوطه", esc(r.unit_name)) +
        dl("طرف قرارداد", esc(r.party)) +
      "</dl>" +
      '<div class="sect">مهلت و مدت</div><dl class="dl">' +
        dl("وضعیت", '<span class="pill p-' + r.status + '">' + esc(r.status_fa) + "</span>") +
        dl("تاریخ شروع", esc(faDate(r.start_jalali))) +
        dl("مدت", esc(r.duration_text)) +
        dl("تاریخ پایان", esc(faDate(r.end_jalali))) +
        dl("روزهای باقیمانده", esc(remain)) +
        dl("مدت سپری‌شده", esc(elapsed)) +
      "</dl>" +
      '<div class="sect">مالی و تضامین</div><dl class="dl">' +
        dl("مبلغ / تأمین مالی", r.amount_rial
          ? faNum(r.amount_rial) + " ریال<br><span style=\"color:var(--ink-3);font-size:12px\">" +
            esc(m.v + " " + m.u) + " ریال</span>"
          : "بدون تعهد مالی") +
        dl("تضامین قرارداد", esc(r.guarantees)) +
      "</dl>" +
      '<div class="sect">اجرا</div><dl class="dl">' +
        dl("ساختگاه / محل اجرا", esc(r.site)) +
        dl("ظرفیت", esc(r.capacity)) +
        dl("عوامل طرف قرارداد", esc(r.counterparty_people)) +
      "</dl>" +
      '<div class="sect">مدارک و سوابق</div><dl class="dl">' +
        dl("محل نگهداری اصل", esc(r.storage_location)) +
        dl("الحاقیه", r.addendum ? esc(r.addendum) : "ندارد", !r.addendum) +
        dl("لینک اسکن", r.scan_link
          ? (/^https?:/i.test(r.scan_link)
              ? '<a href="' + esc(r.scan_link) + '" target="_blank" rel="noopener">باز کردن</a>'
              : esc(r.scan_link))
          : "ثبت نشده", !r.scan_link) +
        dl("سایر موارد", r.notes ? esc(r.notes) : "—", !r.notes) +
        dl("آخرین تغییر", esc(when(r.updated_at))) +
      "</dl>" +
      '<div class="sect">اسکن قرارداد</div>' + files +
      (canWrite
        ? '<div style="margin-top:12px"><button class="btn btn-sm" id="addFileBtn">' +
          "افزودن اسکن (PDF، JPG یا PNG)</button></div>"
        : "");

    if (canWrite) {
      $("addFileBtn").addEventListener("click", function () { $("fileInput").click(); });
    }
    openPanel("viewDrawer");
  }

  /* ================= فرم ثبت و ویرایش ================= */
  function field(name, label, type, required, value) {
    var attrs = 'id="f_' + name + '" name="' + name + '"' + (required ? " required" : "");
    var control = type === "textarea"
      ? "<textarea " + attrs + ">" + esc(value || "") + "</textarea>"
      : '<input ' + attrs + ' value="' + esc(value || "") + '">';
    var hint = type === "date"
      ? '<span class="hint">شمسی یا میلادی — میلادی خودکار به شمسی تبدیل می‌شود.</span>'
      : (name === "amount_rial" ? '<span class="hint">ارقام فارسی و جداکننده مجاز است.</span>' : "");
    return '<div class="field"><label for="f_' + name + '">' + esc(label) + "</label>" +
      control + hint + "</div>";
  }

  function openForm(existing) {
    state.editing = existing || null;
    var r = existing || {};
    $("formTitle").textContent = existing ? "ویرایش سند" : "ثبت سند تازه";

    var sectionOptions = state.me.sections.map(function (s) {
      var selected = (r.section || state.section) === s ? " selected" : "";
      return '<option value="' + s + '"' + selected + ">" + esc(SECTION_FA[s]) + "</option>";
    }).join("");

    // در فرم، تاریخِ نبود باید خالی بماند نه «—»، وگرنه هنگام ثبت به‌عنوان
    // تاریخ نامعتبر رد می‌شود.
    var blank = function (v) { return v ? fa(v) : ""; };
    var pairs = { numbered_on: blank(r.numbered_on_jalali), start: blank(r.start_jalali),
                  end: blank(r.end_jalali) };

    $("formBody").innerHTML =
      '<div class="note" id="formError" hidden></div>' +
      '<div class="grid-2">' +
        '<div class="field"><label for="f_section">بخش</label>' +
          '<select id="f_section">' + sectionOptions + "</select></div>" +
        '<div class="field"><label for="f_kind">نوع سند</label><select id="f_kind">' +
          '<option value="contract"' + (r.kind === "mou" ? "" : " selected") + ">قرارداد</option>" +
          '<option value="mou"' + (r.kind === "mou" ? " selected" : "") + ">تفاهم‌نامه</option>" +
        "</select></div>" +
      "</div>" +
      FIELDS.map(function (f) {
        var value = pairs.hasOwnProperty(f[0]) ? pairs[f[0]] : r[f[0]];
        if (f[0] === "amount_rial" && value) value = faNum(value);
        return field(f[0], f[1], f[2], f[3], value);
      }).join("");

    openPanel("formDrawer");
    $("f_contract_number").focus();
  }

  function collect() {
    var payload = { section: $("f_section").value, kind: $("f_kind").value };
    FIELDS.forEach(function (f) { payload[f[0]] = $("f_" + f[0]).value.trim(); });
    if (state.editing) payload.version = state.editing.version;
    return payload;
  }

  async function save() {
    var box = $("formError");
    box.hidden = true;
    var payload = collect();
    if (!payload.contract_number) {
      box.className = "note err";
      box.textContent = "شماره قرارداد الزامی است.";
      box.hidden = false;
      return;
    }
    $("saveBtn").disabled = true;
    try {
      if (state.editing) {
        await api("/api/contracts/" + state.editing.id, { method: "PUT", body: payload });
        toast("تغییرات ثبت شد.");
      } else {
        await api("/api/contracts", { method: "POST", body: payload });
        toast("سند تازه ثبت شد.");
      }
      closePanels();
      await refresh();
    } catch (err) {
      box.className = "note err";
      box.textContent = err.message;
      box.hidden = false;
    } finally {
      $("saveBtn").disabled = false;
    }
  }

  /* ================= پیش‌نمایش پیوست ================= */
  function openPreview(attachmentId, filename, contentType) {
    $("previewTitle").textContent = filename;
    $("previewBody").innerHTML = /^image\//.test(contentType)
      ? '<img class="preview-img" src="/api/attachments/' + attachmentId + '/inline" alt="' +
        esc(filename) + '">'
      : '<iframe class="preview-frame" src="/api/attachments/' + attachmentId +
        '/inline" title="' + esc(filename) + '"></iframe>';
    $("previewModal").hidden = false;
  }

  async function uploadFile(file) {
    if (!state.viewing) return;
    var form = new FormData();
    form.append("file", file);
    try {
      await api("/api/attachments/contract/" + state.viewing.id, { method: "POST", body: form });
      toast("اسکن بارگذاری شد.");
      await refresh();
      openView(state.viewing.id);
    } catch (err) {
      toast(err.message, "err");
    }
  }

  /* ================= درون‌ریزی اکسل ================= */
  async function runImport(dryRun) {
    if (!state.importFile) return toast("اول فایل را انتخاب کنید.", "err");
    var form = new FormData();
    form.append("file", state.importFile);
    form.append("default_section", $("importSection").value);
    form.append("dry_run", dryRun ? "true" : "false");

    $("dryBtn").disabled = $("commitBtn").disabled = true;
    try {
      var report = await api("/api/imports/xlsx", { method: "POST", body: form });
      var kind = report.errors.length ? "warn" : "ok";
      $("importReport").className = "note " + kind;
      $("importReport").innerHTML =
        "<b>" + (report.dry_run ? "بررسی آزمایشی" : "درون‌ریزی انجام شد") + ".</b> " +
        "کل سطرها: " + fa(report.total_rows) + " · آماده: " + fa(report.ready) +
        " · رد شده: " + fa(report.skipped) +
        (report.dry_run ? "" : " · ثبت‌شده: " + fa(report.imported)) +
        (report.errors.length
          ? '<div class="errors-list" style="margin-top:8px">' +
            report.errors.map(function (e) { return "<div>" + esc(e) + "</div>"; }).join("") + "</div>"
          : "");
      $("importReport").hidden = false;
      $("commitBtn").hidden = report.ready === 0;
      if (!report.dry_run) { await refresh(); }
    } catch (err) {
      $("importReport").className = "note err";
      $("importReport").textContent = err.message;
      $("importReport").hidden = false;
    } finally {
      $("dryBtn").disabled = $("commitBtn").disabled = false;
    }
  }

  /* ================= کاربران و ممیزی ================= */
  async function openUsers() {
    var users = await api("/api/users");
    $("usersBody").innerHTML =
      '<div class="note" id="userError" hidden></div>' +
      '<div class="table-scroll"><table><thead><tr>' +
        "<th>نام کاربری</th><th>نام</th><th>نقش</th><th>بخش‌ها</th><th>وضعیت</th><th></th>" +
      "</tr></thead><tbody>" +
      users.map(function (u) {
        return '<tr data-user="' + u.id + '" style="cursor:default">' +
          '<td class="c-num">' + esc(u.username) + "</td>" +
          "<td>" + esc(u.full_name || "—") + "</td>" +
          "<td>" + esc({ admin: "مدیر سامانه", editor: "کارشناس", viewer: "مشاهده‌گر" }[u.role]) + "</td>" +
          "<td>" + esc(u.sections.map(function (s) { return SECTION_FA[s]; }).join("، ") || "—") + "</td>" +
          '<td><span class="pill ' + (u.is_active ? "p-live" : "p-over") + '">' +
            (u.is_active ? "فعال" : "غیرفعال") + "</span></td>" +
          '<td><button class="btn btn-sm" data-act="toggle">' +
            (u.is_active ? "غیرفعال کن" : "فعال کن") + "</button></td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="sect">افزودن کاربر</div>' +
      '<div class="grid-2">' +
        '<div class="field"><label for="nu_username">نام کاربری</label><input id="nu_username"></div>' +
        '<div class="field"><label for="nu_full">نام و نام خانوادگی</label><input id="nu_full"></div>' +
        '<div class="field"><label for="nu_pass">رمز عبور اولیه</label><input id="nu_pass" type="text"></div>' +
        '<div class="field"><label for="nu_role">نقش</label><select id="nu_role">' +
          '<option value="viewer">مشاهده‌گر</option><option value="editor">کارشناس</option>' +
          '<option value="admin">مدیر سامانه</option></select></div>' +
      "</div>" +
      '<div class="field"><label>بخش‌های مجاز</label><div style="display:flex;gap:14px;flex-wrap:wrap">' +
        Object.keys(SECTION_FA).map(function (s) {
          return '<label style="font-size:13px;display:flex;gap:5px;align-items:center">' +
            '<input type="checkbox" class="nu-sec" value="' + s + '" style="width:auto;min-height:0">' +
            esc(SECTION_FA[s]) + "</label>";
        }).join("") + "</div></div>" +
      '<button class="btn btn-primary" id="addUserBtn">ایجاد کاربر</button>';

    $("addUserBtn").addEventListener("click", async function () {
      var box = $("userError");
      box.hidden = true;
      try {
        await api("/api/users", {
          method: "POST",
          body: {
            username: $("nu_username").value.trim(),
            full_name: $("nu_full").value.trim(),
            password: $("nu_pass").value,
            role: $("nu_role").value,
            sections: Array.prototype.map.call(
              document.querySelectorAll(".nu-sec:checked"), function (c) { return c.value; }),
          },
        });
        toast("کاربر ایجاد شد.");
        openUsers();
      } catch (err) {
        box.className = "note err";
        box.textContent = err.message;
        box.hidden = false;
      }
    });

    $("usersBody").addEventListener("click", async function (ev) {
      var btn = ev.target.closest('[data-act="toggle"]');
      if (!btn) return;
      var id = btn.closest("[data-user]").getAttribute("data-user");
      var row = users.filter(function (u) { return String(u.id) === id; })[0];
      try {
        await api("/api/users/" + id, { method: "PATCH", body: { is_active: !row.is_active } });
        openUsers();
      } catch (err) { toast(err.message, "err"); }
    });

    $("usersModal").hidden = false;
  }

  async function openAudit() {
    var data = await api("/api/audit?per_page=200");
    $("auditBody").innerHTML =
      '<p class="note">رکوردهای ممیزی در سطح پایگاه داده فقط‌افزودنی هستند و قابل ویرایش یا حذف نیستند.</p>' +
      '<div class="table-scroll"><table><thead><tr>' +
        "<th>زمان</th><th>کاربر</th><th>عملیات</th><th>شرح</th><th>فیلد</th>" +
        "<th>مقدار قبلی</th><th>مقدار جدید</th><th>IP</th>" +
      "</tr></thead><tbody>" +
      data.items.map(function (r) {
        return '<tr style="cursor:default">' +
          '<td class="c-num">' + esc(when(r.at)) + "</td>" +
          "<td>" + esc(r.username) + "</td>" +
          "<td>" + esc(r.action_fa) + "</td>" +
          '<td class="c-wide">' + esc(r.summary) + "</td>" +
          "<td>" + esc(r.field_fa || "—") + "</td>" +
          "<td>" + esc(r.old_value || "—") + "</td>" +
          "<td>" + esc(r.new_value || "—") + "</td>" +
          '<td class="c-num">' + esc(r.ip || "—") + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="count" style="margin-top:10px">مجموع ' + fa(data.total) + " رکورد ثبت‌شده.</p>";
    $("auditModal").hidden = false;
  }

  /* ================= کشو و پنجره ================= */
  function openPanel(id) {
    closePanels();
    $(id).classList.add("open");
    $("scrim").classList.add("open");
  }
  function closePanels() {
    Array.prototype.forEach.call(document.querySelectorAll(".drawer"), function (d) {
      d.classList.remove("open");
    });
    $("scrim").classList.remove("open");
  }
  function closeModals() {
    Array.prototype.forEach.call(document.querySelectorAll(".modal"), function (m) {
      m.hidden = true;
    });
    $("previewBody").innerHTML = "";  // بارگذاری فایل را متوقف می‌کند
  }

  /* ================= رویدادها ================= */
  function wire() {
    ["q", "fKind", "fStatus", "sort"].forEach(function (id) {
      $(id).addEventListener("change", function () { state.page = 1; refresh(); });
    });
    var typingTimer = null;
    $("q").addEventListener("input", function () {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(function () { state.page = 1; refresh(); }, 300);
    });

    $("tbody").addEventListener("click", function (ev) {
      var tr = ev.target.closest("tr[data-id]");
      if (tr) openView(+tr.getAttribute("data-id"));
    });
    $("tbody").addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      var tr = ev.target.closest("tr[data-id]");
      if (tr) { ev.preventDefault(); openView(+tr.getAttribute("data-id")); }
    });

    $("newBtn").addEventListener("click", function () { openForm(null); });
    $("editBtn").addEventListener("click", function () { openForm(state.viewing); });
    $("saveBtn").addEventListener("click", save);
    $("cancelBtn").addEventListener("click", closePanels);
    $("viewClose").addEventListener("click", closePanels);
    $("formClose").addEventListener("click", closePanels);
    $("scrim").addEventListener("click", closePanels);

    $("deleteBtn").addEventListener("click", async function () {
      var r = state.viewing;
      if (!r) return;
      if (!window.confirm("سند «" + (r.contract_number) + "» حذف شود؟\n" +
          "حذف نرم است: رکورد در پایگاه داده باقی می‌ماند و در ممیزی ثبت می‌شود.")) return;
      try {
        await api("/api/contracts/" + r.id, { method: "DELETE" });
        toast("سند حذف شد.");
        closePanels();
        await refresh();
      } catch (err) { toast(err.message, "err"); }
    });

    $("viewBody").addEventListener("click", async function (ev) {
      var row = ev.target.closest("[data-att]");
      if (!row) return;
      var id = +row.getAttribute("data-att");
      var att = (state.viewing.attachments || []).filter(function (a) { return a.id === id; })[0];
      if (ev.target.closest('[data-act="preview"]')) {
        openPreview(id, att.filename, att.content_type);
      } else if (ev.target.closest('[data-act="rm"]')) {
        if (!window.confirm("پیوست «" + att.filename + "» حذف شود؟")) return;
        try {
          await api("/api/attachments/" + id, { method: "DELETE" });
          toast("پیوست حذف شد.");
          await refresh();
          openView(state.viewing.id);
        } catch (err) { toast(err.message, "err"); }
      }
    });

    $("fileInput").addEventListener("change", function (ev) {
      if (ev.target.files && ev.target.files[0]) uploadFile(ev.target.files[0]);
      ev.target.value = "";
    });

    $("exportBtn").addEventListener("click", function () {
      window.location.href = "/api/contracts/export?section=" + state.section;
    });
    $("templateBtn").addEventListener("click", function () {
      window.location.href = "/api/contracts/template";
    });

    $("importBtn").addEventListener("click", function () {
      state.importFile = null;
      $("importReport").hidden = true;
      $("commitBtn").hidden = true;
      $("importFileName").textContent = "فایلی انتخاب نشده";
      $("importSection").innerHTML = state.me.sections.map(function (s) {
        return '<option value="' + s + '"' + (s === state.section ? " selected" : "") + ">" +
          esc(SECTION_FA[s]) + "</option>";
      }).join("");
      $("importModal").hidden = false;
    });
    $("pickImport").addEventListener("click", function () { $("importInput").click(); });
    $("importInput").addEventListener("change", function (ev) {
      state.importFile = ev.target.files && ev.target.files[0];
      $("importFileName").textContent = state.importFile ? state.importFile.name : "فایلی انتخاب نشده";
      $("importReport").hidden = true;
      $("commitBtn").hidden = true;
    });
    $("dryBtn").addEventListener("click", function () { runImport(true); });
    $("commitBtn").addEventListener("click", function () { runImport(false); });

    $("usersBtn").addEventListener("click", openUsers);
    $("auditBtn").addEventListener("click", openAudit);
    Array.prototype.forEach.call(document.querySelectorAll("[data-close-modal]"), function (b) {
      b.addEventListener("click", closeModals);
    });

    $("logoutBtn").addEventListener("click", async function () {
      try { await api("/api/auth/logout", { method: "POST" }); } catch (e) { /* بی‌اثر */ }
      window.location.replace("/login");
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { closeModals(); closePanels(); }
    });
  }

  /* ================= شروع ================= */
  (async function start() {
    try {
      await loadMe();
      wire();
      await refresh();
    } catch (err) {
      toast(err.message || "بارگذاری سامانه ناموفق بود.", "err");
    }
  })();
})();
