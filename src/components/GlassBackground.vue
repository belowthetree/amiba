<!-- ============================================================
变形虫 (Amiba) — GlassBackground (玻璃辉光背景)
玉石质感：玉色辉光 + 缓慢划过的流光，全局复用
============================================================ -->
<template>
  <div class="glass-bg" aria-hidden="true">
    <div class="gb-glow gb-glow-1"></div>
    <div class="gb-glow gb-glow-2"></div>
    <div class="gb-glow gb-glow-3"></div>
    <div class="gb-streak gb-streak-1"></div>
    <div class="gb-streak gb-streak-2"></div>
  </div>
</template>

<script setup lang="ts">
// 纯展示组件：颜色取自 CSS 变量体系，随主题自动适配
</script>

<style scoped>
.glass-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background: var(--color-bg);
}

/* ==== 玉色辉光（模糊色团，缓慢漂移） ==== */
.gb-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  will-change: transform;
}

.gb-glow-1 {
  width: 58vmax;
  height: 58vmax;
  top: -18vmax;
  left: -14vmax;
  background: radial-gradient(circle, rgba(140, 222, 194, 0.38) 0%, rgba(140, 222, 194, 0) 68%);
  animation: gb-drift-1 26s ease-in-out infinite alternate;
}

.gb-glow-2 {
  width: 52vmax;
  height: 52vmax;
  right: -16vmax;
  bottom: -18vmax;
  background: radial-gradient(circle, rgba(116, 196, 216, 0.30) 0%, rgba(116, 196, 216, 0) 68%);
  animation: gb-drift-2 32s ease-in-out infinite alternate;
}

.gb-glow-3 {
  width: 34vmax;
  height: 34vmax;
  top: 32%;
  left: 46%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0) 70%);
  animation: gb-drift-3 22s ease-in-out infinite alternate;
}

/* ==== 流光（对角光带，隐约划过） ==== */
.gb-streak {
  position: absolute;
  left: -25%;
  width: 150%;
  height: 130px;
  transform: rotate(-16deg) translate3d(-38vw, 0, 0);
  filter: blur(22px);
  opacity: 0;
  will-change: transform, opacity;
}

.gb-streak-1 {
  top: 16%;
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.42) 42%,
    rgba(255, 255, 255, 0.55) 50%,
    rgba(255, 255, 255, 0.42) 58%,
    transparent 100%);
  animation: gb-sweep 17s linear infinite;
}

.gb-streak-2 {
  top: 58%;
  height: 90px;
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(178, 236, 214, 0.30) 40%,
    rgba(210, 245, 232, 0.42) 50%,
    rgba(178, 236, 214, 0.30) 60%,
    transparent 100%);
  animation: gb-sweep 23s linear infinite;
  animation-delay: -11s;
}

/* ==== 动画 ==== */
@keyframes gb-sweep {
  0%   { transform: rotate(-16deg) translate3d(-38vw, 0, 0); opacity: 0; }
  12%  { opacity: 1; }
  50%  { opacity: 1; }
  88%  { opacity: 0; }
  100% { transform: rotate(-16deg) translate3d(38vw, 0, 0); opacity: 0; }
}

@keyframes gb-drift-1 {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to   { transform: translate3d(6vw, 4vh, 0) scale(1.08); }
}

@keyframes gb-drift-2 {
  from { transform: translate3d(0, 0, 0) scale(1.05); }
  to   { transform: translate3d(-5vw, -5vh, 0) scale(0.96); }
}

@keyframes gb-drift-3 {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(-6vw, 5vh, 0); }
}

/* ==== 深色主题：辉光收敛、流光改发光混合 ==== */
:root[data-theme='dark'] .gb-glow-1 { opacity: 0.5; }
:root[data-theme='dark'] .gb-glow-2 { opacity: 0.45; }
:root[data-theme='dark'] .gb-glow-3 { opacity: 0.25; }
:root[data-theme='dark'] .gb-streak { mix-blend-mode: screen; }

/* ==== 减少动态偏好 ==== */
@media (prefers-reduced-motion: reduce) {
  .gb-glow,
  .gb-streak {
    animation: none;
  }
  .gb-streak {
    opacity: 0.25;
    transform: rotate(-16deg);
  }
}
</style>
