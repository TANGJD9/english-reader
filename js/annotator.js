/*!
 * GrammarAnnotator - 英语语法标注引擎（纯前端，可离线运行）
 * -----------------------------------------------------------------
 * 功能：把一段英语文本自动标注出四类语法成分：
 *   clause        从句（定语从句 / 名词性从句 / 状语从句）
 *   nonfinite     非谓语动词（不定式 to do、动名词 doing、分词 done / doing）
 *   preposition   介词短语（含 out of、because of 等复合介词）
 *   coordination  并列连词（and / but / or / nor / for / yet / so）
 *
 * 分层设计（layered）：
 *   - 从句是"外层"（layer = "outer"），可以包裹其他成分；
 *   - 非谓语 / 介词短语 / 并列词是"内层"（layer = "inner"）。
 *   渲染时外层先铺底、内层覆盖其上，从而实现"从句里遇到其他成分就换色"。
 *
 * 实现方式：基于 compromise 的 POS 词性标注 + 规则启发式；
 *   通过字符偏移（start / end，含头不含尾）把标注映射回原文，绝不修改原文。
 *
 * 依赖：compromise（词法分析库，浏览器全局变量 nlp 或 compromise）
 * 用法：
 *   const result = GrammarAnnotator.analyze(articleText);
 *   result.spans  // [{ id, type, layer, start, end, text, label, explain }]
 * 兼容：浏览器（<script> 标签）与 Node（module.exports）均可使用。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./compromise.min.js"));
  } else {
    root.GrammarAnnotator = factory(root.nlp || root.compromise);
  }
})(typeof self !== "undefined" ? self : this, function (nlp) {
  "use strict";
  var PUNCT_CODE = [44, 46, 59, 58, 33, 63, 40, 41, 123, 125, 91, 93, 34, 39, 8216, 8217, 8220, 8221, 8212, 8211];
  var CC_WORDS = new Set(["and", "but", "or", "nor", "for", "yet", "so"]);
  var REL_PRONOUNS = new Set(["who", "whom", "whose", "which", "that"]);
  var SUBORDINATORS = new Set(["because", "although", "though", "while", "when", "where", "if", "since", "unless", "until", "after", "before", "as", "than", "whether", "whereas", "once", "whenever", "wherever", "while"]);
  var NCLAUSE_VERBS = new Set(["think", "thought", "thinks", "thinking", "say", "said", "says", "saying", "know", "knew", "known", "knows", "knowing", "believe", "believed", "believes", "believing", "feel", "felt", "feels", "feeling", "find", "found", "finds", "finding", "hope", "hoped", "hopes", "hoping", "realize", "realized", "realizes", "realizing", "remember", "remembered", "remembers", "remembering", "forget", "forgot", "forgotten", "forgets", "forgetting", "understand", "understood", "understands", "understanding", "see", "saw", "seen", "sees", "seeing", "show", "showed", "shown", "shows", "showing", "prove", "proved", "proven", "proves", "proving", "mean", "meant", "means", "meaning", "suggest", "suggested", "suggests", "suggesting", "agree", "agreed", "agrees", "agreeing", "decide", "decided", "decides", "deciding", "explain", "explained", "explains", "explaining", "hear", "heard", "hears", "hearing", "imagine", "imagined", "imagines", "imagining", "learn", "learned", "learnt", "learns", "learning", "notice", "noticed", "notices", "noticing", "read", "reading", "report", "reported", "reports", "reporting", "tell", "told", "tells", "telling", "admit", "admitted", "admits", "admitting", "announce", "announced", "announces", "announcing", "argue", "argued", "argues", "arguing", "claim", "claimed", "claims", "claiming", "declare", "declared", "declares", "declaring", "emphasize", "emphasized", "emphasizes", "emphasizing", "insist", "insisted", "insists", "insisting", "mention", "mentioned", "mentions", "mentioning", "promise", "promised", "promises", "promising", "recommend", "recommended", "recommends", "recommending", "state", "stated", "states", "stating", "warn", "warned", "warns", "warning", "suppose", "supposed", "supposes", "supposing", "guess", "guessed", "guesses", "guessing", "assume", "assumed", "assumes", "assuming", "recognize", "recognized", "recognizes", "recognizing", "doubt", "doubted", "doubts", "doubting", "wonder", "wondered", "wonders", "wondering"]);
  var AUX_BE = new Set(["am", "is", "are", "was", "were", "be", "been", "being"]);
  var AUX_HAVE = new Set(["have", "has", "had", "having"]);
  var POSSESSIVE_ADJ = new Set(["my", "your", "his", "her", "its", "our", "their"]);
  var DEGREE_ADV = new Set(["very", "quite", "rather", "really", "extremely", "too", "so", "more", "most", "less", "fairly", "pretty", "almost", "highly"]);
  var IRREG_VBN = new Set(["broken", "written", "taken", "given", "seen", "gone", "done", "made", "spoken", "eaten", "driven", "known", "shown", "thrown", "bought", "brought", "caught", "taught", "thought", "built", "found", "held", "kept", "left", "lost", "sent", "told", "won", "sung", "run", "come", "become", "chosen", "hidden", "forgotten", "forgiven", "risen", "fallen", "felt", "meant", "paid", "said", "sold", "stood", "understood", "worn", "beaten", "blown", "drawn", "flown", "grown"]);
  var COMPOUND_PREPS = ["out of", "up to", "in front of", "in spite of", "instead of", "on top of", "next to", "due to", "according to", "along with", "together with", "apart from", "by means of", "in addition to", "in order to", "prior to", "with regard to", "in terms of", "on behalf of", "in case of", "in favor of", "with respect to", "in accordance with", "as for", "as to", "such as", "thanks to", "ahead of", "close to", "contrary to", "opposite to", "regardless of", "irrespective of", "in response to", "in relation to", "in comparison with", "in contrast with", "in line with", "because of"];

  var TYPE_INFO = {
    clause: { label: "从句", explain: "从句（Clause）：充当句子成分的从句，包括定语从句、名词性从句、状语从句等。从句内部遇到其他成分会换色显示。" },
    nonfinite: { label: "非谓语", explain: "非谓语动词（Non-finite Verb）：不充当谓语的动词形式，包括不定式（to do）、动名词（doing）、分词（done / doing）。" },
    preposition: { label: "介词短语", explain: "介词短语（Prepositional Phrase）：由介词 + 名词 / 代词 / 动名词等构成，常作状语、定语或表语。" },
    coordination: { label: "并列词", explain: "并列连词（Coordinating Conjunction）：连接并列的词、短语或分句，常见 and、but、or、nor、for、yet、so。" }
  };

  function sentenceEnds(text) {
    var ends = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === "!" || ch === "?" || ch === ";" || ch === "\n") { ends.push(i); continue; }
      if (ch === ".") {
        var next = text[i + 1];
        var next2 = text[i + 2] || "";
        if (next === " " && /[A-Z]/.test(next2)) ends.push(i);
        else if (next === undefined || next === "\n") ends.push(i);
        else if (next === " " && !next2) ends.push(i);
      }
    }
    return ends;
  }

  function tokenize(text) {
    var doc = nlp(text);
    var res = doc.json({ offset: true, terms: { tags: true, normal: true, text: true } });
    var tokens = [];
    for (var s = 0; s < res.length; s++) {
      var terms = res[s].terms || [];
      for (var t = 0; t < terms.length; t++) {
        var tm = terms[t];
        var off = tm.offset || { start: 0, length: 0 };
        tokens.push({
          start: off.start,
          end: off.start + off.length,
          text: tm.text || "",
          norm: (tm.normal || tm.text || "").toLowerCase(),
          tags: new Set(tm.tags || [])
        });
      }
    }
    return tokens;
  }

  function has(tok, tag) { return tok.tags.has(tag); }
  function gapHasPunct(text, a, b) {
    var seg = text.slice(a.end, b.start);
    for (var i = 0; i < seg.length; i++) {
      var c = seg.charCodeAt(i);
      for (var k = 0; k < PUNCT_CODE.length; k++) if (c === PUNCT_CODE[k]) return true;
    }
    return false;
  }

  function analyze(text) {
    text = String(text || "");
    var tokens = tokenize(text);
    var n = tokens.length;
    var ends = sentenceEnds(text);
    function nextSentEnd(pos) {
      for (var i = 0; i < ends.length; i++) if (ends[i] >= pos) return ends[i];
      return Infinity;
    }
    var covered = new Array(n).fill(false);
    var ccovered = new Array(n).fill(false);
    var spans = [];
    var idSeq = 0;

    function addSpan(i, j, type, layer, note) {
      if (i < 0 || j >= n || j < i) return;
      var covArr = layer === "outer" ? ccovered : covered;
      for (var k = i; k <= j; k++) if (covArr[k]) return;
      var sTok = tokens[i], eTok = tokens[j];
      var sp = {
        id: ++idSeq,
        type: type,
        layer: layer,
        start: sTok.start,
        end: eTok.end,
        text: text.slice(sTok.start, eTok.end),
        label: TYPE_INFO[type].label,
        explain: TYPE_INFO[type].explain + (note ? "（" + note + "）" : "")
      };
      spans.push(sp);
      for (var k2 = i; k2 <= j; k2++) covArr[k2] = true;
    }

    function inSpan(i) { return i < n && covered[i]; }
    function isNoun(i) { return i < n && has(tokens[i], "Noun"); }
    function isFiniteVerb(i) { return i < n && has(tokens[i], "Verb") && !has(tokens[i], "Gerund"); }
    function isCC(i) { return i < n && CC_WORDS.has(tokens[i].norm) && has(tokens[i], "Conjunction"); }

    /* ========== pass A: inner spans (mutually exclusive) ========== */

    // A1) to-infinitive: to + verb (+ object)
    for (var i = 0; i < n - 1; i++) {
      if (inSpan(i)) continue;
      if (tokens[i].norm !== "to") continue;
      var v = i + 1;
      if (v < n && has(tokens[v], "Adverb")) v++;
      if (v >= n || !has(tokens[v], "Verb") || has(tokens[v], "Gerund") || has(tokens[v], "PastTense")) continue;
      var j = v;
      var k = v + 1;
      while (k < n && k - v <= 8 && !inSpan(k) && !gapHasPunct(text, tokens[k - 1], tokens[k])) {
        var tk = tokens[k];
        if (has(tk, "Determiner") || has(tk, "Adjective") || has(tk, "Noun") || has(tk, "Pronoun") || has(tk, "Possessive") || has(tk, "Gerund") || (has(tk, "Adverb") && k - v <= 4)) {
          j = k; k++;
        } else break;
      }
      addSpan(i, j, "nonfinite", "inner", "不定式 " + text.slice(tokens[i].start, tokens[j].end));
    }

    // A2) prepositional phrases
    for (var pi = 0; pi < n; pi++) {
      if (inSpan(pi)) continue;
      var isPrepLike = has(tokens[pi], "Preposition") || (tokens[pi].norm === "to" && pi + 1 < n && !has(tokens[pi + 1], "Verb")) || (pi + 1 < n && COMPOUND_PREPS.indexOf(tokens[pi].norm + " " + tokens[pi + 1].norm) !== -1) || (pi + 2 < n && COMPOUND_PREPS.indexOf(tokens[pi].norm + " " + tokens[pi + 1].norm + " " + tokens[pi + 2].norm) !== -1);
      if (!isPrepLike) continue;
      if (SUBORDINATORS.has(tokens[pi].norm) || tokens[pi].norm === "that" || tokens[pi].norm === "what" || tokens[pi].norm === "whether" || tokens[pi].norm === "whatever") {
        var subHasV = false;
        for (var q = pi + 1; q < n && q - pi <= 6 && !gapHasPunct(text, tokens[q - 1], tokens[q]); q++) {
          if (isFiniteVerb(q)) { subHasV = true; break; }
        }
        if (subHasV) continue;
      }
      var pj = pi;
      var pk = pi + 1;
      var limit = nextSentEnd(tokens[pi].start);
      var compStr = tokens[pi].norm;
      while (pk < n && pk - pi <= 12 && !inSpan(pk) && tokens[pk].start < limit && !gapHasPunct(text, tokens[pk - 1], tokens[pk])) {
        var pt = tokens[pk];
        if (has(pt, "Preposition")) {
          var joinedComp = compStr + " " + pt.norm;
          var isCompound = false;
          for (var cc = 0; cc < COMPOUND_PREPS.length; cc++) {
            if (COMPOUND_PREPS[cc] === joinedComp || COMPOUND_PREPS[cc].indexOf(joinedComp) === 0) { isCompound = true; break; }
          }
          if (isCompound) { compStr = joinedComp; pj = pk; pk++; continue; }
          break;
        }
        if (has(pt, "Determiner") || has(pt, "Adjective") || has(pt, "Noun") || has(pt, "Pronoun") || has(pt, "Possessive") || has(pt, "Gerund") || has(pt, "Number")) {
          compStr = compStr + " " + pt.norm; pj = pk; pk++;
          continue;
        }
        if (has(pt, "Adverb")) {
          if (DEGREE_ADV.has(pt.norm) || pt.norm === "right" || pt.norm === "straight") { compStr = compStr + " " + pt.norm; pj = pk; pk++; continue; }
          break;
        }
        break;
      }
      if (pj > pi) addSpan(pi, pj, "preposition", "inner", "由介词 " + tokens[pi].norm + " 引导");
    }

    // A3) gerund / present participle
    for (var gi = 0; gi < n; gi++) {
      if (inSpan(gi)) continue;
      var gt = tokens[gi];
      if (!has(gt, "Gerund")) continue;
      if (gi > 0 && AUX_BE.has(tokens[gi - 1].norm)) continue;
      addSpan(gi, gi, "nonfinite", "inner", gt.norm + " 为动名词 / 现在分词");
    }

    // A4) past participle
    for (var ppi = 0; ppi < n; ppi++) {
      if (inSpan(ppi)) continue;
      var ppt = tokens[ppi];
      var prevN = ppi > 0 ? tokens[ppi - 1].norm : "";
      if (has(ppt, "PastTense") && (AUX_HAVE.has(prevN) || AUX_BE.has(prevN))) {
        addSpan(ppi, ppi, "nonfinite", "inner", ppt.norm + " 为过去分词（完成 / 被动结构）");
        continue;
      }
      if (AUX_BE.has(prevN) && (ppt.norm.endsWith("ed") || IRREG_VBN.has(ppt.norm))) {
        addSpan(ppi, ppi, "nonfinite", "inner", ppt.norm + " 为过去分词（被动 / 表语结构）");
      }
    }

    // A5) coordinating conjunctions
    for (var ci = 0; ci < n; ci++) {
      if (inSpan(ci)) continue;
      var ct = tokens[ci];
      if (isCC(ci)) {
        addSpan(ci, ci, "coordination", "inner", "并列连词 " + ct.norm);
      }
    }

    /* ========== pass B: clauses (outer layer, may contain inner spans) ========== */

    function clauseEndFrom(i, opts) {
      // returns {endIdx, hasVerb} scanning forward from i (exclusive)
      var o = opts || {};
      var e = i;
      var hasV = false;
      var k = i + 1;
      var limit = nextSentEnd(tokens[i].start);
      var maxLen = o.maxLen || 14;
      while (k < n && k - i <= maxLen && tokens[k].start < limit && !gapHasPunct(text, tokens[k - 1], tokens[k])) {
        if (isCC(k)) break;
        if (SUBORDINATORS.has(tokens[k].norm)) break;
        if (isFiniteVerb(k)) hasV = true;
        e = k; k++;
      }
      return { endIdx: e, hasVerb: hasV };
    }

    // B1) noun clauses: that / what / whatever / whether after verbs or be
    for (var ni = 1; ni < n; ni++) {
      if (ccovered[ni]) continue;
      var nt = tokens[ni];
      var backVerb = -1;
      var b2 = ni - 1;
      var bCount = 0;
      while (b2 >= 0 && bCount < 4) {
        if (b2 + 1 < n && gapHasPunct(text, tokens[b2], tokens[b2 + 1])) break;
        var bt = tokens[b2];
        if (has(bt, "Verb")) { backVerb = b2; break; }
        if (!(has(bt, "Pronoun") || has(bt, "Determiner") || has(bt, "Possessive") || has(bt, "Adjective") || has(bt, "Noun") || has(bt, "Adverb"))) break;
        bCount++;
        b2--;
      }
      var isNounClauseStart = false;
      var note = "";
      if (nt.norm === "that") {
        if (backVerb >= 0 && (NCLAUSE_VERBS.has(tokens[backVerb].norm) || AUX_BE.has(tokens[backVerb].norm))) { isNounClauseStart = true; note = "由 that 引导的名词性从句（宾语 / 表语）"; }
      } else if (nt.norm === "what" || nt.norm === "whatever" || nt.norm === "whether") {
        if (backVerb >= 0) { isNounClauseStart = true; note = "由 " + nt.norm + " 引导的名词性从句"; }
      }
      if (!isNounClauseStart) continue;
      var nc = clauseEndFrom(ni, { maxLen: 14 });
      if (nc.endIdx > ni) addSpan(ni, nc.endIdx, "clause", "outer", note);
    }

    // B2) adverbial clauses: subordinator + a finite verb follows
    for (var si = 0; si < n; si++) {
      if (ccovered[si]) continue;
      var st = tokens[si];
      if (!SUBORDINATORS.has(st.norm)) continue;
      if (st.norm === "because" && si + 1 < n && has(tokens[si + 1], "Preposition")) continue;
      var ac = clauseEndFrom(si, { maxLen: 12 });
      if (!ac.hasVerb) continue;
      var atStart = si === 0;
      if (!atStart) {
        // if previous token is punctuation-free and part of same sentence, mid-sentence clause still ok
      }
      // if the subordinator starts the sentence, stop at first comma; else to clause end
      var stop = ac.endIdx;
      if (atStart) {
        // find first comma between tokens[si].start and sentence end
        var segEnd = nextSentEnd(st.start);
        var commaPos = -1;
        for (var chI = st.end; chI < segEnd && chI < text.length; chI++) { if (text[chI] === ",") { commaPos = chI; break; } }
        if (commaPos >= 0) {
          var s2 = stop;
          while (s2 > si && tokens[s2].end > commaPos) s2--;
          stop = s2;
        }
      }
      if (stop > si) addSpan(si, stop, "clause", "outer", "由从属连词 " + st.norm + " 引导的状语从句");
    }

    // B3) relative clauses (attributive clauses): who/whom/whose/which/that after a noun
    for (var ri = 1; ri < n; ri++) {
      if (ccovered[ri]) continue;
      var rt = tokens[ri];
      if (!REL_PRONOUNS.has(rt.norm)) continue;
      if (!isNoun(ri - 1)) continue;
      var rj = ri;
      var rk = ri + 1;
      var rlimit = nextSentEnd(rt.start);
      var seenVerb = false;
      while (rk < n && rk - ri <= 12 && tokens[rk].start < rlimit && !gapHasPunct(text, tokens[rk - 1], tokens[rk])) {
        if (isCC(rk)) break;
        if (SUBORDINATORS.has(tokens[rk].norm)) break;
        if (isFiniteVerb(rk)) {
          if (seenVerb) break;
          seenVerb = true;
        }
        rj = rk; rk++;
      }
      if (rj > ri) addSpan(ri, rj, "clause", "outer", "由关系代词 " + rt.norm + " 引导的定语从句");
    }

    spans.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return {
      text: text,
      tokens: tokens.map(function (t) { return { start: t.start, end: t.end, text: t.text, norm: t.norm, tags: Array.from(t.tags) }; }),
      spans: spans,
      types: TYPE_INFO
    };
  }

  return { analyze: analyze, TYPE_INFO: TYPE_INFO };
});