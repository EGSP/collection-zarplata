---
covers:
  - package.json
---

# Стек

Справочник технологий основного приложения. Точные версии npm-пакетов закреплены в [package.json](../package.json). В таблице числа обозначают основные версии библиотек, а TypeScript 7 — версию языка и компилятора.

| Область | Технологии и назначение |
|---|---|
| Исполнение | Node.js запускает сервер и служебные скрипты |
| Язык | TypeScript 7; общие строгие настройки находятся в [tsconfig.base.json](../tsconfig.base.json) |
| База данных | Встраиваемая Turso (`@tursodatabase/database`); путь к файлу задаётся настройками, для ручной проверки используется база в памяти |
| Сервер | NestJS 12 отвечает за маршрутизацию, контроллеры и внедрение зависимостей; HTTP-сервер — Fastify 5 |
| Бизнес-логика и валидация | Effect 4 (сейчас `4.0.0-rc.118`); данные на сервере проверяет Effect Schema |
| Интерфейс | React 19 и Ant Design 6; Refine (`@refinedev/core` 5) связывает ресурсы с операциями над данными, `@refinedev/react-router` 2 подключает React Router 7 |
| Данные и состояние клиента | TanStack Query: запросы и кеш; TanStack Store: состояние; axios: HTTP-запросы; TanStack Hotkeys: сочетания клавиш |
| Граф модулей | React Flow (`@xyflow/react` 12) рисует холст, dagre (`@dagrejs/dagre` 3) раскладывает узлы по слоям; нужны только странице [графа модулей](development-tools.md#граф-модулей-сервера) |
| Сборка клиента | Vite 8 |
| Документация | Markdown в `docs`, сайт собирает VitePress 1, схемы рисует Mermaid 11 |
| Проверка кода | `effect-tsgo` из `@effect/tsgo` проверяет типы и диагностики Effect Language Service; установка подготавливает для этого команду `tsc` |
| Пакеты | npm; зависимости приложения и команды сборки описаны в одном `package.json` |
| Поставка | Один исполняемый файл для Windows x64 на Node.js SEA, esbuild и postject; внутри клиент, документация и нативный модуль Turso |

Подробнее: хранение данных — в разделе [«База данных»](database.md), клиентские компоненты — в [«Интерфейсе»](interface.md), команды разработки и поставки — в [«Сборке и запуске»](build-and-launch.md). Исполняемый файл упаковывает [скрипт сборки](https://github.com/EGSP/collection-zarplata/blob/main/scripts/build-executable.mjs).

## Инструмент импорта XML из 1С

Утилита [tools/1c-xml-import](https://github.com/EGSP/collection-zarplata/blob/main/tools/1c-xml-import/README.md) написана на Go и загружает выгрузку 1С через API приложения. Стандартная библиотека разбирает XML и работает с HTTP, `golang.org/x/term` скрывает ввод PIN. Версия Go `1.27.0` и зависимости закреплены в [go.mod](https://github.com/EGSP/collection-zarplata/blob/main/tools/1c-xml-import/go.mod).

Go нужен только для сборки утилиты. Основное приложение собирается без него, готовая утилита запускается без установленного Go. У неё собственный модуль, она собирается отдельно от npm-проекта; порядок сборки и использования описан в её руководстве.
