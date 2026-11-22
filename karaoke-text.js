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

  // ===================== 가나 → 한글 발음 =====================
  const KANA = {
    あ: "아",
    い: "이",
    う: "우",
    え: "에",
    お: "오",
    か: "카",
    き: "키",
    く: "쿠",
    け: "케",
    こ: "코",
    が: "가",
    ぎ: "기",
    ぐ: "구",
    げ: "게",
    ご: "고",
    さ: "사",
    し: "시",
    す: "스",
    せ: "세",
    そ: "소",
    ざ: "자",
    じ: "지",
    ず: "즈",
    ぜ: "제",
    ぞ: "조",
    た: "타",
    ち: "치",
    つ: "츠",
    て: "테",
    と: "토",
    だ: "다",
    ぢ: "지",
    づ: "즈",
    で: "데",
    ど: "도",
    な: "나",
    に: "니",
    ぬ: "누",
    ね: "네",
    の: "노",
    は: "하",
    ひ: "히",
    ふ: "후",
    へ: "헤",
    ほ: "호",
    ば: "바",
    び: "비",
    ぶ: "부",
    べ: "베",
    ぼ: "보",
    ぱ: "파",
    ぴ: "피",
    ぷ: "푸",
    ぺ: "페",
    ぽ: "포",
    ま: "마",
    み: "미",
    む: "무",
    め: "메",
    も: "모",
    や: "야",
    ゆ: "유",
    よ: "요",
    ら: "라",
    り: "리",
    る: "루",
    れ: "레",
    ろ: "로",
    わ: "와",
    ゐ: "이",
    ゑ: "에",
    を: "오",
    ゔ: "부",
    ぁ: "아",
    ぃ: "이",
    ぅ: "우",
    ぇ: "에",
    ぉ: "오",
    ゃ: "야",
    ゅ: "유",
    ょ: "요",
    ゎ: "와",
  };
  const KANA_COMBO = {
    きゃ: "캬",
    きゅ: "큐",
    きょ: "쿄",
    ぎゃ: "갸",
    ぎゅ: "규",
    ぎょ: "교",
    しゃ: "샤",
    しゅ: "슈",
    しょ: "쇼",
    しぇ: "셰",
    じゃ: "쟈",
    じゅ: "쥬",
    じょ: "죠",
    じぇ: "제",
    ちゃ: "챠",
    ちゅ: "츄",
    ちょ: "쵸",
    ちぇ: "체",
    ぢゃ: "쟈",
    ぢゅ: "쥬",
    ぢょ: "죠",
    にゃ: "냐",
    にゅ: "뉴",
    にょ: "뇨",
    ひゃ: "햐",
    ひゅ: "휴",
    ひょ: "효",
    びゃ: "뱌",
    びゅ: "뷰",
    びょ: "뵤",
    ぴゃ: "퍄",
    ぴゅ: "퓨",
    ぴょ: "표",
    みゃ: "먀",
    みゅ: "뮤",
    みょ: "묘",
    りゃ: "랴",
    りゅ: "류",
    りょ: "료",
    ふぁ: "파",
    ふぃ: "피",
    ふぇ: "페",
    ふぉ: "포",
    ふゅ: "퓨",
    うぃ: "위",
    うぇ: "웨",
    うぉ: "워",
    いぇ: "예",
    ゔぁ: "바",
    ゔぃ: "비",
    ゔぇ: "베",
    ゔぉ: "보",
    ゔゅ: "뷰",
    てぃ: "티",
    てゅ: "튜",
    でぃ: "디",
    でゅ: "듀",
    とぅ: "투",
    どぅ: "두",
    つぁ: "차",
    つぃ: "치",
    つぇ: "체",
    つぉ: "초",
    くぁ: "콰",
    くぃ: "퀴",
    くぇ: "퀘",
    くぉ: "쿼",
    ぐぁ: "과",
  };
  const PUNCTUATION = {
    "、": ", ",
    "，": ", ",
    "。": ". ",
    "．": ". ",
    "！": "!",
    "？": "?",
    "・": " ",
    "　": " ",
    "「": "",
    "」": "",
    "『": "",
    "』": "",
    "（": "(",
    "）": ")",
    "～": "~",
    "〜": "~",
    "…": "…",
    "♪": "♪",
  };
  const KANJI = /[一-龯々〆ヶ]/;
  const isHiragana = (ch) => /[ぁ-ゖ]/.test(ch);
  const isKatakana = (ch) => /[ァ-ヺー]/.test(ch);
  const toHiragana = (ch) => {
    if (ch === "ヵ") return "か";
    if (ch === "ヶ") return "け";
    const code = ch.codePointAt(0);
    return code >= 0x30a1 && code <= 0x30f4 ? String.fromCodePoint(code - 0x60) : ch;
  };
  // 한글 모음 인덱스 → 로마자 모음 (장음 ー 처리용)
  const VOWEL_OF = [
    "a",
    "a",
    "a",
    "a",
    "e",
    "e",
    "e",
    "e",
    "o",
    "a",
    "a",
    "e",
    "o",
    "u",
    "o",
    "e",
    "i",
    "u",
    "u",
    "i",
    "i",
  ];
  const LONG = { a: "아", i: "이", u: "우", e: "에", o: "오" };
  const isBlock = (ch) => !!ch && ch >= "가" && ch <= "힣";
  const blockVowel = (ch) => VOWEL_OF[Math.floor(((ch.charCodeAt(0) - 0xac00) % 588) / 28)];
  const hasFinal = (ch) => (ch.charCodeAt(0) - 0xac00) % 28 !== 0;
  const withFinal = (ch, final) => String.fromCharCode(ch.charCodeAt(0) + final);

  /**
   * 후리가나 표기가 들어간 일본어 가사를 한글 발음으로 바꿉니다.
   * 반환: { text, blocks:[{char, base}] } — base는 각 한글 글자가 나온 원문 글자 위치(소수 가능)
   * 후리가나 없는 한자가 있으면 { error: "kanji", kanji: [...] }
   */
  function kanaToHangul(raw) {
    const parts = furiganaParts(raw),
      base = [...furiganaBase(raw)],
      units = [],
      missing = [];
    parts.forEach((part, partIndex) => {
      const length = [...part.text].length;
      if (part.reading) {
        const reading = [...part.reading],
          before = base[part.start - 1];
        reading.forEach((ch, k) =>
          units.push({
            ch: toHiragana(ch),
            base: part.start + (k / reading.length) * length,
            group: partIndex,
            kind: "kana",
            spaceBefore: k === 0 && !!before && (isHiragana(before) || isKatakana(before)),
          }),
        );
        return;
      }
      [...part.text].forEach((ch, k) => {
        const index = part.start + k,
          before = base[index - 1];
        if (KANJI.test(ch)) {
          missing.push(ch);
          return;
        }
        if (isHiragana(ch) || isKatakana(ch)) {
          const katakana = isKatakana(ch);
          units.push({
            ch: ch === "ー" ? "ー" : toHiragana(ch),
            base: index,
            group: partIndex,
            kind: "kana",
            // 가타카나 단어가 시작되면 띄어 씁니다.
            spaceBefore: katakana && !!before && !isKatakana(before) && !/\s/.test(before),
            // 줄 첫머리가 아닌 は·へ는 조사로 읽습니다(와·에).
            particle: !katakana && (ch === "は" || ch === "へ") && !!before && !/[\s、。！？!?「『（(・]/.test(before),
          });
          return;
        }
        units.push({ ch, base: index, group: partIndex, kind: "other" });
      });
    });
    if (missing.length) return { error: "kanji", kanji: [...new Set(missing)] };

    const out = [];
    const push = (char, at) => out.push({ char, base: at });
    const lastBlock = () => {
      for (let i = out.length - 1; i >= 0; i--) {
        if (isBlock(out[i].char)) return i;
        if (out[i].char.trim()) return -1;
      }
      return -1;
    };
    for (let i = 0; i < units.length; i++) {
      const u = units[i],
        next = units[i + 1],
        previous = units[i - 1];
      if (u.kind === "other") {
        const mapped = PUNCTUATION[u.ch];
        for (const ch of mapped !== undefined ? mapped : u.ch) push(ch, u.base);
        continue;
      }
      if (u.spaceBefore && out.length) push(" ", u.base);
      const last = lastBlock();
      if (u.ch === "っ" || u.ch === "ん") {
        const final = u.ch === "っ" ? 19 : 4; // ㅅ, ㄴ 받침
        if (last >= 0 && !hasFinal(out[last].char) && last === out.length - 1)
          out[last].char = withFinal(out[last].char, final);
        else if (u.ch === "ん") push("응", u.base);
        continue;
      }
      if (u.ch === "ー") {
        if (last >= 0) push(LONG[blockVowel(out[last].char)], u.base);
        continue;
      }
      const pair = next && next.kind === "kana" && next.group === u.group ? KANA_COMBO[u.ch + next.ch] : null;
      if (pair) {
        push(pair, u.base);
        i++;
        continue;
      }
      if (u.particle) {
        push(u.ch === "は" ? "와" : "에", u.base);
        continue;
      }
      // 같은 단어 안의 「오+う」는 길게 읽습니다 (どう→도오, とうきょう→토오쿄오).
      if (
        u.ch === "う" &&
        previous?.kind === "kana" &&
        previous.group === u.group &&
        last === out.length - 1 &&
        last >= 0 &&
        !hasFinal(out[last].char) &&
        blockVowel(out[last].char) === "o"
      ) {
        push("오", u.base);
        continue;
      }
      push(KANA[u.ch] || u.ch, u.base);
    }
    // 공백 정리: 연속 공백 하나로, 문장부호 앞 공백 제거, 앞뒤 공백 제거
    const cleaned = [];
    for (const item of out) {
      const space = item.char === " ";
      if (space && (!cleaned.length || cleaned[cleaned.length - 1].char === " ")) continue;
      if (/[,.!?)~…]/.test(item.char) && cleaned.length && cleaned[cleaned.length - 1].char === " ") cleaned.pop();
      cleaned.push(item);
    }
    while (cleaned.length && cleaned[cleaned.length - 1].char === " ") cleaned.pop();
    return { text: cleaned.map((item) => item.char).join(""), blocks: cleaned };
  }

  /**
   * 사용자가 고친 한글 발음도 자동 발음과 글자 단위로 맞춰(편집 거리 정렬) 원문 위치를 찾아 줍니다.
   * 반환: 발음 문자열의 각 글자(공백 제외)마다 원문 위치(base). auto가 없으면 글자 수 비례.
   */
  function alignReading(auto, reading, baseLength) {
    const chars = [...String(reading || "")].filter((ch) => ch.trim()),
      target = (auto?.blocks || []).filter((item) => item.char.trim());
    if (!chars.length) return [];
    if (!target.length) return chars.map((_, i) => (i / chars.length) * baseLength);
    const n = chars.length,
      m = target.length,
      cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    for (let i = 0; i <= n; i++) cost[i][0] = i;
    for (let j = 0; j <= m; j++) cost[0][j] = j;
    for (let i = 1; i <= n; i++)
      for (let j = 1; j <= m; j++)
        cost[i][j] = Math.min(
          cost[i - 1][j - 1] + (chars[i - 1] === target[j - 1].char ? 0 : 1),
          cost[i - 1][j] + 1,
          cost[i][j - 1] + 1,
        );
    const result = new Array(n).fill(null);
    for (let i = n, j = m; i > 0 && j > 0;) {
      if (cost[i][j] === cost[i - 1][j - 1] + (chars[i - 1] === target[j - 1].char ? 0 : 1)) {
        result[i - 1] = target[j - 1].base;
        i--;
        j--;
      } else if (cost[i][j] === cost[i - 1][j] + 1) i--;
      else j--;
    }
    // 짝이 없는 글자는 앞뒤 사이로 보간
    for (let i = 0; i < n; i++) {
      if (result[i] !== null) continue;
      let left = i - 1,
        right = i + 1;
      while (left >= 0 && result[left] === null) left--;
      while (right < n && result[right] === null) right++;
      const a = left >= 0 ? result[left] : 0,
        b = right < n ? result[right] : baseLength,
        span = right - left;
      result[i] = a + ((b - a) * (i - left)) / span;
    }
    for (let i = 1; i < n; i++) result[i] = Math.max(result[i], result[i - 1]);
    return result;
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
    kanaToHangul,
    alignReading,
  };
})();
