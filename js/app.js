/*!
 * 英语精读助手 - 前端应用逻辑
 * -----------------------------------------------------------------
 * 模块划分：
 *   1. 语法标注渲染  renderArticle() 把标注结果渲染成带 <mark>/<w> 的 HTML
 *   2. 词典          ECDICT 离线词典（DICT_DATA）+ Free Dictionary API 在线例句
 *   3. 发音          浏览器 Web Speech API（美音 / 英音），联网时另有真人发音
 *   4. 生词本 / 历史  localStorage 本地存储
 *   5. AI 增强       可选接入 OpenAI 兼容接口，与内置引擎结果合并
 *
 * 脚本加载顺序（勿改动）：
 *   compromise.min.js（词法分析） -> annotator.js（语法标注）
 *   -> dict.js（离线词典数据） -> app.js（本文件）
 *
 * 数据说明：
 *   - 中文释义 / 音标 / 词频来自开源词典 ECDICT（MIT，已裁剪为常用词）
 *   - 英文例句来自 dictionaryapi.dev（免费接口，联网时获取并缓存 30 天）
 */
"use strict";

/* ================= utilities ================= */
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\'/g, "&#39;");
}
function loadJson(key, def) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
function saveJson(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
function toast(msg) {
  var t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.classList.remove("show"); }, 2200);
}

var SAMPLE_ARTICLE = [
  "Learning a New Language: A Personal Journey",
  "",
  "Learning a new language is a challenging but rewarding experience, and it requires patience, practice, and a positive attitude. Many people believe that they are too old to learn a foreign language, but this idea is completely wrong. Scientific research has shown that adults can learn new languages effectively if they use the right methods.",
  "",
  "To improve your English quickly, you should read English books, watch English movies, and talk with native speakers. Reading is especially useful because it helps you learn new words in context. When you meet an unfamiliar word, you can look it up in a dictionary and write down its meaning in a notebook.",
  "",
  "Grammar is another important part of learning. You need to understand how to use tenses, prepositions, and conjunctions correctly. For example, the sentence \"The book that I read yesterday was very interesting\" contains a relative clause, which modifies the noun \"book\". By studying grammar carefully, you can express your ideas more clearly.",
  "",
  "Finally, do not be afraid of making mistakes. Mistakes are a natural part of the learning process, and they help you improve. If you keep practicing every day, you will make great progress in the future. Remember: learning English is not a sprint but a marathon, and every small step counts."
].join("\n");

var TYPE_LIST = [
  { type: "clause", label: "从句", color: "#e5484d" },
  { type: "nonfinite", label: "非谓语", color: "#3b82f6" },
  { type: "preposition", label: "介词短语", color: "#16a34a" },
  { type: "coordination", label: "并列词", color: "#f59e0b" }
];

var state = { text: "", spans: [], hidden: {}, aiUsed: false };

/* ================= tabs ================= */
function switchTab(name) {
  $$(".tab").forEach(function (t) { t.classList.toggle("active", t.dataset.tab === name); });
  $$(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + name); });
  if (name === "wordbook") renderWordbook();
  if (name === "history") renderHistory();
}

/* ================= rendering ================= */
function wrapWords(seg, segStart) {
  var re = /[A-Za-z]+(?:[\'\’\’-][A-Za-z]+)*/g;
  var out = "";
  var last = 0;
  var m;
  while ((m = re.exec(seg)) !== null) {
    out += escapeHtml(seg.slice(last, m.index));
    var word = m[0];
    var pos = segStart + m.index;
    out += "<w data-word=\"" + word.toLowerCase() + "\" data-start=\"" + pos + "\">" + escapeHtml(word) + "</w>";
    last = m.index + word.length;
  }
  out += escapeHtml(seg.slice(last));
  return out;
}

function renderArticle(text, spans) {
  var cov = new Array(text.length).fill(null);
  var i, s;
  for (s = 0; s < spans.length; s++) {
    var sp = spans[s];
    if (sp.layer !== "outer") continue;
    for (i = sp.start; i < sp.end && i < text.length; i++) if (!cov[i]) cov[i] = sp;
  }
  for (s = 0; s < spans.length; s++) {
    var sp2 = spans[s];
    if (sp2.layer === "outer") continue;
    for (i = sp2.start; i < sp2.end && i < text.length; i++) cov[i] = sp2;
  }
  var html = "";
  var i = 0;
  while (i < text.length) {
    var m = cov[i];
    var j = i;
    while (j < text.length && cov[j] === m) j++;
    var seg = text.slice(i, j);
    var wrapped = wrapWords(seg, i);
    if (m) html += "<mark class=\"span-" + m.type + "\" data-type=\"" + m.type + "\" data-id=\"" + m.id + "\">" + wrapped + "</mark>";
    else html += wrapped;
    i = j;
  }
  return html;
}

function updateLegend() {
  var el = $("#legend");
  el.innerHTML = "";
  TYPE_LIST.forEach(function (t) {
    var count = state.spans.filter(function (s) { return s.type === t.type; }).length;
    var item = document.createElement("label");
    item.className = "legend-item" + (state.hidden[t.type] ? " off" : "");
    item.innerHTML = "<span class=\"dot\" style=\"background:" + t.color + "\"></span>" + t.label + " <span class=\"count\">" + count + "</span>";
    item.title = "点击显示 / 隐藏 " + t.label;
    item.addEventListener("click", function () {
      state.hidden[t.type] = !state.hidden[t.type];
      updateLegend();
      showResult();
    });
    el.appendChild(item);
  });
  var ai = $("#aiHint");
  if (state.aiUsed) { ai.textContent = "✓ 已使用 AI 增强分析（结合内置引擎）"; ai.className = "ai-hint ok"; }
  else { ai.textContent = "未启用 AI 增强分析，当前为内置引擎分析"; ai.className = "ai-hint"; }
}

function showResult() {
  var filtered = state.spans.filter(function (s) { return !state.hidden[s.type]; });
  $("#articleOutput").innerHTML = renderArticle(state.text, filtered);
  $("#emptyState").style.display = "none";
  $("#resultActions").hidden = false;
  var total = state.spans.length;
  $("#stats").textContent = "共标注 " + total + " 处 · 从句为红色，从句内遇到非谓语 / 介词短语 / 并列词会换色显示 · 点任意单词查词典";
}

/* ================= tooltip ================= */
var tooltipEl = null;
function initTooltip() {
  tooltipEl = $("#tooltip");
  var out = $("#articleOutput");
  out.addEventListener("mouseover", function (e) {
    var mark = e.target.closest ? e.target.closest("mark") : null;
    if (!mark || !mark.dataset.type) { tooltipEl.hidden = true; return; }
    var sp = state.spans.find(function (s) { return s.id === parseInt(mark.dataset.id); });
    if (!sp) { tooltipEl.hidden = true; return; }
    var info = TYPE_LIST.find(function (t) { return t.type === sp.type; });
    tooltipEl.innerHTML = "<div class=\"tt-label\"><span class=\"tt-dot\" style=\"background:" + (info ? info.color : "#999") + "\"></span>" + (info ? info.label : sp.label) + "</div><div>" + escapeHtml(sp.explain) + "</div>";
    tooltipEl.hidden = false;
    positionTooltip(e);
  });
  out.addEventListener("mousemove", function (e) { if (!tooltipEl.hidden) positionTooltip(e); });
  out.addEventListener("mouseout", function (e) {
    var mark = e.target.closest ? e.target.closest("mark") : null;
    if (!mark) { tooltipEl.hidden = true; return; }
    var related = e.relatedTarget;
    if (!related || !mark.contains(related)) tooltipEl.hidden = true;
  });
}
function positionTooltip(e) {
  var pad = 14;
  var x = e.clientX + pad;
  var y = e.clientY + pad;
  var rect = tooltipEl.getBoundingClientRect();
  if (x + rect.width > window.innerWidth - 8) x = e.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = e.clientY - rect.height - pad;
  tooltipEl.style.left = x + "px";
  tooltipEl.style.top = y + "px";
}

/* ================= dictionary ================= */
function lookupWord(raw) {
  var w = String(raw || "").toLowerCase().trim();
  if (!w) return null;
  var entry = DICT_DATA.dict[w];
  var base = w;
  var isForm = false;
  if (!entry && DICT_DATA.forms[w]) { base = DICT_DATA.forms[w]; entry = DICT_DATA.dict[base]; isForm = true; }
  return { word: w, base: base, entry: entry, isForm: isForm };
}
function parseTranslation(translation) {
  var posRe = /^(n\.|v\.|vt\.|vi\.|a\.|adj\.|adv\.|ad\.|prep\.|conj\.|art\.|pron\.|num\.|int\.|aux\.|abbr\.|det\.|modal\.|comb\.|pref\.|suff\.)/i;
  var groups = [];
  var lines = String(translation || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
  var other = [];
  lines.forEach(function (line) {
    var m = line.match(posRe);
    if (m) {
      var pos = m[1].replace(/\./g, "").toUpperCase();
      var g = groups.find(function (x) { return x.pos === pos; });
      var text = line.slice(m[0].length).trim().replace(/^[,;：:，]+/, "").trim();
      if (!g) { g = { pos: pos, senses: [] }; groups.push(g); }
      g.senses.push(text || line);
    } else {
      other.push(line);
    }
  });
  if (other.length) groups.push({ pos: "其他", senses: other });
  return groups;
}
function parseExchange(ex) {
  var labels = { p: "过去式", d: "过去分词", i: "现在分词", s: "复数", r: "比较级", t: "最高级", 3: "第三人称单数" };
  var out = [];
  if (!ex) return out;
  ex.split("/").forEach(function (part) {
    var m = part.match(/^([a-z0-9]):(.+)$/);
    if (m && labels[m[1]] && m[2] && /^[a-zA-Z]+$/.test(m[2]) && m[2].length > 1 && m[2].toLowerCase() !== "i") out.push(labels[m[1]] + ": " + m[2]);
  });
  return out;
}
var exampleCache = null;
async function fetchExamples(word) {
  if (!exampleCache) exampleCache = loadJson("dict_examples", {});
  var key = word.toLowerCase();
  if (exampleCache[key] && exampleCache[key].t > Date.now() - 1000 * 60 * 60 * 24 * 30) return exampleCache[key];
  try {
    var r = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(key));
    if (!r.ok) return null;
    var data = await r.json();
    var out = { t: Date.now(), phonetic: null, audio: null, meanings: [] };
    var first = Array.isArray(data) ? data[0] : null;
    if (first) {
      if (first.phonetic) out.phonetic = first.phonetic;
      (first.phonetics || []).forEach(function (ph) { if (ph.audio && !out.audio) out.audio = ph.audio; });
      (first.meanings || []).forEach(function (mean) {
        var pos = mean.partOfSpeech || "其他";
        var defs = (mean.definitions || []).slice(0, 6).map(function (d) { return { def: d.definition || "", example: d.example || null }; });
        out.meanings.push({ pos: pos, defs: defs });
      });
    }
    exampleCache[key] = out;
    saveJson("dict_examples", exampleCache);
    return out;
  } catch (e) { return null; }
}

var onlineAudio = null;
function speak(word, lang, label) {
  if (!("speechSynthesis" in window)) { toast("当前浏览器不支持语音朗读"); return; }
  var voices = window.speechSynthesis.getVoices();
  var voice = voices.find(function (v) { return v.lang === lang; }) || voices.find(function (v) { return v.lang === lang.replace("-", "_"); }) || null;
  var u = new SpeechSynthesisUtterance(word);
  u.lang = lang;
  if (voice) u.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  toast("正在朗读：" + word + (label ? "（" + label + "）" : ""));
}

async function openDict(rawWord) {
  var res = lookupWord(rawWord);
  if (!res) { toast("未找到该词"); return; }
  var drawer = $("#dictDrawer");
  $("#drawerMask").hidden = false;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  $("#dictWordTitle").textContent = res.word;
  $("#dictContent").innerHTML = "<div class=\"dict-loading\">正在查询词典…</div>";

  var html = "";
  var display = res.word;
  html += "<div class=\"dict-word\"><span class=\"headword\">" + escapeHtml(display) + "</span>";
  if (res.entry && res.entry.p) html += "<span class=\"dict-phonetic\">/" + escapeHtml(res.entry.p) + "/</span>";
  html += "</div>";
  if (res.isForm) html += "<div class=\"dict-note\">「" + escapeHtml(res.word) + "」是「" + escapeHtml(res.base) + "」的变形</div>";
  html += "<div class=\"dict-audio\">"
    + "<button class=\"audio-btn\" data-speak=\"" + escapeHtml(res.base) + "\" data-lang=\"en-US\">🔊 美音</button>"
    + "<button class=\"audio-btn\" data-speak=\"" + escapeHtml(res.base) + "\" data-lang=\"en-GB\">🔊 英音</button>"
  + "</div>";
  html += "<button class=\"add-btn\" data-add=\"" + escapeHtml(res.base) + "\" id=\"addWordBtn\">➕ 加入生词本</button>";
  if (res.entry) {
    var badges = [];
    if (res.entry.c) badges.push("<span class=\"badge star\">柯林斯 ★" + res.entry.c + "</span>");
    if (res.entry.o) badges.push("<span class=\"badge star\">牛津核心 " + res.entry.o + "</span>");
    if (res.entry.f) badges.push("<span class=\"badge\">词频排名 " + res.entry.f + "</span>");
    if (res.entry.g) badges.push("<span class=\"badge tag\">" + escapeHtml(res.entry.g.toUpperCase()) + "</span>");
    if (badges.length) html += "<div class=\"dict-badges\">" + badges.join("") + "</div>";
    var groups = parseTranslation(res.entry.t);
    if (groups.length) {
      html += "<div class=\"section-title\">中文释义</div>";
      groups.forEach(function (g) {
        html += "<div class=\"sense-group\"><div class=\"sense-pos\">" + escapeHtml(g.pos) + "</div>";
        g.senses.forEach(function (s) { html += "<div class=\"sense-line\">" + escapeHtml(s) + "</div>"; });
        html += "</div>";
      });
    }
    var forms = parseExchange(res.entry.x);
    if (forms.length) html += "<div class=\"section-title\">词形变化</div><div class=\"sense-line\">" + escapeHtml(forms.join(" · ")) + "</div>";
  } else {
    html += "<div class=\"dict-note\">离线词典未收录该词，以下为在线查询结果（如联网可用）</div>";
  }
  html += "<div class=\"section-title\">例句</div><div id=\"exampleBox\" class=\"dict-loading\">正在获取例句…</div>";
  html += "<div class=\"dict-note\">释义与音标来自开源词典 ECDICT；例句来自 Free Dictionary API（dictionaryapi.dev），联网时自动获取</div>";
  $("#dictContent").innerHTML = html;

  $$("#dictContent [data-speak]").forEach(function (b) {
    b.addEventListener("click", function () { speak(b.dataset.speak, b.dataset.lang, b.textContent.trim()); });
  });
  var addBtn = $("#addWordBtn");
  if (addBtn) {
    if (isSaved(res.base)) { addBtn.textContent = "✓ 已在生词本"; addBtn.classList.add("added"); }
    addBtn.addEventListener("click", function () { toggleWord(res.base, display); });
  }

  var exBox = $("#exampleBox");
  var ex = await fetchExamples(res.base);
  if (ex && ex.meanings.length) {
    var eh = "";
    ex.meanings.forEach(function (mean) {
      mean.defs.forEach(function (d) {
        eh += "<div class=\"sense-group\"><div class=\"sense-pos\">" + escapeHtml(mean.pos) + "</div>";
        eh += "<div class=\"sense-line\">" + escapeHtml(d.def) + "</div>";
        if (d.example) eh += "<div class=\"sense-example\">例句：" + escapeHtml(d.example).replace(new RegExp("(" + res.base + ")", "ig"), "<b>$1</b>") + "</div>";
        else eh += "<div class=\"sense-example\">（该释义暂无例句）</div>";
        eh += "</div>";
      });
    });
    exBox.innerHTML = eh;
    if (ex.audio && !onlineAudio) {
      onlineAudio = new Audio(ex.audio);
      var ab = document.createElement("button");
      ab.className = "audio-btn";
      ab.textContent = "🎵 真人发音（网络）";
      ab.addEventListener("click", function () { onlineAudio.play(); });
      var wrap = $(".dict-audio");
      if (wrap) wrap.appendChild(ab);
    }
  } else {
    exBox.innerHTML = "<div class=\"dict-note\">联网后可获取英文例句；离线时暂无例句。</div>";
  }
}
function closeDict() {
  $("#dictDrawer").classList.remove("open");
  $("#dictDrawer").setAttribute("aria-hidden", "true");
  $("#drawerMask").hidden = true;
}

/* ================= wordbook ================= */
function loadWords() { return loadJson("wordbook", []); }
function saveWords(a) { saveJson("wordbook", a); }
function isSaved(word) { return loadWords().some(function (x) { return x.w === word; }); }
function toggleWord(word, display) {
  var list = loadWords();
  var idx = list.findIndex(function (x) { return x.w === word; });
  if (idx >= 0) { list.splice(idx, 1); toast("已从生词本移除：" + display); }
  else { list.push({ w: word, d: display, t: Date.now() }); toast("已加入生词本：" + display); }
  saveWords(list);
  renderWordbook();
  var btn = $("#addWordBtn");
  if (btn) {
    if (isSaved(word)) { btn.textContent = "✓ 已在生词本"; btn.classList.add("added"); }
    else { btn.textContent = "➕ 加入生词本"; btn.classList.remove("added"); }
  }
}
function renderWordbook() {
  var list = loadWords().slice().sort(function (a, b) { return b.t - a.t; });
  var el = $("#wordbookList");
  var empty = $("#wordbookEmpty");
  if (!list.length) { el.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";
  el.innerHTML = list.map(function (x) {
    var base = lookupWord(x.w);
    var gloss = base && base.entry ? base.entry.t.split("\n")[0] : "";
    return "<span class=\"word-chip\" data-word=\"" + escapeHtml(x.w) + "\"><span class=\"wc-main\">" + escapeHtml(x.d || x.w) + (gloss ? " <span style=\"color:#6b7280;font-size:12px\">" + escapeHtml(gloss) + "</span>" : "") + "</span><button class=\"del\" data-del=\"" + escapeHtml(x.w) + "\">✕</button></span>";
  }).join("");
  $$("#wordbookList .word-chip").forEach(function (chip) {
    chip.addEventListener("click", function (e) {
      if (e.target.dataset.del) {
        var list2 = loadWords().filter(function (x) { return x.w !== e.target.dataset.del; });
        saveWords(list2); renderWordbook(); toast("已移除");
      } else {
        openDict(chip.dataset.word);
      }
    });
  });
}

/* ================= history ================= */
function loadHistory() { return loadJson("history", []); }
function saveHistoryItem() {
  var text = state.text;
  if (!text) { toast("请先分析一篇文章"); return; }
  var title = text.split("\n").map(function (l) { return l.trim(); }).filter(Boolean)[0] || "未命名文章";
  if (title.length > 36) title = title.slice(0, 36) + "…";
  var list = loadHistory();
  list.unshift({ id: Date.now().toString(36), title: title, text: text, date: new Date().toLocaleString("zh-CN") });
  if (list.length > 50) list = list.slice(0, 50);
  saveJson("history", list);
  toast("已存入历史");
}
function renderHistory() {
  var list = loadHistory();
  var el = $("#historyList");
  var empty = $("#historyEmpty");
  if (!list.length) { el.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";
  el.innerHTML = list.map(function (h) {
    return "<div class=\"history-item\"><div><div class=\"hi-title\">" + escapeHtml(h.title) + "</div><div class=\"hi-meta\">" + escapeHtml(h.date) + " · 字数 " + h.text.length + "</div></div>"
      + "<div class=\"hi-actions\"><button class=\"ghost-btn\" data-load=\"" + h.id + "\">重新分析</button><button class=\"ghost-btn\" data-del=\"" + h.id + "\">删除</button></div></div>";
  }).join("");
  $$("#historyList [data-load]").forEach(function (b) {
    b.addEventListener("click", function () {
      var h = loadHistory().find(function (x) { return x.id === b.dataset.load; });
      if (!h) return;
      $("#articleInput").value = h.text;
      switchTab("reader");
      runAnalyze();
    });
  });
  $$("#historyList [data-del]").forEach(function (b) {
    b.addEventListener("click", function () {
      saveJson("history", loadHistory().filter(function (x) { return x.id !== b.dataset.del; }));
      renderHistory(); toast("已删除");
    });
  });
}

/* ================= export ================= */
function exportAnnotated() {
  if (!state.text) { toast("没有可导出的内容"); return; }
  var filtered = state.spans.filter(function (s) { return !state.hidden[s.type]; });
  var body = renderArticle(state.text, filtered);
  var css = "mark{border-radius:4px;padding:1px 2px;} mark.span-clause{background:#fdebec;color:#c0392b;border-bottom:2px solid #e5484d;} mark.span-nonfinite{background:#eaf2fe;color:#1d4ed8;border-bottom:2px solid #3b82f6;} mark.span-preposition{background:#e9f7ef;color:#15803d;border-bottom:2px solid #16a34a;} mark.span-coordination{background:#fef5e6;color:#b45309;border-bottom:2px solid #f59e0b;} body{font-family:Georgia,serif;font-size:18px;line-height:2.1;max-width:800px;margin:30px auto;padding:0 20px;}";
  var legend = TYPE_LIST.map(function (t) {
    var n = filtered.filter(function (s) { return s.type === t.type; }).length;
    return "<span style=\"display:inline-block;margin:0 12px 8px 0;color:" + t.color + ";font-weight:bold;\">■ " + t.label + " (" + n + ")</span>";
  }).join("");
  var doc = "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"UTF-8\"><title>标注版文章</title><style>" + css + "</style></head><body><div style=\"font-size:14px;color:#666;margin-bottom:16px;\">语法标注版：" + legend + "</div>" + body + "</body></html>";
  var blob = new Blob([doc], { type: "text/html;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "annotated-article.html";
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast("已导出标注版 HTML");
}
function exportWords() {
  var list = loadWords();
  if (!list.length) { toast("生词本是空的"); return; }
  var text = list.map(function (x) {
    var base = lookupWord(x.w);
    return x.d + (base && base.entry ? "  " + base.entry.t.split("\n")[0] : "");
  }).join("\n");
  var blob = new Blob(["﻿" + text], { type: "text/plain;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "wordbook.txt";
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast("已导出生词表");
}

/* ================= AI analyze ================= */
function loadAiConfig() {
  return Object.assign({ enabled: false, baseUrl: "https://api.deepseek.com", apiKey: "", model: "deepseek-chat" }, loadJson("ai_config", {}));
}
function saveAiConfig(cfg) { saveJson("ai_config", cfg); }
var AI_SYSTEM = "你是一位专业的英语语法分析助手。用户会给你一篇英语文章，请标注出四种成分：从句(clause，包括定语从句、名词性从句、状语从句)、非谓语动词(nonfinite)、介词短语(preposition)、并列连词(coordination)。你必须只返回一个 JSON 对象，不要输出任何其他文字。格式：{\"spans\":[{\"start\":数字,\"end\":数字,\"type\":\"clause|nonfinite|preposition|coordination\",\"note\":\"简短中文说明\"}]}。start 和 end 是字符偏移（start 含，end 不含），必须对应原文，不要把相邻的同类型片段合并成一个过大区间。注意只标注这四种成分，不要标注谓语动词本身。";
function extractJson(s) {
  s = String(s || "");
  var i = s.indexOf("{");
  if (i < 0) { i = s.indexOf("["); if (i < 0) throw new Error("no json"); return s; }
  var depth = 0, inStr = false, quote = "";
  for (var k = i; k < s.length; k++) {
    var c = s[k];
    if (inStr) { if (c === quote) { if (s[k+1] === quote) { k++; } else inStr = false; } continue; }
    if (c === "\"" || c === "\'") { inStr = true; quote = c; continue; }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) return s.slice(i, k + 1); }
  }
  throw new Error("unbalanced json");
}
async function aiAnalyze(text, cfg) {
  var url = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  var res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.apiKey },
    body: JSON.stringify({ model: cfg.model, temperature: 0, messages: [{ role: "system", content: AI_SYSTEM }, { role: "user", content: text }] })
  });
  if (!res.ok) throw new Error("接口返回 " + res.status);
  var j = await res.json();
  var content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!content) throw new Error("接口无返回内容");
  var parsed = JSON.parse(extractJson(content));
  var arr = parsed.spans || parsed;
  var types = { clause: 1, nonfinite: 1, preposition: 1, coordination: 1 };
  var out = [];
  (Array.isArray(arr) ? arr : []).forEach(function (sp) {
    var start = Math.round(Number(sp.start));
    var end = Math.round(Number(sp.end));
    if (!types[sp.type]) return;
    if (!isFinite(start) || !isFinite(end) || start < 0 || end > text.length || end <= start) return;
    out.push({ type: sp.type, layer: sp.type === "clause" ? "outer" : "inner", start: start, end: end, text: text.slice(start, end), label: sp.type, explain: sp.note ? "AI 分析：" + sp.note : "AI 标注" });
  });
  out.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
  return out;
}
function mergeSpans(rule, ai) {
  var kept = rule.filter(function (rs) { return !ai.some(function (as) { return as.start < rs.end && as.end > rs.start; }); });
  return kept.concat(ai).sort(function (a, b) { return a.start - b.start || a.end - b.end; });
}

/* ================= main analyze flow ================= */
async function runAnalyze() {
  var text = $("#articleInput").value.trim();
  if (!text) { toast("请先输入或粘贴一篇文章"); return; }
  if (text.length > 50000) { toast("文章太长，请控制在 5 万字符以内"); return; }
  var btn = $("#analyzeBtn");
  btn.disabled = true;
  var old = btn.textContent;
  btn.textContent = "分析中…";
  var cfg = loadAiConfig();
  var hint = $("#aiHint");
  try {
    var t0 = performance.now();
    var ruleSpans = GrammarAnnotator.analyze(text).spans;
    var aiUsed = false;
    if (cfg.enabled && cfg.apiKey && cfg.baseUrl) {
      hint.textContent = "AI 增强分析中…"; hint.className = "ai-hint";
      try {
        var aiSpans = await aiAnalyze(text, cfg);
        state.spans = mergeSpans(ruleSpans, aiSpans);
        aiUsed = true;
      } catch (e) {
        state.spans = ruleSpans;
        hint.textContent = "AI 分析失败（" + e.message + "），已使用内置引擎结果"; hint.className = "ai-hint err";
      }
    } else {
      state.spans = ruleSpans;
    }
    state.text = text;
    state.aiUsed = aiUsed;
    var dt = Math.round(performance.now() - t0);
    updateLegend();
    showResult();
    if (!hint.classList.contains("err")) hint.textContent = "分析完成，用时 " + dt + "ms" + (aiUsed ? "（AI 增强）" : "");
  } catch (e) {
    toast("分析出错：" + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

/* ================= settings modal ================= */
function openSettings() {
  var cfg = loadAiConfig();
  $("#aiEnabled").checked = !!cfg.enabled;
  $("#aiBaseUrl").value = cfg.baseUrl;
  $("#aiKey").value = cfg.apiKey;
  $("#aiModel").value = cfg.model;
  $("#settingsModal").hidden = false;
}
function closeSettings() { $("#settingsModal").hidden = true; }
async function testAi() {
  var cfg = { enabled: $("#aiEnabled").checked, baseUrl: $("#aiBaseUrl").value.trim(), apiKey: $("#aiKey").value.trim(), model: $("#aiModel").value.trim() };
  if (!cfg.apiKey || !cfg.baseUrl) { toast("请先填写接口地址和 API Key"); return; }
  try {
    var url = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    var res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] })
    });
    if (res.ok) toast("✓ 连接成功");
    else toast("连接失败：" + res.status);
  } catch (e) { toast("连接失败：" + e.message); }
}

/* ================= init ================= */
function bindEvents() {
  $$(".tab").forEach(function (t) { t.addEventListener("click", function () { switchTab(t.dataset.tab); }); });
  $("#analyzeBtn").addEventListener("click", runAnalyze);
  $("#sampleBtn").addEventListener("click", function () {
    $("#articleInput").value = SAMPLE_ARTICLE;
    runAnalyze();
  });
  $("#clearBtn").addEventListener("click", function () {
    $("#articleInput").value = "";
    state.text = ""; state.spans = []; state.aiUsed = false;
    $("#articleOutput").innerHTML = "";
    $("#emptyState").style.display = "block";
    $("#resultActions").hidden = true;
    $("#stats").textContent = "";
    $("#aiHint").textContent = "";
    $("#legend").innerHTML = "";
  });
  $("#articleOutput").addEventListener("click", function (e) {
    var w = e.target.closest ? e.target.closest("w") : null;
    if (w && w.dataset.word) openDict(w.dataset.word);
  });
  $("#dictClose").addEventListener("click", closeDict);
  $("#drawerMask").addEventListener("click", closeDict);
  $("#exportBtn").addEventListener("click", exportAnnotated);
  $("#saveHistoryBtn").addEventListener("click", saveHistoryItem);
  $("#exportWordsBtn").addEventListener("click", exportWords);
  $("#clearWordsBtn").addEventListener("click", function () { if (confirm("确定清空生词本？")) { saveWords([]); renderWordbook(); toast("已清空"); } });
  $("#clearHistoryBtn").addEventListener("click", function () { if (confirm("确定清空历史？")) { saveJson("history", []); renderHistory(); toast("已清空"); } });
  $("#settingsBtn").addEventListener("click", openSettings);
  $("#aiSaveBtn").addEventListener("click", function () {
    saveAiConfig({ enabled: $("#aiEnabled").checked, baseUrl: $("#aiBaseUrl").value.trim(), apiKey: $("#aiKey").value.trim(), model: $("#aiModel").value.trim() });
    closeSettings();
    toast("AI 设置已保存");
  });
  $("#aiTestBtn").addEventListener("click", testAi);
  $("#settingsModal").addEventListener("click", function (e) { if (e.target === $("#settingsModal")) closeSettings(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeDict(); closeSettings(); } });
}

if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = function () { window.speechSynthesis.getVoices(); };
}

initTooltip();
bindEvents();
renderWordbook();
renderHistory();