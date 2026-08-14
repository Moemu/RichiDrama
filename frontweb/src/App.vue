<template>
  <div class="app">
    <router-view />
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}
html, body, #app, .app {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-page);
  color: var(--text-primary);
}
.richi-brand-mark {
  display: inline-block;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  overflow: hidden;
  border-radius: 9px;
}
.richi-brand-mark img {
  display: block;
  width: 34px;
  height: auto;
}
.logo:has(.richi-brand-mark) {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding-left: 0 !important;
}
.logo:has(.richi-brand-mark)::before {
  display: none !important;
}
.richi-brand-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
</style>
