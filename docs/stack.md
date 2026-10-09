---
covers:
  - package.json
---

# Стек

| Слой | Технологии |
|---|---|
| База данных | Turso (встраиваемая, файл рядом с приложением) |
| Язык | TypeScript 7 |
| Бэкенд | NestJS 12 на Fastify, Effect 4 в бизнес-логике |
| Валидация | Effect Schema на сервере |
| Фронтенд | React 19, Refine (`@refinedev/core`, `@refinedev/react-router` с React Router 7), Ant Design 6, TanStack Query, TanStack Store, TanStack Hotkeys, axios, сборка Vite |
| Документация | Markdown в каталоге `docs`, сайт собирает VitePress, схемы рисует Mermaid |
| Проверка кода | `effect-tsgo` (`@effect/tsgo`): проверка типов TypeScript 7 и диагностики Effect Language Service |
| Пакеты | npm, один `package.json` |
| Поставка | один исполняемый файл |
