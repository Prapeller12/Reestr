import { defineConfig } from 'vitest/config';

// Юнит-тесты чистых функций (QA-3, F3). Отдельно от vite.config.ts: продакшн-сборка от vitest
// не зависит, react-плагин и порт 1420 в тестах не участвуют. Тесты в exe не попадают —
// граф vite build начинается с main.tsx.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
