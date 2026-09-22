// Локальные декларации модулей ассетов для Vite (офлайн, без vite/client).
// SVG-импорт возвращает строковый URL, который Vite вкомпилирует в бинарь.
declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}
