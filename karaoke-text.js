// 가사 텍스트 처리: 후리가나 표기([漢字|かんじ]), 음절 나누기, 음절 시간 계산.
// 화면(app.js)과 무관한 순수 함수만 둡니다.
(function () {
  "use strict";

  const RUBY_PATTERN = /\[([^|\[\]]+)\|([^\[\]]+)\]/g;

  /** "[漢字|かんじ]を" → [{text:"漢字", reading:"かんじ", start:0}, {text:"を", start:2}] */
  function furiganaParts(text) {
    const raw = String(text || ""),
      parts = [];
    let cursor = 0,
      plainIndex = 0,
      match;
    RUBY_PATTERN.lastIndex = 0;
    while ((match = RUBY_PATTERN.exec(raw))) {
      const before = raw.slice(cursor, match.index);
      if (before) {
        parts.push({ text: before, start: plainIndex, raw: before });
        plainIndex += [...before].length;
      }
      parts.push({ text: match[1], reading: match[2], start: plainIndex, raw: match[0] });
      plainIndex += [...match[1]].length;
      cursor = match.index + match[0].length;
    }
    const after = raw.slice(cursor);
    if (after) parts.push({ text: after, start: plainIndex, raw: after });
    return parts;
  }

  /** 후리가나 표기를 뺀 실제 화면 글자 */
  function furiganaBase(text) {
    return furiganaParts(text)
      .map((part) => part.text)
      .join("");
  }

  /**
   * 원문을 자를 수 있는 위치 목록. 후리가나 묶음 안쪽은 자르지 않습니다.
   * base: 화면 글자 기준 위치, raw: 표기 문자열 기준 위치(코드 포인트 단위)
   */
  function splitPoints(raw) {
    const points = [];
    let base = 0,
      rawIndex = 0;
    for (const part of furiganaParts(raw)) {
      const rawChars = [...part.raw];
      if (part.reading) {
        base += [...part.text].length;
        rawIndex += rawChars.length;
        points.push({ base, raw: rawIndex });
        continue;
      }
      for (let i = 0; i < rawChars.length; i++) {
        base++;
        rawIndex++;
        points.push({ base, raw: rawIndex });
      }
    }
    points.pop(); // 맨 끝은 자르는 위치가 아님
    return points.filter((p) => p.base > 0);
  }

  const SMALL_KANA = /[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮヵヶ]/;
  const ATTACH_PREVIOUS = /[\s　、。，．,.!?！？…‥・」』）)\]〉》】〕"'’”~〜♪☆★♡♥]/;
  const ATTACH_NEXT = /[「『（(\[〈《【〔‘“]/;
  const WORD_CHAR = /[A-Za-z0-9]/;
  const WORD_CONTINUE = /[A-Za-z0-9'’\-]/;

  /**
   * 노래방 음절 자동 나누기. 가나 한 글자(작은 가나는 앞에 붙임), 영어는 단어,
   * 후리가나가 달린 한자 묶음은 한 덩어리, 문장부호·공백은 앞 음절에 붙입니다.
   * 반환값은 화면 글자(후리가나 표기 제외) 조각 배열입니다.
   */
  function autoSyllables(raw) {
    const pieces = [];
    let pendingOpen = "";
    const push = (text) => {
      pieces.push(pendingOpen + text);
      pendingOpen = "";
    };
    for (const part of furiganaParts(raw)) {
      if (part.reading) {
        push(part.text);
        continue;
      }
      const chars = [...part.text];
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (WORD_CHAR.test(ch)) {
          let word = ch;
          while (i + 1 < chars.length && WORD_CONTINUE.test(chars[i + 1])) word += chars[++i];
          push(word);
          continue;
        }
        if (ATTACH_NEXT.test(ch)) {
          pendingOpen += ch;
          continue;
        }
        if (SMALL_KANA.test(ch) || ATTACH_PREVIOUS.test(ch)) {
          if (pieces.length && !pendingOpen) pieces[pieces.length - 1] += ch;
          else pendingOpen += ch;
          continue;
        }
        push(ch);
      }
    }
    if (pendingOpen) {
      if (pieces.length) pieces[pieces.length - 1] += pendingOpen;
      else pieces.push(pendingOpen);
    }
    return pieces;
  }

  /** "つ/ま/ら/な/い" 입력을 조각으로. 원문 글자와 다르면 null */
  function parseSyllableInput(input, base) {
    const pieces = String(input || "")
      .split("/")
      .filter((piece) => piece !== "");
    return pieces.length && pieces.join("") === base ? pieces : null;
  }

  /** 저장된 음절이 현재 원문과 맞으면 그대로, 아니면 null */
  function validSegments(cue) {
    const segments = Array.isArray(cue?.karaokeSegments) ? cue.karaokeSegments : [];
    if (!segments.length) return null;
    return segments.map((s) => s.text).join("") === furiganaBase(cue.japanese) ? segments : null;
  }

  /** 음절별 절대 시간(초). 저장된 길이 비율을 줄 길이에 맞춰 늘리거나 줄입니다. */
  function segmentWindows(segments, start, end) {
    const span = Math.max(0, end - start),
      weights = segments.map((s) => Math.max(0, +s.duration || 0)),
      total = weights.reduce((a, b) => a + b, 0);
    let cursor = start,
      baseIndex = 0;
    return segments.map((segment, i) => {
      const share = total > 0 ? weights[i] / total : 1 / segments.length,
        length = [...segment.text].length,
        window = {
          text: segment.text,
          start: cursor,
          end: i === segments.length - 1 ? end : cursor + span * share,
          baseStart: baseIndex,
          baseEnd: baseIndex + length,
        };
      cursor = window.end;
      baseIndex += length;
      return window;
    });
  }

  /** ASS \kf 값(1/100초). 합계가 줄 길이와 정확히 같도록 누적 반올림합니다. */
  function kfDurations(segments, start, end) {
    const windows = segmentWindows(segments, start, end);
    let previous = 0;
    return windows.map((w) => {
      const edge = Math.round((w.end - start) * 100),
        value = Math.max(0, edge - previous);
      previous = Math.max(previous, edge);
      return value;
    });
  }

  /** 줄 길이를 균등하게 나눈 음절 데이터 */
  function evenSegments(pieces, start, end) {
    const total = Math.max(pieces.length, Math.round(Math.max(0, end - start) * 100));
    let previous = 0;
    return pieces.map((text, i) => {
      const edge = Math.round(((i + 1) / pieces.length) * total),
        duration = edge - previous;
      previous = edge;
      return { text, duration };
    });
  }

  /** 절대 시간 경계(음절 2번째부터의 시작 시각)로 음절 길이 만들기 */
  function segmentsFromBoundaries(pieces, start, end, boundaries) {
    const edges = [start];
    for (let i = 0; i < pieces.length - 1; i++) {
      const previous = edges[edges.length - 1],
        remaining = pieces.length - 1 - i,
        latest = end - remaining * 0.01;
      let t = boundaries[i];
      if (!Number.isFinite(t)) {
        // 탭하지 않은 나머지는 남은 시간을 균등 분배
        const left = pieces.length - i;
        t = previous + (end - previous) / left;
      }
      edges.push(Math.min(latest, Math.max(previous + 0.01, t)));
    }
    edges.push(end);
    return pieces.map((text, i) => ({ text, duration: Math.max(1, Math.round((edges[i + 1] - edges[i]) * 100)) }));
  }

  /** ASS 노래방 태그 "{\kf12}テ{\kf30}スト" → 음절 배열 */
  function segmentsFromAssKaraoke(text) {
    const segments = [];
    const pattern = /\{([^}]*)\}([^{]*)/g;
    let match,
      carry = 0;
    const leading = String(text).match(/^[^{]+/);
    if (leading) segments.push({ text: leading[0], duration: 0 });
    while ((match = pattern.exec(text))) {
      const values = match[1].match(/\\k[fo]?(\d+)/gi) || [],
        duration = values.reduce((sum, tag) => sum + Number(tag.replace(/\\k[fo]?/i, "")), 0) + carry,
        piece = match[2].replace(/\\N/gi, "\n").replace(/\\h/g, " ");
      if (!piece) {
        carry = duration;
        continue;
      }
      carry = 0;
      segments.push({ text: piece, duration });
    }
    if (carry && segments.length) segments[segments.length - 1].duration += carry;
    return segments;
  }

  window.KaraokeText = {
    furiganaParts,
    furiganaBase,
    splitPoints,
    autoSyllables,
    parseSyllableInput,
    validSegments,
    segmentWindows,
    kfDurations,
    evenSegments,
    segmentsFromBoundaries,
    segmentsFromAssKaraoke,
  };
})();
