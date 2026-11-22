(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const {
    furiganaParts,
    furiganaBase,
    splitPoints,
    autoSyllables,
    parseSyllableInput,
    validSegments,
    segmentWindows,
    kfDurations,
    evenSegments,
    kanaToHangul,
    alignReading,
    segmentsFromBoundaries,
    segmentsFromAssKaraoke,
  } = window.KaraokeText;
  const selfTestMode = new URLSearchParams(location.search).has("selftest");
  const initial = JSON.parse($("example-data").textContent);
  const projectStorageKey = "two-row-karaoke:last-project";
  const stylePresetStorageKey = "two-row-karaoke:style-presets";
  const defaults = {
    japaneseFont: "Yu Gothic",
    englishFont: "Arial",
    koreanFont: "Malgun Gothic",
    jpPrimary: "#FFE9B8",
    jpSecondary: "#FFFFFF",
    koreanColor: "#FFFFFF",
    koreanSungColor: "#FFE9B8",
    fillReading: true,
    jpOutlineColor: "#7A5429",
    koreanOutlineColor: "#303030",
    outlineWidth: 5,
    shadowDepth: 2,
    rubySizePercent: 42,
    rubyGap: 6,
    originalBold: false,
    koreanBold: false,
    precisionEdit: true,
    linkTimingNeighbors: false,
    showMilliseconds: false,
    followPlayback: true,
    autoStartTopAfterGap: true,
    leftMargin: 120,
    rightMargin: 120,
    topY: 430,
    rowGap: 330,
    overallScale: 100,
    jpSize: 84,
    originalSpacing: 0,
    readingSize: 70,
    phoneticGap: 35,
    translationSize: 66,
    previewLead: 2.5,
    lineHold: 0,
    fadeIn: 0,
    fadeOut: 0,
    fillMode: "sweep",
    countdown: true,
    countdownGap: 5,
    tapOffset: 0,
    part1Name: "파트 1",
    part1Color: "#9FD8FF",
    part2Name: "파트 2",
    part2Color: "#FFB3D9",
    part3Name: "함께",
    part3Color: "#C9F2A8",
    showTranslation: false,
    centerKorean: false,
    lyricOrder: ["reading", "japanese", "translation"],
  };
  const defaultShortcuts = { start: "KeyM", end: "KeyE", play: "Space", syllable: "KeyK" };
  // 모양(스타일)이 아닌 작업 옵션. 모양 초기화·프리셋에서 제외합니다.
  const workSettingKeys = [
    "precisionEdit",
    "linkTimingNeighbors",
    "showMilliseconds",
    "followPlayback",
    "autoStartTopAfterGap",
    "tapOffset",
  ];
  const runtimeFontNames = new Set(),
    resolvedFonts = new Map(),
    fontMetricCache = new Map();
  let auditionEnd = null;
  // ---- 곡 목록: 곡마다 따로 브라우저에 저장합니다 ----
  const libraryKey = "two-row-karaoke:library",
    currentProjectKey = "two-row-karaoke:current",
    projectKeyPrefix = "two-row-karaoke:project:";
  let currentProjectId = null;
  const newProjectId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function readLibrary() {
    try {
      const list = JSON.parse(localStorage.getItem(libraryKey) || "[]");
      return Array.isArray(list) ? list.filter((item) => item && typeof item.id === "string") : [];
    } catch {
      return [];
    }
  }
  function writeLibrary(list) {
    localStorage.setItem(libraryKey, JSON.stringify(list));
  }
  function loadSavedProject() {
    if (selfTestMode) {
      currentProjectId = "selftest";
      return normalizeProject(initial);
    }
    try {
      let library = readLibrary();
      // 예전 버전(마지막 곡 하나만 저장)의 데이터를 목록으로 옮깁니다. 원래 저장값은 지우지 않습니다.
      const legacy = !library.length && !localStorage.getItem(libraryKey) && localStorage.getItem(projectStorageKey);
      if (legacy) {
        const legacyProject = normalizeProject(JSON.parse(legacy)),
          id = newProjectId();
        localStorage.setItem(projectKeyPrefix + id, JSON.stringify(legacyProject));
        library = [{ id, name: legacyProject.name, updated: Date.now(), lines: legacyProject.cues.length }];
        writeLibrary(library);
        localStorage.setItem(currentProjectKey, id);
      }
      const wanted = localStorage.getItem(currentProjectKey),
        entry = library.find((item) => item.id === wanted) || library[0],
        saved = entry && localStorage.getItem(projectKeyPrefix + entry.id);
      if (saved) {
        currentProjectId = entry.id;
        return normalizeProject(JSON.parse(saved));
      }
    } catch {}
    currentProjectId = newProjectId();
    return normalizeProject(initial);
  }
  function saveProjectState() {
    if (selfTestMode) return true;
    try {
      localStorage.setItem(projectKeyPrefix + currentProjectId, JSON.stringify(project));
      const library = readLibrary().filter((item) => item.id !== currentProjectId);
      library.unshift({ id: currentProjectId, name: project.name, updated: Date.now(), lines: project.cues.length });
      writeLibrary(library);
      localStorage.setItem(currentProjectKey, currentProjectId);
      return true;
    } catch {
      return false;
    }
  }
  let project = normalizeProject(loadSavedProject()),
    selected = 0,
    mediaUrl = null,
    previewTime = 1,
    audio = null,
    changeHistory = [],
    redoHistory = [],
    historyEditingTarget = null,
    showIncompleteWarnings = false,
    incompleteCueIds = new Set(),
    projectSaveTimer = 0,
    cueSearch = "",
    cueFilter = "all",
    repeatCueEnabled = false,
    timingStep = 0.1,
    lastMarkedCueId = null,
    previewUnmarkedCueId = null,
    pendingMarkSelection = false,
    manualSelectionLocked = false,
    mediaFrameRequest = 0,
    mediaFrameMode = "",
    waveform = null,
    waveEdit = null,
    syllableTap = null;
  const settingIds = Object.keys(defaults).filter((id) => typeof defaults[id] === "number");
  const partNumbers = [1, 2, 3];
  const colorSettingIds = [
    "part1Color",
    "part2Color",
    "part3Color",
    "jpPrimary",
    "jpSecondary",
    "koreanColor",
    "koreanSungColor",
    "jpOutlineColor",
    "koreanOutlineColor",
  ];
  // ---- 화면 요소 참조 (구조는 index.html에 있음) ----
  const autoSaveState = $("autoSaveState"),
    historyToggle = $("historyToggle"),
    followNow = $("followPlaybackNow");
  let historyExpanded = false;
  historyToggle.onclick = () => {
    historyExpanded = !historyExpanded;
    $("historyList").classList.toggle("collapsed", !historyExpanded);
    historyToggle.textContent = historyExpanded ? "변경 내역 접기" : "변경 내역 펼치기";
  };
  followNow.onclick = () => {
    resumePlaybackSelection();
    const index = playbackCueIndex(previewTime, true);
    if (index >= 0) {
      selected = index;
      renderCueList(true);
      renderEditor();
    }
  };
  const timingTabs = [
    ["mark", "timingTabMark", "markWorkspace"],
    ["edit", "timingTabEdit", "editWorkspace"],
    ["syllable", "timingTabSyllable", "syllableWorkspace"],
  ];
  let timingTab = "mark";
  function setTimingTab(mode) {
    if (timingTab === "syllable" && mode !== "syllable") stopSyllableTap(false);
    timingTab = mode;
    for (const [name, tabId, panelId] of timingTabs) {
      const on = name === mode;
      $(panelId).hidden = !on;
      $(tabId).setAttribute("aria-selected", String(on));
      $(tabId).tabIndex = on ? 0 : -1;
    }
    renderSyllablePanel();
  }
  for (const [name, tabId] of timingTabs) {
    $(tabId).onclick = () => setTimingTab(name);
    $(tabId).onkeydown = (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const index = timingTabs.findIndex((tab) => tab[0] === name),
        next = timingTabs[(index + (event.key === "ArrowRight" ? 1 : timingTabs.length - 1)) % timingTabs.length];
      setTimingTab(next[0]);
      $(next[1]).focus();
    };
  }
  function status(message, error = false) {
    $("status").textContent = message;
    $("status").className = "notice" + (error ? " error" : "");
  }
  function scheduleProjectSave() {
    clearTimeout(projectSaveTimer);
    autoSaveState.textContent = "자동 저장 중…";
    projectSaveTimer = setTimeout(() => {
      const ok = saveProjectState();
      autoSaveState.textContent = ok ? "자동 저장됨" : "⚠ 자동 저장 실패 · 프로젝트 저장으로 파일에 보관하세요";
      autoSaveState.classList.toggle("error", !ok);
      if (ok) renderLibrary();
      if (!ok) status("브라우저 저장 공간에 자동 저장하지 못했습니다. ‘프로젝트 저장’으로 파일에 보관해 주세요.", true);
    }, 250);
  }
  function cloneHistoryState() {
    return JSON.parse(JSON.stringify({ project, selected, previewTime, projectId: currentProjectId }));
  }
  function applyHistoryState(state) {
    // 다른 곡으로 바뀌기 전 상태로 되돌리면 그 곡으로 돌아갑니다(새로 만든 곡은 목록에 남음).
    if (state.projectId && state.projectId !== currentProjectId) {
      saveProjectState();
      currentProjectId = state.projectId;
    }
    project = normalizeProject(state.project);
    selected = Math.max(0, Math.min(state.selected, project.cues.length - 1));
    previewTime = state.previewTime;
    armHistory(document.activeElement);
    lastMarkedCueId = null;
    previewUnmarkedCueId = null;
    pendingMarkSelection = false;
    manualSelectionLocked = true;
    renderAll();
    scheduleProjectSave();
  }
  function renderHistory() {
    const list = $("historyList");
    if (!list) return;
    list.classList.toggle("collapsed", !historyExpanded);
    list.replaceChildren();
    const current = document.createElement("button");
    current.type = "button";
    current.className = "history-entry current";
    current.disabled = true;
    current.textContent = "● 현재 상태";
    list.append(current);
    for (let i = changeHistory.length - 1; i >= 0; i--) {
      const entry = changeHistory[i],
        button = document.createElement("button");
      button.type = "button";
      button.className = "history-entry";
      button.textContent = `↶ ${entry.label}`;
      const detail = document.createElement("small");
      detail.textContent = `${i + 1}번째 이전 상태`;
      button.append(detail);
      button.onclick = () => restoreHistoryAt(i);
      list.append(button);
    }
    for (let i = redoHistory.length - 1; i >= 0; i--) {
      const entry = redoHistory[i],
        item = document.createElement("button");
      item.type = "button";
      item.className = "history-entry muted";
      item.textContent = `↷ ${entry.label}`;
      const detail = document.createElement("small");
      detail.textContent = "앞으로 갈 수 있는 상태";
      item.append(detail);
      item.onclick = redoProject;
      list.append(item);
    }
    $("undoProject").disabled = !changeHistory.length;
    $("redoProject").disabled = !redoHistory.length;
    $("clearHistory").disabled = !(changeHistory.length || redoHistory.length);
  }
  function recordChange(label) {
    changeHistory.push({ label, state: cloneHistoryState() });
    if (changeHistory.length > 60) changeHistory.shift();
    redoHistory = [];
    renderHistory();
  }
  function undoProject() {
    const entry = changeHistory.pop();
    if (!entry) return;
    redoHistory.push({ label: entry.label, state: cloneHistoryState() });
    applyHistoryState(entry.state);
    status(`“${entry.label}” 이전 상태로 되돌렸습니다.`);
  }
  function redoProject() {
    const entry = redoHistory.pop();
    if (!entry) return;
    changeHistory.push({ label: entry.label, state: cloneHistoryState() });
    applyHistoryState(entry.state);
    status(`“${entry.label}” 상태로 앞으로 갔습니다.`);
  }
  function restoreHistoryAt(index) {
    const target = changeHistory[index];
    if (!target) return;
    while (changeHistory.length > index) undoProject();
    status(`“${target.label}” 이전 상태로 되돌렸습니다.`);
  }
  function seconds(text) {
    const m = String(text)
      .trim()
      .match(/^(\d+):(\d{2}):(\d{2})[.,](\d{2,3})$/);
    if (!m) return NaN;
    return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 10 ** m[4].length;
  }
  /** 시간 입력칸: 0:01:23.45 / 1:23.45 / 83.45 모두 허용 */
  function parseTimeInput(text) {
    const value = String(text).trim().replace(",", ".");
    if (!value) return NaN;
    const parts = value.split(":");
    if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return NaN;
    return parts.reduce((total, part) => total * 60 + Number(part), 0);
  }
  function stamp(value) {
    let cs = Math.max(0, Math.round(value * 100));
    const h = Math.floor(cs / 360000);
    cs %= 360000;
    const m = Math.floor(cs / 6000);
    cs %= 6000;
    const s = Math.floor(cs / 100);
    const c = cs % 100;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
  }
  function shortTime(value, withDecimals = false) {
    const cs = Math.max(0, Math.round(value * 100)),
      s = Math.floor(cs / 100),
      base = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    return withDecimals ? `${base}.${String(cs % 100).padStart(2, "0")}` : base;
  }
  function lyricOrder(settings) {
    const allowed = ["reading", "japanese", "translation"],
      requested = Array.isArray(settings?.lyricOrder) ? settings.lyricOrder : [];
    return [
      ...requested.filter((key, index) => allowed.includes(key) && requested.indexOf(key) === index),
      ...allowed.filter((key) => !requested.includes(key)),
    ];
  }
  function normalizeProject(data) {
    if (!data || !Array.isArray(data.cues)) throw Error("프로젝트에 자막 줄이 없습니다.");
    const cues = data.cues.map((cue, i) => {
      const japanese = String(cue.japanese || "");
      let segments = Array.isArray(cue.karaokeSegments)
        ? cue.karaokeSegments
            .map((segment) => ({
              text: String(segment?.text || ""),
              duration: Math.max(0, Math.round(+segment?.duration || 0)),
            }))
            .filter((segment) => segment.text)
        : [];
      // 예전 버전: ASS에서 가져온 노래방 태그 문자열(cue.karaoke)을 음절 데이터로 변환
      if (!segments.length && typeof cue.karaoke === "string" && cue.karaoke.trim())
        segments = segmentsFromAssKaraoke(cue.karaoke);
      if (segments.length && segments.map((x) => x.text).join("") !== furiganaBase(japanese)) segments = [];
      return {
        id: Number.isFinite(+cue.id) ? +cue.id : i + 1,
        start: +cue.start,
        end: +cue.end,
        marked: cue.marked === true || (cue.marked !== false && +cue.end > +cue.start),
        startTop: cue.startTop === true,
        manualEnd: cue.manualEnd === true,
        part: [1, 2, 3].includes(+cue.part) ? +cue.part : 0,
        importedPreviewStart:
          cue.importedPreviewStart !== null &&
          cue.importedPreviewStart !== undefined &&
          Number.isFinite(+cue.importedPreviewStart)
            ? +cue.importedPreviewStart
            : null,
        japanese,
        reading: String(cue.reading || ""),
        translation: String(cue.translation || ""),
        karaokeSegments: segments,
        enabled: cue.enabled !== false,
      };
    });
    if (
      cues.some(
        (c) =>
          !Number.isFinite(c.start) ||
          !Number.isFinite(c.end) ||
          c.start < 0 ||
          c.end < 0 ||
          (c.end > 0 && c.end <= c.start),
      )
    )
      throw Error("시작·끝 시간이 잘못된 줄이 있습니다.");
    const settings = { ...defaults, ...(data.settings || {}) };
    settings.lyricOrder = lyricOrder(settings);
    return {
      name: String(data.name || "노래방 자막"),
      cues,
      settings,
      shortcuts: { ...defaultShortcuts, ...(data.shortcuts || {}) },
    };
  }
  function parseSrt(content) {
    const blocks = content
        .replace(/^\uFEFF/, "")
        .trim()
        .split(/\r?\n\s*\r?\n/),
      cues = [];
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      const index = lines.findIndex((line) => line.includes("-->"));
      if (index < 0) continue;
      const m = lines[index].match(/^\s*(\d+:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d+:\d{2}:\d{2}[,.]\d{3})/);
      if (!m) throw Error("읽을 수 없는 시간표: " + lines[index]);
      const id = /^\d+$/.test(lines[0]) ? +lines[0] : cues.length + 1;
      cues.push({
        id,
        start: seconds(m[1]),
        end: seconds(m[2]),
        marked: true,
        japanese: "",
        reading: "",
        translation: lines.slice(index + 1).join("\n"),
        enabled: true,
      });
    }
    if (!cues.length) throw Error("SRT에서 자막 줄을 찾지 못했습니다.");
    return cues;
  }
  function assPlainText(text) {
    return text
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\N/gi, "\n")
      .replace(/\\h/g, " ")
      .trim();
  }
  function assKaraokeText(text) {
    return text.replace(/\{([^}]*)\}/g, (_, tags) => {
      const karaoke = tags.match(/\\k(?:f|o)?\d+/gi);
      return karaoke ? `{${karaoke.join("")}}` : "";
    });
  }
  // 이 사이트가 내보낸 ASS에는 원본(후리가나 표기·음절)을 Comment 줄로 함께 저장합니다.
  const sourceCommentStyle = "KaraokeSource";
  function parseAss(content) {
    const lines = content.replace(/^﻿/, "").split(/\r?\n/),
      events = [],
      sources = [];
    let title = "";
    for (const raw of lines) {
      const titleMatch = raw.match(/^Title\s*:\s*(.+)$/i);
      if (titleMatch) title = titleMatch[1].trim();
      const m = raw.match(/^(Dialogue|Comment):\s*[^,]*,([^,]+),([^,]+),([^,]+),[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(.*)$/i);
      if (!m) continue;
      const start = seconds(m[2]),
        end = seconds(m[3]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const text = m[5],
        style = m[4].trim();
      if (/^comment$/i.test(m[1])) {
        if (style === sourceCommentStyle)
          try {
            sources.push({ start, end, data: JSON.parse(decodeURIComponent(text)) });
          } catch {}
        continue;
      }
      const position = (text.match(/\\an([789])/) || [])[1] || "",
        pos = text.match(/\\pos\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
      events.push({ start, end, style, text, plain: assPlainText(text), position, y: pos ? +pos[2] : NaN });
    }
    const nonLyricStyle =
      /^(preview|englishpreview|furigana|furiganapreview|pronunciation|reading|hangul|translation)$/i;
    const japanese = events.filter(
      (e) => /^(japanese|kara|english)$/i.test(e.style) || (/\\kf?\d+/i.test(e.text) && !nonLyricStyle.test(e.style)),
    );
    if (!japanese.length) throw Error("ASS에서 Japanese 또는 Kara Dialogue 줄을 찾지 못했습니다.");
    const reading = events.filter((e) => /^(pronunciation|reading|hangul)$/i.test(e.style)),
      translation = events.filter((e) => /^translation$/i.test(e.style)),
      previews = events.filter((e) => /^(preview|englishpreview)$/i.test(e.style)),
      usedReading = new Set(),
      usedTranslation = new Set();
    const cues = japanese.map((event, index) => {
      // 같은 끝 시간의 발음·뜻 줄을 찾습니다. 같은 정렬 위치를 먼저, 가운데 정렬이면 가장 가까운 높이를 고릅니다.
      const findMatch = (list, used) => {
        const candidates = list.filter((item) => !used.has(item) && Math.abs(item.end - event.end) < 0.011);
        const match =
          candidates.find((item) => item.position === event.position) ||
          candidates
            .filter((item) => item.position === "8" || !item.position)
            .sort((a, b) => Math.abs(a.y - event.y) - Math.abs(b.y - event.y) || 0)[0];
        if (match) used.add(match);
        return match;
      };
      const r = findMatch(reading, usedReading),
        tr = findMatch(translation, usedTranslation),
        preview = previews
          .filter(
            (item) =>
              item.position === event.position &&
              item.plain === event.plain &&
              Math.abs(item.end - event.start) < 0.011,
          )
          .at(-1),
        previous = japanese[index - 1],
        source = sources.find(
          (item) => Math.abs(item.start - event.start) < 0.011 && Math.abs(item.end - event.end) < 0.011,
        )?.data;
      let japaneseText = event.plain,
        segments = segmentsFromAssKaraoke(assKaraokeText(event.text));
      if (typeof source?.japanese === "string" && furiganaBase(source.japanese) === event.plain) {
        japaneseText = source.japanese;
        if (Array.isArray(source.segments)) segments = source.segments;
      }
      // 줄 전체에 \kf 하나만 있는 경우는 음절 데이터가 아님
      if (segments.length < 2) segments = [];
      return {
        id: index + 1,
        start: event.start,
        end: Number.isFinite(source?.end) && source.end > event.start ? source.end : event.end,
        marked: true,
        startTop:
          typeof source?.startTop === "boolean"
            ? source.startTop
            : index > 0 && event.position === "7" && previous?.position === "7",
        manualEnd: source?.manualEnd === true,
        part: [1, 2, 3].includes(+source?.part) ? +source.part : 0,
        importedPreviewStart: preview?.start ?? null,
        japanese: japaneseText,
        reading: r?.plain || "",
        translation: tr?.plain || "",
        karaokeSegments: segments,
        enabled: true,
      };
    });
    return { name: title || "ASS 자막", cues };
  }
  function cleanWikiCell(value) {
    return value
      .replace(/\[\s*\\?\[\d+\\?\]\s*\]\(https?:\/\/[^)]+\)/g, "")
      .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
      .replace(/\\([~\[\]_*])/g, "$1")
      .replace(/&nbsp;/gi, " ")
      .replace(/\u00a0/g, " ")
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .trim();
  }
  function parseWikiTable(content, groupSize = 3) {
    const triples = [];
    let buffer = [],
      gapBefore = 0;
    for (const raw of content.replace(/\r/g, "").split("\n")) {
      const trimmed = raw.trim();
      if (!trimmed) {
        if (!buffer.length && triples.length) gapBefore++;
        continue;
      }
      const cell = cleanWikiCell(trimmed.startsWith("|") && trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed);
      if (/^:?-{3,}:?$/.test(cell)) continue;
      if (!cell) {
        if (!buffer.length && triples.length) gapBefore++;
        continue;
      }
      if (cell.includes("\t")) {
        const columns = cell.split("\t").map(cleanWikiCell).filter(Boolean);
        if (columns.length === groupSize && buffer.length === 0) {
          triples.push({ japanese: columns[0], reading: columns[1], translation: columns[2] || "", gapBefore });
          gapBefore = 0;
          continue;
        }
      }
      if (groupSize === 2 && buffer.length === 1) {
        const hasHangul = /[가-힣]/.test(cell);
        if (hasHangul) {
          triples.push({ japanese: buffer[0], reading: cell, translation: "", gapBefore });
          buffer = [];
          gapBefore = 0;
        } else {
          triples.push({ japanese: buffer[0], reading: "", translation: "", gapBefore });
          buffer = [cell];
          gapBefore = 0;
        }
        continue;
      }
      buffer.push(cell);
      if (buffer.length === groupSize) {
        triples.push({ japanese: buffer[0], reading: buffer[1], translation: buffer[2] || "", gapBefore });
        buffer = [];
        gapBefore = 0;
      }
    }
    if (buffer.length)
      triples.push({ japanese: buffer[0] || "", reading: buffer[1] || "", translation: buffer[2] || "", gapBefore });
    if (!triples.length) throw Error("가사 3행 묶음을 찾지 못했습니다.");
    return triples;
  }
  function activeScenes() {
    const scenes = project.cues
      .filter((c) => c.enabled && c.japanese.trim() && c.marked && c.end > c.start)
      .map((c) => ({ ...c }))
      .sort((a, b) => a.start - b.start || a.id - b.id);
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i],
        previous = scenes[i - 1],
        hasInterlude = !!(i && scene.start - previous.end > 0.5),
        automaticPreview =
          i && !scene.startTop && !hasInterlude
            ? Math.max(previous.start, scene.start - (+project.settings.previewLead || 0))
            : scene.start,
        importedPreview =
          !hasInterlude &&
          Number.isFinite(scene.importedPreviewStart) &&
          scene.importedPreviewStart < scene.start &&
          scene.start - scene.importedPreviewStart <= Math.max(0.5, +project.settings.previewLead || 0)
            ? scene.importedPreviewStart
            : null;
      scene.row =
        i === 0 || scene.startTop || (project.settings.autoStartTopAfterGap !== false && hasInterlude)
          ? 0
          : 1 - previous.row;
      scene.previewStart = importedPreview ?? automaticPreview;
      scene.displayEnd = scene.end + (scene.manualEnd ? 0 : +project.settings.lineHold || 0);
      // 긴 간주 뒤에는 ●●● 카운트다운과 함께 줄을 미리 보여 줍니다.
      const gapBefore = i ? scene.start - previous.end : scene.start;
      scene.countdown =
        project.settings.countdown !== false && gapBefore >= Math.max(1, +project.settings.countdownGap || 5)
          ? Math.min(3, gapBefore - 0.5)
          : 0;
      if (scene.countdown) scene.previewStart = Math.min(scene.previewStart, scene.start - scene.countdown);
    }
    for (let i = 0; i < scenes.length; i++) {
      const nextSameRow = scenes.slice(i + 1).find((next) => next.row === scenes[i].row);
      if (nextSameRow) scenes[i].displayEnd = Math.min(scenes[i].displayEnd, nextSameRow.start);
      const previousSameRow = scenes
        .slice(0, i)
        .reverse()
        .find((previous) => previous.row === scenes[i].row);
      if (previousSameRow) scenes[i].previewStart = Math.max(scenes[i].previewStart, previousSameRow.displayEnd);
    }
    return scenes;
  }
  function rowForIndex(indexes, pos) {
    let row = 0;
    for (let i = 1; i <= pos; i++) {
      const previous = project.cues[indexes[i - 1]],
        current = project.cues[indexes[i]],
        hasInterlude = current.marked && previous.marked && current.start - previous.end > 0.5;
      row = current.startTop || (project.settings.autoStartTopAfterGap !== false && hasInterlude) ? 0 : 1 - row;
    }
    return row;
  }
  function incompleteCues() {
    return project.cues.filter((c) => c.enabled && c.japanese.trim() && (!c.marked || c.end <= c.start));
  }
  function refreshIncompleteWarnings() {
    if (showIncompleteWarnings) incompleteCueIds = new Set(incompleteCues().map((c) => c.id));
  }
  function fontSizes(s) {
    const ratio = (+s.overallScale || 100) / 100;
    return {
      jp: Math.round(+s.jpSize * ratio * 100) / 100,
      read: Math.round(+s.readingSize * ratio * 100) / 100,
      tr: Math.round(+s.translationSize * ratio * 100) / 100,
    };
  }
  function usesEnglishFont(text) {
    const latin = (String(text).match(/[A-Za-z]/g) || []).length,
      cjk = (String(text).match(/[ぁ-んァ-ン一-龯]/g) || []).length;
    return latin > 0 && latin >= cjk;
  }
  function layerSource(scene, key, s, f, maxW) {
    const japanese = furiganaBase(scene.japanese),
      english = usesEnglishFont(japanese),
      source = {
        reading: { type: "read", style: "Pronunciation", text: scene.reading, font: f.read, fontFamily: s.koreanFont },
        japanese: {
          type: "jp",
          style: english ? "English" : "Japanese",
          text: japanese,
          rawText: scene.japanese,
          font: f.jp,
          fontFamily: english ? s.englishFont : s.japaneseFont,
        },
        translation: {
          type: "tr",
          style: "Translation",
          text: scene.translation,
          font: f.tr,
          fontFamily: s.koreanFont,
        },
      }[key];
    if (!source || !source.text.trim() || (key === "translation" && !s.showTranslation)) return null;
    return {
      ...source,
      key,
      scale: fitScale(source.text, source.font, maxW, key === "japanese" ? +s.originalSpacing || 0 : 0),
    };
  }
  function stackLayout(scene, s, f, top, maxW) {
    const layers = lyricOrder(s)
      .map((key) => layerSource(scene, key, s, f, maxW))
      .filter(Boolean);
    let y = top;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i],
        next = layers[i + 1];
      layer.y = y;
      y += layer.font;
      if (next)
        y +=
          (layer.key === "reading" && next.key === "japanese") || (layer.key === "japanese" && next.key === "reading")
            ? +s.phoneticGap
            : 30;
    }
    return layers;
  }
  function lowerEdge(s) {
    const f = fontSizes(s),
      sample = { japanese: "가", reading: "가", translation: "가" },
      layers = stackLayout(sample, s, f, 0, 9999);
    return +s.topY + +s.rowGap + (layers.length ? layers.at(-1).y + layers.at(-1).font : 0);
  }
  function fitScale(text, font, maxWidth, spacing = 0) {
    const characters = [...text.replace(/\\N/g, " ")].length;
    const naturalWidth = characters * font + Math.max(0, characters - 1) * spacing;
    return Math.min(100, Math.max(42, Math.floor((maxWidth / Math.max(1, naturalWidth)) * 100)));
  }
  function matchesCueFilter(cue) {
    const text = `${cue.japanese}\n${furiganaBase(cue.japanese)}\n${cue.reading}\n${cue.translation}`.toLowerCase(),
      search = cueSearch.trim().toLowerCase();
    if (search && !text.includes(search)) return false;
    if (cueFilter === "incomplete") return cue.enabled && cue.japanese.trim() && (!cue.marked || cue.end <= cue.start);
    if (cueFilter === "unmarked") return cue.enabled && cue.japanese.trim() && !cue.marked;
    if (cueFilter === "missingReading") return cue.enabled && cue.japanese.trim() && !cue.reading.trim();
    if (cueFilter === "missingSyllables") return cue.enabled && cue.japanese.trim() && !validSegments(cue);
    return true;
  }
  function renderCueList(reveal = false) {
    refreshIncompleteWarnings();
    const list = $("cueList"),
      oldScroll = list.scrollTop;
    list.replaceChildren();
    if (!project.cues.length) {
      const p = document.createElement("p");
      p.className = "note";
      p.style.padding = "15px";
      p.textContent = "아직 가사가 없습니다. 표를 가져오거나 가사 한 줄을 추가하세요.";
      list.append(p);
    }
    project.cues.forEach((c, i) => {
      if (!matchesCueFilter(c)) return;
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.index = String(i);
      b.className =
        "cue" +
        (i === selected ? " selected" : "") +
        (c.enabled ? "" : " disabled") +
        (incompleteCueIds.has(c.id) ? " incomplete" : "");
      const n = document.createElement("strong");
      n.textContent = String(c.id);
      const t = document.createElement("small");
      t.textContent = incompleteCueIds.has(c.id)
        ? c.marked
          ? "끝 시간 없음"
          : "시작·끝 없음"
        : c.marked
          ? stamp(c.start)
          : "미마킹";
      const text = document.createElement("span");
      text.className = "snippet";
      text.textContent = furiganaBase(c.japanese) || c.translation || "(빈 줄)";
      const flags = document.createElement("span");
      flags.className = "flags";
      if (partColor(c)) {
        const dot = document.createElement("span");
        dot.className = "part-dot";
        dot.style.background = partColor(c);
        dot.title = project.settings[`part${c.part}Name`];
        flags.append(dot);
      }
      if (validSegments(c)) {
        flags.append("♪");
        flags.title = "음절 타이밍 있음";
      }
      b.append(n, t, text, flags);
      b.onclick = () => {
        pendingMarkSelection = false;
        manualSelectionLocked = true;
        if (project.settings.precisionEdit !== false) stopPrecisionPlayback();
        selected = i;
        renderCueList(true);
        renderEditor();
        if (c.marked) {
          previewTime = c.start;
          if (audio && Number.isFinite(audio.duration)) audio.currentTime = c.start;
        }
        syncSeek();
        renderPreview();
        revealSelectedOnWave();
      };
      list.append(b);
    });
    if (project.cues.length && !list.children.length) {
      const p = document.createElement("p");
      p.className = "note";
      p.style.padding = "15px";
      p.textContent = "조건에 맞는 가사 줄이 없습니다.";
      list.append(p);
    }
    list.scrollTop = oldScroll;
    const selectedItem = list.querySelector(`[data-index="${selected}"]`);
    if (reveal && selectedItem) {
      const box = list.getBoundingClientRect(),
        item = selectedItem.getBoundingClientRect();
      if (item.top < box.top) list.scrollTop += item.top - box.top - 8;
      else if (item.bottom > box.bottom) list.scrollTop += item.bottom - box.bottom + 8;
    }
    scheduleProjectSave();
  }
  /** 목록을 다시 만들지 않고 선택 표시만 옮깁니다 (재생 중 자동 선택용). */
  function updateCueListSelection(reveal = false) {
    const list = $("cueList");
    for (const item of list.querySelectorAll(".cue.selected")) item.classList.remove("selected");
    const item = list.querySelector(`[data-index="${selected}"]`);
    if (!item) return renderCueList(reveal);
    item.classList.add("selected");
    if (reveal) {
      const box = list.getBoundingClientRect(),
        rect = item.getBoundingClientRect();
      if (rect.top < box.top) list.scrollTop += rect.top - box.top - 8;
      else if (rect.bottom > box.bottom) list.scrollTop += rect.bottom - box.bottom + 8;
    }
  }
  function renderEditor() {
    const c = project.cues[selected];
    for (const id of [
      "cueStart",
      "cueEnd",
      "cueJapanese",
      "cueReading",
      "cueTranslation",
      "cueEnabled",
      "cueStartTop",
      "cuePart",
      "partFillDown",
    ])
      $(id).disabled = !c;
    renderPartOptions();
    if (!c) {
      for (const id of ["cueStart", "cueEnd", "cueJapanese", "cueReading", "cueTranslation"]) $(id).value = "";
      $("cueEnabled").checked = $("cueStartTop").checked = false;
      renderTimingPanel();
      return;
    }
    $("cuePart").value = String(c.part || 0);
    $("cueStart").value = stamp(c.start);
    $("cueEnd").value = stamp(c.end);
    $("cueJapanese").value = c.japanese;
    $("cueReading").value = c.reading;
    $("cueTranslation").value = c.translation;
    $("cueEnabled").checked = c.enabled;
    $("cueStartTop").checked = !!c.startTop;
    renderTimingPanel();
  }
  function renderFontPreview() {
    const s = project.settings,
      jp = $("fontPreviewJapanese"),
      en = $("fontPreviewEnglish"),
      ko = $("fontPreviewKorean"),
      stroke = Math.max(0.5, (+s.outlineWidth || 0) * 0.28) + "px";
    jp.style.fontFamily = previewFont(s.japaneseFont);
    jp.style.color = s.jpPrimary;
    jp.style.webkitTextStroke = `${stroke} ${s.jpOutlineColor}`;
    en.style.fontFamily = previewFont(s.englishFont);
    en.style.color = s.jpPrimary;
    en.style.webkitTextStroke = `${stroke} ${s.jpOutlineColor}`;
    ko.style.fontFamily = previewFont(s.koreanFont);
    ko.style.color = s.koreanColor;
    ko.style.webkitTextStroke = `${stroke} ${s.koreanOutlineColor}`;
  }
  function loadStylePresets() {
    try {
      const saved = JSON.parse(localStorage.getItem(stylePresetStorageKey) || "[]");
      return Array.isArray(saved) ? saved.filter((item) => item && typeof item.name === "string" && item.settings) : [];
    } catch {
      return [];
    }
  }
  function saveStylePresets(presets) {
    try {
      localStorage.setItem(stylePresetStorageKey, JSON.stringify(presets));
    } catch {}
  }
  function renderStylePresets() {
    const select = $("stylePreset"),
      current = select.value,
      presets = loadStylePresets();
    select.replaceChildren();
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = presets.length ? "프리셋 선택" : "저장된 프리셋 없음";
    select.append(blank);
    for (const preset of presets) {
      const option = document.createElement("option");
      option.value = preset.name;
      option.textContent = preset.name;
      select.append(option);
    }
    if (presets.some((preset) => preset.name === current)) select.value = current;
    $("applyStylePreset").disabled = !select.value;
    $("deleteStylePreset").disabled = !select.value;
  }
  /** 프리셋에 저장할 모양 값(작업 옵션 제외) */
  function captureStyle() {
    const style = JSON.parse(JSON.stringify(project.settings));
    for (const key of workSettingKeys) delete style[key];
    return style;
  }
  function workSettings() {
    return Object.fromEntries(workSettingKeys.map((key) => [key, project.settings[key]]));
  }
  function changeLyricOrder(next) {
    const order = lyricOrder({ lyricOrder: next });
    if (order.join("|") === lyricOrder(project.settings).join("|")) return;
    recordChange("자막 쌓는 순서 변경");
    project.settings.lyricOrder = order;
    renderLyricStack(true);
    renderPreview();
    scheduleProjectSave();
  }
  function renderLyricStack(animate = false) {
    const list = $("lyricStack"),
      before = new Map([...list.children].map((item) => [item.dataset.key, item.getBoundingClientRect()])),
      labels = {
        reading: ["한글 발음", "쿠룻테 시맛탄다", "read"],
        japanese: ["일본어 가사", "狂ってしまったんだ", "jp"],
        translation: ["한글 뜻", "미쳐버린 거야", "tr"],
      },
      order = lyricOrder(project.settings);
    list.replaceChildren();
    for (const [index, key] of order.entries()) {
      const [label, sample, className] = labels[key],
        patty = document.createElement("div");
      patty.className = `lyric-patty ${className}`;
      patty.draggable = true;
      patty.dataset.key = key;
      patty.innerHTML = `<span class="grip" aria-hidden="true">≡</span><span><strong>${label}</strong><small>${sample}</small></span>`;
      const up = document.createElement("button"),
        down = document.createElement("button");
      up.type = down.type = "button";
      up.textContent = "↑";
      down.textContent = "↓";
      up.disabled = index === 0;
      down.disabled = index === order.length - 1;
      up.onclick = () => {
        const next = [...order];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        changeLyricOrder(next);
      };
      down.onclick = () => {
        const next = [...order];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        changeLyricOrder(next);
      };
      patty.append(up, down);
      patty.ondragstart = (event) => {
        event.dataTransfer.setData("text/plain", key);
        event.dataTransfer.effectAllowed = "move";
        patty.classList.add("dragging");
      };
      patty.ondragend = () => patty.classList.remove("dragging");
      patty.ondragover = (event) => event.preventDefault();
      patty.ondrop = (event) => {
        event.preventDefault();
        const from = event.dataTransfer.getData("text/plain"),
          fromIndex = order.indexOf(from);
        if (fromIndex < 0 || from === key) return;
        const next = order.filter((value) => value !== from);
        next.splice(next.indexOf(key), 0, from);
        changeLyricOrder(next);
      };
      list.append(patty);
      if (animate && before.has(key)) {
        const delta = before.get(key).top - patty.getBoundingClientRect().top;
        if (delta)
          patty.animate([{ transform: `translateY(${delta}px) scale(.98)` }, { transform: "translateY(0) scale(1)" }], {
            duration: 260,
            easing: "cubic-bezier(.2,.8,.2,1)",
          });
      }
    }
  }
  function renderSettings() {
    for (const id of settingIds) {
      $(id).value = project.settings[id];
      $(id + "Slider").value = project.settings[id];
    }
    for (const id of colorSettingIds) $(id).value = project.settings[id];
    $("japaneseFont").value = project.settings.japaneseFont;
    $("englishFont").value = project.settings.englishFont;
    $("koreanFont").value = project.settings.koreanFont;
    $("showMilliseconds").checked = !!project.settings.showMilliseconds;
    $("followPlayback").checked = project.settings.followPlayback !== false;
    $("autoStartTopAfterGap").checked = project.settings.autoStartTopAfterGap !== false;
    $("showTranslation").checked = !!project.settings.showTranslation;
    $("centerKorean").checked = !!project.settings.centerKorean;
    $("fillReading").checked = project.settings.fillReading !== false;
    $("countdown").checked = project.settings.countdown !== false;
    $("fillMode").value = project.settings.fillMode === "instant" ? "instant" : "sweep";
    $("originalBold").checked = !!project.settings.originalBold;
    $("koreanBold").checked = !!project.settings.koreanBold;
    $("precisionEdit").checked = project.settings.precisionEdit !== false;
    $("linkTimingNeighbors").checked = !!project.settings.linkTimingNeighbors;
    renderFontPreview();
    renderLyricStack();
    renderStylePresets();
    ensurePreviewFonts();
  }
  function duration() {
    return Math.max(10, Number.isFinite(audio?.duration) ? audio.duration : 0, ...project.cues.map((c) => c.end));
  }
  function playbackCueIndex(time, includeGap = false) {
    let active = -1,
      previous = -1,
      first = -1;
    for (let i = 0; i < project.cues.length; i++) {
      const cue = project.cues[i];
      if (!cue.enabled || !cue.marked || !cue.japanese.trim()) continue;
      if (first < 0 || cue.start < project.cues[first].start) first = i;
      if (cue.start <= time) {
        if (previous < 0 || cue.start >= project.cues[previous].start) previous = i;
        if ((cue.end === 0 || time < cue.end) && (active < 0 || cue.start >= project.cues[active].start)) active = i;
      }
    }
    return active >= 0 ? active : includeGap ? (previous >= 0 ? previous : first) : -1;
  }
  function syncPlayingCue() {
    const activeIndex = playbackCueIndex(previewTime),
      followIndex = playbackCueIndex(previewTime, true);
    if (pendingMarkSelection && project.cues[selected]?.marked && previewTime >= project.cues[selected].start)
      pendingMarkSelection = false;
    const editing = ["cueStart", "cueEnd", "cueJapanese", "cueReading", "cueTranslation"].includes(
      document.activeElement?.id,
    );
    if (
      project.settings.followPlayback !== false &&
      !pendingMarkSelection &&
      !manualSelectionLocked &&
      !editing &&
      !repeatCueEnabled &&
      !syllableTap &&
      followIndex >= 0 &&
      followIndex !== selected
    ) {
      selected = followIndex;
      updateCueListSelection(true);
      renderEditor();
    }
    for (const item of $("cueList").querySelectorAll("[data-index]"))
      item.classList.toggle("playing", Number(item.dataset.index) === activeIndex);
  }
  function resumePlaybackSelection() {
    pendingMarkSelection = false;
    manualSelectionLocked = false;
    syncPlayingCue();
  }

  function renderPrecisionInfo() {
    const cue = project.cues[selected];
    if ($("precisionCueInfo"))
      $("precisionCueInfo").textContent = cue ? `${stamp(cue.start)} → ${stamp(cue.end)}` : "가사를 선택하세요";
  }
  function syncSeek() {
    const d = duration(),
      decimals = !!project.settings.showMilliseconds || project.settings.precisionEdit !== false;
    $("seek").max = String(d);
    $("seek").value = String(Math.min(previewTime, d));
    $("timeLabel").textContent = `${shortTime(previewTime, decimals)} / ${shortTime(d, decimals)}`;
    syncPlayingCue();
  }
  function fontWeight(family) {
    return (family === project.settings.koreanFont ? project.settings.koreanBold : project.settings.originalBold)
      ? 700
      : 400;
  }
  function previewFont(family) {
    return resolvedFonts.get(family)?.alias || family;
  }
  async function resolvePreviewFont(name) {
    if (resolvedFonts.has(name)) return resolvedFonts.get(name).promise;
    const entry = { alias: null, status: "확인 중", promise: null };
    resolvedFonts.set(name, entry);
    entry.promise = (async () => {
      try {
        const alias = "KaraokeLocal" + resolvedFonts.size,
          face = new FontFace(alias, `local(${JSON.stringify(name)})`, { weight: "400" });
        await face.load();
        document.fonts.add(face);
        entry.alias = alias;
        entry.status = "연결됨";
        runtimeFontNames.add(name);
      } catch {
        entry.status = "정확한 폰트 연결 실패 · PC 폰트 새로 읽기를 눌러 주세요";
      } finally {
        textMeasureCache.clear();
        fontMetricCache.clear();
      }
    })();
    return entry.promise;
  }
  async function ensurePreviewFonts() {
    const names = [
      ...new Set([project.settings.japaneseFont, project.settings.englishFont, project.settings.koreanFont]),
    ];
    await Promise.all(names.map(resolvePreviewFont));
    $("fontDiagnostic").textContent = names
      .map((name) => `${name}: ${resolvedFonts.get(name)?.status || "확인 중"}`)
      .join(" / ");
    renderFontPreview();
    renderPreview();
  }
  function fontMetrics(family) {
    const key = family + "|" + fontWeight(family);
    if (fontMetricCache.has(key)) return fontMetricCache.get(key);
    textMeasureContext.font = `${fontWeight(family)} 1000px ${JSON.stringify(previewFont(family))}`;
    const m = textMeasureContext.measureText("Hg国한"),
      ascent = m.fontBoundingBoxAscent || 1000,
      descent = m.fontBoundingBoxDescent || 250;
    const metrics = { ratio: 1000 / (ascent + descent), ascent: ascent / (ascent + descent) };
    fontMetricCache.set(key, metrics);
    return metrics;
  }
  const textMeasureCanvas = document.createElement("canvas"),
    textMeasureContext = textMeasureCanvas.getContext("2d");
  const textMeasureCache = new Map();
  function textWidth(text, font, family, spacing = 0) {
    const weight = fontWeight(family),
      key = JSON.stringify([text, font, family, spacing, weight, previewFont(family)]);
    if (textMeasureCache.has(key)) return textMeasureCache.get(key);
    textMeasureContext.font = `${weight} ${font * fontMetrics(family).ratio}px ${JSON.stringify(previewFont(family))}`;
    const width = textMeasureContext.measureText(text).width + Math.max(0, [...text].length - 1) * spacing;
    if (textMeasureCache.size >= 512) textMeasureCache.clear();
    textMeasureCache.set(key, width);
    return width;
  }
  function furiganaLayout(text, x, y, anchor, font, scale, family, spacing = 0) {
    const parts = furiganaParts(text),
      plain = parts.map((part) => part.text).join(""),
      factor = scale / 100,
      naturalTotal = Math.max(1, textWidth(plain, font, family, spacing));
    const total = naturalTotal * factor;
    const left = x - (anchor === 9 ? total : anchor === 8 ? total / 2 : 0),
      size = Math.max(1, Math.round((font * (+project.settings.rubySizePercent || 42)) / 100)),
      gap = +project.settings.rubyGap || 0;
    let prefix = "";
    const readings = [];
    for (const part of parts) {
      const offset = textWidth(prefix, font, family, spacing) + (prefix ? spacing : 0),
        baseWidth = textWidth(part.text, font, family, spacing);
      if (part.reading) {
        const readingWidth = textWidth(part.reading, size, family, 0);
        readings.push({
          text: part.reading,
          x: left + (offset + baseWidth / 2) * factor,
          y: y - size - gap,
          font: size,
          scale: Math.min(scale, ((baseWidth * factor) / Math.max(1, readingWidth)) * 100),
          baseFrom: part.start,
          baseTo: part.start + [...part.text].length,
          fracFrom: Math.min(1, offset / naturalTotal),
          fracTo: Math.min(1, (offset + baseWidth) / naturalTotal),
        });
      }
      prefix += part.text;
    }
    return { plain, readings };
  }
  /** 줄의 노래방 진행 정보: 음절이 있으면 음절 시간, 없으면 줄 전체를 일정한 속도로 */
  function karaokeTiming(scene) {
    const segments = validSegments(scene);
    return {
      start: scene.start,
      end: scene.end,
      windows: segments && scene.end > scene.start ? segmentWindows(segments, scene.start, scene.end) : null,
    };
  }
  /**
   * 한글 발음 줄의 노래방 진행 정보. 발음 글자마다 원문 위치를 찾아(자동 발음과 정렬)
   * 그 원문이 불리는 시각에 칠해지게 합니다. filledWidth와 같은 형태로 돌려줍니다.
   */
  function readingTiming(scene) {
    if (!project.settings.fillReading || !scene.reading?.trim() || !(scene.end > scene.start)) return null;
    const timing = karaokeTiming(scene),
      baseLength = Math.max(1, [...furiganaBase(scene.japanese)].length),
      auto = kanaToHangul(scene.japanese),
      positions = alignReading(auto.error ? null : auto, scene.reading, baseLength),
      chars = [...scene.reading],
      pieces = [];
    let k = 0;
    chars.forEach((ch, index) => {
      if (!ch.trim()) {
        if (pieces.length) pieces[pieces.length - 1].baseEnd = index + 1;
        return;
      }
      const at = positions[k++],
        time = timing.windows
          ? timeAtBase(timing, at, 0)
          : timing.start + (timing.end - timing.start) * Math.min(1, at / baseLength);
      pieces.push({ start: time, baseStart: pieces.length ? index : 0, baseEnd: index + 1 });
    });
    if (!pieces.length) return null;
    pieces[pieces.length - 1].baseEnd = chars.length;
    pieces[0].start = timing.start;
    for (let i = 0; i < pieces.length; i++) {
      pieces[i].start = Math.max(pieces[i].start, i ? pieces[i - 1].start : timing.start);
      pieces[i].end = i + 1 < pieces.length ? Math.max(pieces[i].start, pieces[i + 1].start) : timing.end;
      pieces[i].text = chars.slice(pieces[i].baseStart, pieces[i].baseEnd).join("");
    }
    for (let i = 0; i < pieces.length - 1; i++) pieces[i].end = Math.max(pieces[i].start, pieces[i + 1].start);
    return { start: timing.start, end: timing.end, windows: pieces };
  }
  /** 원문 글자 위치(baseIndex)가 칠해지기 시작하는 시각 */
  function timeAtBase(timing, baseIndex, fraction) {
    if (!timing.windows) return timing.start + (timing.end - timing.start) * fraction;
    for (const w of timing.windows)
      if (baseIndex < w.baseEnd) {
        const length = Math.max(1, w.baseEnd - w.baseStart);
        return w.start + ((Math.max(baseIndex, w.baseStart) - w.baseStart) / length) * (w.end - w.start);
      }
    return timing.end;
  }
  /** 후리가나 한 묶음이 칠해지는 시간 구간 */
  function rubyWindow(timing, reading) {
    return {
      start: timeAtBase(timing, reading.baseFrom, reading.fracFrom),
      end: timeAtBase(timing, reading.baseTo, reading.fracTo),
    };
  }
  const instantFill = () => project.settings.fillMode === "instant";
  /** 원문 줄에서 지금까지 칠해진 폭(글자 폭 단위) */
  function filledWidth(timing, text, font, family, spacing, width, time) {
    if (time < timing.start) return 0;
    if (time >= timing.end) return width;
    if (!timing.windows)
      return instantFill() ? width : width * ((time - timing.start) / Math.max(0.01, timing.end - timing.start));
    const chars = [...text];
    for (const w of timing.windows) {
      if (time >= w.end) continue;
      const before = chars.slice(0, w.baseStart).join(""),
        piece = chars.slice(w.baseStart, w.baseEnd).join(""),
        x0 = before ? textWidth(before, font, family, spacing) + spacing : 0,
        pieceWidth = textWidth(piece, font, family, spacing),
        frac = instantFill()
          ? time >= w.start
            ? 1
            : 0
          : Math.min(1, Math.max(0, (time - w.start) / Math.max(0.01, w.end - w.start)));
      return Math.min(width, x0 + pieceWidth * frac);
    }
    return width;
  }
  function addText(scene, type, text, x, y, anchor, font, scale, fontFamily, fillWindow = null) {
    const s = project.settings,
      isJapanese = type === "jp",
      isReading = type === "furigana",
      isCountdown = type === "countdown",
      outline = isJapanese || isReading || isCountdown ? s.jpOutlineColor : s.koreanOutlineColor;
    let layout = null;
    if (isJapanese) {
      layout = furiganaLayout(text, x, y, anchor, font, scale, fontFamily, +s.originalSpacing || 0);
      text = layout.plain;
    }
    const ns = "http://www.w3.org/2000/svg",
      el = document.createElementNS(ns, "svg"),
      spacing = isJapanese ? +s.originalSpacing || 0 : 0;
    const width = Math.max(1, textWidth(text, font, fontFamily, spacing)),
      k = $("preview").clientWidth / 1920,
      metrics = fontMetrics(fontFamily);
    el.setAttribute("class", "preview-text " + type);
    el.setAttribute("width", width * k);
    el.setAttribute("height", font * k);
    el.setAttribute("viewBox", `0 0 ${width} ${font}`);
    Object.assign(el.style, {
      left: (x / 1920) * 100 + "%",
      top: (y / 1080) * 100 + "%",
      overflow: "visible",
      transformOrigin: anchor === 7 ? "top left" : anchor === 8 ? "top center" : "top right",
      transform: `translateX(${anchor === 7 ? "0" : anchor === 8 ? "-50%" : "-100%"}) scaleX(${scale / 100})`,
    });
    const border = (+s.outlineWidth || 0) * (isReading ? 0.55 : isCountdown ? 0.6 : 1),
      shadow = +s.shadowDepth || 0;
    const makeText = (fill, stroke, offset = 0) => {
      const node = document.createElementNS(ns, "text");
      node.textContent = text;
      node.setAttribute("x", offset);
      node.setAttribute("y", font * metrics.ascent + offset);
      node.setAttribute("font-family", previewFont(fontFamily));
      node.setAttribute("font-size", font * metrics.ratio);
      node.setAttribute("font-weight", fontWeight(fontFamily));
      node.setAttribute("letter-spacing", spacing);
      node.setAttribute("fill", fill);
      node.setAttribute("stroke", stroke);
      node.setAttribute("stroke-width", border * 2);
      node.setAttribute("stroke-linejoin", "round");
      node.setAttribute("paint-order", "stroke fill");
      node.setAttribute("xml:space", "preserve");
      node.style.whiteSpace = "pre";
      return node;
    };
    if (shadow) {
      const shade = makeText("#000", "#000", shadow);
      shade.setAttribute("opacity", ".5");
      el.append(shade);
    }
    const koreanFill = type === "read" && !!fillWindow?.windows,
      karaokeText = isJapanese || isReading || koreanFill,
      part = partColor(scene),
      primary = isJapanese || isReading ? part || s.jpPrimary : koreanFill ? part || s.koreanSungColor : s.koreanColor,
      secondary = isJapanese || isReading ? s.jpSecondary : isCountdown ? part || s.jpPrimary : s.koreanColor;
    el.append(makeText(secondary, outline));
    const timing = isJapanese ? karaokeTiming(scene) : null;
    let filled = 0;
    if (isJapanese) filled = filledWidth(timing, text, font, fontFamily, spacing, width, previewTime);
    else if (koreanFill) filled = filledWidth(fillWindow, text, font, fontFamily, 0, width, previewTime);
    else if (isReading && fillWindow) {
      if (previewTime >= fillWindow.end || (instantFill() && previewTime >= fillWindow.start)) filled = width;
      else if (previewTime > fillWindow.start)
        filled = width * ((previewTime - fillWindow.start) / Math.max(0.01, fillWindow.end - fillWindow.start));
    }
    if (karaokeText && filled > 0) {
      const done = makeText(primary, outline),
        clip = document.createElementNS(ns, "clipPath"),
        rect = document.createElementNS(ns, "rect"),
        clipId = "karaokeClip" + ++previewClipId;
      clip.id = clipId;
      // 왼쪽 외곽선까지 포함하고, 다 칠해지면 오른쪽 외곽선까지 포함합니다.
      rect.setAttribute("x", -border);
      rect.setAttribute("y", -font);
      rect.setAttribute("width", border + filled + (filled >= width ? border : 0));
      rect.setAttribute("height", font * 3);
      clip.append(rect);
      el.append(clip);
      done.setAttribute("clip-path", `url(#${clipId})`);
      el.append(done);
    }
    el.setAttribute("aria-hidden", "true");
    $("preview").append(el);
    if (layout)
      for (const reading of layout.readings)
        addText(
          scene,
          "furigana",
          reading.text,
          reading.x,
          reading.y,
          8,
          reading.font,
          reading.scale,
          fontFamily,
          rubyWindow(timing, reading),
        );
  }
  let previewClipId = 0;

  /** 파트(가수)가 지정된 줄은 칠해진 색을 파트 색으로 바꿉니다. */
  function partColor(scene) {
    const part = scene?.part;
    return partNumbers.includes(part) ? project.settings[`part${part}Color`] : null;
  }
  function assColorOverride(hex) {
    return `\\1c${assColor(hex).replace("&H00", "&H")}&`;
  }
  /** 카운트다운: 남은 초만큼 ● (3 → 2 → 1) */
  function countdownDots(scene, time) {
    if (!scene.countdown || time >= scene.start || time < scene.start - scene.countdown) return "";
    const step = scene.countdown / 3;
    return Array(Math.min(3, Math.ceil((scene.start - time) / step - 1e-9)))
      .fill("●")
      .join(" ");
  }
  function countdownLayout(scene, layers, f, x, anchor) {
    const size = Math.max(12, Math.round(f.jp * 0.6)),
      topLayer = layers[0];
    return { size, x, y: Math.max(0, (topLayer ? topLayer.y : +project.settings.topY) - size - 16), anchor };
  }
  /** 페이드 인·아웃 투명도 (미리보기용) */
  function fadeAlpha(scene, time) {
    const fadeIn = (+project.settings.fadeIn || 0) / 1000,
      fadeOut = (+project.settings.fadeOut || 0) / 1000;
    let alpha = 1;
    if (fadeIn > 0) alpha = Math.min(alpha, (time - scene.previewStart) / fadeIn);
    if (fadeOut > 0 && Number.isFinite(scene.displayEnd)) alpha = Math.min(alpha, (scene.displayEnd - time) / fadeOut);
    return Math.max(0, Math.min(1, alpha));
  }
  function renderPreview() {
    $("preview")
      .querySelectorAll(".preview-text")
      .forEach((el) => el.remove());
    const s = project.settings;
    const maxW = 1920 - +s.leftMargin - +s.rightMargin - 40;
    const incomplete = project.cues.some((c) => c.enabled && c.japanese.trim() && (!c.marked || c.end <= c.start));
    const indexes = enabledIndexes(),
      position = indexes.indexOf(selected),
      f = fontSizes(s);
    let scenes = activeScenes();
    if (incomplete) {
      const selectedCue = project.cues[selected],
        selectedUnmarked = !!(
          selectedCue?.enabled &&
          selectedCue.japanese.trim() &&
          !selectedCue.marked &&
          previewUnmarkedCueId === selectedCue.id
        );
      const markedPositions = indexes
        .map((i, pos) => (project.cues[i].marked && project.cues[i].start <= previewTime ? pos : -1))
        .filter((pos) => pos >= 0);
      const first = selectedUnmarked
        ? Math.max(0, position)
        : markedPositions.length
          ? markedPositions.at(-1)
          : Math.max(0, position);
      const current = project.cues[indexes[first]];
      if (!selectedUnmarked && markedPositions.length && current && current.end > 0 && previewTime >= current.end) {
        scenes = [];
      } else if (current) {
        scenes = [first, first + 1]
          .filter((pos) => {
            if (pos >= indexes.length) return false;
            if (pos === first) return true;
            const nextCue = project.cues[indexes[pos]],
              hasKnownInterlude = current.marked && nextCue.marked && nextCue.start - current.end > 0.5,
              markingNext = pendingMarkSelection && selected === indexes[pos];
            return !nextCue.startTop && !hasKnownInterlude && current.marked && (nextCue.marked || markingNext);
          })
          .map((pos) => {
            const cue = project.cues[indexes[pos]];
            return {
              ...cue,
              row: rowForIndex(indexes, pos),
              previewStart: 0,
              displayEnd: pos === first && cue.end > 0 ? cue.end + (cue.manualEnd ? 0 : +s.lineHold || 0) : Infinity,
              start: cue.marked ? cue.start : Infinity,
            };
          });
      } else scenes = [];
    }
    const preview = $("preview");
    for (const scene of scenes) {
      if (previewTime < scene.previewStart || previewTime >= scene.displayEnd) continue;
      const top = +s.topY + scene.row * +s.rowGap,
        anchor = scene.row ? 9 : 7,
        x = scene.row ? 1920 - +s.rightMargin : +s.leftMargin,
        layers = stackLayout(scene, s, f, top, maxW),
        firstNew = preview.children.length;
      const dots = countdownDots(scene, previewTime);
      if (dots) {
        const dot = countdownLayout(scene, layers, f, x, anchor);
        addText(scene, "countdown", dots, dot.x, dot.y, anchor, dot.size, 100, s.japaneseFont);
      }
      for (const layer of layers) {
        const centerKorean = s.centerKorean && layer.type !== "jp";
        addText(
          scene,
          layer.type,
          layer.rawText || layer.text,
          centerKorean ? 960 : x,
          layer.y,
          centerKorean ? 8 : anchor,
          layer.font,
          layer.scale,
          layer.fontFamily,
          layer.key === "reading" ? readingTiming(scene) : null,
        );
      }
      const alpha = fadeAlpha(scene, previewTime);
      if (alpha < 1) for (const el of [...preview.children].slice(firstNew)) el.style.opacity = String(alpha);
    }
    waveform?.render();
    if (!$("syllableWorkspace").hidden) updateSyllableHighlight();
    const warn = $("layoutWarning");
    warn.hidden = lowerEdge(s) <= 1040;
    warn.textContent = "아래 줄이 화면 아래쪽에 가까워요. 위 줄 높이나 두 줄 사이 높이를 줄여 주세요.";
  }
  function inspectProject() {
    const issues = [];
    const active = project.cues
      .filter((c) => c.enabled && c.japanese.trim())
      .sort((a, b) => a.start - b.start || a.id - b.id);
    for (const cue of active) {
      if (!cue.marked || cue.end <= cue.start) issues.push({ cue, message: "시작·끝 시간이 없습니다." });
      if (!cue.reading.trim()) issues.push({ cue, message: "한글 발음이 없습니다." });
    }
    for (let i = 1; i < active.length; i++)
      if (active[i].marked && active[i - 1].marked && active[i].start < active[i - 1].end)
        issues.push({ cue: active[i], message: "앞 줄과 시간이 겹칩니다." });
    const list = $("inspectionList");
    list.hidden = false;
    list.replaceChildren();
    if (!issues.length) {
      const item = document.createElement("div");
      item.className = "inspection-item ok";
      item.textContent = "검사 완료: 시간, 발음, 자막 겹침에서 문제를 찾지 못했습니다.";
      list.append(item);
      status("완성도 검사를 마쳤습니다.");
      return;
    }
    for (const issue of issues) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "inspection-item";
      item.textContent = `${issue.cue.id}번 · ${issue.message}`;
      item.onclick = () => {
        selected = project.cues.indexOf(issue.cue);
        previewTime = Math.max(0, issue.cue.start || 0);
        renderCueList(true);
        renderEditor();
        syncSeek();
        renderPreview();
      };
      list.append(item);
    }
    status(`${issues.length}개 항목을 확인해 주세요. 목록을 누르면 해당 줄로 이동합니다.`, true);
  }
  function previewAssExport() {
    const list = $("inspectionList");
    list.hidden = false;
    list.replaceChildren();
    try {
      buildAss();
      const scenes = activeScenes();
      for (const scene of scenes) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "inspection-item ass-preview";
        const preview =
          scene.previewStart < scene.start ? `미리보기 ${stamp(scene.previewStart)}–${stamp(scene.start)} · ` : "";
        item.textContent = `${scene.id}번 · ${scene.row === 0 ? "위 줄" : "아래 줄"} · ${preview}본문 ${stamp(scene.start)}–${stamp(scene.displayEnd)}`;
        const detail = document.createElement("small");
        detail.textContent = `${scene.japanese}${scene.reading ? ` / ${scene.reading}` : ""}`;
        item.append(detail);
        item.onclick = () => {
          selected = project.cues.findIndex((cue) => cue.id === scene.id);
          previewTime = scene.previewStart;
          if (audio && Number.isFinite(audio.duration)) audio.currentTime = previewTime;
          renderCueList(true);
          renderEditor();
          syncSeek();
          renderPreview();
        };
        list.append(item);
      }
      status(`ASS에 저장될 ${scenes.length}개 가사 줄의 표시 시간을 확인합니다.`);
    } catch (error) {
      const item = document.createElement("div");
      item.className = "inspection-item";
      item.textContent = `ASS를 아직 만들 수 없습니다: ${error.message}`;
      list.append(item);
      status(item.textContent, true);
    }
  }
  function assText(value) {
    if (/[{}]/.test(value)) throw Error("ASS에 사용할 수 없는 { 또는 } 문자가 있습니다. 해당 자막 줄을 확인해 주세요.");
    return value.replace(/\r?\n/g, "\\N");
  }
  function assColor(hex) {
    const value = String(hex || "#FFFFFF").replace("#", "");
    return /^[0-9a-f]{6}$/i.test(value)
      ? `&H00${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}`
      : "&H00FFFFFF";
  }
  function assStyle(name, font, size, primary, secondary, outline, outlineWidth, spacing = 0) {
    return `Style: ${name},${String(font || "Arial").replace(/,/g, " ")},${size},${primary},${secondary},${outline},&H80000000,${fontWeight(font) >= 700 ? -1 : 0},0,0,0,100,100,${spacing},0,1,${outlineWidth},${+project.settings.shadowDepth || 0},8,80,80,50,1`;
  }
  /** \kf(부드럽게 쓸기) 또는 \k(음절마다 한 번에) */
  function kTag() {
    return instantFill() ? "\\k" : "\\kf";
  }
  /** 페이드 태그. fadeIn/fadeOut false면 그쪽은 0 */
  function fadTag(fadeIn = true, fadeOut = true) {
    const a = fadeIn ? Math.round(+project.settings.fadeIn || 0) : 0,
      b = fadeOut ? Math.round(+project.settings.fadeOut || 0) : 0;
    return a || b ? `\\fad(${a},${b})` : "";
  }
  function lineEvent(layer, start, end, style, anchor, x, y, scale, text, kf, raw = false, extra = "") {
    const tag = `{\\an${anchor}\\pos(${x},${y})\\fscx${scale}${extra}${kf === null ? "" : `${kTag()}${kf}`}}`;
    return `Dialogue: ${layer},${stamp(start)},${stamp(end)},${style},,0,0,0,,${tag}${raw ? text : assText(text)}`;
  }
  function buildAss() {
    const s = project.settings,
      scenes = activeScenes(),
      f = fontSizes(s),
      unfinished = incompleteCues();
    if (unfinished.length) throw Error(`시간이 완성되지 않은 가사 ${unfinished.length}줄이 있습니다.`);
    if (!scenes.length) throw Error("일본어 가사가 입력된 줄이 없습니다.");
    if (lowerEdge(s) > 1080) throw Error("아래 자막이 화면 밖으로 나갑니다. 위치나 간격을 줄여 주세요.");
    const lines = [
      "[Script Info]",
      `Title: ${project.name.replace(/[\r\n]/g, " ")}`,
      "ScriptType: v4.00+",
      "WrapStyle: 2",
      "ScaledBorderAndShadow: yes",
      "PlayResX: 1920",
      "PlayResY: 1080",
      "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      assStyle(
        "Japanese",
        s.japaneseFont,
        f.jp,
        assColor(s.jpPrimary),
        assColor(s.jpSecondary),
        assColor(s.jpOutlineColor),
        s.outlineWidth,
        s.originalSpacing,
      ),
      assStyle(
        "Preview",
        s.japaneseFont,
        f.jp,
        assColor(s.jpSecondary),
        assColor(s.jpSecondary),
        assColor(s.jpOutlineColor),
        s.outlineWidth,
        s.originalSpacing,
      ),
      assStyle(
        "English",
        s.englishFont,
        f.jp,
        assColor(s.jpPrimary),
        assColor(s.jpSecondary),
        assColor(s.jpOutlineColor),
        s.outlineWidth,
        s.originalSpacing,
      ),
      assStyle(
        "EnglishPreview",
        s.englishFont,
        f.jp,
        assColor(s.jpSecondary),
        assColor(s.jpSecondary),
        assColor(s.jpOutlineColor),
        s.outlineWidth,
        s.originalSpacing,
      ),
      assStyle(
        "Pronunciation",
        s.koreanFont,
        f.read,
        assColor(s.fillReading ? s.koreanSungColor : s.koreanColor),
        assColor(s.koreanColor),
        assColor(s.koreanOutlineColor),
        s.outlineWidth,
      ),
      assStyle(
        "Translation",
        s.koreanFont,
        f.tr,
        assColor(s.koreanColor),
        assColor(s.koreanColor),
        assColor(s.koreanOutlineColor),
        s.outlineWidth,
      ),
      assStyle(
        "Furigana",
        s.japaneseFont,
        Math.max(1, Math.round((f.jp * (+s.rubySizePercent || 42)) / 100)),
        assColor(s.jpPrimary),
        assColor(s.jpSecondary),
        assColor(s.jpOutlineColor),
        (+s.outlineWidth || 0) * 0.55,
        0,
      ),
      assStyle(
        "FuriganaPreview",
        s.japaneseFont,
        Math.max(1, Math.round((f.jp * (+s.rubySizePercent || 42)) / 100)),
        assColor(s.jpSecondary),
        assColor(s.jpSecondary),
        assColor(s.jpOutlineColor),
        (+s.outlineWidth || 0) * 0.55,
        0,
      ),
      assStyle(
        "Countdown",
        s.japaneseFont,
        Math.max(12, Math.round(f.jp * 0.6)),
        assColor(s.jpPrimary),
        assColor(s.jpPrimary),
        assColor(s.jpOutlineColor),
        (+s.outlineWidth || 0) * 0.6,
        0,
      ),
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ];
    const maxW = 1920 - +s.leftMargin - +s.rightMargin - 40;
    for (const scene of scenes) {
      const top = +s.topY + scene.row * +s.rowGap,
        anchor = scene.row ? 9 : 7,
        x = scene.row ? 1920 - +s.rightMargin : +s.leftMargin,
        layers = stackLayout(scene, s, f, top, maxW),
        jpLayer = layers.find((layer) => layer.key === "japanese"),
        timing = karaokeTiming(scene);
      // 다시 불러올 때 후리가나 표기·음절을 되살리기 위한 원본 정보 (화면에는 표시되지 않음)
      const source = {
        japanese: scene.japanese,
        end: scene.end,
        startTop: !!scene.startTop,
        manualEnd: !!scene.manualEnd,
        part: scene.part || 0,
      };
      if (timing.windows) source.segments = scene.karaokeSegments;
      lines.push(
        `Comment: 0,${stamp(scene.start)},${stamp(scene.displayEnd)},${sourceCommentStyle},,0,0,0,,${encodeURIComponent(JSON.stringify(source))}`,
      );
      const hasPreview = scene.previewStart < scene.start,
        partOverride = partColor(scene) ? assColorOverride(partColor(scene)) : "";
      if (hasPreview && jpLayer)
        lines.push(
          lineEvent(
            0,
            scene.previewStart,
            scene.start,
            jpLayer.style === "English" ? "EnglishPreview" : "Preview",
            anchor,
            x,
            jpLayer.y,
            jpLayer.scale,
            jpLayer.text,
            null,
            false,
            fadTag(true, false),
          ),
        );
      if (scene.countdown) {
        const dot = countdownLayout(scene, layers, f, x, anchor),
          step = scene.countdown / 3;
        for (let n = 3; n >= 1; n--)
          lines.push(
            lineEvent(
              3,
              scene.start - step * n,
              scene.start - step * (n - 1),
              "Countdown",
              anchor,
              dot.x,
              Math.round(dot.y),
              100,
              Array(n).fill("●").join(" "),
              null,
              false,
              partOverride,
            ),
          );
      }
      for (const layer of layers) {
        const centerKorean = s.centerKorean && layer.key !== "japanese",
          layerAnchor = centerKorean ? 8 : anchor,
          layerX = centerKorean ? 960 : x;
        if (layer.key === "japanese") {
          const durations = timing.windows ? kfDurations(validSegments(scene), scene.start, scene.end) : null,
            karaokeText = durations
              ? timing.windows.map((w, i) => `{${kTag()}${durations[i]}}${assText(w.text)}`).join("")
              : null;
          lines.push(
            lineEvent(
              0,
              scene.start,
              scene.displayEnd,
              layer.style,
              layerAnchor,
              layerX,
              layer.y,
              layer.scale,
              karaokeText ?? layer.text,
              karaokeText ? null : Math.max(1, Math.round((scene.end - scene.start) * 100)),
              !!karaokeText,
              fadTag(!hasPreview, true) + partOverride,
            ),
          );
          const ruby = furiganaLayout(
            scene.japanese,
            layerX,
            layer.y,
            layerAnchor,
            layer.font,
            layer.scale,
            layer.fontFamily,
            +s.originalSpacing || 0,
          );
          for (const reading of ruby.readings) {
            const rx = Math.round(reading.x * 100) / 100,
              ry = Math.round(reading.y * 100) / 100,
              rs = Math.round(reading.scale * 100) / 100;
            if (scene.previewStart < scene.start)
              lines.push(
                lineEvent(
                  2,
                  scene.previewStart,
                  scene.start,
                  "FuriganaPreview",
                  8,
                  rx,
                  ry,
                  rs,
                  reading.text,
                  null,
                  false,
                  fadTag(true, false),
                ),
              );
            // 후리가나도 해당 한자가 불릴 때 칠해지도록: 앞부분은 빈 \k로 기다린 뒤 \kf로 채움
            const window = rubyWindow(timing, reading),
              delay = Math.max(0, Math.round((window.start - scene.start) * 100)),
              fill = Math.max(1, Math.round((window.end - scene.start) * 100) - delay),
              rubyText = `${delay ? `{\\k${delay}}` : ""}{${kTag()}${fill}}${assText(reading.text)}`;
            lines.push(
              lineEvent(
                2,
                scene.start,
                scene.displayEnd,
                "Furigana",
                8,
                rx,
                ry,
                rs,
                rubyText,
                null,
                true,
                fadTag(!hasPreview, true) + partOverride,
              ),
            );
          }
        } else {
          // 한글 발음: 줄이 시작될 때까지 빈 \k로 기다린 뒤 글자마다 \kf로 칠합니다.
          const fill = layer.key === "reading" ? readingTiming(scene) : null;
          let text = layer.text,
            raw = false;
          if (fill) {
            const wait = Math.max(0, Math.round((scene.start - scene.previewStart) * 100));
            let previous = 0;
            text =
              (wait ? `{\\k${wait}}` : "") +
              fill.windows
                .map((piece) => {
                  const edge = Math.round((piece.end - scene.start) * 100),
                    value = Math.max(0, edge - previous);
                  previous = Math.max(previous, edge);
                  return `{${kTag()}${value}}${assText(piece.text)}`;
                })
                .join("");
            raw = true;
          }
          lines.push(
            lineEvent(
              1,
              scene.previewStart,
              scene.displayEnd,
              layer.style,
              layerAnchor,
              layerX,
              layer.y,
              layer.scale,
              text,
              null,
              raw,
              fadTag(true, true) + (fill ? partOverride : ""),
            ),
          );
        }
      }
    }
    return lines.join("\r\n") + "\r\n";
  }
  // ===================== LRC · SRT 내보내기 =====================
  const pad2 = (n) => String(n).padStart(2, "0");
  function lrcTime(t) {
    const cs = Math.max(0, Math.round(t * 100));
    return `${pad2(Math.floor(cs / 6000))}:${pad2(Math.floor((cs % 6000) / 100))}.${pad2(cs % 100)}`;
  }
  function srtTime(t) {
    const ms = Math.max(0, Math.round(t * 1000));
    return `${pad2(Math.floor(ms / 3600000))}:${pad2(Math.floor((ms % 3600000) / 60000))}:${pad2(Math.floor((ms % 60000) / 1000))},${String(ms % 1000).padStart(3, "0")}`;
  }
  /** 음악 플레이어용 LRC. 음절 타이밍이 있는 줄은 <시간>음절 형식(단어 단위 LRC)으로, 한글 발음은 같은 시간의 다음 줄로 넣습니다. */
  function buildLrc() {
    const scenes = activeScenes();
    if (!scenes.length) throw Error("시간이 있는 일본어 가사 줄이 없습니다.");
    const lines = [`[ti:${project.name.replace(/[\r\n\]]/g, " ")}]`, "[re:두 줄 노래방 자막 만들기]"];
    scenes.forEach((scene, i) => {
      const timing = karaokeTiming(scene),
        text = timing.windows
          ? timing.windows.map((w) => `<${lrcTime(w.start)}>${w.text}`).join("") + `<${lrcTime(scene.end)}>`
          : furiganaBase(scene.japanese);
      lines.push(`[${lrcTime(scene.start)}]${text.replace(/\r?\n/g, " ")}`);
      if (scene.reading.trim()) lines.push(`[${lrcTime(scene.start)}]${scene.reading.replace(/\r?\n/g, " ")}`);
      const next = scenes[i + 1];
      if (!next || next.start - scene.end > 1) lines.push(`[${lrcTime(scene.end)}]`);
    });
    return lines.join("\r\n") + "\r\n";
  }
  /** 일반 동영상 플레이어용 SRT: 원문 / 한글 발음 / (표시 설정 시) 뜻 */
  function buildSrt() {
    const scenes = activeScenes();
    if (!scenes.length) throw Error("시간이 있는 일본어 가사 줄이 없습니다.");
    return (
      scenes
        .map((scene, i) => {
          const body = [
            furiganaBase(scene.japanese),
            scene.reading,
            project.settings.showTranslation ? scene.translation : "",
          ]
            .map((line) => line.trim())
            .filter(Boolean)
            .join("\r\n");
          return `${i + 1}\r\n${srtTime(scene.start)} --> ${srtTime(scene.displayEnd)}\r\n${body}\r\n`;
        })
        .join("\r\n") + "\r\n"
    );
  }
  async function exportText(extension, build, label) {
    try {
      const contents = build(),
        filename = `${basename()}.${extension}`,
        skipped = incompleteCues().length;
      if (await writeToWorkspace(filename, contents)) status(`작업 폴더에 ${filename} 파일을 저장했습니다.`);
      else {
        download(filename, contents, "text/plain;charset=utf-8");
        status(`${label} 파일을 다운로드했습니다.`);
      }
      if (skipped) status(`${label} 파일을 저장했습니다. 시간이 완성되지 않은 ${skipped}줄은 빠졌습니다.`, true);
    } catch (error) {
      status(error.message, true);
    }
  }
  $("exportLrc").onclick = () => exportText("lrc", buildLrc, "LRC");
  $("exportSrt").onclick = () => exportText("srt", buildSrt, "SRT");
  function download(name, contents, type) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function basename() {
    return project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "karaoke";
  }
  window.addEventListener("beforeunload", saveProjectState);
  $("projectName").oninput = () => {
    project.name = $("projectName").value;
    scheduleProjectSave();
  };
  $("newProject").onclick = () => {
    startNewSong("새 프로젝트 만들기");
    project = { name: "새 노래", cues: [], settings: { ...project.settings }, shortcuts: { ...project.shortcuts } };
    selected = 0;
    previewTime = 0;
    lastMarkedCueId = null;
    renderAll();
    status("새 곡을 만들었습니다. 이전 곡은 ‘내 곡 목록’에 저장되어 있습니다. 가사를 붙여넣거나 한 줄씩 추가하세요.");
  };
  $("addCue").onclick = () => {
    recordChange("가사 줄 추가");
    const id = project.cues.length ? Math.max(...project.cues.map((c) => c.id)) + 1 : 1;
    project.cues.push({
      id,
      start: 0,
      end: 0,
      marked: false,
      startTop: false,
      japanese: "",
      reading: "",
      translation: "",
      karaokeSegments: [],
      enabled: true,
    });
    selected = project.cues.length - 1;
    renderAll();
    status("새 가사 줄을 추가했습니다.");
  };
  $("deleteCue").onclick = () => {
    if (!project.cues.length) return;
    recordChange("가사 줄 삭제");
    project.cues.splice(selected, 1);
    selected = Math.min(selected, project.cues.length - 1);
    renderAll();
    status("선택한 줄을 삭제했습니다.");
  };
  function compactLength(text) {
    return [...String(text || "").replace(/\s/g, "")].length;
  }
  const breakChar = /[\s　、。！？!?，,．.]/;
  function splitIndex(text, target) {
    const chars = [...String(text || "")],
      safe = Math.max(1, Math.min(chars.length - 1, Math.round(target))),
      candidates = [];
    for (let i = 1; i < chars.length; i++)
      if (breakChar.test(chars[i - 1]) || breakChar.test(chars[i])) candidates.push(i);
    const nearby = candidates.filter((i) => i >= Math.max(1, safe - 7) && i <= Math.min(chars.length - 1, safe + 7));
    const point =
      (nearby.length ? nearby : candidates).sort((a, b) => Math.abs(a - safe) - Math.abs(b - safe))[0] ?? safe;
    return Math.max(1, Math.min(chars.length - 1, point));
  }
  function splitText(text, ratio) {
    const chars = [...String(text || "")];
    if (chars.length < 2) return [String(text || ""), ""];
    const point = splitIndex(text, chars.length * ratio);
    return [chars.slice(0, point).join("").trim(), chars.slice(point).join("").trim()];
  }
  /** 후리가나 표기를 뺀, 공백 제외 원문 글자 수 */
  function japaneseLength(text) {
    return compactLength(furiganaBase(text));
  }
  /** 잘린 음절 목록을 새 원문에 맞춥니다(앞뒤 공백 정리). 맞지 않으면 빈 목록. */
  function fitSegments(segments, japanese) {
    const list = segments.map((segment) => ({ ...segment }));
    if (list.length) {
      list[0].text = list[0].text.trimStart();
      list[list.length - 1].text = list[list.length - 1].text.trimEnd();
    }
    const kept = list.filter((segment) => segment.text);
    return kept.map((x) => x.text).join("") === furiganaBase(japanese) ? kept : [];
  }
  /**
   * 원문을 두 줄로 나눕니다. 후리가나 묶음 안쪽은 자르지 않고, 음절 타이밍이 있으면
   * 음절 경계에서 잘라 그 경계 시각을 나누는 시간으로 씁니다.
   */
  function splitCue(index, target) {
    const cue = project.cues[index];
    if (!cue?.japanese.trim() || japaneseLength(cue.japanese) <= 1) return false;
    const raw = cue.japanese,
      baseChars = [...furiganaBase(raw)],
      segments = validSegments(cue);
    let points = splitPoints(raw);
    if (segments) {
      const edges = new Set();
      let cursor = 0;
      for (const segment of segments.slice(0, -1)) edges.add((cursor += [...segment.text].length));
      const onEdges = points.filter((point) => edges.has(point.base));
      if (onEdges.length) points = onEdges;
    }
    if (!points.length) return false;
    // target(공백 제외 글자 수)을 화면 글자 위치로 바꿉니다.
    let goal = baseChars.length,
      counted = 0;
    const wanted = Math.min(target, japaneseLength(raw) - 1);
    for (let i = 0; i < baseChars.length; i++) {
      if (!/\s/.test(baseChars[i])) counted++;
      if (counted >= wanted) {
        goal = i + 1;
        break;
      }
    }
    const atBreak = points.filter(
        (p) => breakChar.test(baseChars[p.base - 1] || "") || breakChar.test(baseChars[p.base] || ""),
      ),
      nearby = atBreak.filter((p) => Math.abs(p.base - goal) <= 7),
      pool = nearby.length ? nearby : atBreak.length ? atBreak : points,
      pick = [...pool].sort((a, b) => Math.abs(a.base - goal) - Math.abs(b.base - goal))[0];
    const rawChars = [...raw],
      firstJapanese = rawChars.slice(0, pick.raw).join("").trim(),
      secondJapanese = rawChars.slice(pick.raw).join("").trim();
    if (!firstJapanese || !secondJapanese) return false;
    const ratio = Math.max(0.05, Math.min(0.95, japaneseLength(firstJapanese) / japaneseLength(raw))),
      [firstReading, secondReading] = splitText(cue.reading, ratio),
      [firstTranslation, secondTranslation] = splitText(cue.translation, ratio),
      oldEnd = cue.end,
      complete = cue.marked && oldEnd > cue.start;
    let mid = complete ? cue.start + (oldEnd - cue.start) * ratio : 0,
      firstSegments = [],
      secondSegments = [];
    if (segments) {
      let cursor = 0,
        count = 0;
      while (count < segments.length && cursor < pick.base) cursor += [...segments[count++].text].length;
      if (cursor === pick.base) {
        firstSegments = fitSegments(segments.slice(0, count), firstJapanese);
        secondSegments = fitSegments(segments.slice(count), secondJapanese);
        if (complete) mid = segmentWindows(segments, cue.start, oldEnd)[count - 1].end;
      }
    }
    mid = Math.round(mid * 100) / 100;
    const nextId = Math.max(0, ...project.cues.map((item) => item.id)) + 1,
      next = {
        ...cue,
        id: nextId,
        start: complete ? mid : 0,
        end: complete ? oldEnd : 0,
        marked: complete,
        startTop: false,
        manualEnd: cue.manualEnd,
        importedPreviewStart: null,
        japanese: secondJapanese,
        reading: secondReading,
        translation: secondTranslation,
        karaokeSegments: secondSegments,
      };
    cue.japanese = firstJapanese;
    cue.reading = firstReading;
    cue.translation = firstTranslation;
    cue.karaokeSegments = firstSegments;
    if (complete) {
      cue.end = mid;
      cue.manualEnd = false;
    } else {
      cue.start = 0;
      cue.end = 0;
      cue.marked = false;
    }
    project.cues.splice(index + 1, 0, next);
    return true;
  }
  function refreshAfterSplit(message) {
    renderAll();
    scheduleProjectSave();
    status(message);
  }
  $("splitCue").onclick = () => {
    if (!project.cues[selected] || japaneseLength(project.cues[selected].japanese) <= 1) {
      status("나눌 원문 가사가 없습니다.", true);
      return;
    }
    recordChange("선택 가사 줄 나누기");
    if (!splitCue(selected, Math.ceil(japaneseLength(project.cues[selected].japanese) / 2))) {
      changeHistory.pop();
      renderHistory();
      status("나눌 원문 가사가 없습니다.", true);
      return;
    }
    selected += 1;
    refreshAfterSplit("선택한 가사와 발음·뜻을 두 줄로 나눴습니다. 시간을 찍은 줄은 시간도 비율에 맞춰 나눴습니다.");
  };
  $("splitLongCues").onclick = () => {
    const limit = Number($("splitLength").value) || 22;
    let count = 0;
    recordChange("긴 가사 줄 자동 나누기");
    for (let i = 0; i < project.cues.length; i++) {
      while (japaneseLength(project.cues[i].japanese) > limit && splitCue(i, limit)) {
        count++;
        i++;
      }
    }
    if (!count) {
      changeHistory.pop();
      renderHistory();
      status(limit + "자보다 긴 원문 가사가 없습니다.");
      return;
    }
    refreshAfterSplit(
      count + "개의 긴 가사를 " + limit + "자 기준으로 나눴습니다. 발음·뜻과 시간도 함께 나뉘었습니다.",
    );
  };
  $("importWiki").onclick = () => {
    try {
      const groupSize = Number($("wikiGroupSize").value),
        triples = parseWikiTable($("wikiTable").value, groupSize),
        mode = $("wikiMode").value,
        discard = $("discardTranslation").checked;
      if (discard) triples.forEach((item) => (item.translation = ""));
      if (mode === "new") {
        const cues = triples.map((item, i) => ({
          id: i + 1,
          start: 0,
          end: 0,
          marked: false,
          startTop: false,
          japanese: item.japanese,
          reading: item.reading,
          translation: item.translation,
          enabled: true,
        }));
        startNewSong("가사 붙여넣기");
        project = {
          name: [...furiganaBase(cues[0]?.japanese || "")].slice(0, 20).join("").trim() || "가사 프로젝트",
          cues,
          settings: {
            ...project.settings,
            showTranslation: groupSize === 2 || discard ? false : project.settings.showTranslation,
          },
          shortcuts: { ...project.shortcuts },
        };
        selected = 0;
        previewTime = 0;
        lastMarkedCueId = null;
        renderAll();
        status(
          `${cues.length}개 가사 줄을 만들었습니다. 시간은 모두 0초입니다. 음악을 재생하며 시작 키로 시간을 찍어 주세요.`,
        );
      } else {
        const candidates = project.cues.filter((c) => c.enabled),
          target =
            triples.length === project.cues.length
              ? project.cues
              : triples.length === candidates.length
                ? candidates
                : null;
        if (!target)
          throw Error(
            `표는 ${triples.length}묶음, 현재 시간 칸은 ${project.cues.length}개(포함 ${candidates.length}개)입니다. 줄 수를 맞춘 뒤 다시 적용해 주세요.`,
          );
        recordChange("가사 덮어쓰기");
        target.forEach((cue, i) => {
          cue.japanese = triples[i].japanese;
          cue.reading = triples[i].reading;
          cue.translation = triples[i].translation;
          cue.karaokeSegments = [];
          cue.enabled = true;
        });
        if (groupSize === 2 || discard) project.settings.showTranslation = false;
        renderAll();
        status(`${triples.length}개 가사를 기존 시간에 넣었습니다.`);
      }
    } catch (e) {
      status(e.message, true);
    }
  };
  async function loadSubtitleFile(file) {
    try {
      const content = await file.text(),
        isAss = /\.ass$/i.test(file.name),
        parsed = isAss ? parseAss(content) : { name: file.name.replace(/\.srt$/i, ""), cues: parseSrt(content) };
      startNewSong(isAss ? "ASS 불러오기" : "SRT 불러오기");
      project = normalizeProject({
        name: parsed.name,
        cues: parsed.cues,
        settings: { ...project.settings },
        shortcuts: { ...project.shortcuts },
      });
      selected = 0;
      previewTime = parsed.cues[0].start;
      lastMarkedCueId = null;
      renderAll();
      status(
        isAss
          ? `ASS에서 ${parsed.cues.length}개 가사 줄과 시간을 불러왔습니다.`
          : `${parsed.cues.length}개 시간 줄을 불러왔습니다. 일본어 가사와 발음을 넣어 주세요.`,
      );
    } catch (e) {
      status(e.message, true);
    }
  }
  async function loadProjectFile(file) {
    try {
      const loaded = normalizeProject(JSON.parse(await file.text()));
      startNewSong("프로젝트 불러오기");
      project = loaded;
      selected = 0;
      previewTime = project.cues[0]?.start || 0;
      lastMarkedCueId = null;
      renderAll();
      status("프로젝트를 불러왔습니다.");
    } catch (e) {
      status(e.message, true);
    }
  }
  function stopMediaFrameSync() {
    if (!mediaFrameRequest) return;
    if (mediaFrameMode === "video" && typeof audio?.cancelVideoFrameCallback === "function")
      audio.cancelVideoFrameCallback(mediaFrameRequest);
    else cancelAnimationFrame(mediaFrameRequest);
    mediaFrameRequest = 0;
    mediaFrameMode = "";
  }
  function syncMediaClock(value) {
    const t = Number(value);
    if (!Number.isFinite(t)) return;
    if (auditionEnd !== null && t >= auditionEnd) {
      const end = auditionEnd;
      auditionEnd = null;
      audio.pause();
      audio.currentTime = end;
      previewTime = end;
      syncSeek();
      renderPreview();
      return;
    }
    if (syllableTap && t >= syllableTap.end) finishSyllableTap(true);
    const cue = project.cues[selected];
    if (repeatCueEnabled && cue?.marked && cue.end > cue.start && t >= cue.end) {
      audio.currentTime = Math.max(0, cue.start - 0.5);
      return;
    }
    previewTime = t;
    syncSeek();
    renderPreview();
    if (audio && !audio.paused) waveform?.follow(t);
  }
  function startMediaFrameSync() {
    stopMediaFrameSync();
    const source = audio;
    if (!source) return;
    const tick = (now, metadata) => {
      if (audio !== source || source.paused || source.ended) {
        stopMediaFrameSync();
        return;
      }
      syncMediaClock(metadata?.mediaTime ?? source.currentTime);
      if (typeof source.requestVideoFrameCallback === "function" && source.style.display !== "none") {
        mediaFrameMode = "video";
        mediaFrameRequest = source.requestVideoFrameCallback(tick);
      } else {
        mediaFrameMode = "animation";
        mediaFrameRequest = requestAnimationFrame((next) => tick(next, null));
      }
    };
    if (typeof source.requestVideoFrameCallback === "function" && source.style.display !== "none") {
      mediaFrameMode = "video";
      mediaFrameRequest = source.requestVideoFrameCallback(tick);
    } else {
      mediaFrameMode = "animation";
      mediaFrameRequest = requestAnimationFrame((next) => tick(next, null));
    }
  }
  function loadMediaFile(file) {
    stopMediaFrameSync();
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = URL.createObjectURL(file);
    const video = $("video");
    video.src = mediaUrl;
    video.style.display = file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(file.name) ? "block" : "none";
    $("placeholder").style.display = video.style.display === "block" ? "none" : "grid";
    audio = video;
    video.playbackRate = Number($("playbackRate").value) || 1;
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(previewTime, video.duration || previewTime);
      syncMediaClock(video.currentTime);
    };
    video.ontimeupdate = () => syncMediaClock(video.currentTime);
    video.onseeked = () => syncMediaClock(video.currentTime);
    video.onplay = () => {
      $("playPause").textContent = "⏸";
      if (auditionEnd === null && !repeatCueEnabled) resumePlaybackSelection();
      startMediaFrameSync();
    };
    video.onpause = () => {
      $("playPause").textContent = "▶";
      if (syllableTap) finishSyllableTap(false);
      stopMediaFrameSync();
      syncMediaClock(video.currentTime);
    };
    video.onended = () => {
      stopMediaFrameSync();
      syncMediaClock(video.currentTime);
    };
    status("영상·음악을 불러왔습니다. 영상 프레임 기준으로 자막 미리보기를 동기화합니다.");
    $("waveformStatus").textContent = "파형 만드는 중…";
    waveform
      .loadFile(file)
      .then((loaded) => {
        if (loaded) $("waveformStatus").textContent = `파형: ${file.name}`;
      })
      .catch((error) => {
        $("waveformStatus").textContent =
          `파형을 만들지 못했습니다 · ${error.message || "이 형식의 소리를 읽을 수 없습니다"}`;
      });
  }
  function mediaStore() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("two-row-karaoke-media", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("handles");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function saveMediaHandle(handle) {
    const db = await mediaStore();
    await new Promise((resolve, reject) => {
      const request = db.transaction("handles", "readwrite").objectStore("handles").put(handle, "last");
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    db.close();
  }
  async function getMediaHandle() {
    const db = await mediaStore();
    const result = await new Promise((resolve, reject) => {
      const request = db.transaction("handles").objectStore("handles").get("last");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
  }
  async function saveProjectHandle(handle) {
    const db = await mediaStore();
    await new Promise((resolve, reject) => {
      const request = db.transaction("handles", "readwrite").objectStore("handles").put(handle, "project");
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    db.close();
  }
  async function saveWorkspaceFolderHandle(handle) {
    const db = await mediaStore();
    await new Promise((resolve, reject) => {
      const request = db.transaction("handles", "readwrite").objectStore("handles").put(handle, "workspace");
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    db.close();
  }
  async function getWorkspaceFolderHandle() {
    const db = await mediaStore();
    const result = await new Promise((resolve, reject) => {
      const request = db.transaction("handles").objectStore("handles").get("workspace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
  }
  async function refreshWorkspaceFolderState() {
    try {
      const handle = await getWorkspaceFolderHandle();
      $("workspaceFolderState").textContent = handle ? `저장 폴더: ${handle.name}` : "저장 폴더 미연결";
    } catch {
      $("workspaceFolderState").textContent = "저장 폴더 미연결";
    }
  }
  async function chooseWorkspaceFolder() {
    try {
      if (typeof window.showDirectoryPicker !== "function") {
        status("이 브라우저에서는 작업 폴더 연결을 지원하지 않습니다. Chrome 또는 Edge에서 열어 주세요.", true);
        return;
      }
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await saveWorkspaceFolderHandle(handle);
      await refreshWorkspaceFolderState();
      status(`“${handle.name}” 폴더에 프로젝트와 ASS를 모아 저장합니다.`);
    } catch (e) {
      if (e.name !== "AbortError") status(`작업 폴더를 연결하지 못했습니다: ${e.message}`, true);
    }
  }
  async function writeToWorkspace(filename, data) {
    try {
      const folder = await getWorkspaceFolderHandle();
      if (!folder) return false;
      const permission = await folder.requestPermission({ mode: "readwrite" });
      if (permission !== "granted") return false;
      const file = await folder.getFileHandle(filename, { create: true });
      const writable = await file.createWritable();
      await writable.write(data);
      await writable.close();
      return true;
    } catch {
      return false;
    }
  }
  async function getProjectHandle() {
    const db = await mediaStore();
    const result = await new Promise((resolve, reject) => {
      const request = db.transaction("handles").objectStore("handles").get("project");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
  }
  async function chooseRememberedMedia() {
    try {
      if (typeof window.showOpenFilePicker !== "function") {
        status("이 브라우저에서는 자동 영상 연결을 지원하지 않습니다. 일반 영상·음악 불러오기를 사용해 주세요.", true);
        return;
      }
      const saved = await getMediaHandle();
      if (saved && typeof saved.requestPermission === "function") {
        const permission = await saved.requestPermission({ mode: "read" });
        if (permission === "granted") {
          loadMediaFile(await saved.getFile());
          status("저장된 마지막 영상을 다시 연결했습니다.");
          return;
        }
      }
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: "영상·음악",
            accept: {
              "video/*": [".mp4", ".webm", ".mov", ".mkv"],
              "audio/*": [".mp3", ".wav", ".m4a", ".ogg", ".flac"],
            },
          },
        ],
      });
      await saveMediaHandle(handle);
      loadMediaFile(await handle.getFile());
      status("이 영상을 기억했습니다. 다음에 열 때 자동 연결을 시도합니다.");
    } catch (e) {
      if (e.name !== "AbortError") status(`영상을 열지 못했습니다: ${e.message}`, true);
    }
  }
  async function restoreRememberedMedia() {
    try {
      const handle = await getMediaHandle();
      if (!handle) return;
      const permission = await handle.queryPermission({ mode: "read" });
      if (permission !== "granted") {
        status(
          "마지막 영상이 저장되어 있습니다. 왼쪽 “1. 파일 또는 새 프로젝트”의 “영상·음악 열기 및 자동 연결”을 눌러 같은 영상을 다시 선택해 주세요.",
        );
        return;
      }
      loadMediaFile(await handle.getFile());
      status("마지막으로 사용한 영상을 자동 연결했습니다.");
    } catch {}
  }
  $("rememberedMedia").onclick = chooseRememberedMedia;
  $("workspaceFolder").onclick = chooseWorkspaceFolder;
  async function openLinkedProject() {
    try {
      if (typeof window.showOpenFilePicker !== "function") {
        status("이 브라우저에서는 연결 저장을 지원하지 않습니다. 일반 프로젝트 불러오기를 사용해 주세요.", true);
        return;
      }
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "노래방 프로젝트", accept: { "application/json": [".json"] } }],
      });
      const loaded = normalizeProject(JSON.parse(await (await handle.getFile()).text()));
      startNewSong("프로젝트 불러오기");
      project = loaded;
      selected = 0;
      previewTime = project.cues[0]?.start || 0;
      lastMarkedCueId = null;
      await saveProjectHandle(handle);
      renderAll();
      status("프로젝트를 연결해서 열었습니다. 저장을 누르면 이 파일에 덮어씁니다.");
    } catch (e) {
      if (e.name !== "AbortError") status(`프로젝트를 열지 못했습니다: ${e.message}`, true);
    }
  }
  async function saveProjectToFile(saveAs = false) {
    try {
      const filename = basename() + ".karaoke.json",
        data = JSON.stringify(project, null, 2);
      if (!saveAs && (await writeToWorkspace(filename, data))) {
        status(`작업 폴더에 ${filename} 파일을 저장했습니다.`);
        return;
      }
      if (typeof window.showSaveFilePicker !== "function") {
        download(filename, data, "application/json;charset=utf-8");
        status("이 브라우저에서는 파일 덮어쓰기를 지원하지 않아 다운로드했습니다.", true);
        return;
      }
      let handle = null;
      if (!saveAs) {
        handle = await getProjectHandle();
        if (
          handle &&
          typeof handle.requestPermission === "function" &&
          (await handle.requestPermission({ mode: "readwrite" })) !== "granted"
        )
          handle = null;
      }
      if (!handle) {
        handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: "노래방 프로젝트", accept: { "application/json": [".karaoke.json", ".json"] } }],
        });
        await saveProjectHandle(handle);
      }
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      status(saveAs ? "다른 이름으로 프로젝트를 저장했습니다." : "연결된 프로젝트 파일에 저장했습니다.");
    } catch (e) {
      if (e.name !== "AbortError") status(`프로젝트를 저장하지 못했습니다: ${e.message}`, true);
    }
  }
  $("linkedProjectOpen").onclick = openLinkedProject;
  const historyLabels = {
    projectName: "프로젝트 이름 변경",
    cueJapanese: "일본어 가사 수정",
    cueReading: "한글 발음 수정",
    cueTranslation: "한국어 뜻 수정",
    cueEnabled: "가사 줄 표시 설정",
    cueStartTop: "위·아래 시작 위치 설정",
    japaneseFont: "일본어 폰트 변경",
    englishFont: "영어 폰트 변경",
    koreanFont: "한글 폰트 변경",
    showMilliseconds: "재생 시간 표시 설정",
    showTranslation: "한국어 뜻 표시 설정",
    centerKorean: "한글 자막 정렬 변경",
    fillReading: "한글 발음 칠하기 설정",
    countdown: "카운트다운 설정",
    fillMode: "노래방 채움 방식 변경",
    cuePart: "줄 파트 변경",
    part1Name: "파트 이름 변경",
    part2Name: "파트 이름 변경",
    part3Name: "파트 이름 변경",
  };
  for (const id of settingIds) historyLabels[id] = historyLabels[id + "Slider"] = "모양 조절 변경";
  for (const id of colorSettingIds) historyLabels[id] = "자막 색 변경";
  // 입력칸에 들어갈 때 상태를 기억해 두었다가, 실제로 값이 바뀌었을 때만 변경 내역에 남깁니다.
  function armHistory(target) {
    const label = historyLabels[target?.id];
    historyEditingTarget = label ? { target, label, state: cloneHistoryState(), committed: false } : null;
  }
  function commitArmedHistory(event) {
    const armed = historyEditingTarget;
    if (!armed || armed.committed || armed.target !== event.target) return;
    armed.committed = true;
    changeHistory.push({ label: armed.label, state: armed.state });
    if (changeHistory.length > 60) changeHistory.shift();
    redoHistory = [];
    renderHistory();
  }
  document.addEventListener("focusin", (event) => {
    if (historyEditingTarget?.target !== event.target) armHistory(event.target);
  });
  document.addEventListener("input", commitArmedHistory, true);
  document.addEventListener("change", commitArmedHistory, true);
  document.addEventListener("focusout", (event) => {
    if (historyEditingTarget?.target === event.target) historyEditingTarget = null;
  });
  $("srtFile").onchange = async (event) => {
    const file = event.target.files[0];
    if (file) await loadSubtitleFile(file);
    event.target.value = "";
  };
  $("projectFile").onchange = async (event) => {
    const file = event.target.files[0];
    if (file) await loadProjectFile(file);
    event.target.value = "";
  };
  $("mediaFile").onchange = (event) => {
    const file = event.target.files[0];
    if (file) loadMediaFile(file);
    event.target.value = "";
  };
  $("cueSearch").oninput = () => {
    cueSearch = $("cueSearch").value;
    renderCueList();
  };
  $("cueFilter").onchange = () => {
    cueFilter = $("cueFilter").value;
    renderCueList();
  };
  for (const [id, key] of [
    ["cueJapanese", "japanese"],
    ["cueReading", "reading"],
    ["cueTranslation", "translation"],
  ])
    $(id).oninput = () => {
      const cue = project.cues[selected];
      if (key === "japanese" && furiganaBase(cue.japanese) !== furiganaBase($(id).value)) cue.karaokeSegments = [];
      cue[key] = $(id).value;
      if (key === "japanese") renderTimingPanel();
      renderCueList();
      renderPreview();
    };

  let rubyJob = null;
  async function rubyConvert(text, signal) {
    if (!/[一-龯]/u.test(text)) return text;
    if (text.length > 2000) throw Error("한 줄이 너무 깁니다. 2,000자 이하로 나눠 주세요.");
    // Existing readings are preserved. Convert only unannotated fragments.
    const result = [];
    for (const part of furiganaParts(text)) {
      if (part.reading) {
        result.push(`[${part.text}|${part.reading}]`);
        continue;
      }
      if (!/[一-龯]/u.test(part.text)) {
        result.push(part.text);
        continue;
      }
      const response = await fetch("https://yomi.onrender.com/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ text: part.text, mode: "furigana", to: "hiragana" }),
        signal,
      });
      if (!response.ok) throw Error(`변환 서비스 오류 (${response.status})`);
      const raw = await response.text();
      if (raw.length > 100000) throw Error("변환 응답이 너무 큽니다.");
      let data = JSON.parse(raw);
      if (typeof data === "string") data = JSON.parse(data);
      if (typeof data?.converted !== "string") throw Error("변환 서비스 응답을 읽을 수 없습니다.");
      const doc = new DOMParser().parseFromString(data.converted, "text/html");
      for (const ruby of doc.querySelectorAll("ruby")) {
        const reading = ruby.querySelector("rt")?.textContent || "";
        ruby.querySelectorAll("rt,rp").forEach((node) => node.remove());
        const base = ruby.textContent;
        ruby.replaceWith(doc.createTextNode(reading ? `[${base}|${reading}]` : base));
      }
      const converted = doc.body.textContent;
      if (furiganaBase(converted) !== part.text) throw Error("원문과 다른 응답이라 적용하지 않았습니다.");
      result.push(converted);
    }
    return result.join("");
  }
  async function autoRuby(all) {
    if (rubyJob) return;
    const owner = project,
      targets = (all ? project.cues.filter((c) => c.enabled) : [project.cues[selected]])
        .filter((c) => c && /[一-龯]/u.test(c.japanese))
        .map((c) => ({ cue: c, text: c.japanese }));
    if (!targets.length) {
      $("autoRubyStatus").textContent = "변환할 한자가 없습니다.";
      return;
    }
    const job = { controller: null, cancelled: false };
    rubyJob = job;
    $("autoRubyOne").disabled = $("autoRubyAll").disabled = true;
    $("autoRubyCancel").disabled = false;
    const progress = $("autoRubyProgress");
    progress.hidden = false;
    progress.max = targets.length;
    progress.value = 0;
    let done = 0,
      failed = 0,
      changed = 0,
      recorded = false,
      lastError = "";
    const cache = new Map();
    try {
      for (const item of targets) {
        if (job.cancelled || project !== owner) break;
        $("autoRubyStatus").textContent = `${done} / ${targets.length}줄 완료 · ${done + 1}번째 줄 변환 중 (최대 30초)`;
        await new Promise((resolve) => setTimeout(resolve, 20));
        job.controller = new AbortController();
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          job.controller.abort();
        }, 30000);
        try {
          const output = cache.has(item.text)
            ? cache.get(item.text)
            : await rubyConvert(item.text, job.controller.signal);
          cache.set(item.text, output);
          if (job.cancelled || project !== owner) break;
          if (owner.cues.includes(item.cue) && item.cue.japanese === item.text && output !== item.text) {
            if (!recorded) {
              recordChange("자동 후리가나");
              recorded = true;
            }
            item.cue.japanese = output;
            changed++;
          }
        } catch (error) {
          if (job.cancelled) break;
          failed++;
          lastError = timedOut ? "서비스 응답 시간 초과" : error.message;
        } finally {
          clearTimeout(timeout);
        }
        done++;
        progress.value = done;
        if (failed >= 3) {
          lastError += " · 연속 요청을 멈췄습니다.";
          break;
        }
      }
    } finally {
      rubyJob = null;
      $("autoRubyOne").disabled = $("autoRubyAll").disabled = false;
      $("autoRubyCancel").disabled = true;
      if (changed && project === owner) {
        renderCueList();
        renderEditor();
        renderPreview();
        scheduleProjectSave();
      }
      $("autoRubyStatus").textContent =
        `${job.cancelled ? "취소됨" : "처리 종료"} · ${done}/${targets.length}줄 확인 · ${changed}줄 적용${failed ? ` · ${failed}줄 실패: ${lastError}` : ""}. 적용된 내용은 Ctrl+Z로 되돌릴 수 있습니다.`;
    }
  }
  $("autoRubyOne").onclick = () => autoRuby(false);
  $("autoRubyAll").onclick = () => autoRuby(true);
  $("autoRubyCancel").onclick = () => {
    if (rubyJob) {
      rubyJob.cancelled = true;
      rubyJob.controller?.abort();
      $("autoRubyStatus").textContent = "취소 중…";
    }
  };
  for (const id of ["cueStart", "cueEnd", "cueJapanese", "cueReading", "cueTranslation"])
    $(id).addEventListener("focus", () => {
      manualSelectionLocked = true;
      if (project.settings.precisionEdit !== false) stopPrecisionPlayback();
    });
  for (const [id, key] of [
    ["cueStart", "start"],
    ["cueEnd", "end"],
  ])
    $(id).onchange = () => {
      if (!changeSelectedTime(key, parseTimeInput($(id).value))) renderEditor();
    };
  $("cueEnabled").onchange = () => {
    project.cues[selected].enabled = $("cueEnabled").checked;
    renderCueList();
    renderPreview();
  };
  $("cueStartTop").onchange = () => {
    project.cues[selected].startTop = $("cueStartTop").checked;
    renderCueList();
    renderPreview();
    status(
      $("cueStartTop").checked
        ? "이 줄부터 위 → 아래 순서로 다시 시작합니다."
        : "이전 줄에 이어 위·아래로 번갈아 표시합니다.",
    );
  };
  for (const id of settingIds) {
    const number = $(id),
      slider = document.createElement("input");
    slider.type = "range";
    slider.id = id + "Slider";
    slider.min = number.min;
    slider.max = number.max;
    slider.step = number.step;
    slider.setAttribute("aria-label", number.closest("label").textContent.trim() + " 슬라이더");
    number.after(slider);
    number.oninput = () => {
      if (number.value === "") return;
      const n = Number(number.value);
      if (!Number.isFinite(n)) return;
      project.settings[id] = n;
      slider.value = String(n);
      renderPreview();
      scheduleProjectSave();
    };
    slider.oninput = () => {
      const n = Number(slider.value);
      project.settings[id] = n;
      number.value = slider.value;
      renderPreview();
      scheduleProjectSave();
    };
  }
  for (const id of ["japaneseFont", "englishFont", "koreanFont"])
    $(id).oninput = () => {
      project.settings[id] = $(id).value.trim() || defaults[id];
      ensurePreviewFonts();
      renderPreview();
      scheduleProjectSave();
    };
  for (const id of colorSettingIds)
    $(id).oninput = () => {
      project.settings[id] = $(id).value;
      renderFontPreview();
      renderPreview();
      scheduleProjectSave();
    };
  function setFontOptions(names) {
    const list = $("installedFontList");
    list.replaceChildren();
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      list.append(option);
    }
  }
  async function readPcFonts() {
    if (typeof window.queryLocalFonts !== "function") {
      status("이 브라우저에서는 PC 폰트 읽기를 지원하지 않습니다. Chrome 최신 버전에서 다시 열어 주세요.", true);
      return;
    }
    try {
      const fonts = await window.queryLocalFonts(),
        byName = new Map();
      for (const font of fonts) {
        const fullName = String(font.fullName || font.family || "").trim(),
          postscriptName = String(font.postscriptName || "").trim();
        if (fullName && postscriptName) byName.set(fullName, postscriptName);
      }
      const names = [...byName.keys()].sort((a, b) => a.localeCompare(b));
      if (!names.length) throw Error("읽을 수 있는 폰트가 없습니다.");
      setFontOptions(names);
      runtimeFontNames.clear();
      names.forEach((name) => runtimeFontNames.add(name));
      const css = [...byName]
        .map(
          ([name, postscript]) =>
            `@font-face{font-family:${JSON.stringify(name)};src:local(${JSON.stringify(postscript)});font-weight:normal;font-style:normal;}`,
        )
        .join("");
      let style = $("runtimeFontFaces");
      if (!style) {
        style = document.createElement("style");
        style.id = "runtimeFontFaces";
        document.head.append(style);
      }
      style.textContent = css;
      resolvedFonts.clear();
      textMeasureCache.clear();
      fontMetricCache.clear();
      ensurePreviewFonts();
      $("fontSource").textContent = `현재 PC에서 ${names.length}개 읽음`;
      renderPreview();
      status(`현재 PC의 실제 폰트 ${names.length}개를 불러왔습니다.`);
    } catch (e) {
      status(`PC 폰트를 읽지 못했습니다: ${e.message}`, true);
    }
  }
  for (const id of ["originalBold", "koreanBold"])
    $(id).onchange = () => {
      recordChange("글씨 굵기 변경");
      project.settings[id] = $(id).checked;
      textMeasureCache.clear();
      fontMetricCache.clear();
      renderPreview();
      scheduleProjectSave();
    };
  $("readPcFonts").onclick = readPcFonts;
  $("showMilliseconds").onchange = () => {
    project.settings.showMilliseconds = $("showMilliseconds").checked;
    syncSeek();
    scheduleProjectSave();
  };
  $("followPlayback").onchange = () => {
    project.settings.followPlayback = $("followPlayback").checked;
    if (project.settings.followPlayback) resumePlaybackSelection();
    scheduleProjectSave();
  };
  $("autoStartTopAfterGap").onchange = () => {
    project.settings.autoStartTopAfterGap = $("autoStartTopAfterGap").checked;
    renderCueList();
    renderEditor();
    renderPreview();
    scheduleProjectSave();
  };
  $("showTranslation").onchange = () => {
    project.settings.showTranslation = $("showTranslation").checked;
    renderPreview();
    scheduleProjectSave();
  };
  $("countdown").onchange = () => {
    project.settings.countdown = $("countdown").checked;
    renderPreview();
    scheduleProjectSave();
  };
  $("fillMode").onchange = () => {
    project.settings.fillMode = $("fillMode").value;
    renderPreview();
    scheduleProjectSave();
  };
  $("fillReading").onchange = () => {
    project.settings.fillReading = $("fillReading").checked;
    renderPreview();
    scheduleProjectSave();
  };
  $("centerKorean").onchange = () => {
    project.settings.centerKorean = $("centerKorean").checked;
    renderPreview();
    scheduleProjectSave();
  };
  $("resetAppearance").onclick = () => {
    recordChange("모양 조절 초기화");
    project.settings = { ...defaults, ...workSettings() };
    renderSettings();
    renderPreview();
    scheduleProjectSave();
    status("모양 조절 값을 처음 상태로 되돌렸습니다.");
  };
  $("stylePreset").onchange = () => renderStylePresets();
  $("saveStylePreset").onclick = () => {
    const name = $("presetName").value.trim();
    if (!name) {
      status("프리셋 이름을 입력해 주세요.", true);
      return;
    }
    const presets = loadStylePresets(),
      index = presets.findIndex((item) => item.name === name),
      preset = { name, settings: captureStyle() };
    if (index >= 0) presets[index] = preset;
    else presets.push(preset);
    saveStylePresets(presets);
    $("stylePreset").value = name;
    renderStylePresets();
    $("stylePreset").value = name;
    status(`“${name}” 스타일을 저장했습니다.`);
  };
  $("applyStylePreset").onclick = () => {
    const name = $("stylePreset").value,
      preset = loadStylePresets().find((item) => item.name === name);
    if (!preset) {
      status("적용할 스타일을 선택해 주세요.", true);
      return;
    }
    recordChange("스타일 프리셋 적용");
    const style = { ...preset.settings };
    for (const key of workSettingKeys) delete style[key];
    project.settings = { ...defaults, ...style, ...workSettings(), lyricOrder: lyricOrder(style) };
    renderSettings();
    $("stylePreset").value = name;
    renderPreview();
    scheduleProjectSave();
    status(`“${name}” 스타일을 적용했습니다.`);
  };
  $("deleteStylePreset").onclick = () => {
    const name = $("stylePreset").value;
    if (!name) return;
    saveStylePresets(loadStylePresets().filter((item) => item.name !== name));
    renderStylePresets();
    status(`“${name}” 스타일을 삭제했습니다.`);
  };
  $("exportStylePresets").onclick = () => {
    const presets = loadStylePresets();
    if (!presets.length) {
      status("백업할 스타일 프리셋이 없습니다.", true);
      return;
    }
    download(
      "노래방-자막-스타일-프리셋.json",
      JSON.stringify({ type: "two-row-karaoke-style-presets", version: 1, presets }, null, 2),
      "application/json;charset=utf-8",
    );
    status(`${presets.length}개 스타일 프리셋을 백업했습니다.`);
  };
  $("importStylePresets").onchange = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()),
        incoming = Array.isArray(data?.presets) ? data.presets : null;
      if (!incoming) throw Error("프리셋 백업 파일이 아닙니다.");
      const valid = incoming
          .filter(
            (item) =>
              item &&
              typeof item.name === "string" &&
              item.name.trim() &&
              item.settings &&
              typeof item.settings === "object",
          )
          .map((item) => ({ name: item.name.trim(), settings: item.settings })),
        merged = loadStylePresets();
      for (const preset of valid) {
        const index = merged.findIndex((item) => item.name === preset.name);
        if (index >= 0) merged[index] = preset;
        else merged.push(preset);
      }
      saveStylePresets(merged);
      renderStylePresets();
      status(`${valid.length}개 스타일 프리셋을 불러왔습니다.`);
    } catch (error) {
      status(`프리셋을 불러오지 못했습니다: ${error.message}`, true);
    }
  };
  $("applyBulk").onclick = () => {
    const jp = $("bulkJapanese").value.replace(/\r/g, "").split("\n"),
      r = $("bulkReading").value.replace(/\r/g, "").split("\n");
    if (jp.length !== project.cues.length || r.length !== project.cues.length) {
      status(
        `각 칸에 SRT와 같은 ${project.cues.length}줄을 넣어 주세요. (일본어 ${jp.length}줄, 발음 ${r.length}줄)`,
        true,
      );
      return;
    }
    recordChange("여러 줄 가사 적용");
    project.cues.forEach((c, i) => {
      c.japanese = jp[i];
      c.reading = r[i];
      c.karaokeSegments = [];
      c.enabled = !!jp[i].trim();
    });
    renderCueList();
    renderEditor();
    renderPreview();
    status("일본어 가사와 한글 발음을 적용했습니다.");
  };
  $("exportAss").onclick = async () => {
    const unfinished = incompleteCues();
    if (unfinished.length) {
      showIncompleteWarnings = true;
      incompleteCueIds = new Set(unfinished.map((c) => c.id));
      selected = project.cues.findIndex((c) => c.id === unfinished[0].id);
      renderCueList(true);
      renderEditor();
      renderPreview();
      status(`빨간색으로 표시한 ${unfinished.length}줄의 시작·끝 시간을 확인해 주세요.`, true);
      return;
    }
    try {
      await ensurePreviewFonts();
      const filename = basename() + ".ass",
        ass = buildAss();
      if (await writeToWorkspace(filename, ass)) {
        status(`작업 폴더에 ${filename} 파일을 저장했습니다.`);
      } else {
        download(filename, ass, "text/plain;charset=utf-8");
        status("ASS 파일을 다운로드했습니다.");
      }
      showIncompleteWarnings = false;
      incompleteCueIds.clear();
    } catch (e) {
      status(e.message, true);
    }
  };
  $("saveProject").onclick = () => saveProjectToFile(false);
  $("saveProjectAs").onclick = () => saveProjectToFile(true);
  $("seek").oninput = () => {
    pendingMarkSelection = false;
    manualSelectionLocked = false;
    previewTime = Number($("seek").value);
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = previewTime;
    syncSeek();
    renderPreview();
  };
  function stepText() {
    return timingStep.toFixed(timingStep === 0.01 ? 2 : timingStep === 0.05 ? 2 : 1);
  }
  function renderTimingStep() {
    const unit = stepText();
    $("nudgeCursorBack").textContent = `재생 위치 −${unit}초`;
    $("nudgeCursorForward").textContent = `재생 위치 +${unit}초`;
    $("shiftEarlier").textContent = `−${unit}초 앞당기기`;
    $("shiftLater").textContent = `+${unit}초 늦추기`;
    $("syncStartEarlier").textContent = `시작 −${unit}초`;
    $("syncStartLater").textContent = `시작 +${unit}초`;
    $("syncEndEarlier").textContent = `끝 −${unit}초`;
    $("syncEndLater").textContent = `끝 +${unit}초`;
  }
  $("timingStep").onchange = () => {
    timingStep = Number($("timingStep").value) || 0.1;
    renderTimingStep();
  };
  function shiftAllTimes(delta) {
    const complete = project.cues.filter((c) => c.marked && c.end > c.start);
    if (!complete.length) {
      status("먼저 가사 줄의 시간을 찍어 주세요.", true);
      return;
    }
    snapshotMark(delta < 0 ? "전체 시간 앞당기기" : "전체 시간 늦추기");
    for (const cue of complete) {
      const nextStart = Math.max(0, Math.round((cue.start + delta) * 100) / 100),
        nextEnd = Math.round((cue.end + delta) * 100) / 100;
      cue.start = nextStart;
      cue.end = Math.max(Math.round((nextStart + 0.01) * 100) / 100, nextEnd);
    }
    previewTime = Math.max(0, Math.round((previewTime + delta) * 100) / 100);
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = previewTime;
    renderCueList(true);
    renderEditor();
    syncSeek();
    renderPreview();
    status(`완성된 자막 ${complete.length}줄을 ${unitText(delta)}.`);
  }
  function unitText(delta) {
    return `${stepText()}초 ${delta < 0 ? "앞당겼습니다" : "늦췄습니다"}`;
  }
  $("shiftEarlier").onclick = () => shiftAllTimes(-timingStep);
  $("shiftLater").onclick = () => shiftAllTimes(timingStep);
  function stopPrecisionPlayback() {
    auditionEnd = null;
    repeatCueEnabled = false;
    manualSelectionLocked = true;
    pendingMarkSelection = false;
    if (audio?.pause) audio.pause();
  }
  function seekPrecision(time) {
    stopPrecisionPlayback();
    previewTime = Math.max(0, Math.min(duration(), Math.round(time * 100) / 100));
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = previewTime;
    syncSeek();
    renderPreview();
    renderTimingPanel();
  }
  function selectPrecisionRow(delta) {
    const indexes = enabledIndexes(),
      pos = indexes.indexOf(selected),
      index = indexes[Math.max(0, Math.min(indexes.length - 1, pos + delta))];
    if (index === undefined) return;
    stopPrecisionPlayback();
    selected = index;
    seekPrecision(project.cues[index].start);
    renderCueList(true);
    renderEditor();
    revealSelectedOnWave();
  }
  function changeSelectedTime(boundary, value) {
    const indexes = enabledIndexes(),
      position = indexes.indexOf(selected),
      cue = project.cues[selected];
    if (!cue || position < 0) return false;
    if (!Number.isFinite(value)) {
      status("시간 형식을 읽을 수 없습니다. 예: 1:23.45 또는 0:01:23.45", true);
      return false;
    }
    value = Math.round(value * 100) / 100;
    if (
      value < 0 ||
      (boundary === "start" && cue.end > 0 && value >= cue.end) ||
      (boundary === "end" && value <= cue.start)
    ) {
      status("시작은 끝보다 앞, 끝은 시작보다 뒤에 있어야 합니다.", true);
      return false;
    }
    const previous = position > 0 ? project.cues[indexes[position - 1]] : null,
      next = project.cues[indexes[position + 1]],
      link = !!project.settings.linkTimingNeighbors;
    if (
      link &&
      ((boundary === "start" && previous?.marked && value <= previous.start) ||
        (boundary === "end" && next?.marked && next.end > 0 && value >= next.end))
    ) {
      status("앞뒤 줄의 길이가 0이 됩니다. 함께 변경을 끄거나 다른 시간을 선택해 주세요.", true);
      return false;
    }
    stopPrecisionPlayback();
    snapshotMark(`선택 줄 ${boundary === "start" ? "시작" : "끝"} 시간 수정`);
    const saved = [cue, previous, next].map((item) => [item, segmentBoundaries(item)]);
    cue[boundary] = value;
    cue.marked = true;
    cue.importedPreviewStart = null;
    if (boundary === "end") cue.manualEnd = true;
    if (link && boundary === "start" && previous?.marked) {
      previous.end = value;
      previous.importedPreviewStart = null;
    }
    if (link && boundary === "end" && next?.marked) {
      next.start = value;
      next.importedPreviewStart = null;
    }
    for (const [item, boundaries] of saved) restoreBoundaries(item, boundaries);
    seekPrecision(value);
    renderCueList(true);
    renderEditor();
    scheduleProjectSave();
    status(`선택 줄 ${boundary === "start" ? "시작" : "끝"}: ${stamp(value)}${link ? " · 앞뒤 경계 함께 적용" : ""}`);
    return true;
  }
  function adjustSelectedBoundary(boundary, delta) {
    const cue = project.cues[selected];
    if (!cue?.marked) {
      status("먼저 이 줄의 시작 시간을 찍어 주세요.", true);
      return;
    }
    changeSelectedTime(boundary, cue[boundary] + delta);
  }
  function auditionSelection(kind) {
    const cue = project.cues[selected];
    if (!audio || !Number.isFinite(audio.duration)) {
      status("영상·음악을 먼저 불러와 주세요.", true);
      return;
    }
    if (!cue?.marked || cue.end <= cue.start) {
      status("선택 줄의 시작·끝 시간이 필요합니다.", true);
      return;
    }
    stopPrecisionPlayback();
    const point = kind === "end" ? cue.end : cue.start;
    const from = Math.max(0, point - 0.7),
      to = Math.min(audio.duration, kind === "line" ? cue.end + 0.3 : point + 0.7);
    auditionEnd = to;
    previewTime = from;
    audio.currentTime = from;
    syncSeek();
    audio.play().catch((error) => {
      auditionEnd = null;
      status(error.message, true);
    });
  }
  $("precisionEdit").onchange = () => {
    project.settings.precisionEdit = $("precisionEdit").checked;
    scheduleProjectSave();
  };
  $("linkTimingNeighbors").onchange = () => {
    project.settings.linkTimingNeighbors = $("linkTimingNeighbors").checked;
    scheduleProjectSave();
  };
  $("editPrevious").onclick = () => selectPrecisionRow(-1);
  $("editNext").onclick = () => selectPrecisionRow(1);
  $("seekCueStart").onclick = () => seekPrecision(project.cues[selected]?.start || 0);
  $("seekCueEnd").onclick = () => seekPrecision(project.cues[selected]?.end || 0);
  $("nudgeCursorBack").onclick = () => seekPrecision(previewTime - timingStep);
  $("nudgeCursorForward").onclick = () => seekPrecision(previewTime + timingStep);
  $("setStartHere").onclick = () => changeSelectedTime("start", previewTime);
  $("setEndHere").onclick = () => changeSelectedTime("end", previewTime);
  $("listenStart").onclick = () => auditionSelection("start");
  $("listenEnd").onclick = () => auditionSelection("end");
  $("listenLine").onclick = () => auditionSelection("line");
  $("stopAudition").onclick = () => stopPrecisionPlayback();

  function matchEndToNextStart() {
    manualSelectionLocked = true;
    const indexes = enabledIndexes(),
      position = indexes.indexOf(selected),
      cue = project.cues[selected],
      next = position >= 0 && position + 1 < indexes.length ? project.cues[indexes[position + 1]] : null;
    if (!cue || !cue.marked || cue.start < 0 || !next?.marked || next.start <= cue.start) {
      status("선택한 줄과 다음 줄의 시작 시간을 먼저 찍어 주세요.", true);
      return;
    }
    snapshotMark("끝을 다음 줄 시작에 맞추기");
    cue.end = next.start;
    cue.manualEnd = false;
    cue.marked = true;
    pendingMarkSelection = false;
    previewUnmarkedCueId = null;
    renderCueList(true);
    renderEditor();
    syncSeek();
    renderPreview();
    status(`선택한 줄 끝을 다음 줄 시작 ${stamp(next.start)}에 맞췄습니다. 다음 줄 미리보기는 그대로 유지합니다.`);
  }
  $("syncStartEarlier").onclick = () => adjustSelectedBoundary("start", -timingStep);
  $("syncStartLater").onclick = () => adjustSelectedBoundary("start", timingStep);
  $("syncEndEarlier").onclick = () => adjustSelectedBoundary("end", -timingStep);
  $("syncEndLater").onclick = () => adjustSelectedBoundary("end", timingStep);
  $("matchNextStart").onclick = matchEndToNextStart;
  $("playPause").onclick = () => {
    if (!audio) {
      status("재생하려면 영상·음악을 먼저 불러와 주세요.", true);
      return;
    }
    if (audio.paused) {
      resumePlaybackSelection();
      audio.play();
    } else audio.pause();
  };
  function renderRepeatCue() {
    const cue = project.cues[selected],
      ready = !!(cue?.marked && cue.end > cue.start);
    if (!ready) repeatCueEnabled = false;
    $("repeatCue").textContent = `줄 반복: ${repeatCueEnabled ? "켬" : "끔"}`;
    $("repeatCue").classList.toggle("primary", repeatCueEnabled);
    $("repeatCue").disabled = !ready;
    $("slowRepeatCue").disabled = !ready;
  }
  $("repeatCue").onclick = () => {
    const cue = project.cues[selected];
    if (!cue?.marked || cue.end <= cue.start) {
      status("시작과 끝 시간을 찍은 가사 줄을 선택해 주세요.", true);
      return;
    }
    repeatCueEnabled = !repeatCueEnabled;
    renderRepeatCue();
    if (repeatCueEnabled && audio) {
      audio.currentTime = Math.max(0, cue.start - 0.5);
      audio.play();
      status("선택한 줄 반복 재생을 켰습니다.");
    } else status("선택한 줄 반복 재생을 껐습니다.");
  };
  $("slowRepeatCue").onclick = () => {
    const cue = project.cues[selected];
    if (!cue?.marked || cue.end <= cue.start) {
      status("시작과 끝 시간을 찍은 가사 줄을 선택해 주세요.", true);
      return;
    }
    $("playbackRate").value = "0.5";
    if (audio) audio.playbackRate = 0.5;
    repeatCueEnabled = true;
    renderRepeatCue();
    if (audio) {
      audio.currentTime = Math.max(0, cue.start - 0.5);
      audio.play();
    }
    status("선택한 줄을 0.5배로 반복 재생합니다.");
  };
  $("playbackRate").onchange = () => {
    const rate = Number($("playbackRate").value) || 1;
    if (audio) audio.playbackRate = rate;
    status(`재생 속도를 ${rate}×로 바꿨습니다.`);
  };
  $("video").onplay = () => {
    $("playPause").textContent = "⏸";
  };
  $("video").onpause = () => {
    $("playPause").textContent = "▶";
  };
  function enabledIndexes() {
    return project.cues.map((c, i) => (c.enabled && c.japanese.trim() ? i : -1)).filter((i) => i >= 0);
  }
  function renderTimingPanel() {
    const indexes = enabledIndexes(),
      pos = indexes.indexOf(selected),
      current = pos >= 0 ? project.cues[selected] : null,
      next = pos >= 0 && pos + 1 < indexes.length ? project.cues[indexes[pos + 1]] : null;
    const meta = $("timingMeta");
    meta.replaceChildren();
    if (current) {
      for (const text of [
        `${pos + 1} / ${indexes.length}`,
        rowForIndex(indexes, pos) === 0 ? "위 줄" : "아래 줄",
        `재생 ${shortTime(previewTime, !!project.settings.showMilliseconds)}`,
      ]) {
        const chip = document.createElement("span");
        chip.textContent = text;
        meta.append(chip);
      }
    } else {
      const chip = document.createElement("span");
      chip.textContent = "가사 줄을 선택해 주세요";
      meta.append(chip);
    }
    $("timingCurrent").textContent = current
      ? `${furiganaBase(current.japanese)}${current.reading ? " / " + current.reading : ""}`
      : "—";
    renderPrecisionInfo();
    $("undoMark").disabled = !changeHistory.length;
    $("resetCurrentMark").disabled = !(current && current.marked);
    $("resetAllMarks").disabled = !project.cues.some((c) => c.marked);
    $("matchNextStart").disabled = !(current?.marked && next?.marked && next.start > current.start);
    renderRepeatCue();
    renderSyllablePanel();
  }
  function snapshotMark(label = "시간 마킹") {
    recordChange(label);
  }
  /** 시간 찍기에 쓸 현재 시각. 재생 중이면 탭 지연 보정만큼 앞당깁니다. */
  function mediaMarkTime() {
    const live = Number(audio?.currentTime),
      view = Number(previewTime),
      playing = !!audio && audio.paused === false,
      offset = playing ? (+project.settings.tapOffset || 0) / 1000 : 0;
    let value = Number.isFinite(live) && live > 0.001 ? live : view;
    if (!Number.isFinite(value)) value = 0;
    return Math.max(0, Math.round((value - offset) * 100) / 100);
  }
  function markCurrent() {
    if (!audio || !Number.isFinite(audio.duration)) {
      status("먼저 영상·음악을 불러와 주세요.", true);
      return;
    }
    const indexes = enabledIndexes(),
      pos = indexes.indexOf(selected);
    if (pos < 0) {
      status("시간을 찍을 가사 줄을 선택해 주세요.", true);
      return;
    }
    const t = mediaMarkTime(),
      c = project.cues[selected],
      previous = pos > 0 ? project.cues[indexes[pos - 1]] : null;
    if (previous?.marked && previous.end === 0 && t <= previous.start) {
      status(`현재 재생 위치 ${stamp(t)}은 이전 줄 시작보다 앞입니다.`, true);
      return;
    }
    snapshotMark("가사 시작 시간 찍기");
    if (previous?.marked && previous.end === 0) {
      previous.end = t;
      previous.manualEnd = false;
    }
    const next = pos + 1 < indexes.length ? project.cues[indexes[pos + 1]] : null,
      existingEnd = Number.isFinite(c.end) && c.end > t ? c.end : 0,
      resetEnd = Number.isFinite(c.resetEnd) && c.resetEnd > t ? c.resetEnd : 0,
      retainedEnd = existingEnd || resetEnd || (next?.marked && next.start > t ? next.start : 0),
      retainedManualEnd = !!existingEnd && !!c.manualEnd;
    delete c.resetEnd;
    c.start = t;
    c.end = retainedEnd;
    c.manualEnd = retainedManualEnd;
    c.marked = true;
    lastMarkedCueId = c.id;
    previewUnmarkedCueId = null;
    previewTime = t;
    selected = indexes[pos + 1] ?? selected;
    manualSelectionLocked = false;
    pendingMarkSelection = pos + 1 < indexes.length;
    renderCueList(true);
    renderEditor();
    syncSeek();
    renderPreview();
    scheduleProjectSave();
    status(
      pos + 1 < indexes.length
        ? `${pos + 1}번째 줄 시작을 찍었습니다. 다음 줄을 기다리세요.`
        : "마지막 줄 시작을 찍었습니다. 끝날 때 E를 누르세요.",
    );
  }
  function markEnd() {
    if (!audio || !Number.isFinite(audio.duration)) {
      status("먼저 영상·음악을 불러와 주세요.", true);
      return;
    }
    const t = mediaMarkTime(),
      target = project.cues
        .filter((c) => c.enabled && c.marked && c.start < t && (c.end === 0 || t <= c.end))
        .sort((a, b) => b.start - a.start || b.id - a.id)[0];
    if (!target) {
      status(`현재 재생 위치 ${stamp(t)}에 해당하는 시작된 가사 줄이 없습니다. 먼저 줄 시작을 찍어 주세요.`, true);
      return;
    }
    snapshotMark("가사 끝 시간 찍기");
    target.end = t;
    target.manualEnd = true;
    target.marked = true;
    lastMarkedCueId = target.id;
    previewTime = t;
    renderCueList(true);
    renderEditor();
    syncSeek();
    renderPreview();
    status(
      `현재 재생 위치 ${stamp(t)}로 “${target.japanese || "선택한 줄"}”의 끝 시간을 찍고, 화면 미리보기에서도 바로 숨겼습니다.`,
    );
  }
  $("markBtn").onclick = markCurrent;
  $("endBtn").onclick = markEnd;
  $("undoMark").onclick = undoProject;
  $("inspectProject").onclick = inspectProject;
  $("previewAssExport").onclick = previewAssExport;
  $("resetCurrentMark").onclick = () => {
    const cue = project.cues[selected];
    if (!cue || !cue.marked) return;
    recordChange("현재 줄 마킹 초기화");
    cue.resetEnd = cue.end;
    cue.start = 0;
    cue.end = 0;
    cue.manualEnd = false;
    cue.marked = false;
    cue.importedPreviewStart = null;
    repeatCueEnabled = false;
    lastMarkedCueId = null;
    previewUnmarkedCueId = cue.id;
    renderCueList(true);
    renderEditor();
    syncSeek();
    renderPreview();
    scheduleProjectSave();
    status(
      "선택한 줄의 시작·끝 시간만 초기화하고, 재생 위치와 화면 확인은 유지했습니다. 다시 시작을 찍으면 이전 끝 시간을 이어 씁니다.",
    );
  };
  $("resetAllMarks").onclick = () => {
    if (!project.cues.some((c) => c.marked)) return;
    recordChange("전체 마킹 초기화");
    for (const cue of project.cues) {
      cue.start = 0;
      cue.end = 0;
      cue.manualEnd = false;
      cue.marked = false;
      cue.importedPreviewStart = null;
      delete cue.resetEnd;
    }
    repeatCueEnabled = false;
    lastMarkedCueId = null;
    previewUnmarkedCueId = project.cues[selected]?.id ?? null;
    renderCueList(true);
    renderEditor();
    syncSeek();
    renderPreview();
    scheduleProjectSave();
    status("모든 줄의 시작·끝 시간만 초기화하고, 재생 위치와 화면 확인은 유지했습니다.");
  };
  $("undoProject").onclick = undoProject;
  $("redoProject").onclick = redoProject;
  $("clearHistory").onclick = () => {
    changeHistory = [];
    redoHistory = [];
    historyEditingTarget = null;
    renderHistory();
    renderTimingPanel();
    status("변경 내역을 지웠습니다.");
  };
  const shortcutButtons = {
      start: "shortcutStart",
      end: "shortcutEnd",
      syllable: "shortcutSyllable",
      play: "shortcutPlay",
    },
    shortcutLabels = { start: "시작 찍기", end: "끝 찍기", syllable: "음절 탭", play: "재생/일시정지" };
  let capturingShortcut = null;
  function keyLabel(code) {
    if (code === "Space") return "스페이스바";
    if (code === "Enter") return "Enter";
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    return code;
  }
  function renderShortcuts() {
    project.shortcuts = { ...defaultShortcuts, ...(project.shortcuts || {}) };
    for (const action of Object.keys(shortcutButtons))
      $(shortcutButtons[action]).textContent =
        shortcutLabels[action] +
        ": " +
        (capturingShortcut === action ? "키 입력 대기…" : keyLabel(project.shortcuts[action]));
    $("syllableTap").textContent = `탭 (${keyLabel(project.shortcuts.syllable)})`;
  }
  for (const action of Object.keys(shortcutButtons))
    $(shortcutButtons[action]).onclick = () => {
      capturingShortcut = action;
      renderShortcuts();
      status("원하는 키를 누르세요. Esc로 취소할 수 있습니다.");
    };
  $("resetShortcuts").onclick = () => {
    recordChange("단축키 초기화");
    project.shortcuts = { ...defaultShortcuts };
    capturingShortcut = null;
    renderShortcuts();
    scheduleProjectSave();
    status("단축키를 기본값으로 되돌렸습니다.");
  };
  document.addEventListener("keydown", (event) => {
    const editable = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
    if (
      (event.ctrlKey || event.metaKey) &&
      !editable &&
      ((event.code === "KeyZ" && event.shiftKey) || event.code === "KeyY")
    ) {
      event.preventDefault();
      redoProject();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ" && !editable) {
      event.preventDefault();
      undoProject();
      return;
    }
    if (capturingShortcut) {
      event.preventDefault();
      if (event.code === "Escape") {
        capturingShortcut = null;
        renderShortcuts();
        status("키 변경을 취소했습니다.");
        return;
      }
      const code = event.code;
      if (
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        !/^(Key[A-Z]|Digit[0-9]|F([2-4]|[6-9]|1[0-2])|Space|Enter)$/.test(code)
      ) {
        status("글자·숫자·스페이스바·Enter·일부 F키 중 하나를 눌러 주세요.", true);
        return;
      }
      if (Object.entries(project.shortcuts).some(([action, key]) => action !== capturingShortcut && key === code)) {
        status("이미 다른 기능에 지정한 키입니다.", true);
        return;
      }
      recordChange("단축키 변경");
      project.shortcuts[capturingShortcut] = code;
      capturingShortcut = null;
      renderShortcuts();
      scheduleProjectSave();
      status("단축키를 바꿨습니다. 프로젝트를 저장하면 함께 보관됩니다.");
      return;
    }
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || editable) return;
    if (event.code === project.shortcuts.start) {
      event.preventDefault();
      markCurrent();
    } else if (event.code === project.shortcuts.end) {
      event.preventDefault();
      markEnd();
    } else if (event.code === project.shortcuts.syllable) {
      event.preventDefault();
      tapSyllable();
    } else if (event.code === project.shortcuts.play) {
      event.preventDefault();
      $("playPause").click();
    }
  });
  $("fullscreenBtn").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("preview").requestFullscreen();
    } catch (e) {
      status("전체화면을 열 수 없습니다: " + e.message, true);
    }
  };
  document.addEventListener("fullscreenchange", () => {
    $("fullscreenBtn").textContent = document.fullscreenElement ? "전체화면 닫기" : "전체화면";
    renderPreview();
  });
  let dragDepth = 0;
  document.addEventListener("dragenter", (e) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      dragDepth++;
      $("dropOverlay").classList.add("show");
    }
  });
  document.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  document.addEventListener("dragleave", (e) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) $("dropOverlay").classList.remove("show");
    }
  });
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    dragDepth = 0;
    $("dropOverlay").classList.remove("show");
    const files = [...e.dataTransfer.files];
    for (const file of files) {
      if (/\.(srt|ass)$/i.test(file.name)) await loadSubtitleFile(file);
      else if (/\.json$/i.test(file.name)) await loadProjectFile(file);
      else if (/^(audio|video)\//.test(file.type) || /\.(mp3|wav|m4a|ogg|flac|mp4|webm|mov|mkv)$/i.test(file.name))
        loadMediaFile(file);
      else status(`지원하지 않는 파일: ${file.name}`, true);
    }
  });
  document.fonts?.addEventListener("loadingdone", () => {
    textMeasureCache.clear();
    fontMetricCache.clear();
    renderPreview();
  });
  new ResizeObserver(renderPreview).observe($("preview"));
  // ===================== 한글 발음 자동 생성 =====================
  /** 한 줄의 발음을 만듭니다. 성공하면 문자열, 후리가나 없는 한자가 있으면 그 한자 목록 */
  function generateReading(cue) {
    const result = kanaToHangul(cue.japanese);
    return result.error ? { kanji: result.kanji } : { text: result.text };
  }
  function missingKanjiMessage(kanji) {
    return `후리가나가 없는 한자(${kanji.slice(0, 6).join(" ")}${kanji.length > 6 ? " …" : ""})가 있습니다. 「자동 후리가나」를 먼저 눌러 주세요.`;
  }
  $("autoReadingOne").onclick = () => {
    const cue = selectedCue();
    if (!cue?.japanese.trim()) {
      status("일본어 가사가 있는 줄을 선택해 주세요.", true);
      return;
    }
    const result = generateReading(cue);
    if (result.kanji) {
      status(missingKanjiMessage(result.kanji), true);
      return;
    }
    if (result.text === cue.reading) {
      status("이미 자동 생성 결과와 같은 발음입니다.");
      return;
    }
    recordChange("한글 발음 자동 생성");
    cue.reading = result.text;
    renderCueList();
    renderEditor();
    renderPreview();
    scheduleProjectSave();
    status(`발음을 만들었습니다: ${result.text}`);
  };
  $("autoReadingEmpty").onclick = () => {
    const targets = project.cues.filter((cue) => cue.enabled && cue.japanese.trim() && !cue.reading.trim());
    if (!targets.length) {
      status("발음이 비어 있는 줄이 없습니다.");
      return;
    }
    const results = targets.map((cue) => [cue, generateReading(cue)]),
      ready = results.filter(([, result]) => result.text),
      skipped = results.filter(([, result]) => result.kanji);
    if (ready.length) {
      recordChange("빈 한글 발음 자동 생성");
      for (const [cue, result] of ready) cue.reading = result.text;
      renderCueList();
      renderEditor();
      renderPreview();
      scheduleProjectSave();
    }
    status(
      `${ready.length}줄의 발음을 만들었습니다.` +
        (skipped.length
          ? ` 후리가나가 없는 한자가 있는 ${skipped.length}줄은 건너뛰었습니다. 「모든 줄 자동 후리가나」를 먼저 눌러 주세요.`
          : ""),
      !ready.length,
    );
  };

  // ===================== 음절 타이밍 =====================
  /** 줄 시작·끝을 바꿔도 안쪽 음절 경계의 실제 시각은 그대로 두기 위해 기억합니다. */
  function segmentBoundaries(cue) {
    const segments = cue && validSegments(cue);
    if (!segments || !cueIsTimed(cue)) return null;
    return {
      pieces: segments.map((segment) => segment.text),
      inner: segmentWindows(segments, cue.start, cue.end)
        .slice(1)
        .map((w) => w.start),
    };
  }
  function restoreBoundaries(cue, saved) {
    if (saved && cueIsTimed(cue))
      cue.karaokeSegments = segmentsFromBoundaries(saved.pieces, cue.start, cue.end, saved.inner);
  }
  function selectedCue() {
    return project.cues[selected] || null;
  }
  function cueIsTimed(cue) {
    return !!(cue?.marked && cue.end > cue.start);
  }
  /** 저장된 음절이 있으면 그 조각, 없으면 자동으로 나눈 조각 */
  function cuePieces(cue) {
    const segments = validSegments(cue);
    return segments ? segments.map((segment) => segment.text) : autoSyllables(cue.japanese);
  }
  function renderSyllablePanel() {
    const workspace = $("syllableWorkspace");
    if (!workspace || workspace.hidden) return;
    const cue = selectedCue(),
      chips = $("syllableChips"),
      input = $("syllableText"),
      ready = !!cue?.japanese.trim(),
      timed = ready && cueIsTimed(cue),
      segments = ready ? validSegments(cue) : null,
      tapping = !!syllableTap && syllableTap.cueId === cue?.id;
    chips.replaceChildren();
    input.disabled = !ready || tapping;
    $("syllableTapStart").disabled = !timed;
    $("syllableTapStart").textContent = syllableTap ? "■ 탭 끝내기" : "● 음절 탭 시작";
    $("syllableTapStart").classList.toggle("primary", !syllableTap);
    $("syllableTap").disabled = !syllableTap;
    $("syllableTap").classList.toggle("armed", !!syllableTap);
    $("syllableAuto").disabled = !ready || tapping;
    $("syllableEven").disabled = !timed || tapping;
    $("syllableClear").disabled = !segments || tapping;
    if (!ready) {
      input.value = "";
      const empty = document.createElement("span");
      empty.className = "empty";
      empty.textContent = "일본어 가사가 있는 줄을 선택하세요.";
      chips.append(empty);
      $("syllableHint").textContent = "";
      return;
    }
    const pieces = tapping ? syllableTap.pieces : cuePieces(cue),
      windows = segments && timed ? segmentWindows(segments, cue.start, cue.end) : null;
    if (document.activeElement !== input) input.value = pieces.join("/");
    pieces.forEach((text, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "syllable-chip";
      chip.dataset.index = String(i);
      chip.append(text.trim() || "␣");
      const length = document.createElement("small");
      length.textContent = windows ? `${(windows[i].end - windows[i].start).toFixed(2)}초` : "—";
      chip.append(length);
      chip.title = windows ? `${stamp(windows[i].start)} – ${stamp(windows[i].end)} · 눌러서 듣기` : "음절 타이밍 없음";
      chip.onclick = () => {
        if (windows) auditionRange(windows[i].start, windows[i].end, Math.max(0, windows[i].start - 0.15));
      };
      chips.append(chip);
    });
    const key = keyLabel(project.shortcuts.syllable);
    let hint;
    if (tapping) {
      const done = syllableTap.boundaries.length,
        next = syllableTap.pieces[done + 1];
      hint = next
        ? `탭 ${done}/${pieces.length - 1} · 노래가 “${next.trim()}”로 넘어가는 순간 ${key}를 누르세요. 줄이 끝나면 자동으로 저장됩니다.`
        : "모든 음절을 탭했습니다. 줄이 끝나면 저장됩니다.";
    } else if (!timed) hint = "먼저 이 줄의 시작·끝 시간을 찍어 주세요. 음절 시간은 줄 안에서 나눕니다.";
    else if (!segments)
      hint = `아직 음절 타이밍이 없어 줄 전체가 같은 속도로 칠해집니다. ‘음절 탭 시작’을 누르면 줄 1초 전부터 재생되고, 음절이 바뀔 때마다 ${key}를 누르면 됩니다.`;
    else hint = "음절 타이밍이 저장되어 있습니다. 파형의 노란 점선을 끌어 미세 조절하거나, 음절을 눌러 들어 보세요.";
    $("syllableHint").textContent = hint;
    updateSyllableHighlight();
  }
  /** 재생 위치에 맞춰 음절 칩 색을 바꿉니다. */
  function updateSyllableHighlight() {
    const cue = selectedCue(),
      chips = $("syllableChips").querySelectorAll(".syllable-chip");
    if (!cue || !chips.length) return;
    const tapping = !!syllableTap && syllableTap.cueId === cue.id,
      segments = validSegments(cue),
      windows = !tapping && segments && cueIsTimed(cue) ? segmentWindows(segments, cue.start, cue.end) : null;
    chips.forEach((chip, i) => {
      let done = false,
        active = false,
        next = false;
      if (tapping) {
        done =
          i < syllableTap.boundaries.length ||
          (i === syllableTap.boundaries.length && previewTime >= syllableTap.start);
        active = i === syllableTap.boundaries.length && previewTime >= syllableTap.start;
        next = i === syllableTap.boundaries.length + 1;
      } else if (windows?.[i]) {
        done = previewTime >= windows[i].end;
        active = previewTime >= windows[i].start && previewTime < windows[i].end;
      }
      chip.classList.toggle("done", done && !active);
      chip.classList.toggle("active", active);
      chip.classList.toggle("next", next);
    });
  }
  function setCueSegments(cue, segments, label) {
    recordChange(label);
    cue.karaokeSegments = segments;
    renderCueList();
    renderSyllablePanel();
    renderPreview();
    scheduleProjectSave();
  }
  function startSyllableTap() {
    const cue = selectedCue();
    if (!audio || !Number.isFinite(audio.duration)) {
      status("먼저 영상·음악을 불러와 주세요.", true);
      return;
    }
    if (!cueIsTimed(cue) || !cue.japanese.trim()) {
      status("시작·끝 시간이 있는 일본어 가사 줄을 선택해 주세요.", true);
      return;
    }
    const typed = parseSyllableInput($("syllableText").value, furiganaBase(cue.japanese)),
      pieces = typed || cuePieces(cue);
    if (pieces.length < 2) {
      status("음절이 2개 이상이어야 탭으로 맞출 수 있습니다.", true);
      return;
    }
    stopPrecisionPlayback();
    if (timingTab !== "syllable") setTimingTab("syllable");
    syllableTap = { cueId: cue.id, pieces, boundaries: [], start: cue.start, end: cue.end };
    previewTime = Math.max(0, cue.start - 1);
    audio.currentTime = previewTime;
    syncSeek();
    renderSyllablePanel();
    revealSelectedOnWave();
    audio.play().catch((error) => {
      syllableTap = null;
      renderSyllablePanel();
      status(error.message, true);
    });
    status(
      `음절 탭 시작: 줄 1초 전부터 재생합니다. 음절이 바뀔 때마다 ${keyLabel(project.shortcuts.syllable)}를 누르세요.`,
    );
  }
  function tapSyllable() {
    if (!syllableTap) {
      startSyllableTap();
      return;
    }
    const tap = syllableTap,
      t = mediaMarkTime(),
      last = tap.boundaries.at(-1) ?? tap.start;
    if (t <= tap.start) {
      status("아직 줄이 시작되지 않았습니다. 첫 음절은 줄 시작에 자동으로 맞춰집니다.");
      return;
    }
    if (tap.boundaries.length >= tap.pieces.length - 1 || t <= last + 0.01) return;
    tap.boundaries.push(Math.min(t, tap.end - 0.01));
    renderSyllablePanel();
  }
  /** 탭 결과를 저장합니다. continueNext면 다음 줄로 이어서 탭합니다. */
  function finishSyllableTap(continueNext) {
    const tap = syllableTap;
    if (!tap) return;
    syllableTap = null;
    const cue = project.cues.find((item) => item.id === tap.cueId);
    if (cue && tap.boundaries.length) {
      setCueSegments(cue, segmentsFromBoundaries(tap.pieces, tap.start, tap.end, tap.boundaries), "음절 탭 타이밍");
      status(`“${furiganaBase(cue.japanese)}” 음절 ${tap.pieces.length}개 타이밍을 저장했습니다.`);
    }
    if (continueNext && $("syllableContinuous").checked) {
      const indexes = enabledIndexes(),
        pos = indexes.indexOf(project.cues.indexOf(cue)),
        nextIndex = indexes.slice(pos + 1).find((i) => cueIsTimed(project.cues[i])),
        next = project.cues[nextIndex];
      if (next && next.start >= tap.end - 0.05 && next.start - tap.end < 4 && cuePieces(next).length > 1) {
        selected = nextIndex;
        updateCueListSelection(true);
        renderEditor();
        syllableTap = { cueId: next.id, pieces: cuePieces(next), boundaries: [], start: next.start, end: next.end };
        renderSyllablePanel();
        revealSelectedOnWave();
        return;
      }
    }
    if (audio && !audio.paused) audio.pause();
    renderSyllablePanel();
    renderPreview();
  }
  function stopSyllableTap(save = true) {
    if (!syllableTap) return;
    if (save) finishSyllableTap(false);
    else {
      syllableTap = null;
      renderSyllablePanel();
    }
  }
  function auditionRange(from, to, startAt = from) {
    if (!audio || !Number.isFinite(audio.duration)) {
      status("영상·음악을 먼저 불러와 주세요.", true);
      return;
    }
    stopPrecisionPlayback();
    auditionEnd = Math.min(audio.duration, to);
    previewTime = startAt;
    audio.currentTime = startAt;
    syncSeek();
    audio.play().catch((error) => {
      auditionEnd = null;
      status(error.message, true);
    });
  }
  $("syllableTapStart").onclick = () => (syllableTap ? finishSyllableTap(false) : startSyllableTap());
  $("syllableTap").onclick = tapSyllable;
  $("syllableText").onchange = () => {
    const cue = selectedCue();
    if (!cue?.japanese.trim()) return;
    const base = furiganaBase(cue.japanese),
      pieces = parseSyllableInput($("syllableText").value, base);
    if (!pieces) {
      status("음절 나누기는 원문 글자를 그대로 두고 / 만 넣거나 빼야 합니다.", true);
      $("syllableText").value = cuePieces(cue).join("/");
      return;
    }
    if (pieces.join("/") === cuePieces(cue).join("/") && validSegments(cue)) return;
    const span = cueIsTimed(cue) ? [cue.start, cue.end] : [0, pieces.length * 0.3];
    setCueSegments(cue, evenSegments(pieces, ...span), "음절 나누기 변경");
    status(`음절 ${pieces.length}개로 나눴습니다. 시간은 균등하게 나눴으니 탭이나 파형으로 맞춰 주세요.`);
  };
  $("syllableText").onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("syllableText").blur();
    }
  };
  $("syllableAuto").onclick = () => {
    const cue = selectedCue();
    if (!cue?.japanese.trim()) return;
    const pieces = autoSyllables(cue.japanese),
      span = cueIsTimed(cue) ? [cue.start, cue.end] : [0, pieces.length * 0.3];
    setCueSegments(cue, evenSegments(pieces, ...span), "음절 자동 나누기");
    status("음절을 자동으로 다시 나누고 시간을 균등하게 분배했습니다.");
  };
  $("syllableEven").onclick = () => {
    const cue = selectedCue();
    if (!cueIsTimed(cue)) return;
    setCueSegments(cue, evenSegments(cuePieces(cue), cue.start, cue.end), "음절 시간 균등 분배");
    status("음절 시간을 균등하게 나눴습니다.");
  };
  $("syllableClear").onclick = () => {
    const cue = selectedCue();
    if (!cue || !validSegments(cue)) return;
    setCueSegments(cue, [], "음절 타이밍 지우기");
    status("이 줄의 음절 타이밍을 지웠습니다. 줄 전체가 같은 속도로 칠해집니다.");
  };

  // ===================== 파형 타임라인 =====================
  const round2 = (value) => Math.round(value * 100) / 100;
  function waveCues() {
    const byId = new Map(project.cues.map((cue, index) => [cue.id, index])),
      current = selectedCue();
    return activeScenes().map((scene) => {
      const index = byId.get(scene.id),
        isSelected = index === selected,
        tapping = isSelected && syllableTap?.cueId === scene.id;
      let syllables = null;
      if (isSelected && !tapping) {
        const segments = validSegments(current);
        if (segments)
          syllables = segmentWindows(segments, scene.start, scene.end).map((w) => ({
            ...w,
            active: previewTime >= w.start && previewTime < w.end,
          }));
      }
      return {
        index,
        start: scene.start,
        end: scene.end,
        row: scene.row,
        label: furiganaBase(scene.japanese),
        selected: isSelected,
        syllables,
      };
    });
  }
  function revealSelectedOnWave() {
    const cue = selectedCue();
    if (waveform && cueIsTimed(cue)) waveform.reveal(cue.start - 0.3, cue.end + 0.3);
  }
  function neighborIndexes(index) {
    const indexes = enabledIndexes(),
      pos = indexes.indexOf(index);
    return { previous: project.cues[indexes[pos - 1]], next: project.cues[indexes[pos + 1]] };
  }
  function showWaveEditTime(time) {
    if (!audio || audio.paused) {
      previewTime = time;
      if (audio && Number.isFinite(audio.duration)) audio.currentTime = time;
    }
    const cue = selectedCue();
    if (cue) {
      $("cueStart").value = stamp(cue.start);
      $("cueEnd").value = stamp(cue.end);
    }
    renderPrecisionInfo();
    syncSeek();
    renderPreview();
  }
  waveform = new WaveformView($("waveform"), {
    getTime: () => previewTime,
    getDuration: () => duration(),
    emptyMessage: () =>
      audio ? "파형 만드는 중이거나 이 파일의 소리를 읽지 못했습니다" : "영상·음악을 불러오면 파형이 표시됩니다",
    getCues: waveCues,
    seek(time) {
      pendingMarkSelection = false;
      manualSelectionLocked = false;
      previewTime = Math.min(duration(), time);
      if (audio && Number.isFinite(audio.duration)) audio.currentTime = previewTime;
      syncSeek();
      renderPreview();
    },
    select(index, time) {
      pendingMarkSelection = false;
      manualSelectionLocked = true;
      if (project.settings.precisionEdit !== false) stopPrecisionPlayback();
      selected = index;
      previewTime = time;
      if (audio && Number.isFinite(audio.duration)) audio.currentTime = time;
      updateCueListSelection(true);
      renderEditor();
      syncSeek();
      renderPreview();
    },
    beginEdit(hit) {
      if (syllableTap) stopSyllableTap(false);
      waveEdit = {
        boundaries: new Map(project.cues.map((cue) => [cue, segmentBoundaries(cue)])),
        state: cloneHistoryState(),
        label: hit.kind === "edge" ? "파형에서 줄 시간 수정" : "파형에서 음절 경계 수정",
        changed: false,
      };
      manualSelectionLocked = true;
      if (hit.index !== selected) {
        selected = hit.index;
        updateCueListSelection(true);
        renderEditor();
      }
    },
    dragCueEdge(index, edge, time) {
      const cue = project.cues[index];
      if (!cue || !waveEdit) return;
      const link = !!project.settings.linkTimingNeighbors,
        { previous, next } = neighborIndexes(index);
      let t = round2(time);
      if (edge === "start") {
        t = Math.min(t, round2(cue.end - 0.05));
        if (link && previous?.marked) t = Math.max(t, round2(previous.start + 0.05));
        t = Math.max(0, t);
        if (link && previous?.marked) {
          previous.end = t;
          previous.importedPreviewStart = null;
        }
      } else {
        t = Math.max(t, round2(cue.start + 0.05));
        if (link && next?.marked && next.end > 0) t = Math.min(t, round2(next.end - 0.05));
        if (link && next?.marked) {
          next.start = t;
          next.importedPreviewStart = null;
        }
        cue.manualEnd = true;
      }
      cue[edge] = t;
      cue.importedPreviewStart = null;
      for (const item of [cue, previous, next]) if (item) restoreBoundaries(item, waveEdit.boundaries.get(item));
      waveEdit.changed = true;
      showWaveEditTime(t);
    },
    dragSyllable(index, boundary, time) {
      const cue = project.cues[index],
        segments = cue && validSegments(cue);
      if (!segments || !cueIsTimed(cue) || !waveEdit) return;
      const windows = segmentWindows(segments, cue.start, cue.end),
        edges = [...windows.map((w) => w.start), cue.end],
        t = Math.min(edges[boundary + 1] - 0.01, Math.max(edges[boundary - 1] + 0.01, round2(time)));
      edges[boundary] = t;
      cue.karaokeSegments = segments.map((segment, i) => ({
        text: segment.text,
        duration: Math.max(1, Math.round((edges[i + 1] - edges[i]) * 100)),
      }));
      waveEdit.changed = true;
      showWaveEditTime(t);
      renderSyllablePanel();
    },
    endEdit(cancelled) {
      const edit = waveEdit;
      waveEdit = null;
      if (!edit?.changed) return;
      if (cancelled) {
        applyHistoryState(edit.state);
        return;
      }
      changeHistory.push({ label: edit.label, state: edit.state });
      if (changeHistory.length > 60) changeHistory.shift();
      redoHistory = [];
      renderHistory();
      renderCueList(true);
      renderEditor();
      renderPreview();
      scheduleProjectSave();
    },
  });
  $("waveSnap").onclick = () => {
    waveform.snap = !waveform.snap;
    $("waveSnap").classList.toggle("is-on", waveform.snap);
    $("waveSnap").setAttribute("aria-pressed", String(waveform.snap));
    status(waveform.snap ? "경계를 끌 때 소리 시작점에 붙입니다." : "소리 시작점 자석을 껐습니다.");
  };
  $("waveZoomIn").onclick = () => waveform.zoom(0.6, previewTime);
  $("waveZoomOut").onclick = () => waveform.zoom(1 / 0.6, previewTime);
  $("waveFit").onclick = () => {
    const cue = selectedCue();
    if (!cueIsTimed(cue)) {
      status("시간이 있는 줄을 선택해 주세요.", true);
      return;
    }
    waveform.viewSpan = Math.max(1.5, (cue.end - cue.start) * 1.5);
    waveform.setViewStart((cue.start + cue.end) / 2 - waveform.viewSpan / 2);
  };

  // ===================== 파트(가수) =====================
  function renderPartOptions() {
    const select = $("cuePart"),
      current = select.value;
    select.replaceChildren();
    for (const [value, label] of [
      [0, "기본 색"],
      ...partNumbers.map((n) => [n, project.settings[`part${n}Name`] || `파트 ${n}`]),
    ]) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = label;
      select.append(option);
    }
    select.value = current || "0";
    for (const n of partNumbers) $(`part${n}Name`).value = project.settings[`part${n}Name`] || "";
  }
  function setCuePart(cues, part) {
    for (const cue of cues) cue.part = part;
    renderCueList();
    renderPreview();
    scheduleProjectSave();
  }
  $("cuePart").onchange = () => {
    const cue = selectedCue();
    if (cue) setCuePart([cue], +$("cuePart").value);
  };
  $("partFillDown").onclick = () => {
    const cue = selectedCue();
    if (!cue) return;
    const part = +$("cuePart").value,
      targets = project.cues.slice(selected);
    recordChange("파트 아래로 모두 지정");
    setCuePart(targets, part);
    status(
      `${selected + 1}번째 줄부터 끝까지 ${targets.length}줄을 “${$("cuePart").selectedOptions[0].textContent}”(으)로 지정했습니다.`,
    );
  };
  for (const n of partNumbers)
    $(`part${n}Name`).oninput = () => {
      project.settings[`part${n}Name`] = $(`part${n}Name`).value.trim() || `파트 ${n}`;
      renderPartOptions();
      scheduleProjectSave();
    };

  // ===================== 탭 지연 보정 =====================
  let calibration = null;
  /** 0.6초 간격 딸깍 소리 10번에 맞춰 누른 시각과 실제 소리 시각의 차이(중앙값)를 잽니다. */
  function startTapCalibration() {
    if (calibration) return finishTapCalibration(true);
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) {
      status("이 브라우저에서는 소리 재생을 지원하지 않아 측정할 수 없습니다.", true);
      return;
    }
    if (audio && !audio.paused) audio.pause();
    const ctx = new Context(),
      first = ctx.currentTime + 1,
      beats = Array.from({ length: 10 }, (_, i) => first + i * 0.6);
    for (const at of beats) {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.frequency.value = 1200;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.6, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.08);
    }
    calibration = {
      ctx,
      beats,
      delays: [],
      timer: setTimeout(() => finishTapCalibration(false), (1 + 10 * 0.6 + 0.6) * 1000),
    };
    $("calibrateTap").textContent = "■ 측정 취소";
    $("calibrateTap").classList.add("primary");
    $("tapCalibrationStatus").textContent = "딸깍 소리에 맞춰 아무 키나(또는 이 버튼 아래 영역을) 10번 누르세요.";
  }
  function recordCalibrationTap(eventTime) {
    const c = calibration;
    if (!c) return;
    // 이벤트가 생긴 순간의 오디오 시각으로 바꿉니다.
    const at = c.ctx.currentTime - Math.max(0, performance.now() - eventTime) / 1000,
      nearest = c.beats.reduce((best, beat) => (Math.abs(beat - at) < Math.abs(best - at) ? beat : best), c.beats[0]),
      delay = at - nearest;
    if (Math.abs(delay) > 0.3) return;
    c.delays.push(delay);
    $("tapCalibrationStatus").textContent = `${c.delays.length} / 10 · 이번 탭 ${Math.round(delay * 1000)}ms`;
  }
  function finishTapCalibration(cancelled) {
    const c = calibration;
    if (!c) return;
    calibration = null;
    clearTimeout(c.timer);
    c.ctx.close();
    $("calibrateTap").textContent = "박자 맞춰 측정";
    $("calibrateTap").classList.remove("primary");
    if (cancelled) {
      $("tapCalibrationStatus").textContent = "측정을 취소했습니다.";
      return;
    }
    if (c.delays.length < 4) {
      $("tapCalibrationStatus").textContent = "탭이 너무 적어 측정하지 못했습니다. 다시 시도해 주세요.";
      return;
    }
    const sorted = [...c.delays].sort((a, b) => a - b),
      median = sorted[Math.floor(sorted.length / 2)],
      value = Math.max(-300, Math.min(500, Math.round((median * 1000) / 10) * 10));
    recordChange("탭 지연 보정 측정");
    project.settings.tapOffset = value;
    renderSettings();
    scheduleProjectSave();
    $("tapCalibrationStatus").textContent =
      `측정 결과 ${value}ms 늦게 누르고 있습니다. 재생 중 찍는 시간에서 이만큼 빼서 저장합니다.`;
    status(`탭 지연 보정을 ${value}ms로 설정했습니다.`);
  }
  $("calibrateTap").onclick = startTapCalibration;
  document.addEventListener(
    "keydown",
    (event) => {
      if (!calibration) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") finishTapCalibration(true);
      else if (!event.repeat) recordCalibrationTap(event.timeStamp);
    },
    true,
  );
  $("tapCalibrationPad").addEventListener("pointerdown", (event) => {
    if (calibration) recordCalibrationTap(event.timeStamp);
  });

  // ===================== 찾아 바꾸기 =====================
  $("replaceAll").onclick = () => {
    const find = $("findText").value,
      replacement = $("replaceText").value,
      target = $("replaceTarget").value,
      fields = target === "all" ? ["japanese", "reading", "translation"] : [target];
    if (!find) {
      status("찾을 말을 입력해 주세요.", true);
      return;
    }
    let count = 0;
    for (const cue of project.cues) for (const key of fields) count += cue[key].split(find).length - 1;
    if (!count) {
      status(`“${find}”을(를) 찾지 못했습니다.`);
      return;
    }
    recordChange("찾아 바꾸기");
    let lostSyllables = 0;
    for (const cue of project.cues)
      for (const key of fields) {
        if (!cue[key].includes(find)) continue;
        const next = cue[key].split(find).join(replacement);
        if (key === "japanese" && validSegments(cue) && furiganaBase(next) !== furiganaBase(cue.japanese)) {
          cue.karaokeSegments = [];
          lostSyllables++;
        }
        cue[key] = next;
      }
    renderCueList();
    renderEditor();
    renderPreview();
    scheduleProjectSave();
    status(
      `${count}곳을 바꿨습니다.` +
        (lostSyllables ? ` 원문이 바뀐 ${lostSyllables}줄은 음절 타이밍을 다시 맞춰 주세요.` : ""),
    );
  };

  // ===================== 앱 설치·오프라인 =====================
  // GitHub Pages(https)나 localhost에서 열었을 때만 동작합니다. 파일로 직접 연 경우에는 건너뜁니다.
  if (
    "serviceWorker" in navigator &&
    (location.protocol === "https:" || location.hostname === "localhost") &&
    !selfTestMode
  )
    navigator.serviceWorker.register("sw.js").catch(() => {});
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    $("installApp").hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    $("installApp").hidden = true;
    status("앱으로 설치했습니다. 바탕화면이나 시작 메뉴에서 바로 열 수 있습니다.");
  });
  $("installApp").onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    $("installApp").hidden = true;
  };

  // ===================== 곡 목록 백업 =====================
  $("exportLibrary").onclick = () => {
    saveProjectState();
    const songs = readLibrary()
      .map((entry) => {
        try {
          return JSON.parse(localStorage.getItem(projectKeyPrefix + entry.id));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (!songs.length) {
      status("백업할 곡이 없습니다.", true);
      return;
    }
    const day = new Date(),
      stampText = `${day.getFullYear()}${pad2(day.getMonth() + 1)}${pad2(day.getDate())}`;
    download(
      `노래방-곡-목록-백업-${stampText}.json`,
      JSON.stringify({ type: "two-row-karaoke-library", version: 1, exported: day.toISOString(), songs }, null, 2),
      "application/json;charset=utf-8",
    );
    status(`${songs.length}곡을 백업 파일로 저장했습니다.`);
  };
  $("importLibrary").onchange = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()),
        incoming = Array.isArray(data?.songs) ? data.songs : Array.isArray(data?.cues) ? [data] : null;
      if (!incoming) throw Error("곡 목록 백업 파일이나 프로젝트 파일이 아닙니다.");
      saveProjectState();
      const library = readLibrary();
      let added = 0;
      incoming.forEach((song, index) => {
        try {
          const normalized = normalizeProject(song),
            id = newProjectId() + index;
          localStorage.setItem(projectKeyPrefix + id, JSON.stringify(normalized));
          library.push({ id, name: normalized.name, updated: Date.now() - index - 1, lines: normalized.cues.length });
          added++;
        } catch {}
      });
      writeLibrary(library);
      renderLibrary();
      status(
        `${added}곡을 ‘내 곡 목록’에 추가했습니다.${added < incoming.length ? ` (${incoming.length - added}곡은 읽지 못함)` : ""}`,
        !added,
      );
    } catch (error) {
      status(`백업을 불러오지 못했습니다: ${error.message}`, true);
    }
  };

  // ===================== 곡 목록 =====================
  /** 지금 곡을 저장해 두고, 이어서 만들 내용은 새 곡으로 목록에 추가합니다. */
  function startNewSong(label) {
    saveProjectState();
    recordChange(label);
    currentProjectId = newProjectId();
  }
  function formatSavedTime(value) {
    const date = new Date(value),
      pad = (n) => String(n).padStart(2, "0");
    return Number.isFinite(date.getTime())
      ? `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
      : "";
  }
  function renderLibrary() {
    const select = $("projectLibrary"),
      list = readLibrary();
    if (!list.some((item) => item.id === currentProjectId))
      list.unshift({ id: currentProjectId, name: project.name, updated: Date.now(), lines: project.cues.length });
    select.replaceChildren();
    for (const item of list) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.name || "이름 없음"} · ${item.lines ?? "?"}줄 · ${formatSavedTime(item.updated)}`;
      select.append(option);
    }
    select.value = currentProjectId;
    $("deleteLibraryProject").disabled = selfTestMode;
  }
  function resetForSong() {
    if (syllableTap) stopSyllableTap(false);
    changeHistory = [];
    redoHistory = [];
    selected = 0;
    previewTime = project.cues.find((cue) => cue.marked)?.start || 0;
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = previewTime;
    lastMarkedCueId = null;
    previewUnmarkedCueId = null;
    pendingMarkSelection = false;
    showIncompleteWarnings = false;
    incompleteCueIds = new Set();
    renderAll();
    revealSelectedOnWave();
  }
  function openSong(id, saveCurrent = true) {
    let next;
    try {
      next = normalizeProject(JSON.parse(localStorage.getItem(projectKeyPrefix + id)));
    } catch {
      status("이 곡을 열 수 없습니다. 저장된 내용이 손상되었습니다.", true);
      renderLibrary();
      return false;
    }
    if (saveCurrent) saveProjectState();
    currentProjectId = id;
    project = next;
    resetForSong();
    scheduleProjectSave();
    return true;
  }
  $("projectLibrary").onchange = () => {
    const id = $("projectLibrary").value;
    if (id === currentProjectId) return;
    if (openSong(id)) status(`“${project.name}”을(를) 열었습니다. 영상·음악은 그대로이니 다른 곡이면 다시 불러오세요.`);
  };
  $("deleteLibraryProject").onclick = () => {
    const id = $("projectLibrary").value,
      list = readLibrary(),
      entry = list.find((item) => item.id === id) || (id === currentProjectId ? { id, name: project.name } : null);
    if (!entry) return;
    if (
      !confirm(`“${entry.name}”을(를) 곡 목록에서 지울까요?\n이 브라우저에 저장된 내용이 지워지며 되돌릴 수 없습니다.`)
    )
      return;
    try {
      localStorage.removeItem(projectKeyPrefix + id);
      writeLibrary(list.filter((item) => item.id !== id));
    } catch {}
    if (id === currentProjectId) {
      const rest = readLibrary();
      if (!rest.length || !openSong(rest[0].id, false)) {
        currentProjectId = newProjectId();
        project = { name: "새 노래", cues: [], settings: { ...project.settings }, shortcuts: { ...project.shortcuts } };
        resetForSong();
        scheduleProjectSave();
      }
    }
    renderLibrary();
    status(`“${entry.name}”을(를) 목록에서 지웠습니다.`);
  };

  function renderAll() {
    $("projectName").value = project.name;
    renderCueList();
    renderEditor();
    renderSettings();
    renderShortcuts();
    renderHistory();
    renderLibrary();
    syncSeek();
    renderPreview();
  }
  setTimingTab(project.cues.some((c) => c.marked) ? "edit" : "mark");
  renderAll();
  refreshWorkspaceFolderState();
  restoreRememberedMedia();
  if (new URLSearchParams(location.search).has("selftest")) {
    try {
      const ass = buildAss();
      const originalRows = activeScenes();
      // --- 음절·후리가나·ASS 왕복 검사 ---
      if (autoSyllables("小さな[声|こえ]で歌ってた").join("/") !== "小/さ/な/声/で/歌/っ/て/た")
        throw Error("Auto syllables failed");
      if (autoSyllables("「ねえ、Hello world」").join("/") !== "「ね/え、/Hello /world」")
        throw Error("Syllable punctuation failed");
      if (!ass.includes("{\\kf30}小{\\kf30}さ{\\kf40}な{\\kf45}声")) throw Error("Syllable \\kf export failed");
      if (!/Furigana,,0,0,0,,\{[^}]*\}\{\\k\d+\}\{\\kf\d+\}/.test(ass)) throw Error("Timed furigana export failed");
      project.settings.centerKorean = true;
      const roundTrip = parseAss(buildAss());
      project.settings.centerKorean = false;
      if (
        roundTrip.cues.length !== originalRows.length ||
        roundTrip.cues.some((cue) => !cue.reading) ||
        roundTrip.cues[0].japanese !== project.cues[0].japanese ||
        roundTrip.cues[1].karaokeSegments.map((x) => x.duration).join() !== "30,30,40,45,30,40,25,30,50"
      )
        throw Error("ASS round trip failed");
      const historyBefore = changeHistory.length;
      $("cueReading").focus();
      $("cueTranslation").focus();
      $("cueTranslation").blur();
      if (changeHistory.length !== historyBefore) throw Error("Focus alone recorded history");
      const segmentCue = project.cues[1],
        segmentCopy = JSON.parse(JSON.stringify(segmentCue));
      if (
        !splitCue(1, 4) ||
        project.cues[1].japanese !== "[小|ちい]さな[声|こえ]" ||
        project.cues[1].end !== 5.65 ||
        project.cues[2].start !== 5.65 ||
        project.cues[2].karaokeSegments.length !== 5
      )
        throw Error("Syllable-aware split failed");
      project.cues.splice(1, 2, segmentCopy);
      for (const [source, expected] of [
        ["つまらない[話|はなし]でも[笑|わら]った", "츠마라나이 하나시데모 와랏타"],
        ["ママに[可愛|かわい]いって[言|い]われて[育|そだ]った", "마마니 카와이잇테 이와레테 소닷타"],
        ["トーキョー・ヴィーナスが[渋谷|しぶや]のヴィジョンから", "토오쿄오 비이나스가 시부야노 비죤카라"],
        ["[思|おも]う", "오모우"],
      ])
        if (kanaToHangul(source).text !== expected) throw Error("Reading generation failed: " + source);
      if (!kanaToHangul("聞こえる").error) throw Error("Missing furigana not detected");
      // --- 파트 색·탭 지연 보정 ---
      project.cues[1].part = 2;
      const partAss = buildAss();
      project.cues[1].part = 0;
      if (
        !/,Japanese,,0,0,0,,\{[^}]*\\1c&HD9B3FF&\}\{\\kf30\}小/.test(partAss) ||
        !/Furigana,,0,0,0,,\{[^}]*\\1c&HD9B3FF&\}\{\\k\d+\}\{\\kf\d+\}こえ/.test(partAss) ||
        /,Japanese,,0,0,0,,\{[^}]*\\1c/.test(buildAss()) ||
        parseAss(partAss).cues[1].part !== 2
      )
        throw Error("Part color export failed");
      const savedAudio = audio;
      audio = { duration: 30, currentTime: 5, paused: false };
      project.settings.tapOffset = 150;
      const compensated = mediaMarkTime();
      audio.paused = true;
      const pausedMark = mediaMarkTime();
      project.settings.tapOffset = 0;
      audio = savedAudio;
      if (compensated !== 4.85 || pausedMark !== 5) throw Error("Tap offset failed");
      // --- LRC·SRT ---
      const lrc = buildLrc(),
        srt = buildSrt();
      if (
        !lrc.includes("[00:04.20]<00:04.20>小<00:04.50>さ<00:04.80>な") ||
        !lrc.includes("[00:01.00]夜明け前の空を見てた\r\n[00:01.00]요아케 마에노 소라오 미테타") ||
        !lrc.includes("[00:18.80]\r\n[00:25.00]") ||
        !srt.startsWith("1\r\n00:00:01,000 --> 00:00:04,200\r\n夜明け前の空を見てた\r\n요아케 마에노 소라오 미테타\r\n")
      )
        throw Error("LRC/SRT export failed");
      // --- 카운트다운·페이드·채움 방식 ---
      const countdownScene = activeScenes()[6];
      if (countdownScene.countdown !== 3 || countdownScene.previewStart !== 22 || activeScenes()[5].countdown)
        throw Error("Countdown scene failed");
      if (
        !/Dialogue: 3,0:00:22\.00,0:00:23\.00,Countdown,,0,0,0,,\{\\an7\\pos\(120,\d+\)\\fscx100\}● ● ●/.test(
          buildAss(),
        )
      )
        throw Error("Countdown export failed");
      project.settings.fadeIn = 200;
      project.settings.fadeOut = 300;
      const faded = buildAss();
      project.settings.fadeIn = project.settings.fadeOut = 0;
      if (
        !/Pronunciation,,0,0,0,,\{[^}]*\\fad\(200,300\)/.test(faded) ||
        !/,Preview,,0,0,0,,\{[^}]*\\fad\(200,0\)\}/.test(faded)
      )
        throw Error("Fade export failed");
      project.settings.fillMode = "instant";
      const instant = buildAss();
      project.settings.fillMode = "sweep";
      if (!instant.includes("{\\k30}小{\\k30}さ") || /Japanese,,0,0,0,,[^\n]*\\kf/.test(instant))
        throw Error("Instant fill export failed");
      const readingFill = readingTiming(activeScenes()[1]),
        koPiece = readingFill?.windows.find((piece) => piece.text.startsWith("코"));
      if (!koPiece || Math.abs(koPiece.start - 5.2) > 0.001 || readingFill.windows[0].start !== 4.2)
        throw Error("Reading fill timing failed");
      if (!/Pronunciation,,0,0,0,,\{[^}]*\}\{\\k250\}\{\\kf\d+\}치/.test(ass))
        throw Error("Reading karaoke export failed");
      if (
        parseTimeInput("1:23.45") !== 83.45 ||
        parseTimeInput("0:01:02.5") !== 62.5 ||
        !Number.isNaN(parseTimeInput("abc"))
      )
        throw Error("Time input parsing failed");
      const keepCopy = JSON.parse(JSON.stringify(project.cues[1]));
      selected = 1;
      adjustSelectedBoundary("start", 0.1);
      if (
        project.cues[1].karaokeSegments
          .slice(0, 3)
          .map((x) => x.duration)
          .join() !== "20,30,40"
      )
        throw Error("Syllable boundaries moved with line start");
      project.cues.splice(1, 1, keepCopy);
      selected = 0;
      if (
        originalRows.length < 4 ||
        originalRows[0].row !== 0 ||
        originalRows[1].row !== 1 ||
        originalRows[2].row !== 0
      )
        throw Error("Alternating rows failed");
      project.settings.lineHold = 1.5;
      const heldRows = activeScenes();
      if (
        Math.abs(heldRows[0].displayEnd - Math.min(originalRows[0].end + 1.5, heldRows[2].start)) > 0.001 ||
        heldRows[2].previewStart < heldRows[0].displayEnd
      )
        throw Error("Line hold preview timing failed");
      project.settings.lineHold = defaults.lineHold;
      const resetCue = project.cues.find((c) => c.id === originalRows[3].id);
      resetCue.startTop = true;
      const resetRows = activeScenes();
      if (resetRows[3].row !== 0 || resetRows[4].row !== 1) throw Error("Section row reset failed");
      resetCue.startTop = false;
      const probe = parseSrt("1\n00:00:00,000 --> 00:00:01,250\n검사");
      const assProbe = parseAss(
        "[Script Info]\nTitle: 검사곡\n[Events]\nDialogue: 0,0:00:00.50,0:00:01.00,Preview,,0,0,0,,{\\an7\\pos(120,615)}テスト\nDialogue: 0,0:00:01.00,0:00:02.50,Japanese,,0,0,0,,{\\an7\\pos(120,615)\\kf150}テスト\nDialogue: 1,0:00:00.50,0:00:02.50,Pronunciation,,0,0,0,,{\\an7\\pos(120,510)}테스트",
      );
      const wikiFixture =
        "| 狂ってしまったんだ |\n| :---: |\n| 쿠룻테 시맛탄다 |\n| 미쳐버린 거야 |\n| |\n| 泣きたい |\n| 나키타이 |\n| [울고 싶어](https://example.com) [\\[1\\]](https://example.com/#fn-1) |";
      const wikiProbe = parseWikiTable(wikiFixture);
      const plainFixture =
        "狂ってしまったんだ\n쿠룻테 시맛탄다\n미쳐버린 거야\n\n脳みそ切り離して考えて？\n노오미소 키리하나시테 칸가에테?\n머리 좀 비우고 생각해봐";
      const plainProbe = parseWikiTable(plainFixture);
      const twoLineProbe = parseWikiTable(
        "狂ってしまったんだ\n쿠룻테 시맛탄다\n脳みそ切り離して考えて？\n노오미소 키리하나시테 칸가에테?",
        2,
      );
      const chorusProbe = parseWikiTable(
        "Nothing but up, up, up (yeah)\n위, 위, 오직 위뿐이야 (yeah)\nWhoa Oh, Whoa Oh Oh (Hey! Hey!)\nIntergalactic bound\n우주 사이의 경계를",
        2,
      );
      if (
        probe.length !== 1 ||
        probe[0].end !== 1.25 ||
        assProbe.name !== "검사곡" ||
        assProbe.cues.length !== 1 ||
        assProbe.cues[0].japanese !== "テスト" ||
        assProbe.cues[0].reading !== "테스트" ||
        assProbe.cues[0].importedPreviewStart !== 0.5 ||
        assProbe.cues[0].karaokeSegments.length !== 0 ||
        wikiProbe.length !== 2 ||
        wikiProbe[1].translation !== "울고 싶어" ||
        plainProbe.length !== 2 ||
        plainProbe[1].gapBefore !== 1 ||
        twoLineProbe.length !== 2 ||
        twoLineProbe[1].translation !== "" ||
        chorusProbe.length !== 3 ||
        chorusProbe[1].japanese !== "Whoa Oh, Whoa Oh Oh (Hey! Hey!)" ||
        chorusProbe[1].reading !== "" ||
        chorusProbe[2].reading !== "우주 사이의 경계를" ||
        ass.split(/\r?\n/).filter((x) => x.startsWith("Dialogue:")).length < originalRows.length * 3
      )
        throw Error("GUI self-test failed");
      $("wikiTable").value = plainFixture;
      $("wikiMode").value = "new";
      $("importWiki").click();
      if (
        project.cues.length !== 2 ||
        project.cues.some((c) => c.start !== 0 || c.end !== 0 || c.marked) ||
        !project.cues[1].translation
      )
        throw Error("SRT-free import failed");
      $("exportAss").click();
      if (
        !showIncompleteWarnings ||
        !$("cueList").children[0].classList.contains("incomplete") ||
        !$("cueList").children[1].classList.contains("incomplete")
      )
        throw Error("Incomplete lyric highlight failed");
      audio = { duration: 20, currentTime: 1 };
      markCurrent();
      if (
        project.cues[0].start !== 1 ||
        !project.cues[0].marked ||
        selected !== 1 ||
        !$("preview").textContent.includes(project.cues[0].japanese)
      )
        throw Error("First mark preview failed");
      audio.currentTime = 2;
      markEnd();
      previewTime = 2.5;
      renderPreview();
      if (project.cues[0].end !== 2 || $("preview").querySelectorAll(".preview-text").length !== 0)
        throw Error("Interlude did not clear subtitles");
      audio.currentTime = 4;
      markCurrent();
      audio.currentTime = 6;
      markEnd();
      $("shiftEarlier").click();
      if (
        project.cues[0].start !== 0.9 ||
        project.cues[0].end !== 1.9 ||
        project.cues[1].start !== 3.9 ||
        project.cues[1].end !== 5.9
      )
        throw Error("Global time shift failed");
      $("shiftLater").click();
      $("cueList").children[0].click();
      if (audio.currentTime !== 1 || previewTime !== 1 || !$("preview").textContent.includes(project.cues[0].japanese))
        throw Error("Cue seek failed");
      project.cues[0].start = 0;
      project.cues[0].end = 2;
      previewTime = 0;
      $("shiftEarlier").click();
      if (project.cues[0].start !== 0 || project.cues[0].end !== 1.9) throw Error("Zero timestamp shift failed");
      project.cues[0].start = 1;
      project.cues[0].end = 2;
      project.cues[1].start = 4;
      project.cues[1].end = 6;
      previewTime = 1;
      $("phoneticGapSlider").value = "50";
      $("phoneticGapSlider").oninput();
      if (project.settings.phoneticGap !== 50 || $("phoneticGap").value !== "50")
        throw Error("Slider synchronization failed");
      $("resetAppearance").click();
      if (
        project.settings.phoneticGap !== defaults.phoneticGap ||
        $("phoneticGapSlider").value !== String(defaults.phoneticGap)
      )
        throw Error("Appearance reset failed");
      project.cues[0].manualEnd = false;
      project.settings.lineHold = 0.5;
      if (activeScenes()[0].displayEnd !== 2.5) throw Error("Line hold failed");
      project.settings.lineHold = 0;
      const withoutSrt = buildAss();
      if (
        !withoutSrt.includes("狂ってしまったんだ") ||
        withoutSrt.includes("Translation,,") ||
        project.cues[0].end !== 2 ||
        project.cues[1].end !== 6 ||
        activeScenes()[1].previewStart !== 4
      )
        throw Error("Timing or interlude failed");
      project.settings.overallScale = 125;
      renderSettings();
      renderPreview();
      if (fontSizes(project.settings).jp !== 105 || !buildAss().includes("Style: Japanese,Yu Gothic,105,"))
        throw Error("Overall font scale failed");
      project.settings.japaneseFont = "M PLUS Rounded 1c ExtraBold";
      project.settings.englishFont = "Arial";
      project.settings.koreanFont = "NanumSquareRound ExtraBold";
      renderSettings();
      const englishLayer = layerSource(
        { japanese: "C'mon, I feel it", reading: "", translation: "" },
        "japanese",
        project.settings,
        fontSizes(project.settings),
        1000,
      );
      if (
        !buildAss().includes("Style: Japanese,M PLUS Rounded 1c ExtraBold,105,") ||
        !buildAss().includes("Style: English,Arial,105,") ||
        englishLayer.style !== "English" ||
        englishLayer.fontFamily !== "Arial" ||
        !buildAss().includes("Style: Pronunciation,NanumSquareRound ExtraBold,")
      )
        throw Error("Font selection failed");
      $("resetAppearance").click();
      project.settings.showTranslation = true;
      project.settings.lyricOrder = ["japanese", "translation", "reading"];
      const stackProbe = stackLayout(
        { japanese: "일본어", reading: "발음", translation: "뜻" },
        project.settings,
        fontSizes(project.settings),
        100,
        1600,
      );
      if (
        stackProbe.map((layer) => layer.key).join("|") !== "japanese|translation|reading" ||
        stackProbe[1].y <= stackProbe[0].y ||
        stackProbe[2].y <= stackProbe[1].y
      )
        throw Error("Lyric stack ordering failed");
      project.settings.lyricOrder = [...defaults.lyricOrder];
      project.settings.showTranslation = false;
      $("showTranslation").checked = true;
      $("showTranslation").onchange();
      if (!buildAss().includes("Translation,,")) throw Error("Translation toggle failed");
      $("centerKorean").checked = true;
      $("centerKorean").onchange();
      if (!buildAss().includes("\\an8\\pos(960,")) throw Error("Centered Korean export failed");
      $("centerKorean").checked = false;
      $("centerKorean").onchange();
      $("discardTranslation").checked = true;
      $("importWiki").click();
      if (project.cues.some((c) => c.translation) || project.settings.showTranslation)
        throw Error("Translation discard failed");
      project = {
        name: "경계 검사",
        settings: { ...defaults, linkTimingNeighbors: true },
        cues: [
          {
            id: 1,
            start: 5,
            end: 6,
            marked: true,
            startTop: false,
            japanese: "앞 줄",
            reading: "",
            translation: "",
            enabled: true,
          },
          {
            id: 2,
            start: 6,
            end: 7,
            marked: true,
            startTop: false,
            japanese: "선택 줄",
            reading: "",
            translation: "",
            enabled: true,
          },
          {
            id: 3,
            start: 7,
            end: 8,
            marked: true,
            startTop: false,
            japanese: "뒤 줄",
            reading: "",
            translation: "",
            enabled: true,
          },
        ],
      };
      selected = 1;
      audio = { duration: 30, currentTime: 6 };
      adjustSelectedBoundary("start", 0.5);
      if (project.cues[0].end !== 6.5 || project.cues[1].start !== 6.5)
        throw Error("Selected start boundary sync failed");
      adjustSelectedBoundary("end", -0.2);
      if (project.cues[1].end !== 6.8 || project.cues[2].start !== 6.8)
        throw Error("Selected end boundary sync failed");
      project = {
        name: "마킹 화면 검사",
        settings: { ...defaults },
        cues: ["첫 줄", "둘째 줄", "셋째 줄"].map((japanese, i) => ({
          id: i + 1,
          start: 0,
          end: 0,
          marked: false,
          startTop: false,
          japanese,
          reading: "발음 " + i,
          translation: "",
          enabled: true,
        })),
      };
      selected = 0;
      previewTime = 0;
      audio = { duration: 30, currentTime: 1 };
      renderAll();
      markCurrent();
      if (selected !== 1 || !$("cueList").children[1].classList.contains("selected"))
        throw Error("Auto advance after first mark failed");
      audio.currentTime = 3;
      markCurrent();
      if (selected !== 2 || !$("preview").textContent.includes("둘째 줄") || $("preview").textContent.includes("첫 줄"))
        throw Error("Auto advance preview failed");
      $("cueList").children[0].click();
      previewTime = 3;
      renderPreview();
      if (!$("preview").textContent.includes("둘째 줄")) throw Error("Preview did not follow playback time");
      project.cues = Array.from({ length: 30 }, (_, i) => ({
        id: i + 1,
        start: 0,
        end: 0,
        marked: false,
        startTop: false,
        japanese: "가사 " + i,
        reading: "발음 " + i,
        translation: "",
        enabled: true,
      }));
      selected = 29;
      renderCueList(true);
      if ($("cueList").scrollTop === 0 || !$("cueList").children[29].classList.contains("selected"))
        throw Error("Selected lyric was not revealed");
      $("shortcutStart").click();
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ", key: "j", bubbles: true }));
      if (project.shortcuts.start !== "KeyJ" || $("shortcutStart").textContent !== "시작 찍기: J")
        throw Error("Shortcut reassignment failed");
      audio.currentTime = 7;
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ", key: "j", bubbles: true }));
      if (!project.cues[29].marked || project.cues[29].start !== 7) throw Error("Custom shortcut did not mark time");
      $("resetShortcuts").click();
      if (project.shortcuts.start !== "KeyM" || project.shortcuts.play !== "Space")
        throw Error("Shortcut reset failed");
      const historyName = project.name;
      recordChange("되돌리기 검사");
      project.name = "되돌림 검사";
      undoProject();
      if (project.name !== historyName || changeHistory.length < 0) throw Error("History undo failed");
      recordChange("Ctrl+Z 검사");
      project.name = "CtrlZ 검사";
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyZ", key: "z", ctrlKey: true, bubbles: true }));
      if (project.name !== historyName) throw Error("Ctrl+Z failed");
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyY", key: "y", ctrlKey: true, bubbles: true }));
      if (project.name !== "CtrlZ 검사") throw Error("Ctrl+Y failed");
      project = {
        name: "줄 나누기 검사",
        settings: { ...defaults },
        cues: [
          {
            id: 1,
            start: 10,
            end: 16,
            marked: true,
            startTop: false,
            japanese: "提灯が　風鈴が　陽炎が　向日葵が　蝉時雨が",
            reading: "초오친가 후우린가 카게로오가 히마와리가 세미시구레가",
            translation: "등롱이 풍경이 아지랑이가 해바라기가 매미 울음 소리가",
            enabled: true,
          },
        ],
      };
      selected = 0;
      if (
        !splitCue(0, 12) ||
        project.cues.length !== 2 ||
        project.cues[0].end <= project.cues[0].start ||
        project.cues[1].start !== project.cues[0].end ||
        !project.cues[0].reading ||
        !project.cues[1].translation
      )
        throw Error("Long lyric split failed");
      project.cues = [
        {
          id: 1,
          start: 0,
          end: 0,
          marked: false,
          startTop: false,
          japanese: "[漢字|かんじ]を[勉強|べんきょう]する",
          reading: "",
          translation: "",
          enabled: true,
        },
      ];
      splitCue(0, Math.ceil(japaneseLength(project.cues[0].japanese) / 2));
      if (
        project.cues.some((cue) => /\[[^\]]*$|^[^\[]*\]/.test(cue.japanese)) ||
        project.cues.map((c) => furiganaBase(c.japanese)).join("") !== "漢字を勉強する"
      )
        throw Error("Furigana split broke markup");
      document.documentElement.dataset.selftest = "pass";
    } catch (error) {
      document.documentElement.dataset.selftest = "fail";
      document.documentElement.dataset.selftestError = error.message;
      throw error;
    }
  }
})();
