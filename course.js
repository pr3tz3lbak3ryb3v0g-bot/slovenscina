/* course.js — Memrise-style progress layer for the slovenian-kb course.
   100% client-side (localStorage), so it works offline inside the PWA.
   Features: daily streak + goal, XP/levels, a spaced-repetition review bank,
   per-lesson completion, and a shared text-to-speech helper. */
(function (global) {
  "use strict";
  var KEY = "slo_course_v1", GOAL = 20;          // daily goal = 20 words learnt/reviewed
  var SRS = [1, 1, 3, 7, 15, 30];                // Leitner intervals (days) by box 0..5

  function day() { return Math.floor(Date.now() / 86400000); }   // days since epoch (UTC)
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function init(s) {
    s.xp = s.xp || 0; s.streak = s.streak || 0; s.lastGoalDay = s.lastGoalDay || 0;
    s.goalDay = s.goalDay || 0; s.goalCount = s.goalCount || 0;
    s.lessons = s.lessons || {}; s.bank = s.bank || {}; s.days = s.days || {};
    if (s.lastGoalDay && s.lastGoalDay < day() - 1) s.streak = 0;   // missed a day → streak broken
    return s;
  }

  function level(xp) { return Math.floor(xp / 200) + 1; }

  // count an activity toward today's goal; bump the streak the first time goal is hit
  function credit(s, n) {
    var t = day();
    if (s.goalDay !== t) { s.goalDay = t; s.goalCount = 0; }
    s.goalCount += n;
    s.days[t] = (s.days[t] || 0) + n;          // per-day activity log (drives the progress heatmap)
    if (s.goalCount >= GOAL && s.lastGoalDay !== t) {
      s.streak = (s.lastGoalDay === t - 1) ? s.streak + 1 : 1;
      s.lastGoalDay = t;
    }
  }

  var Course = {
    /* record one answer to a word (word = the lemma/cue, q = {p,a,o} for later review) */
    answer: function (word, ok, q) {
      if (!word) return;
      var s = init(load()), b = s.bank[word] || { box: 0, miss: 0, seen: 0 };
      if (q && !b.q) b.q = q;
      b.seen = (b.seen || 0) + 1;
      if (ok) { b.box = Math.min(5, (b.box || 0) + 1); s.xp += 10; }
      else { b.box = 0; b.miss = (b.miss || 0) + 1; s.xp += 2; }
      b.due = day() + SRS[b.box];
      s.bank[word] = b;
      credit(s, 1);
      save(s);
    },
    /* record that a lesson was opened (→ orange "started" until finished) */
    visit: function (id, total) {
      if (!id) return; var s = init(load()), L = s.lessons[id] || {};
      L.started = true; if (total) L.total = total; L.ts = Date.now();
      s.lessons[id] = L; save(s);
    },
    /* record partial progress as the user answers (so a half-done lesson survives leaving) */
    progress: function (id, ans, cor, total) {
      if (!id) return; var s = init(load()), L = s.lessons[id] || {};
      L.started = true; L.ans = ans; L.cor = cor; if (total) L.total = total; L.ts = Date.now();
      s.lessons[id] = L; save(s);
    },
    /* mark a lesson finished; keep the best score; small completion bonus */
    finishLesson: function (id, right, total) {
      var s = init(load()), L = s.lessons[id] || {}, prev = L.best || 0, score = total ? right / total : 0;
      L.best = Math.max(prev, score); L.done = true; L.started = true;
      L.ans = total; L.cor = right; if (total) L.total = total; L.ts = Date.now();
      s.lessons[id] = L;
      if (score >= 0.6) s.xp += 25;
      save(s);
      return { streak: s.streak, xp: s.xp, level: level(s.xp), goal: { count: s.goalCount, target: GOAL } };
    },
    /* traffic-light status: green = finished & passed, orange = started/partial, red = untouched */
    state: function (id) {
      var L = init(load()).lessons[id];
      if (!L) return "red";
      if (L.done && (L.best || 0) >= 0.6) return "green";
      return "orange";
    },
    stats: function () {
      var s = init(load()), learned = 0, due = 0, t = day();
      for (var w in s.bank) { var b = s.bank[w]; if (b.box >= 1) { learned++; if (b.due <= t) due++; } else if (b.due <= t) due++; }
      var done = 0; for (var k in s.lessons) if (s.lessons[k].done) done++;
      return { streak: s.streak, xp: s.xp, level: level(s.xp), learned: learned, due: due,
               lessonsDone: done, goal: { count: s.goalDay === t ? s.goalCount : 0, target: GOAL } };
    },
    lesson: function (id) { return init(load()).lessons[id] || null; },
    /* words due for review (or all wrong-at-least-once), most-overdue first */
    dueItems: function (limit) {
      var s = init(load()), t = day(), out = [];
      for (var w in s.bank) { var b = s.bank[w]; if (b.q && (b.due <= t || b.miss > 0)) out.push({ word: w, b: b }); }
      out.sort(function (a, c) { return (a.b.due - c.b.due) || (c.b.miss - a.b.miss); });
      return out.slice(0, limit || 9999).map(function (x) {
        var q = x.b.q || {}; return { word: x.word, p: q.p, a: q.a, o: q.o || [] };
      });
    },
    /* words answered wrong at least once (weak words), most-missed first */
    mistakes: function (limit) {
      var s = init(load()), out = [];
      for (var w in s.bank) { var b = s.bank[w]; if (b.q && b.miss > 0) out.push({ word: w, b: b }); }
      out.sort(function (a, c) { return c.b.miss - a.b.miss; });
      return out.slice(0, limit || 9999).map(function (x) {
        var q = x.b.q || {}; return { word: x.word, p: q.p, a: q.a, o: q.o || [] };
      });
    },
    /* self-graded review: 'again' | 'good' | 'easy' → set the Leitner box + reschedule */
    grade: function (word, g) {
      if (!word) return;
      var s = init(load()), b = s.bank[word] || { box: 0, miss: 0, seen: 0 };
      b.seen = (b.seen || 0) + 1;
      if (g === "again") { b.box = 0; b.miss = (b.miss || 0) + 1; s.xp += 2; }
      else if (g === "easy") { b.box = Math.min(5, (b.box || 0) + 2); s.xp += 12; }
      else { b.box = Math.min(5, (b.box || 0) + 1); s.xp += 10; }   // good
      b.due = day() + SRS[b.box];
      s.bank[word] = b; credit(s, 1); save(s);
    },
    /* per-day activity counts {dayNumber: n} for the progress heatmap */
    history: function () { return init(load()).days || {}; },
    today: function () { return day(); },
    /* text-to-speech (Slovene voice if the device has one) */
    say: function (text) {
      if (!text || !("speechSynthesis" in global)) return;
      try {
        speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(String(text).replace(/<[^>]+>/g, "").replace(/[·•]/g, " "));
        u.lang = "sl-SI"; u.rate = 0.9;
        var v = speechSynthesis.getVoices().find(function (x) { return /sl|sloven/i.test(x.lang + x.name); });
        if (v) u.voice = v;
        speechSynthesis.speak(u);
      } catch (e) {}
    }
  };

  /* ---- index page: render the progress header + per-lesson badges ---- */
  function decorateIndex() {
    var cards = document.querySelectorAll("a.lcard");
    if (!cards.length) return;
    var st = Course.stats();
    var pct = st.goal.target ? Math.min(100, Math.round(st.goal.count / st.goal.target * 100)) : 0;
    var bar = document.createElement("div");
    bar.className = "statbar";
    bar.innerHTML =
      '<div class="stat"><div class="v">' + (st.streak || 0) + ' 🔥</div><div class="k">day streak</div></div>' +
      '<div class="stat"><div class="v">lvl ' + st.level + '</div><div class="k">' + st.xp + ' XP</div></div>' +
      '<div class="stat"><div class="v">' + st.learned + '</div><div class="k">words learnt</div></div>' +
      '<a class="stat' + (st.due ? ' due' : '') + '" href="review.html"><div class="v">' + st.due + ' 🔁</div><div class="k">to review</div></a>' +
      '<div class="goal"><div class="goalbar"><span style="width:' + pct + '%"></span></div>' +
      '<div class="k">daily goal · ' + Math.min(st.goal.count, st.goal.target) + '/' + st.goal.target + (pct >= 100 ? ' ✓' : '') + '</div></div>';
    var slot = document.getElementById("progress");
    if (slot) { slot.appendChild(bar); }
    else { var h1 = document.querySelector("h1"); if (h1 && h1.nextSibling) h1.parentNode.insertBefore(bar, h1.nextSibling.nextSibling || null); }

    /* per-card traffic-light badge (green = passed · orange = started · red = untouched),
       a left-edge colour, and a record of the most-recently-opened lesson (for resume) */
    var lastId = null, lastTs = 0, firstRed = null, firstOrange = null, touched = 0;
    cards.forEach(function (a) {
      var href = a.getAttribute("href") || "";
      if (href.indexOf("lesson-") !== 0) return;                 // lessons only (exams keep their own look)
      var id = href.replace(".html", ""), L = Course.lesson(id), st = Course.state(id);
      a.dataset.state = st;
      if (L && L.ts) { touched++; if (L.ts > lastTs) { lastTs = L.ts; lastId = id; } }
      if (st === "red" && !firstRed) firstRed = a;
      if (st === "orange" && !firstOrange) firstOrange = a;
      var b = document.createElement("span"); b.className = "badge " + st;
      if (st === "green") b.textContent = "✓ " + Math.round((L.best || 0) * 100) + "%";
      else if (st === "orange") b.textContent = (L && L.total) ? ("◐ " + (L.ans || 0) + "/" + L.total) : "◐ started";
      else b.textContent = "○ new";
      a.appendChild(b);
    });

    /* per-branch progress: passed (green) / total + a bar */
    document.querySelectorAll("details.branch").forEach(function (br) {
      var ls = br.querySelectorAll('a.lcard[href^="lesson-"]');
      if (!ls.length) return;
      var green = 0; ls.forEach(function (a) { if (a.dataset.state === "green") green++; });
      var sum = br.querySelector("summary"), cnt = sum && sum.querySelector(".bcount");
      if (sum && !sum.querySelector(".bprog")) {
        var p = document.createElement("span");
        p.className = "bprog"; p.title = green + " / " + ls.length + " passed";
        p.innerHTML = '<span class="bpbar"><span style="width:' + Math.round(green / ls.length * 100) + '%"></span></span>';
        if (cnt) { cnt.textContent = green + "/" + ls.length; sum.insertBefore(p, cnt); } else sum.appendChild(p);
      }
    });

    /* "you were here": mark + reveal the most-recently-opened lesson */
    var resumeCard = null;
    if (lastId) {
      var la = document.querySelector('a.lcard[href="' + lastId + '.html"]');
      if (la) {
        var tag = document.createElement("span"); tag.className = "here"; tag.textContent = "you were here";
        la.appendChild(tag);
        for (var p = la.parentNode; p; p = p.parentNode) { if (p.tagName === "DETAILS") p.open = true; }  // open its branch
        if (la.dataset.state !== "green") resumeCard = la;
      }
    }

    /* continue button: resume the last lesson if unfinished, else the next untouched/started one */
    var target = resumeCard || firstRed || firstOrange;
    if (target && slot && !document.getElementById("continue")) {
      var lt = target.querySelector(".lt"), L = Course.lesson(target.getAttribute("href").replace(".html", ""));
      var label = resumeCard ? "pick up where you left off"
                : (touched ? "continue the course" : "start the course");
      var detail = lt ? lt.textContent : "";
      if (resumeCard && L && L.total) detail += " · " + (L.ans || 0) + "/" + L.total + " so far";
      var c = document.createElement("a");
      c.id = "continue"; c.className = "continue"; c.href = target.getAttribute("href");
      c.innerHTML = '<span class="ci">▶</span><span class="ct"><span class="ck">' + label +
        '</span><span class="cl">' + detail + "</span></span>";
      slot.appendChild(c);
    }
  }

  /* ---- lesson page: record the visit + persist guided-writing / can-do state ---- */
  function decorateLesson() {
    var main = document.querySelector("main[data-lesson]");
    if (!main) return;
    var id = main.getAttribute("data-lesson");
    Course.visit(id, document.querySelectorAll(".q,.wo,.wbq").length);
    var wkey = "slo_write_" + id, saved = {};
    try { saved = JSON.parse(localStorage.getItem(wkey)) || {}; } catch (e) {}
    function persist() { try { localStorage.setItem(wkey, JSON.stringify(saved)); } catch (e) {} }
    document.querySelectorAll(".fin").forEach(function (inp) {
      var k = "f" + inp.dataset.i; if (saved[k] != null) inp.value = saved[k];
      inp.addEventListener("input", function () { saved[k] = inp.value; persist(); });
    });
    document.querySelectorAll(".candobox").forEach(function (cb) {
      var k = "c" + cb.dataset.i; if (saved[k]) cb.checked = true;
      cb.addEventListener("change", function () { saved[k] = cb.checked; persist(); });
    });
  }

  function decorate() { decorateIndex(); decorateLesson(); }
  if (document.readyState !== "loading") decorate();
  else document.addEventListener("DOMContentLoaded", decorate);

  global.Course = Course;
})(window);
