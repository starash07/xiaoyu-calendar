// 保留原有轻弹展开；关闭沿同一空间路径连续加速收拢。
(function (root) {
  const COLLAPSED = 'translate(0px, 12px) scale(.001, .001)';
  const CLOSE_COLLAPSED = 'translate(0px, 12px) scale(.03, .03)';
  const EXPANDED = 'translate(0px, 0px) scale(1, 1)';
  const OPEN_TIMING = { duration: 280, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' };
  const CLOSE_TIMING = { duration: 180, easing: 'cubic-bezier(.42, 0, 1, 1)', fill: 'both' };

  root.RCPopupMotion = class {
    constructor(element, {
      openDuration = OPEN_TIMING.duration,
      openEasing = OPEN_TIMING.easing,
      openFrom = COLLAPSED,
      openPeak = 'translate(0px, -1px) scale(1.005, 1.005)',
      openPeakOffset = .72,
      backdrop = null,
      backdropColor = 'rgba(0, 0, 0, 0)',
    } = {}) {
      this.element = element;
      this.openTiming = { ...OPEN_TIMING, duration: openDuration, easing: openEasing };
      this.openFrom = openFrom;
      this.openPeak = openPeak;
      this.openPeakOffset = openPeakOffset;
      this.backdrop = backdrop;
      this.backdropColor = backdropColor;
      this.backdropAnimation = null;
      this.animation = null;
      this.opening = null;
    }

    currentTransform() {
      const value = getComputedStyle(this.element).transform;
      if (value === 'none') return EXPANDED;
      const matrix = new DOMMatrix(value);
      // 此动效只使用位移和缩放；将计算样式还原为相同函数序列，并避开零缩放。
      return `translate(${matrix.e}px, ${matrix.f}px) scale(${Math.max(.001, matrix.a)}, ${Math.max(.001, matrix.d)})`;
    }

    open() {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.cancel();
        return Promise.resolve(true);
      }
      if (this.animation && this.opening) return this.finished();
      const from = this.animation ? this.currentTransform() : this.openFrom;
      const backdropFrom = this.backdropAnimation
        ? getComputedStyle(this.backdrop).backgroundColor : 'rgba(28, 28, 32, 0)';
      this.cancel();
      this.opening = true;
      this.animation = this.element.animate([
        { transform: from },
        { transform: this.openPeak, offset: this.openPeakOffset },
        { transform: EXPANDED },
      ], this.openTiming);
      if (this.backdrop) {
        this.backdropAnimation = this.backdrop.animate([
          { backgroundColor: backdropFrom },
          { backgroundColor: this.backdropColor },
        ], this.openTiming);
      }
      return this.finished();
    }

    close() {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.cancel();
        return Promise.resolve(true);
      }
      if (this.animation && !this.opening) return this.finished();
      const from = this.currentTransform();
      const backdropFrom = this.backdrop ? getComputedStyle(this.backdrop).backgroundColor : null;
      this.cancel();
      this.opening = false;
      this.animation = this.element.animate([
        { transform: from, transformOrigin: 'center center', opacity: 1 },
        { transform: CLOSE_COLLAPSED, transformOrigin: 'center center', opacity: 1 },
      ], CLOSE_TIMING);
      if (this.backdrop) {
        this.backdropAnimation = this.backdrop.animate([
          { backgroundColor: backdropFrom },
          { backgroundColor: 'rgba(28, 28, 32, 0)' },
        ], CLOSE_TIMING);
      }
      return this.finished();
    }

    finished() {
      const animations = [this.animation, this.backdropAnimation].filter(Boolean);
      return Promise.all(animations.map(animation => animation.finished)).then(() => true, () => false);
    }

    cancel() {
      this.animation?.cancel();
      this.backdropAnimation?.cancel();
      this.animation = null;
      this.backdropAnimation = null;
      this.opening = null;
    }
  };
})(window);
