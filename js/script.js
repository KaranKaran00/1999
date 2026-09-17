(function(){
  "use strict";

  var MAX_PAISE = 199900;   /* ₹1,999.00 per QR */
  var MAX_QRS   = 200;
  var payments  = [];
  var meta      = null;

  function $(id){ return document.getElementById(id); }

  var ICON_OK  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  var ICON_BAD = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16.5v.01"/></svg>';

  function toast(msg, kind){
    var t = $("toast");
    t.className = "toast " + (kind === "bad" ? "bad" : "ok");
    t.innerHTML = (kind === "bad" ? ICON_BAD : ICON_OK) + "<span></span>";
    t.lastChild.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function(){ t.hidden = true; }, 3400);
  }

  /* ---------- money ---------- */
  function rupees(paise){
    var whole = Math.floor(paise / 100), frac = paise % 100;
    var s = whole.toLocaleString("en-IN");
    return frac ? s + "." + String(frac).padStart(2, "0") : s;
  }
  function inr(paise){ return "\u20B9" + rupees(paise); }
  function inrHTML(paise){ return '<span class="rupee">\u20B9</span>' + rupees(paise); }
  function plainAmount(paise){ return (paise / 100).toFixed(2); }

  /* ---------- splitting ---------- */
  function split(totalPaise){
    var out = [], remaining = totalPaise;
    while (remaining > 0){
      var chunk = Math.min(remaining, MAX_PAISE);
      out.push(chunk);
      remaining -= chunk;
    }
    return out;
  }

  function buildUri(upiId, payee, paise, note){
    var q = "upi://pay?pa=" + encodeURIComponent(upiId) +
            "&pn=" + encodeURIComponent(payee) +
            "&am=" + encodeURIComponent(plainAmount(paise)) +
            "&cu=INR";
    if (note) q += "&tn=" + encodeURIComponent(note);
    return q;
  }

  /* ---------- QR ---------- */
  function qrCanvas(text, targetPx){
    var qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount(), quiet = 4, total = n + quiet * 2;
    var scale = Math.max(4, Math.floor((targetPx || 900) / total));
    var size = total * scale;
    var c = document.createElement("canvas");
    c.width = size; c.height = size;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000000";
    for (var r = 0; r < n; r++)
      for (var col = 0; col < n; col++)
        if (qr.isDark(r, col)) ctx.fillRect((col + quiet) * scale, (r + quiet) * scale, scale, scale);
    return c;
  }

  function sheetCanvas(p){
    var W = 1100, pad = 64;
    var qr = qrCanvas(p.uri, 860);
    var qrSize = W - pad * 2;

    var lines = [["UPI ID", meta.upiId], ["Account name", meta.payee]];
    if (meta.note) lines.push(["Note", meta.note]);

    var lineH = 52;
    var H = pad + 108 + qrSize + 130 + lines.length * lineH + pad;

    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);

    var y = pad;
    ctx.fillStyle = "#0D141D";
    ctx.font = "700 44px Inter, Arial, sans-serif";
    ctx.fillText("Payment " + p.index + " of " + payments.length, pad, y + 42);
    y += 60;

    ctx.strokeStyle = "#CED8E1"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad, y + 12); ctx.lineTo(W - pad, y + 12); ctx.stroke();
    y += 70;

    ctx.drawImage(qr, pad, y, qrSize, qrSize);
    ctx.strokeStyle = "#DEE5EC"; ctx.lineWidth = 2;
    ctx.strokeRect(pad, y, qrSize, qrSize);
    y += qrSize + 80;

    ctx.fillStyle = "#0A7553";
    ctx.font = "700 70px Inter, Arial, sans-serif";
    ctx.fillText("Amount: " + inr(p.paise), pad, y);
    y += 62;

    ctx.font = "400 31px Inter, Arial, sans-serif";
    lines.forEach(function(l){
      ctx.fillStyle = "#5B6E82"; ctx.fillText(l[0] + ":", pad, y + 30);
      ctx.fillStyle = "#0D141D"; ctx.fillText(l[1], pad + 250, y + 30);
      y += lineH;
    });
    return c;
  }

  function canvasToBlob(c){ return new Promise(function(res){ c.toBlob(res, "image/png"); }); }
  function fileNameFor(p){ return "UPI-QR-Payment-" + p.index + "-" + rupees(p.paise).replace(/,/g, "") + ".png"; }

  /* ---------- saving ---------- */
  var dlCap;
  function downloadsCap(){
    if (!dlCap){
      dlCap = (window.claude && typeof window.claude.use === "function")
        ? Promise.resolve(window.claude.use("downloads")).catch(function(){ return null; })
        : Promise.resolve(null);
    }
    return dlCap;
  }
  function anchorSave(filename, blob){
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
    toast("Saved " + filename);
  }
  function saveFile(filename, blob){
    return downloadsCap().then(function(dl){
      if (dl && typeof dl.save === "function"){
        return dl.save({ filename: filename, data: blob }).then(
          function(){ toast("Saved " + filename); },
          function(err){
            var code = err && err.code;
            if (code === "declined") return;
            if (code === "rate_limited"){ toast("One download at a time — try again in a moment.", "bad"); return; }
            anchorSave(filename, blob);
          });
      }
      anchorSave(filename, blob);
    });
  }

  /* ---------- validation ---------- */
  var UPI_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{1,255}@[a-zA-Z][a-zA-Z0-9.\-_]{1,63}$/;

  function setErr(id, msg){
    var input = $(id), slot = $(id + "Err");
    if (msg){
      slot.innerHTML = ICON_BAD.replace('width="15" height="15"', 'width="13" height="13"') + "<span></span>";
      slot.lastChild.textContent = msg;
      input.setAttribute("aria-invalid", "true");
    } else {
      slot.textContent = "";
      input.removeAttribute("aria-invalid");
    }
    return !msg;
  }

  function parsePaise(raw){
    raw = raw.trim().replace(/[,\s\u20B9]/g, "");
    if (!raw) return { empty: true };
    if (!/^\d*\.?\d{0,2}$/.test(raw) || raw === ".") return { bad: true };
    var paise = Math.round(parseFloat(raw) * 100);
    if (!(paise > 0)) return { zero: true };
    if (Math.ceil(paise / MAX_PAISE) > MAX_QRS) return { huge: true };
    return { paise: paise };
  }

  function readForm(){
    var upiId = $("upiId").value.trim();
    var payee = $("payee").value.trim().replace(/\s+/g, " ");
    var note  = $("note").value.trim().replace(/\s+/g, " ");
    var amt   = parsePaise($("amount").value);
    var ok = true;

    if (!upiId) ok = setErr("upiId", "Enter the UPI ID you want to be paid on.") && ok;
    else if (!UPI_RE.test(upiId)) ok = setErr("upiId", "This isn't a valid UPI ID. Use the name@bank format.") && ok;
    else ok = setErr("upiId", "") && ok;

    if (!payee) ok = setErr("payee", "Enter the account name the payer will see.") && ok;
    else ok = setErr("payee", "") && ok;

    if (amt.empty)     ok = setErr("amount", "Enter the total amount to collect.") && ok;
    else if (amt.bad)  ok = setErr("amount", "Enter a plain number with at most two decimal places.") && ok;
    else if (amt.zero) ok = setErr("amount", "The amount has to be more than ₹0.") && ok;
    else if (amt.huge) ok = setErr("amount", "That needs more than " + MAX_QRS + " QR codes. Keep the total under " + inr(MAX_PAISE * MAX_QRS) + ".") && ok;
    else ok = setErr("amount", "") && ok;

    setErr("note", "");
    return ok ? { upiId: upiId, payee: payee, note: note, totalPaise: amt.paise } : null;
  }

  /* ---------- live split preview ---------- */
  function renderSplit(){
    var box = $("split");
    var amt = parsePaise($("amount").value);
    if (amt.paise === undefined){
      box.className = "split is-idle";
      box.textContent = amt.empty
        ? "Enter an amount to see how it will be split."
        : "Waiting for a valid amount.";
      return;
    }
    var parts = split(amt.paise);
    var full = parts.filter(function(x){ return x === MAX_PAISE; }).length;
    var rest = parts.length > full ? parts[parts.length - 1] : 0;

    var chips = "";
    if (full){
      chips += '<span class="chip">' + inr(MAX_PAISE) + (full > 1 ? " \u00D7 " + full : "") + "</span>";
    }
    if (rest){
      chips += '<span class="chip rest">' + inr(rest) + "</span>";
    }
    box.className = "split";
    box.innerHTML =
      '<div class="split-top"><b>' + parts.length + (parts.length === 1 ? " QR code" : " QR codes") +
      "</b><em>totalling " + inr(amt.paise) + "</em></div>" +
      '<div class="chips">' + chips + "</div>";
  }

  /* ---------- stubs ---------- */
  function esc(s){
    return String(s).replace(/[&<>"']/g, function(ch){
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch];
    });
  }

  function stubFor(p){
    var card = document.createElement("article");
    card.className = "stub";

    var head = document.createElement("div");
    head.className = "stub-head";
    head.innerHTML = '<span class="seq">' + p.index + "</span><b>Payment " + p.index +
                     '</b><span class="of">of ' + payments.length + "</span>";
    card.appendChild(head);

    var wrap = document.createElement("div");
    wrap.className = "qrwrap";
    var c = qrCanvas(p.uri, 720);
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", "UPI QR code for payment " + p.index + ", " + inr(p.paise));
    wrap.appendChild(c);
    card.appendChild(wrap);

    var amt = document.createElement("p");
    amt.className = "amt";
    amt.innerHTML = "<small>Amount</small>" + inrHTML(p.paise);
    card.appendChild(amt);

    var tear = document.createElement("div");
    tear.className = "tear";
    card.appendChild(tear);

    var m = document.createElement("dl");
    m.className = "meta";
    var rows = "<div><dt>UPI ID</dt><dd>" + esc(meta.upiId) + "</dd></div>" +
               "<div><dt>Account</dt><dd>" + esc(meta.payee) + "</dd></div>";
    if (meta.note) rows += "<div><dt>Note</dt><dd>" + esc(meta.note) + "</dd></div>";
    m.innerHTML = rows;
    card.appendChild(m);

    var foot = document.createElement("div");
    foot.className = "stub-foot";

    var dl = document.createElement("button");
    dl.className = "btn btn-secondary btn-sm";
    dl.type = "button";
    dl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 11l5 5 5-5M4 20h16"/></svg>Download QR';
    dl.addEventListener("click", function(){
      canvasToBlob(sheetCanvas(p)).then(function(b){ saveFile(fileNameFor(p), b); });
    });
    foot.appendChild(dl);

    var cp = document.createElement("button");
    cp.className = "btn btn-secondary btn-sm icon-only";
    cp.type = "button";
    cp.title = "Copy the UPI payment link";
    cp.setAttribute("aria-label", "Copy the UPI payment link for payment " + p.index);
    cp.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    cp.addEventListener("click", function(){
      var done = function(){ toast("Payment link copied"); };
      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(p.uri).then(done, function(){ toast("Couldn't copy the link.", "bad"); });
      } else {
        var ta = document.createElement("textarea");
        ta.value = p.uri; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); done(); } catch(e){ toast("Couldn't copy the link.", "bad"); }
        ta.remove();
      }
    });
    foot.appendChild(cp);

    card.appendChild(foot);
    return card;
  }

  /* ---------- actions ---------- */
  function generate(){
    var form = readForm();
    if (!form){ toast("Fix the highlighted fields and try again.", "bad"); return; }
    meta = form;

    payments = split(form.totalPaise).map(function(paise, i){
      return { index: i + 1, paise: paise, uri: buildUri(form.upiId, form.payee, paise, form.note) };
    });

    $("tTotal").innerHTML = inrHTML(form.totalPaise);
    $("tCount").textContent = String(payments.length);
    $("tPayee").textContent = form.payee;

    var grid = $("grid");
    grid.textContent = "";
    var frag = document.createDocumentFragment();
    payments.forEach(function(p){ frag.appendChild(stubFor(p)); });
    grid.appendChild(frag);

    $("empty").hidden = true;
    $("results").hidden = false;
    if (window.innerWidth < 1024) $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearAll(){
    ["upiId", "payee", "amount", "note"].forEach(function(id){ $(id).value = ""; setErr(id, ""); });
    payments = []; meta = null;
    $("grid").textContent = "";
    $("results").hidden = true;
    $("empty").hidden = false;
    renderSplit();
    $("upiId").focus();
  }

  /* ---------- PDF ---------- */
  function buildPdf(){
    var Ctor = window.jspdf && window.jspdf.jsPDF;
    if (!Ctor){ toast("The PDF library didn't load. Reload the page.", "bad"); return; }

    var doc = new Ctor({ unit: "mm", format: "a4", compress: true });
    var PW = 210, PH = 297, M = 14, cols = 2;
    var colW = (PW - M * 2) / cols, qrMM = 72, cellH = qrMM + 30;

    doc.setFont("helvetica", "bold"); doc.setFontSize(19);
    doc.text("UPI Payment QR Codes", M, M + 6);

    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(70);
    var head = [
      "Total amount: INR " + rupees(meta.totalPaise),
      "Number of QR codes: " + payments.length + "  (maximum INR " + rupees(MAX_PAISE) + " per QR)",
      "UPI ID: " + meta.upiId + "    Account name: " + meta.payee
    ];
    if (meta.note) head.push("Note: " + meta.note);
    var hy = M + 14;
    head.forEach(function(l){ doc.text(l, M, hy); hy += 5.2; });

    doc.setDrawColor(190); doc.line(M, hy + 1, PW - M, hy + 1); doc.setTextColor(0);

    var top = hy + 9, i = 0;
    while (i < payments.length){
      var rows = Math.floor((PH - top - M) / cellH);
      if (rows < 1){ doc.addPage(); top = M; rows = Math.floor((PH - top - M) / cellH); }
      for (var r = 0; r < rows && i < payments.length; r++){
        for (var c = 0; c < cols && i < payments.length; c++){
          var p = payments[i++];
          var x = M + c * colW, y = top + r * cellH, qx = x + (colW - qrMM) / 2;

          doc.setFont("helvetica", "bold"); doc.setFontSize(11);
          doc.text("Payment " + p.index, qx, y + 5);

          doc.addImage(qrCanvas(p.uri, 900).toDataURL("image/png"), "PNG", qx, y + 8, qrMM, qrMM, undefined, "NONE");
          doc.setDrawColor(200); doc.rect(qx, y + 8, qrMM, qrMM);

          doc.setFont("helvetica", "bold"); doc.setFontSize(14);
          doc.text("INR " + rupees(p.paise), qx, y + qrMM + 17);

          doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(90);
          doc.text(meta.upiId, qx, y + qrMM + 23);
          doc.setTextColor(0);
        }
      }
      if (i < payments.length){ doc.addPage(); top = M; }
    }
    saveFile("UPI-QR-Codes-" + rupees(meta.totalPaise).replace(/,/g, "") + "-" + payments.length + "x.pdf", doc.output("blob"));
  }

  /* ---------- ZIP ---------- */
  function buildZip(){
    if (!window.JSZip){ toast("The ZIP library didn't load. Reload the page.", "bad"); return; }
    var zip = new window.JSZip();
    var btn = $("dlZip"), label = btn.innerHTML;
    btn.disabled = true; btn.textContent = "Packing\u2026";

    Promise.all(payments.map(function(p){
      return canvasToBlob(sheetCanvas(p)).then(function(b){ zip.file(fileNameFor(p), b); });
    }))
    .then(function(){ return zip.generateAsync({ type: "blob" }); })
    .then(function(blob){ return saveFile("UPI-QR-Codes-" + payments.length + "x.zip", blob); })
    .catch(function(){ toast("Couldn't build the ZIP. Try the PDF instead.", "bad"); })
    .then(function(){ btn.disabled = false; btn.innerHTML = label; });
  }

  /* ---------- wiring ---------- */
  $("generate").addEventListener("click", generate);
  $("clear").addEventListener("click", clearAll);
  $("dlPdf").addEventListener("click", buildPdf);
  $("dlZip").addEventListener("click", buildZip);
  $("printBtn").addEventListener("click", function(){ window.print(); });

  ["upiId", "payee", "amount", "note"].forEach(function(id){
    $(id).addEventListener("keydown", function(e){ if (e.key === "Enter") generate(); });
    $(id).addEventListener("input", function(){ if ($(id + "Err").textContent) setErr(id, ""); });
  });
  $("amount").addEventListener("input", renderSplit);

  $("themeToggle").addEventListener("click", function(){
    var dark = matchMedia("(prefers-color-scheme: dark)").matches;
    var cur = document.documentElement.getAttribute("data-theme") || (dark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
  });

  renderSplit();
})();
