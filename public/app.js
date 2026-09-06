(function(){
  "use strict";
  var $ = function(id){ return document.getElementById(id); };
  var FA = "۰۱۲۳۴۵۶۷۸۹";
  function fa(v){ return String(v).replace(/\d/g, function(d){ return FA[d]; }); }
  function group(n){ return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "٬"); }
  function faNum(n){ return fa(group(n)); }
  function faDate(s){ return s ? fa(s) : "—"; }
  function trim(x){ return (x < 100 ? x.toFixed(1) : x.toFixed(0)).replace(/\.0$/, "").replace(".", "٫"); }
  function money(n){
    if (!n) return { v:"—", u:"" };
    if (n >= 1e12) return { v: fa(trim(n/1e12)), u:"هزار میلیارد" };
    if (n >= 1e9)  return { v: fa(trim(n/1e9)),  u:"میلیارد" };
    if (n >= 1e6)  return { v: fa((n/1e6).toFixed(0)), u:"میلیون" };
    return { v: faNum(n), u:"" };
  }
  function bytes(n){
    if (n < 1024) return fa(n) + " بایت";
    if (n < 1048576) return fa((n/1024).toFixed(0)) + " کیلوبایت";
    return fa((n/1048576).toFixed(1)) + " مگابایت";
  }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]; });
  }
  function when(iso){
    var d = new Date(iso); if (isNaN(d)) return "—";
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian",
      { year:"numeric", month:"2-digit", day:"2-digit" }).format(d) + " — " +
      new Intl.DateTimeFormat("fa-IR", { hour:"2-digit", minute:"2-digit", hour12:false }).format(d);
  }
  var toastTimer = null;
  function toast(msg, kind){
    var el = $("toast"); if (!el){ el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
    el.textContent = msg; el.className = "toast" + (kind === "err" ? " err" : ""); el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ el.hidden = true; }, kind === "err" ? 7000 : 3500);
  }

  var state = { me:null, csrf:"", section:null, rows:[], viewing:null, editing:null, importFile:null };
  var SECTION_FA = { technical:"فنی", financial:"امور مالی", hr:"منابع انسانی" };

  async function api(path, opts){
    opts = opts || {};
    var headers = opts.headers || {};
    if (opts.body && !(opts.body instanceof ArrayBuffer) && typeof opts.body !== "string"){
      headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.body);
    }
    if ((opts.method || "GET") !== "GET") headers["X-CSRF-Token"] = state.csrf;
    var res = await fetch(path, Object.assign({}, opts, { headers: headers }));
    if (res.status === 401){ window.location.replace("/login.html"); throw new Error("نشست منقضی شد."); }
    var data = null; try { data = await res.json(); } catch(e){}
    if (!res.ok) throw new Error((data && data.error) || "خطای غیرمنتظره.");
    return data;
  }

  var FIELDS = [
    ["number","شماره قرارداد/تفاهم‌نامه","text"], ["party","طرف قرارداد","text"],
    ["subject","موضوع","textarea"], ["unit","واحد مربوطه","text"],
    ["numberedOn","تاریخ شماره‌گذاری","date"], ["start","تاریخ شروع","date"],
    ["duration","مدت","text"], ["end","تاریخ پایان","date"],
    ["amount","مبلغ / تأمین مالی (ریال)","text"], ["guarantees","تضامین قرارداد","textarea"],
    ["people","عوامل طرف قرارداد","textarea"], ["site","ساختگاه / محل اجرا","text"],
    ["capacity","ظرفیت","text"], ["storage","محل نگهداری اصل","text"],
    ["addendum","الحاقیه","textarea"], ["scanLink","لینک اسکن (ارجاع خارجی)","text"],
    ["notes","سایر موارد","textarea"]
  ];
  var has = function(p){ return state.me && state.me.perms.indexOf(p) > -1; };

  async function loadMe(){
    state.me = await api("/api/auth/me");
    state.csrf = state.me.csrf;
    if (state.me.mustChange){ window.location.replace("/login.html"); return; }
    $("whoami").innerHTML = "<b>" + esc(state.me.name || state.me.username) + "</b> — " + esc(state.me.roleName);
    $("newBtn").hidden = !has("edit");
    $("importBtn").hidden = !has("import");
    $("exportBtn").hidden = !has("export");
    $("usersBtn").hidden = !has("manage_users");
    $("auditBtn").hidden = !has("view_audit");

    var tabs = $("tabs");
    if (!state.me.sections.length){
      tabs.innerHTML = '<span class="tab">هیچ بخشی به شما تخصیص نیافته است</span>'; return;
    }
    tabs.innerHTML = state.me.sections.map(function(s){
      return '<button class="tab" data-section="'+s+'">' + esc(SECTION_FA[s]) + "</button>"; }).join("");
    state.section = state.me.sections[0];
    tabs.addEventListener("click", function(ev){
      var b = ev.target.closest(".tab[data-section]"); if (!b) return;
      state.section = b.getAttribute("data-section"); refresh();
    });
  }

  async function refresh(){
    if (!state.section) return;
    Array.prototype.forEach.call(document.querySelectorAll(".tab[data-section]"), function(t){
      t.classList.toggle("active", t.getAttribute("data-section") === state.section); });
    var p = new URLSearchParams({ section: state.section });
    if ($("q").value.trim()) p.set("q", $("q").value.trim());
    if ($("fKind").value)   p.set("kind", $("fKind").value);
    if ($("fStatus").value) p.set("status", $("fStatus").value);
    if ($("sort").value)    p.set("sort", $("sort").value);
    var data = await api("/api/contracts?" + p.toString());
    state.rows = data.items;
    renderTiles(); renderTable();
  }

  function tile(cls, k, v, n){
    return '<div class="tile '+cls+'"><span class="k">'+esc(k)+'</span><span class="v">'+esc(v)+
           '</span><span class="n">'+esc(n)+"</span></div>";
  }
  function renderTiles(){
    var r = state.rows;
    var cnt = function(s){ return r.filter(function(x){ return x.status === s; }).length; };
    var m = money(r.reduce(function(a,x){ return a + (x.amount||0); }, 0));
    var contractCount = r.filter(function(x){ return x.kind === "contract"; }).length;
    $("tiles").innerHTML =
      tile("t-total","اسناد این بخش", fa(r.length),
           fa(contractCount)+" قرارداد · "+fa(r.length-contractCount)+" تفاهم‌نامه") +
      tile("t-over","منقضی‌شده", fa(cnt("over")), "نیازمند تعیین تکلیف") +
      tile("t-soon","رو به انقضا", fa(cnt("soon")), "کمتر از ۹۰ روز تا پایان") +
      tile("t-live","جاری", fa(cnt("live")), "بدون هشدار مهلت") +
      tile("t-sum","مجموع تعهدات", m.v, (m.u ? m.u+" ریال" : "ریال"));
  }
  function renderTable(){
    $("count").textContent = "نمایش " + fa(state.rows.length) + " سند";
    $("empty").hidden = state.rows.length > 0;
    $("tbody").innerHTML = state.rows.map(function(r){
      var m = money(r.amount);
      var rem = r.daysRemaining == null ? "—"
        : (r.daysRemaining < 0 ? fa(Math.abs(r.daysRemaining))+" روز گذشته"
                               : fa(r.daysRemaining)+" روز مانده");
      var flags = "";
      if (r.addendum) flags += '<span class="flag">الحاقیه</span>';
      if (r.attachments && r.attachments.length)
        flags += '<span class="flag">'+fa(r.attachments.length)+" پیوست</span>";
      return '<tr class="s-'+r.status+'" data-id="'+r.id+'" tabindex="0">'+
        '<td class="stripe"><span class="pill p-'+r.status+'">'+esc(r.statusFa)+"</span></td>"+
        '<td class="c-num">'+esc(r.number)+"</td>"+
        '<td><span class="chip '+(r.kind==="contract"?"k-contract":"k-mou")+'">'+esc(r.kindFa)+"</span></td>"+
        '<td class="c-strong">'+esc(r.party||"—")+'<div class="flags">'+flags+"</div></td>"+
        '<td class="c-wide">'+esc(r.subject||"—")+"</td>"+
        '<td class="c-amount">'+(r.amount ? esc(m.v)+' <span class="unit">'+esc(m.u)+"</span>"
                                          : '<span class="unit">بدون تعهد مالی</span>')+"</td>"+
        '<td><div class="dates"><b>'+esc(faDate(r.start))+"</b><span>←</span><b>"+
          esc(faDate(r.end))+"</b></div>"+
          (r.percent != null ? '<div class="bar"><span style="width:'+Math.min(r.percent,100)+'%"></span></div>' : "")+
          '<div class="remain">'+esc(rem)+(r.duration?" · "+esc(r.duration):"")+"</div></td></tr>";
    }).join("");
  }

  function dl(k, v, muted){ return "<dt>"+esc(k)+"</dt><dd"+(muted?' class="muted"':"")+">"+(v||"—")+"</dd>"; }
  function openView(id){
    var r = state.rows.filter(function(x){ return x.id === id; })[0];
    if (!r) return;
    state.viewing = r;
    $("viewTitle").textContent = r.subject || r.number;
    $("editBtn").hidden = !has("edit");
    $("deleteBtn").hidden = !has("delete");
    var m = money(r.amount);
    var rem = r.daysRemaining == null ? "—"
      : (r.daysRemaining < 0 ? fa(Math.abs(r.daysRemaining))+" روز از پایان گذشته"
                             : fa(r.daysRemaining)+" روز تا پایان");
    var elapsed = (r.daysTotal != null && r.percent != null)
      ? fa(r.daysElapsed)+" روز از "+fa(r.daysTotal)+" روز (٪"+fa(r.percent)+")" : "—";
    var files = (r.attachments && r.attachments.length)
      ? '<div class="files">' + r.attachments.map(function(a){
          return '<div class="file-row" data-att="'+a.id+'"><span class="nm">'+esc(a.name)+"</span>"+
            '<span class="sz">'+esc(bytes(a.size))+"</span>"+
            '<button class="btn btn-sm" data-act="preview">پیش‌نمایش</button>'+
            '<a class="btn btn-sm" href="/api/contracts/'+r.id+'/attachments/'+a.id+'/download">دریافت</a>'+
            (has("upload") ? '<button class="btn btn-sm btn-danger" data-act="rm">حذف</button>' : "")+
            "</div>"; }).join("") + "</div>"
      : '<p class="note">هنوز اسکنی برای این سند بارگذاری نشده است.</p>';

    $("viewBody").innerHTML =
      '<div class="sect">شناسه سند</div><dl class="dl">'+
        dl("بخش", esc(SECTION_FA[r.section]))+
        dl("نوع", '<span class="chip '+(r.kind==="contract"?"k-contract":"k-mou")+'">'+esc(r.kindFa)+"</span>")+
        dl("شماره", esc(r.number))+ dl("تاریخ شماره‌گذاری", esc(faDate(r.numberedOn)))+
        dl("واحد مربوطه", esc(r.unit))+ dl("طرف قرارداد", esc(r.party))+"</dl>"+
      '<div class="sect">مهلت و مدت</div><dl class="dl">'+
        dl("وضعیت", '<span class="pill p-'+r.status+'">'+esc(r.statusFa)+"</span>")+
        dl("تاریخ شروع", esc(faDate(r.start)))+ dl("مدت", esc(r.duration))+
        dl("تاریخ پایان", esc(faDate(r.end)))+ dl("روزهای باقیمانده", esc(rem))+
        dl("مدت سپری‌شده", esc(elapsed))+"</dl>"+
      '<div class="sect">مالی و تضامین</div><dl class="dl">'+
        dl("مبلغ / تأمین مالی", r.amount
          ? faNum(r.amount)+' ریال<br><span style="color:var(--ink-3);font-size:12px">'+esc(m.v+" "+m.u)+" ریال</span>"
          : "بدون تعهد مالی")+
        dl("تضامین قرارداد", esc(r.guarantees))+"</dl>"+
      '<div class="sect">اجرا</div><dl class="dl">'+
        dl("ساختگاه / محل اجرا", esc(r.site))+ dl("ظرفیت", esc(r.capacity))+
        dl("عوامل طرف قرارداد", esc(r.people))+"</dl>"+
      '<div class="sect">مدارک و سوابق</div><dl class="dl">'+
        dl("محل نگهداری اصل", esc(r.storage))+
        dl("الحاقیه", r.addendum ? esc(r.addendum) : "ندارد", !r.addendum)+
        dl("لینک اسکن", r.scanLink
          ? (/^https?:/i.test(r.scanLink)
              ? '<a href="'+esc(r.scanLink)+'" target="_blank" rel="noopener">باز کردن</a>' : esc(r.scanLink))
          : "ثبت نشده", !r.scanLink)+
        dl("سایر موارد", r.notes ? esc(r.notes) : "—", !r.notes)+
        dl("آخرین تغییر", esc(when(r.updatedAt)))+"</dl>"+
      '<div class="sect">اسکن قرارداد</div>'+files+
      (has("upload") ? '<div style="margin-top:12px"><button class="btn btn-sm" id="addFileBtn">افزودن اسکن (PDF، JPG یا PNG)</button></div>' : "");
    if (has("upload")) $("addFileBtn").addEventListener("click", function(){ $("fileInput").click(); });
    openPanel("viewDrawer");
  }

  function field(name, label, type, value){
    var attrs = 'id="f_'+name+'" name="'+name+'"';
    var ctrl = type === "textarea"
      ? "<textarea "+attrs+">"+esc(value||"")+"</textarea>"
      : '<input '+attrs+' value="'+esc(value||"")+'">';
    var hint = type === "date"
      ? '<span class="hint">شمسی یا میلادی — میلادی خودکار به شمسی تبدیل می‌شود.</span>'
      : (name === "amount" ? '<span class="hint">ارقام فارسی و جداکننده مجاز است.</span>' : "");
    return '<div class="field"><label for="f_'+name+'">'+esc(label)+"</label>"+ctrl+hint+"</div>";
  }
  function openForm(existing){
    state.editing = existing || null;
    var r = existing || {};
    $("formTitle").textContent = existing ? "ویرایش سند" : "ثبت سند تازه";
    var opts = state.me.sections.map(function(s){
      return '<option value="'+s+'"'+((r.section||state.section)===s?" selected":"")+">"+esc(SECTION_FA[s])+"</option>";
    }).join("");
    $("formBody").innerHTML =
      '<div class="note" id="formError" hidden></div>'+
      '<div class="grid-2">'+
        '<div class="field"><label for="f_section">بخش</label><select id="f_section">'+opts+"</select></div>"+
        '<div class="field"><label for="f_kind">نوع سند</label><select id="f_kind">'+
          '<option value="contract"'+(r.kind==="mou"?"":" selected")+">قرارداد</option>"+
          '<option value="mou"'+(r.kind==="mou"?" selected":"")+">تفاهم‌نامه</option></select></div></div>"+
      FIELDS.map(function(f){
        var v = r[f[0]];
        if (f[2] === "date") v = v ? fa(v) : "";
        if (f[0] === "amount" && v) v = faNum(v);
        return field(f[0], f[1], f[2], v);
      }).join("");
    openPanel("formDrawer");
    $("f_number").focus();
  }
  async function save(){
    var box = $("formError"); box.hidden = true;
    var payload = { section:$("f_section").value, kind:$("f_kind").value };
    FIELDS.forEach(function(f){ payload[f[0]] = $("f_"+f[0]).value.trim(); });
    if (state.editing) payload.version = state.editing.version;
    if (!payload.number){ box.className="note err"; box.textContent="شماره قرارداد الزامی است."; box.hidden=false; return; }
    $("saveBtn").disabled = true;
    try {
      if (state.editing){ await api("/api/contracts/"+state.editing.id, { method:"PUT", body:payload }); toast("تغییرات ثبت شد."); }
      else { await api("/api/contracts", { method:"POST", body:payload }); toast("سند تازه ثبت شد."); }
      closePanels(); await refresh();
    } catch(err){ box.className="note err"; box.textContent = err.message; box.hidden = false; }
    finally { $("saveBtn").disabled = false; }
  }

  function openPreview(cid, a){
    $("previewTitle").textContent = a.name;
    var src = "/api/contracts/"+cid+"/attachments/"+a.id+"/inline";
    $("previewBody").innerHTML = /^image\//.test(a.type)
      ? '<img class="preview-img" src="'+src+'" alt="'+esc(a.name)+'">'
      : '<iframe class="preview-frame" src="'+src+'" title="'+esc(a.name)+'"></iframe>';
    $("previewModal").hidden = false;
  }
  async function uploadFile(file){
    if (!state.viewing) return;
    try {
      var buf = await file.arrayBuffer();
      await api("/api/contracts/"+state.viewing.id+"/attachments", { method:"POST", body: buf,
        headers:{ "Content-Type":"application/octet-stream", "X-File-Name": encodeURIComponent(file.name) } });
      toast("اسکن بارگذاری شد.");
      await refresh(); openView(state.viewing.id);
    } catch(err){ toast(err.message, "err"); }
  }

  async function runImport(commit){
    if (!state.importFile) return toast("اول فایل را انتخاب کنید.", "err");
    $("dryBtn").disabled = true; if ($("commitBtn")) $("commitBtn").disabled = true;
    try {
      var buf = await state.importFile.arrayBuffer();
      var rep = await api("/api/import?section="+$("importSection").value+(commit?"&commit=1":""),
        { method:"POST", body: buf, headers:{ "Content-Type":"application/octet-stream" } });
      var box = $("importReport");
      box.className = "note " + (rep.errors.length ? "warn" : "ok");
      box.innerHTML = "<b>"+(rep.dryRun ? "بررسی آزمایشی" : "درون‌ریزی انجام شد")+".</b> "+
        "کل سطرها: "+fa(rep.total)+" · آماده: "+fa(rep.ready)+" · رد شده: "+fa(rep.skipped)+
        (rep.dryRun ? "" : " · ثبت‌شده: "+fa(rep.imported))+
        (rep.errors.length ? '<div class="errors-list" style="margin-top:8px">'+
          rep.errors.map(function(e){ return "<div>"+esc(e)+"</div>"; }).join("")+"</div>" : "");
      box.hidden = false;
      $("commitBtn").hidden = rep.ready === 0 || !rep.dryRun;
      if (!rep.dryRun) await refresh();
    } catch(err){
      var b = $("importReport"); b.className="note err"; b.textContent=err.message; b.hidden=false;
    } finally { $("dryBtn").disabled = false; if ($("commitBtn")) $("commitBtn").disabled = false; }
  }

  async function openUsers(){
    var d = await api("/api/users");
    var roleOpts = d.roles.map(function(r){ return '<option value="'+r.id+'">'+esc(r.name)+"</option>"; }).join("");
    $("usersBody").innerHTML =
      '<div class="note" id="userError" hidden></div>'+
      '<div class="table-scroll"><table><thead><tr><th>نام کاربری</th><th>نام</th><th>نقش</th>'+
      "<th>بخش‌ها</th><th>وضعیت</th><th></th></tr></thead><tbody>"+
      d.users.map(function(u){
        return '<tr data-user="'+u.id+'" style="cursor:default">'+
          '<td class="c-num">'+esc(u.username)+"</td><td>"+esc(u.name||"—")+"</td><td>"+esc(u.roleName)+"</td>"+
          "<td>"+esc(u.sections.map(function(s){ return SECTION_FA[s]; }).join("، ")||"—")+"</td>"+
          '<td><span class="pill '+(u.active?"p-live":"p-over")+'">'+(u.active?"فعال":"غیرفعال")+"</span></td>"+
          '<td><button class="btn btn-sm" data-act="toggle">'+(u.active?"غیرفعال کن":"فعال کن")+"</button></td></tr>";
      }).join("")+"</tbody></table></div>"+
      '<div class="sect">افزودن کاربر</div><div class="grid-2">'+
        '<div class="field"><label for="nu_username">نام کاربری</label><input id="nu_username"></div>'+
        '<div class="field"><label for="nu_name">نام و نام خانوادگی</label><input id="nu_name"></div>'+
        '<div class="field"><label for="nu_pass">رمز عبور اولیه</label><input id="nu_pass" type="text"></div>'+
        '<div class="field"><label for="nu_role">نقش</label><select id="nu_role">'+roleOpts+"</select></div></div>"+
      '<div class="field"><label>بخش‌های مجاز</label><div style="display:flex;gap:14px;flex-wrap:wrap">'+
        d.sections.map(function(s){
          return '<label style="font-size:13px;display:flex;gap:5px;align-items:center">'+
            '<input type="checkbox" class="nu-sec" value="'+s.key+'" style="width:auto;min-height:0">'+esc(s.label)+"</label>";
        }).join("")+"</div></div>"+
      '<button class="btn btn-primary" id="addUserBtn">ایجاد کاربر</button>';

    $("addUserBtn").addEventListener("click", async function(){
      var box = $("userError"); box.hidden = true;
      try {
        await api("/api/users", { method:"POST", body:{
          username:$("nu_username").value.trim(), name:$("nu_name").value.trim(),
          password:$("nu_pass").value, roleId:$("nu_role").value,
          sections: Array.prototype.map.call(document.querySelectorAll(".nu-sec:checked"), function(c){ return c.value; }) }});
        toast("کاربر ایجاد شد."); openUsers();
      } catch(err){ box.className="note err"; box.textContent=err.message; box.hidden=false; }
    });
    $("usersBody").addEventListener("click", async function(ev){
      var b = ev.target.closest('[data-act="toggle"]'); if (!b) return;
      var id = +b.closest("[data-user]").getAttribute("data-user");
      var u = d.users.filter(function(x){ return x.id === id; })[0];
      try { await api("/api/users/"+id, { method:"PATCH", body:{ active: !u.active } }); openUsers(); }
      catch(err){ toast(err.message, "err"); }
    });
    $("usersModal").hidden = false;
  }

  async function openAudit(){
    var d = await api("/api/audit?limit=200");
    var chain = await api("/api/audit/verify");
    $("auditBody").innerHTML =
      '<p class="note '+(chain.ok ? "ok" : "err")+'">'+
        (chain.ok
          ? "زنجیره درهم‌سازی سالم است — هر "+fa(chain.lines)+" رکورد ممیزی دست‌نخورده‌اند."
          : "هشدار: زنجیره ممیزی از سطر "+fa(chain.brokenAt)+" شکسته است. یعنی رکوردی حذف یا دستکاری شده.")+
      "</p>"+
      '<div class="table-scroll"><table><thead><tr><th>زمان</th><th>کاربر</th><th>عملیات</th>'+
      "<th>شرح</th><th>فیلد</th><th>مقدار قبلی</th><th>مقدار جدید</th><th>IP</th></tr></thead><tbody>"+
      d.items.map(function(r){
        return '<tr style="cursor:default"><td class="c-num">'+esc(when(r.at))+"</td>"+
          "<td>"+esc(r.user||"—")+"</td><td>"+esc(r.actionFa)+"</td>"+
          '<td class="c-wide">'+esc(r.summary)+"</td><td>"+esc(r.fieldFa||"—")+"</td>"+
          "<td>"+esc(r.old||"—")+"</td><td>"+esc(r.new||"—")+"</td>"+
          '<td class="c-num">'+esc(r.ip||"—")+"</td></tr>";
      }).join("")+"</tbody></table></div>"+
      '<p class="count" style="margin-top:10px">مجموع '+fa(d.total)+" رکورد.</p>";
    $("auditModal").hidden = false;
  }

  function openPanel(id){
    closePanels(); $(id).classList.add("open"); $("scrim").classList.add("open");
  }
  function closePanels(){
    Array.prototype.forEach.call(document.querySelectorAll(".drawer"), function(d){ d.classList.remove("open"); });
    $("scrim").classList.remove("open");
  }
  function closeModals(){
    Array.prototype.forEach.call(document.querySelectorAll(".modal"), function(m){ m.hidden = true; });
    $("previewBody").innerHTML = "";
  }

  function wire(){
    ["q","fKind","fStatus","sort"].forEach(function(id){ $(id).addEventListener("change", refresh); });
    var t = null;
    $("q").addEventListener("input", function(){ clearTimeout(t); t = setTimeout(refresh, 300); });
    $("tbody").addEventListener("click", function(ev){
      var tr = ev.target.closest("tr[data-id]"); if (tr) openView(+tr.getAttribute("data-id")); });
    $("tbody").addEventListener("keydown", function(ev){
      if (ev.key !== "Enter" && ev.key !== " ") return;
      var tr = ev.target.closest("tr[data-id]"); if (tr){ ev.preventDefault(); openView(+tr.getAttribute("data-id")); } });
    $("newBtn").addEventListener("click", function(){ openForm(null); });
    $("editBtn").addEventListener("click", function(){ openForm(state.viewing); });
    $("saveBtn").addEventListener("click", save);
    $("cancelBtn").addEventListener("click", closePanels);
    $("viewClose").addEventListener("click", closePanels);
    $("formClose").addEventListener("click", closePanels);
    $("scrim").addEventListener("click", closePanels);
    $("deleteBtn").addEventListener("click", async function(){
      var r = state.viewing; if (!r) return;
      if (!window.confirm("سند «"+r.number+"» حذف شود؟\nحذف نرم است: رکورد می‌ماند و در ممیزی ثبت می‌شود.")) return;
      try { await api("/api/contracts/"+r.id, { method:"DELETE" }); toast("سند حذف شد."); closePanels(); await refresh(); }
      catch(err){ toast(err.message, "err"); }
    });
    $("viewBody").addEventListener("click", async function(ev){
      var row = ev.target.closest("[data-att]"); if (!row) return;
      var aid = row.getAttribute("data-att");
      var a = (state.viewing.attachments||[]).filter(function(x){ return x.id === aid; })[0];
      if (ev.target.closest('[data-act="preview"]')) openPreview(state.viewing.id, a);
      else if (ev.target.closest('[data-act="rm"]')){
        if (!window.confirm("پیوست «"+a.name+"» حذف شود؟")) return;
        try { await api("/api/contracts/"+state.viewing.id+"/attachments/"+aid, { method:"DELETE" });
          toast("پیوست حذف شد."); await refresh(); openView(state.viewing.id); }
        catch(err){ toast(err.message, "err"); }
      }
    });
    $("fileInput").addEventListener("change", function(ev){
      if (ev.target.files && ev.target.files[0]) uploadFile(ev.target.files[0]);
      ev.target.value = ""; });
    $("exportBtn").addEventListener("click", function(){ window.location.href = "/api/export?section="+state.section; });
    $("templateBtn").addEventListener("click", function(){ window.location.href = "/api/template"; });
    $("importBtn").addEventListener("click", function(){
      state.importFile = null;
      $("importReport").hidden = true; $("commitBtn").hidden = true;
      $("importFileName").textContent = "فایلی انتخاب نشده";
      $("importSection").innerHTML = state.me.sections.map(function(s){
        return '<option value="'+s+'"'+(s===state.section?" selected":"")+">"+esc(SECTION_FA[s])+"</option>"; }).join("");
      $("importModal").hidden = false;
    });
    $("pickImport").addEventListener("click", function(){ $("importInput").click(); });
    $("importInput").addEventListener("change", function(ev){
      state.importFile = ev.target.files && ev.target.files[0];
      $("importFileName").textContent = state.importFile ? state.importFile.name : "فایلی انتخاب نشده";
      $("importReport").hidden = true; $("commitBtn").hidden = true; });
    $("dryBtn").addEventListener("click", function(){ runImport(false); });
    $("commitBtn").addEventListener("click", function(){ runImport(true); });
    $("usersBtn").addEventListener("click", openUsers);
    $("auditBtn").addEventListener("click", openAudit);
    Array.prototype.forEach.call(document.querySelectorAll("[data-close-modal]"), function(b){
      b.addEventListener("click", closeModals); });
    $("logoutBtn").addEventListener("click", async function(){
      try { await api("/api/auth/logout", { method:"POST" }); } catch(e){}
      window.location.replace("/login.html"); });
    document.addEventListener("keydown", function(ev){
      if (ev.key === "Escape"){ closeModals(); closePanels(); } });
  }

  (async function start(){
    try { await loadMe(); wire(); await refresh(); }
    catch(err){ if (err.message.indexOf("نشست") < 0) toast(err.message || "بارگذاری ناموفق بود.", "err"); }
  })();
})();
