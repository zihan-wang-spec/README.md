const welcomeScreen = document.getElementById("screen-welcome");
const profileScreen = document.getElementById("screen-profile");
const quizScreen = document.getElementById("screen-quiz");
const resultScreen = document.getElementById("screen-result");
const questionText = document.getElementById("questionText");
const optionsBox = document.getElementById("optionsBox");
const progressText = document.getElementById("progressText");
const progressFill = document.getElementById("progressFill");
const prevBtn = document.getElementById("prevBtn");
const badgeEl = document.getElementById("typeBadge");
const badgeIcon = document.getElementById("badgeIcon");
const badgeName = document.getElementById("badgeName");
const strengthTags = document.getElementById("strengthTags");
const gapTags = document.getElementById("gapTags");
const directionText = document.getElementById("directionText");
const gapAdviceText = document.getElementById("gapAdviceText");
const resultBlurb = document.getElementById("resultBlurb");
const copyBtn = document.getElementById("copyBtn");
const saveBtn = document.getElementById("saveBtn");
const genderChoices = document.getElementById("genderChoices");
const gradeChoices = document.getElementById("gradeChoices");
const interestInput = document.getElementById("interestInput");
const profileHint = document.getElementById("profileHint");

/* 本地 5500 静态预览时直连 8001；正式同域部署用相对路径 */
const API_BASE =
  location.port === "5500" || location.port === "5501"
    ? "http://127.0.0.1:8001"
    : "";
const RESULTS_API = API_BASE + "/api/results";
const ADVICE_API = API_BASE + "/api/advice";
const CATEGORIES = ["strength", "growth", "values", "collab"];

let currentIndex = 0;
let totals = {};
let gaps = {};
let sessionQuestions = [];
let answers = [];
let lastPortrait = null;
let profile = { gender: "", grade: "", interest: "" };

function showScreen(screen) {
  welcomeScreen.classList.remove("active");
  profileScreen.classList.remove("active");
  quizScreen.classList.remove("active");
  resultScreen.classList.remove("active");
  screen.classList.add("active");
}

function bindChoiceGroup(container, key) {
  container.addEventListener("click", function (e) {
    const btn = e.target.closest(".choice-chip");
    if (!btn || !container.contains(btn)) return;
    container.querySelectorAll(".choice-chip").forEach(function (chip) {
      chip.classList.remove("selected");
    });
    btn.classList.add("selected");
    profile[key] = btn.getAttribute("data-value") || "";
    profileHint.hidden = true;
  });
}

function resetProfileForm() {
  profile = { gender: "", grade: "", interest: "" };
  genderChoices.querySelectorAll(".choice-chip").forEach(function (chip) {
    chip.classList.remove("selected");
  });
  gradeChoices.querySelectorAll(".choice-chip").forEach(function (chip) {
    chip.classList.remove("selected");
  });
  interestInput.value = "";
  profileHint.hidden = true;
}

function showProfile() {
  resetProfileForm();
  showScreen(profileScreen);
}

function submitProfile() {
  profile.interest = (interestInput.value || "").trim();
  if (!profile.gender || !profile.grade || !profile.interest) {
    profileHint.hidden = false;
    return;
  }
  profileHint.hidden = true;
  startQuiz();
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/* 四类各抽 PER_CATEGORY 道，合成 16 题；选项打乱但 typeId 仍对应 A/B/C/D */
function pickSessionQuestions() {
  let picked = [];
  CATEGORIES.forEach(function (cat) {
    const pool = QUESTIONS.filter(function (q) {
      return q.category === cat;
    });
    picked = picked.concat(shuffle(pool).slice(0, PER_CATEGORY));
  });
  return shuffle(picked).map(function (q) {
    const options = q.options.map(function (label, i) {
      return { label: label, typeId: OPTION_TYPE_IDS[i] };
    });
    return {
      category: q.category,
      text: q.text,
      options: shuffle(options)
    };
  });
}

function emptyScores() {
  const map = {};
  TYPES.forEach(function (type) {
    map[type.id] = 0;
  });
  return map;
}

/* 只用已确认的答案重算，避免上一题/改选后分数对不上 */
function recomputeScores() {
  totals = emptyScores();
  gaps = emptyScores();
  for (let i = 0; i < currentIndex; i++) {
    const ans = answers[i];
    if (!ans) continue;
    if (ans.category === "growth") {
      gaps[ans.typeId] += 1;
    } else {
      totals[ans.typeId] += 1;
    }
  }
}

function startQuiz() {
  currentIndex = 0;
  answers = [];
  lastPortrait = null;
  sessionQuestions = pickSessionQuestions();
  recomputeScores();
  showScreen(quizScreen);
  renderQuestion();
}

function pickType() {
  let best = TYPES[0];
  TYPES.forEach(function (type) {
    if (totals[type.id] > totals[best.id]) {
      best = type;
    }
  });
  return best;
}

function rankedBy(scoreMap) {
  return TYPES.slice().sort(function (a, b) {
    return (scoreMap[b.id] || 0) - (scoreMap[a.id] || 0);
  });
}

/* 待补避开强项，避免同一标签既是强项又是最该补 */
function pickGapExclusive(strengthIds) {
  const ranked = rankedBy(gaps);
  for (let i = 0; i < ranked.length; i++) {
    if (strengthIds.indexOf(ranked[i].id) === -1) {
      return ranked[i];
    }
  }
  return ranked[ranked.length - 1];
}

function toPercentScores() {
  const additiveCount = sessionQuestions.filter(function (q) {
    return q.category !== "growth";
  }).length;
  const cap = additiveCount || 1;
  const percents = {};
  DIMENSIONS.forEach(function (dim) {
    percents[dim.id] = Math.round(Math.min(100, ((totals[dim.id] || 0) / cap) * 100));
  });
  return percents;
}

function radarPoint(index, radius, cx, cy, count) {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
    angle: angle
  };
}

function tracePolygon(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

function drawRadar(percentScores) {
  const canvas = document.getElementById("radarCanvas");
  const cssSize = 280;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssSize * dpr;
  canvas.height = cssSize * dpr;
  canvas.style.width = cssSize + "px";
  canvas.style.height = cssSize + "px";

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);

  const count = DIMENSIONS.length;
  const cx = cssSize / 2;
  const cy = cssSize / 2 + 6;
  const maxR = 78;
  const levels = 4;

  for (let level = levels; level >= 1; level--) {
    const ring = [];
    for (let i = 0; i < count; i++) {
      ring.push(radarPoint(i, maxR * (level / levels), cx, cy, count));
    }
    tracePolygon(ctx, ring);
    ctx.strokeStyle = "rgba(116, 124, 138, 0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  for (let i = 0; i < count; i++) {
    const tip = radarPoint(i, maxR, cx, cy, count);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tip.x, tip.y);
    ctx.strokeStyle = "rgba(116, 124, 138, 0.2)";
    ctx.stroke();
  }

  const dataPoints = [];
  for (let i = 0; i < count; i++) {
    const value = (percentScores[DIMENSIONS[i].id] || 0) / 100;
    dataPoints.push(radarPoint(i, maxR * Math.max(value, 0.08), cx, cy, count));
  }
  tracePolygon(ctx, dataPoints);
  const grad = ctx.createLinearGradient(cx - maxR, cy - maxR, cx + maxR, cy + maxR);
  grad.addColorStop(0, "rgba(126, 182, 232, 0.4)");
  grad.addColorStop(1, "rgba(125, 207, 176, 0.3)");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "#7EB6E8";
  ctx.lineWidth = 2;
  ctx.stroke();

  dataPoints.forEach(function (pt) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#5A9AD4";
    ctx.fill();
  });

  ctx.font = "700 12px PingFang SC, Microsoft YaHei, sans-serif";
  ctx.fillStyle = "#2F3542";
  DIMENSIONS.forEach(function (dim, i) {
    const labelPt = radarPoint(i, maxR + 20, cx, cy, count);
    const cos = Math.cos(labelPt.angle);
    const sin = Math.sin(labelPt.angle);
    ctx.textAlign = "center";
    ctx.textBaseline = sin > 0.45 ? "top" : sin < -0.45 ? "bottom" : "middle";
    let x = labelPt.x;
    if (cos > 0.4) x += 6;
    if (cos < -0.4) x -= 6;
    ctx.fillText(dim.name, x, labelPt.y);
  });
}

function makeTag(text, kind) {
  const span = document.createElement("span");
  span.className = "tag tag-" + kind;
  span.textContent = text;
  return span;
}

function typeShortName(type) {
  return type.name.replace("型", "");
}

function reportResult(type, percents) {
  try {
    fetch(RESULTS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        typeId: type.id,
        typeName: type.name,
        totals: totals,
        gaps: gaps,
        percents: percents,
        profile: {
          gender: profile.gender,
          grade: profile.grade,
          interest: profile.interest
        }
      })
    }).catch(function () {});
  } catch (err) {}
}

/* 先本地拼装，再尝试 Kimi；失败则静默保留本地文案 */
function fetchAiAdvice(type, gapTop) {
  try {
    fetch(ADVICE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        typeId: type.id,
        typeName: type.name,
        gapId: gapTop.id,
        gapName: gapTop.name,
        profile: {
          gender: profile.gender,
          grade: profile.grade,
          interest: profile.interest
        }
      })
    })
      .then(function (res) {
        if (!res.ok) throw new Error("advice failed");
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok || !data.direction || !data.gapAdvice) return;
        if (!lastPortrait || lastPortrait.type.id !== type.id) return;
        lastPortrait.direction = data.direction;
        lastPortrait.gapAdvice = data.gapAdvice;
        directionText.textContent = data.direction;
        gapAdviceText.textContent = data.gapAdvice;
      })
      .catch(function () {});
  } catch (err) {}
}

function showResult() {
  currentIndex = sessionQuestions.length;
  recomputeScores();

  const type = pickType();
  const top = rankedBy(totals);
  const strengthIds = [top[0].id, top[1].id];
  const gapTop = pickGapExclusive(strengthIds);
  const percents = toPercentScores();
  const strengthA = typeShortName(top[0]);
  const strengthB = typeShortName(top[1]);
  const gapName = typeShortName(gapTop);
  const advice = buildGapAdvice(type.id, gapTop.id, profile);
  const direction = buildDirection(type.id, gapTop.id, profile);

  lastPortrait = {
    type: type,
    gapType: gapTop,
    strengthA: strengthA,
    strengthB: strengthB,
    gapName: gapName,
    gapAdvice: advice,
    direction: direction
  };

  badgeIcon.src = type.icon;
  badgeIcon.alt = type.name;
  badgeName.textContent = type.name;
  resultBlurb.textContent = type.blurb;
  directionText.textContent = direction;
  gapAdviceText.textContent = advice;

  strengthTags.innerHTML = "";
  strengthTags.appendChild(makeTag(strengthA, "good"));
  strengthTags.appendChild(makeTag(strengthB, "good"));

  gapTags.innerHTML = "";
  gapTags.appendChild(makeTag(gapName, "grow"));

  badgeEl.classList.remove("pop-in");
  void badgeEl.offsetWidth;
  badgeEl.classList.add("pop-in");

  showScreen(resultScreen);
  drawRadar(percents);
  reportResult(type, percents);
  fetchAiAdvice(type, gapTop);
}

function renderQuestion() {
  const q = sessionQuestions[currentIndex];
  const total = sessionQuestions.length;
  questionText.textContent = q.text;
  progressText.textContent = "第 " + (currentIndex + 1) + " / " + total + " 题";
  progressFill.style.width = ((currentIndex + 1) / total * 100) + "%";
  prevBtn.disabled = currentIndex === 0;

  const prevPick = answers[currentIndex];

  optionsBox.innerHTML = "";
  q.options.forEach(function (option) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-btn";
    if (prevPick && prevPick.typeId === option.typeId) {
      btn.classList.add("picked");
    }
    btn.textContent = option.label;
    btn.addEventListener("click", function () {
      goNext(option);
    });
    optionsBox.appendChild(btn);
  });
}

function goNext(option) {
  const q = sessionQuestions[currentIndex];
  answers[currentIndex] = { typeId: option.typeId, category: q.category };
  currentIndex += 1;
  recomputeScores();

  if (currentIndex < sessionQuestions.length) {
    renderQuestion();
  } else {
    showResult();
  }
}

function goPrev() {
  if (currentIndex === 0) return;
  currentIndex -= 1;
  recomputeScores();
  renderQuestion();
}

function portraitText() {
  if (!lastPortrait) return "";
  const p = lastPortrait;
  return [
    "GAPS 申请者自评测",
    "你更像：" + p.type.name,
    "强项：" + p.strengthA + "、" + p.strengthB,
    "最该补的一块：" + p.gapName,
    "适合方向：" + p.direction,
    "可以这样补：" + p.gapAdvice,
    p.type.blurb
  ].join("\n");
}

function copyPortrait() {
  const text = portraitText();
  if (!text) return;

  function done() {
    copyBtn.textContent = "已复制";
    setTimeout(function () {
      copyBtn.textContent = "复制画像";
    }, 1600);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallbackCopy);
  } else {
    fallbackCopy();
  }

  function fallbackCopy() {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      done();
    } catch (err) {}
    document.body.removeChild(area);
  }
}

function wrapLines(ctx, text, maxWidth) {
  const chars = text.split("");
  const lines = [];
  let line = "";
  chars.forEach(function (ch) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function finishSaveCard(ctx, canvas, p, iconImg) {
  const width = canvas.width;

  ctx.fillStyle = "#FFF8F3";
  ctx.fillRect(0, 0, width, canvas.height);

  ctx.fillStyle = "#FFFFFF";
  roundRect(ctx, 48, 48, width - 96, canvas.height - 96, 28);
  ctx.fill();

  ctx.fillStyle = "#5A9AD4";
  ctx.font = "700 22px PingFang SC, Microsoft YaHei, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("GAPS 申请者自评测", width / 2, 140);

  if (iconImg) {
    const size = 88;
    ctx.drawImage(iconImg, width / 2 - size / 2, 168, size, size);
  } else {
    ctx.font = "48px sans-serif";
    ctx.fillText(p.type.emoji, width / 2, 230);
  }

  ctx.fillStyle = "#2F3542";
  ctx.font = "800 40px PingFang SC, Microsoft YaHei, sans-serif";
  ctx.fillText(p.type.name, width / 2, 300);

  ctx.fillStyle = "#3A9A72";
  ctx.font = "700 22px PingFang SC, Microsoft YaHei, sans-serif";
  ctx.fillText("强项  " + p.strengthA + " · " + p.strengthB, width / 2, 360);

  ctx.fillStyle = "#FFB089";
  ctx.fillText("最该补  " + p.gapName, width / 2, 404);

  const dirBottom = drawBlock(ctx, "适合方向", p.direction, 460, "#8B93A7", "#2F3542");
  drawBlock(ctx, "可以这样补", p.gapAdvice, dirBottom + 36, "#FFB089", "#C46A3A");

  ctx.fillStyle = "#8B93A7";
  ctx.font = "16px PingFang SC, Microsoft YaHei, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("给画像，不给分数", width / 2, 980);

  const link = document.createElement("a");
  link.download = "GAPS画像.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function saveCard() {
  if (!lastPortrait) return;
  const p = lastPortrait;
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");

  if (!p.type.icon) {
    finishSaveCard(ctx, canvas, p, null);
    return;
  }

  const img = new Image();
  img.onload = function () {
    finishSaveCard(ctx, canvas, p, img);
  };
  img.onerror = function () {
    finishSaveCard(ctx, canvas, p, null);
  };
  img.src = p.type.icon;
}

function drawBlock(ctx, title, body, y, titleColor, bodyColor) {
  const left = 96;
  const maxW = 528;
  const lineH = 32;
  ctx.textAlign = "left";
  ctx.fillStyle = titleColor;
  ctx.font = "700 18px PingFang SC, Microsoft YaHei, sans-serif";
  ctx.fillText(title, left, y);

  ctx.fillStyle = bodyColor;
  ctx.font = "400 20px PingFang SC, Microsoft YaHei, sans-serif";
  const lines = wrapLines(ctx, body, maxW);
  lines.forEach(function (line, i) {
    ctx.fillText(line, left, y + 36 + i * lineH);
  });
  return y + 36 + Math.max(lines.length, 1) * lineH;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

bindChoiceGroup(genderChoices, "gender");
bindChoiceGroup(gradeChoices, "grade");
interestInput.addEventListener("input", function () {
  profileHint.hidden = true;
});

document.getElementById("startBtn").addEventListener("click", showProfile);
document.getElementById("profileNextBtn").addEventListener("click", submitProfile);
document.getElementById("retryBtn").addEventListener("click", function () {
  showScreen(welcomeScreen);
});
prevBtn.addEventListener("click", goPrev);
copyBtn.addEventListener("click", copyPortrait);
saveBtn.addEventListener("click", saveCard);
