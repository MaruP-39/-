// 파형(웨이브폼) 타임라인: 소리 모양, 가사 줄 구간, 음절 경계를 그리고 마우스로 수정합니다.
// 화면 상태는 host(app.js)가 가지고 있고, 이 모듈은 그리기와 입력 처리만 합니다.
(function () {
  "use strict";

  const DECODE_RATE = 8000; // 파형 표시용으로 충분한 샘플레이트 (메모리 절약)
  const PEAK_RATE = 100; // 미리 계산하는 요약 파형: 초당 100칸
  const MAX_FILE_BYTES = 1.5 * 1024 ** 3;
  const RULER = 20,
    LABEL_BAND = 22,
    SYLLABLE_BAND = 18,
    HIT_PX = 7;
  const COLORS = {
    background: "#0b1220",
    grid: "#1c2a3f",
    gridText: "#6f819c",
    wave: "#5b7fb0",
    waveSelected: "#9cc3ff",
    rows: ["rgba(59,130,246,", "rgba(168,85,247,"],
    edge: "#cfe1ff",
    playhead: "#ffcf4a",
    syllable: "#ffd98a",
  };

  /**
   * 소리가 갑자기 커지는 지점(onset)을 찾습니다. 10ms 단위 로그 에너지의 상승량에서
   * 주변 평균보다 확실히 큰 봉우리만 고르고, 서로 0.12초 이상 떨어지게 합니다.
   */
  function detectOnsets(samples, rate) {
    const hop = Math.max(1, Math.round(rate * 0.01)),
      frames = Math.floor(samples.length / hop),
      energy = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let i = f * hop, end = i + hop; i < end; i++) sum += samples[i] * samples[i];
      energy[f] = Math.log10(Math.sqrt(sum / hop) + 1e-4);
    }
    const rise = new Float32Array(frames);
    for (let f = 3; f < frames; f++)
      rise[f] = Math.max(0, energy[f] - (energy[f - 1] + energy[f - 2] + energy[f - 3]) / 3);
    const onsets = [],
      half = 50; // 주변 ±0.5초 평균
    let windowSum = 0,
      last = -Infinity;
    for (let f = 0; f < Math.min(frames, half); f++) windowSum += rise[f];
    for (let f = 0; f < frames; f++) {
      if (f + half < frames) windowSum += rise[f + half];
      if (f - half - 1 >= 0) windowSum -= rise[f - half - 1];
      const count = Math.min(frames - 1, f + half) - Math.max(0, f - half) + 1,
        threshold = (windowSum / count) * 2 + 0.08,
        value = rise[f];
      if (value < threshold) continue;
      let peak = true;
      for (let k = Math.max(0, f - 3); k <= Math.min(frames - 1, f + 3); k++) if (rise[k] > value) peak = false;
      if (!peak || f - last < 12) continue;
      onsets.push((f * hop) / rate);
      last = f;
    }
    return onsets;
  }

  function formatTime(t, step) {
    const sign = t < 0 ? "-" : "";
    t = Math.abs(t);
    const m = Math.floor(t / 60),
      s = t - m * 60,
      decimals = step < 1 ? 1 : 0;
    return `${sign}${m}:${s.toFixed(decimals).padStart(decimals ? 4 : 2, "0")}`;
  }

  class WaveformView {
    constructor(canvas, host) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.host = host;
      this.samples = null;
      this.peaks = null;
      this.onsets = [];
      this.snap = true;
      this.snapped = null;
      this.scale = 1;
      this.viewStart = 0;
      this.viewSpan = 12;
      this.hits = [];
      this.pointer = null;
      this.frame = 0;
      this.loadToken = 0;
      new ResizeObserver(() => this.render()).observe(canvas);
      canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
      canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
      canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
      canvas.addEventListener("pointercancel", (e) => this.onPointerUp(e, true));
      canvas.addEventListener("pointerleave", () => {
        if (!this.pointer) canvas.style.cursor = "";
      });
      canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
      canvas.addEventListener("keydown", (e) => this.onKeyDown(e));
    }

    get hasAudio() {
      return !!this.samples;
    }

    clear() {
      this.loadToken++;
      this.samples = null;
      this.peaks = null;
      this.onsets = [];
      this.render();
    }

    /** 영상·음악 파일에서 소리를 읽어 파형 데이터를 만듭니다. */
    async loadFile(file) {
      const token = ++this.loadToken;
      this.samples = null;
      this.peaks = null;
      this.onsets = [];
      this.render();
      if (file.size > MAX_FILE_BYTES) throw Error("파일이 너무 커서 파형을 만들지 않았습니다. (1.5GB 초과)");
      const buffer = await file.arrayBuffer();
      if (token !== this.loadToken) return false;
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Offline) throw Error("이 브라우저는 소리 분석을 지원하지 않습니다.");
      const decoded = await new Offline(1, 1, DECODE_RATE).decodeAudioData(buffer);
      if (token !== this.loadToken) return false;
      const length = decoded.length,
        mono = new Float32Array(length);
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const data = decoded.getChannelData(c);
        for (let i = 0; i < length; i++) mono[i] += data[i] / decoded.numberOfChannels;
      }
      const step = decoded.sampleRate / PEAK_RATE,
        columns = Math.ceil(length / step),
        peaks = new Float32Array(columns * 2);
      let loudest = 0;
      for (let col = 0; col < columns; col++) {
        let min = 0,
          max = 0;
        const from = Math.floor(col * step),
          to = Math.min(length, Math.floor((col + 1) * step));
        for (let i = from; i < to; i++) {
          const v = mono[i];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        peaks[col * 2] = min;
        peaks[col * 2 + 1] = max;
        loudest = Math.max(loudest, -min, max);
      }
      this.sampleRate = decoded.sampleRate;
      this.samples = mono;
      this.peaks = peaks;
      this.scale = loudest > 0.001 ? Math.min(8, 0.95 / loudest) : 1;
      this.onsets = detectOnsets(mono, decoded.sampleRate);
      this.render();
      return true;
    }

    // ---- 좌표 변환 ----
    get width() {
      return this.canvas.clientWidth || 1;
    }
    get pxPerSec() {
      return this.width / this.viewSpan;
    }
    timeToX(t) {
      return (t - this.viewStart) * this.pxPerSec;
    }
    xToTime(x) {
      return this.viewStart + x / this.pxPerSec;
    }
    maxStart() {
      return Math.max(0, this.host.getDuration() - this.viewSpan * 0.5);
    }
    setViewStart(t) {
      this.viewStart = Math.max(0, Math.min(this.maxStart(), t));
      this.render();
    }

    /** 확대/축소. anchorTime 위치를 화면에서 고정합니다. */
    zoom(factor, anchorTime) {
      const duration = Math.max(10, this.host.getDuration()),
        anchor = Number.isFinite(anchorTime) ? anchorTime : this.viewStart + this.viewSpan / 2,
        ratio = (anchor - this.viewStart) / this.viewSpan,
        span = Math.max(0.8, Math.min(duration * 1.05, this.viewSpan * factor));
      this.viewSpan = span;
      this.setViewStart(anchor - ratio * span);
    }

    /** 재생 위치가 화면 밖으로 나가면 따라갑니다. */
    follow(time) {
      if (time < this.viewStart || time > this.viewStart + this.viewSpan * 0.88) {
        this.viewStart = Math.max(0, Math.min(this.maxStart(), time - this.viewSpan * 0.2));
      }
      this.render();
    }

    /** 구간이 보이도록 이동합니다. */
    reveal(start, end) {
      if (!Number.isFinite(start)) return;
      const stop = Number.isFinite(end) && end > start ? end : start;
      if (start < this.viewStart || stop > this.viewStart + this.viewSpan) {
        const middle = (start + stop) / 2;
        if (stop - start > this.viewSpan * 0.9) this.viewSpan = Math.min(120, (stop - start) * 1.4);
        this.viewStart = Math.max(0, Math.min(this.maxStart(), middle - this.viewSpan / 2));
      }
      this.render();
    }

    render() {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
    }

    // ---- 그리기 ----
    draw() {
      const canvas = this.canvas,
        ctx = this.ctx,
        dpr = window.devicePixelRatio || 1,
        w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, w, h);
      this.hits = [];
      const waveTop = RULER + LABEL_BAND,
        waveBottom = h - SYLLABLE_BAND,
        cues = this.host.getCues(),
        selected = cues.find((c) => c.selected);
      this.drawRuler(ctx, w, h);
      this.drawOnsets(ctx, w);
      for (const cue of cues) this.drawCue(ctx, cue, h);
      this.drawWave(ctx, w, waveTop, waveBottom, selected);
      for (const cue of cues) this.drawEdges(ctx, cue, h);
      if (selected?.syllables) this.drawSyllables(ctx, selected, waveTop, h);
      const x = this.timeToX(this.host.getTime());
      if (x >= -2 && x <= w + 2) {
        ctx.fillStyle = COLORS.playhead;
        ctx.fillRect(Math.round(x) - 1, 0, 2, h);
        ctx.beginPath();
        ctx.moveTo(x - 6, 0);
        ctx.lineTo(x + 6, 0);
        ctx.lineTo(x, 8);
        ctx.fill();
      }
      if (!this.samples) {
        ctx.fillStyle = COLORS.gridText;
        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          this.host.emptyMessage?.() || "영상·음악을 불러오면 파형이 표시됩니다",
          w / 2,
          (waveTop + waveBottom) / 2 + 4,
        );
      }
    }

    /** 소리 시작점: 눈금 아래 작은 삼각형. 끌어서 붙은 지점은 밝게 */
    drawOnsets(ctx, w) {
      if (!this.onsets?.length || this.pxPerSec < 15) return;
      const from = this.viewStart,
        to = this.viewStart + this.viewSpan;
      for (const t of this.onsets) {
        if (t < from || t > to) continue;
        const x = this.timeToX(t),
          hot = this.snapped !== null && Math.abs(this.snapped - t) < 1e-6;
        ctx.fillStyle = hot ? COLORS.playhead : "rgba(255,207,74,.55)";
        ctx.beginPath();
        ctx.moveTo(x - 3.5, RULER - 7);
        ctx.lineTo(x + 3.5, RULER - 7);
        ctx.lineTo(x, RULER - 1);
        ctx.fill();
      }
    }

    /** 끌고 있는 시각 근처(화면에서 8px 안)에 소리 시작점이 있으면 그 시각으로 붙입니다. */
    snapTime(t, event) {
      this.snapped = null;
      if (!this.snap || event.altKey || !this.onsets?.length) return t;
      const limit = 8 / this.pxPerSec;
      let best = null;
      for (const onset of this.onsets) {
        const distance = Math.abs(onset - t);
        if (distance <= limit && (best === null || distance < Math.abs(best - t))) best = onset;
      }
      if (best === null) return t;
      this.snapped = best;
      return best;
    }

    drawRuler(ctx, w, h) {
      const pps = this.pxPerSec,
        steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120],
        step = steps.find((s) => s * pps >= 70) || 300,
        first = Math.floor(this.viewStart / step) * step;
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "left";
      for (let t = first; t <= this.viewStart + this.viewSpan; t += step) {
        const x = Math.round(this.timeToX(t)) + 0.5;
        ctx.fillStyle = COLORS.grid;
        ctx.fillRect(x, RULER - 6, 1, h);
        ctx.fillStyle = COLORS.gridText;
        if (t >= 0) ctx.fillText(formatTime(t, step), x + 4, 13);
      }
      ctx.fillStyle = COLORS.grid;
      ctx.fillRect(0, RULER - 0.5, w, 1);
    }

    drawCue(ctx, cue, h) {
      const x1 = this.timeToX(cue.start),
        x2 = this.timeToX(cue.end),
        w = this.width;
      if (x2 < 0 || x1 > w) return;
      const color = COLORS.rows[cue.row ? 1 : 0];
      ctx.fillStyle = color + (cue.selected ? "0.30)" : "0.13)");
      ctx.fillRect(x1, RULER, x2 - x1, h - RULER);
      ctx.fillStyle = color + (cue.selected ? "0.95)" : "0.55)");
      ctx.fillRect(x1, RULER, x2 - x1, LABEL_BAND);
      if (x2 - x1 > 18) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x1 + 2, RULER, x2 - x1 - 4, LABEL_BAND);
        ctx.clip();
        ctx.fillStyle = "#fff";
        ctx.font = `${cue.selected ? "600 " : ""}12px system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText(cue.label, Math.max(x1, 0) + 5, RULER + 15);
        ctx.restore();
      }
    }

    drawEdges(ctx, cue, h) {
      const w = this.width;
      for (const edge of ["start", "end"]) {
        const x = this.timeToX(cue[edge]);
        if (x < -HIT_PX || x > w + HIT_PX) continue;
        ctx.fillStyle = cue.selected ? COLORS.edge : "rgba(207,225,255,.45)";
        ctx.fillRect(Math.round(x) - (edge === "end" ? 1 : 0), RULER, cue.selected ? 2 : 1, h - RULER);
        this.hits.push({ kind: "edge", index: cue.index, edge, x, selected: cue.selected });
      }
    }

    drawSyllables(ctx, cue, top, h) {
      const w = this.width;
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      cue.syllables.forEach((syllable, i) => {
        const x1 = this.timeToX(syllable.start),
          x2 = this.timeToX(syllable.end);
        if (x2 < 0 || x1 > w) return;
        if (i > 0) {
          ctx.strokeStyle = COLORS.syllable;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.round(x1) + 0.5, top);
          ctx.lineTo(Math.round(x1) + 0.5, h);
          ctx.stroke();
          ctx.setLineDash([]);
          this.hits.push({ kind: "syllable", index: cue.index, boundary: i, x: x1, selected: true });
        }
        if (x2 - x1 > 8) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x1, h - SYLLABLE_BAND, x2 - x1, SYLLABLE_BAND);
          ctx.clip();
          ctx.fillStyle = syllable.active ? COLORS.playhead : COLORS.syllable;
          ctx.fillText(syllable.text.trim() || "·", (x1 + x2) / 2, h - 5);
          ctx.restore();
        }
      });
    }

    drawWave(ctx, w, top, bottom, selected) {
      if (!this.samples) return;
      const mid = (top + bottom) / 2,
        half = (bottom - top) / 2,
        pps = this.pxPerSec,
        usePeaks = pps <= PEAK_RATE,
        source = usePeaks ? this.peaks : this.samples,
        rate = usePeaks ? PEAK_RATE : this.sampleRate,
        count = usePeaks ? this.peaks.length / 2 : this.samples.length,
        selStart = selected ? this.timeToX(selected.start) : -1,
        selEnd = selected ? this.timeToX(selected.end) : -1;
      for (let x = 0; x < w; x++) {
        const t0 = this.xToTime(x),
          t1 = this.xToTime(x + 1);
        let from = Math.floor(t0 * rate),
          to = Math.max(from + 1, Math.ceil(t1 * rate));
        if (to <= 0 || from >= count) continue;
        from = Math.max(0, from);
        to = Math.min(count, to);
        let min = 0,
          max = 0;
        for (let i = from; i < to; i++) {
          const a = usePeaks ? source[i * 2] : source[i],
            b = usePeaks ? source[i * 2 + 1] : source[i];
          if (a < min) min = a;
          if (b > max) max = b;
        }
        const y1 = mid - Math.min(1, max * this.scale) * half,
          y2 = mid - Math.max(-1, min * this.scale) * half;
        ctx.fillStyle = x >= selStart && x <= selEnd ? COLORS.waveSelected : COLORS.wave;
        ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
      }
    }

    // ---- 입력 ----
    localX(event) {
      return event.clientX - this.canvas.getBoundingClientRect().left;
    }

    hitTest(x) {
      let best = null;
      for (const hit of this.hits) {
        const distance = Math.abs(hit.x - x);
        // 선택한 줄과 음절 경계를 우선합니다.
        const score = distance - (hit.selected ? 2 : 0) - (hit.kind === "syllable" ? 1 : 0);
        if (distance <= HIT_PX && (!best || score < best.score)) best = { ...hit, score };
      }
      return best;
    }

    onPointerDown(event) {
      if (event.button !== 0) return;
      this.canvas.focus({ preventScroll: true });
      const x = this.localX(event),
        hit = this.hitTest(x);
      this.canvas.setPointerCapture(event.pointerId);
      this.pointer = {
        id: event.pointerId,
        startX: x,
        lastX: x,
        viewStart: this.viewStart,
        hit,
        moved: false,
        editing: false,
      };
      event.preventDefault();
    }

    onPointerMove(event) {
      const x = this.localX(event),
        p = this.pointer;
      if (!p) {
        const hit = this.hitTest(x);
        this.canvas.style.cursor = hit ? "ew-resize" : "pointer";
        return;
      }
      if (Math.abs(x - p.startX) > 3) p.moved = true;
      if (!p.moved) return;
      if (p.hit) {
        if (!p.editing) {
          p.editing = true;
          this.host.beginEdit(p.hit);
        }
        const t = Math.max(0, this.snapTime(this.xToTime(x), event));
        if (p.hit.kind === "edge") this.host.dragCueEdge(p.hit.index, p.hit.edge, t);
        else this.host.dragSyllable(p.hit.index, p.hit.boundary, t);
        // 가장자리에 가까우면 자동 스크롤
        if (x < 20) this.setViewStart(this.viewStart - this.viewSpan * 0.02);
        if (x > this.width - 20) this.setViewStart(this.viewStart + this.viewSpan * 0.02);
      } else {
        this.canvas.style.cursor = "grabbing";
        this.setViewStart(p.viewStart - (x - p.startX) / this.pxPerSec);
      }
      this.render();
    }

    onPointerUp(event, cancelled = false) {
      const p = this.pointer;
      if (!p || p.id !== event.pointerId) return;
      this.pointer = null;
      this.canvas.style.cursor = "";
      if (p.editing) {
        this.snapped = null;
        this.host.endEdit(cancelled);
        return;
      }
      if (!p.moved && !cancelled) {
        const x = this.localX(event),
          t = Math.max(0, this.xToTime(x)),
          cue = this.host
            .getCues()
            .filter((c) => t >= c.start && t < c.end)
            .sort((a, b) => (b.selected ? 1 : 0) - (a.selected ? 1 : 0))[0];
        if (event.offsetY <= RULER + LABEL_BAND && event.offsetY >= RULER && cue)
          this.host.select(cue.index, cue.start);
        else this.host.seek(t, cue?.index ?? -1);
      }
    }

    onWheel(event) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        this.zoom(Math.exp(event.deltaY * 0.002), this.xToTime(this.localX(event)));
        return;
      }
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY,
        pixels = event.deltaMode === 1 ? delta * 16 : delta;
      this.setViewStart(this.viewStart + pixels / this.pxPerSec);
    }

    onKeyDown(event) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        this.setViewStart(this.viewStart + (event.key === "ArrowLeft" ? -1 : 1) * this.viewSpan * 0.25);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        this.zoom(0.7);
      } else if (event.key === "-") {
        event.preventDefault();
        this.zoom(1 / 0.7);
      }
    }
  }

  window.WaveformView = WaveformView;
})();
