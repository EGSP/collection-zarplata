import { Effect } from 'effect';
import { RightsGuardPlatform } from '../authorization/rights-guard.platform.js';
import { platformRights } from '../authorization/rights.js';
import { newGuid } from '../common/guid.js';
import { DataNotFoundError } from '../data/data.errors.js';
import { guidValue, objectValue } from '../data/records.js';
import { writeJournal } from '../journal/journal.js';
import type { BackupService } from './backup.service.js';
import { saveBackupSettings } from './backup-settings.js';

/** Цель единого эндпоинта для резервных копий. */
export const backupsTarget = { kind: 'platform', name: 'backups' } as const;

/**
 * Действия резервного копирования единого эндпоинта: `list` читает состояние, `create` начинает
 * копию, `cancel` прерывает её по `id`, `saveSettings` меняет расписание и число копий.
 * Создание и отмена записываются в журнал до запуска:
 * если копию начать нельзя, транзакция запроса откатывает и запись журнала.
 */
export const backupAction = Effect.fn('backups.action')(function* (
    action: string, payload: unknown, userGuid: string | null, guard: RightsGuardPlatform, backups: BackupService,
) {
    if (!['list', 'create', 'cancel', 'saveSettings'].includes(action)) return yield* new DataNotFoundError({ message: `Действие «${action}» для резервных копий не найдено` });
    yield* guard.require(userGuid, action === 'list' ? platformRights.backups.read : platformRights.backups.write);
    if (action === 'list') {
        const rights = yield* guard.rightsOf(userGuid);
        return yield* backups.overview(rights.allows(platformRights.backups.write));
    }
    // Настройки и журнал меняются в общей транзакции запроса, без изменения файла с секретом PIN.
    if (action === 'saveSettings') return yield* saveBackupSettings(payload, backups.initialSettings);
    const occurredAt = new Date().toISOString();
    if (action === 'create') {
        const id = newGuid();
        yield* writeJournal({ occurredAt, target: { ...backupsTarget, guid: id }, action: 'create', changes: null });
        return yield* backups.start('manual', id);
    }
    const id = guidValue(objectValue(payload, 'payload')['id'], 'id');
    yield* writeJournal({ occurredAt, target: { ...backupsTarget, guid: id }, action: 'cancel', changes: null });
    yield* backups.cancel(id);
    return {};
});
