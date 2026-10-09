# Инструменты разработки

- **Проверка кода.** После изменений код проверяется командой `effect-tsgo` из пакета `@effect/tsgo`. Она выполняет проверку типов TypeScript 7 и выдаёт диагностики Effect Language Service. Плагин `@effect/language-service` подключён в `tsconfig.json`.
- **Исходники Effect в репозитории.** Репозиторий Effect подключён через `git subtree` в `repos/effect` и служит справочником по API и примерам. Код из `repos/` не импортируется и не редактируется. Обновление:

  ```bash
  git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git main --squash
  ```
