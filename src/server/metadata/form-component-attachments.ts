/**
 * Подключения компонентов применяются до проверки форм. Исходные билдеры не меняются,
 * поэтому повторная сборка не накапливает вставки. Клиент получает готовую раскладку.
 */
import type { ObjectState } from './builders.js';
import type { FormOverride } from './descriptions.js';
import type { FormComponentDefinition } from './form-elements.js';
import type { MetadataProblem } from './metadata.errors.js';

/** Проверяет цели подключений, в том числе объекты без формы. */
export function checkFormComponentTargets(states: ReadonlyArray<ObjectState>, definitions: ReadonlyArray<FormComponentDefinition>, problems: Array<MetadataProblem>): void {
    for (const definition of definitions) {
        for (const attachment of definition.attachments) {
            const target = attachment.override?.object ?? attachment.insert?.object;
            if (target === undefined || (attachment.override !== undefined && attachment.insert !== undefined)) {
                problems.push({ object: definition.name, location: 'подключение', message: 'требуется ровно одно подключение: override либо insert' });
                continue;
            }
            const state = states.find((candidate) => candidate.kind === target.kind && candidate.name === target.name);
            if (state === undefined || (state.kind !== 'catalog' && state.kind !== 'document')) {
                problems.push({ object: definition.name, location: 'подключение', message: `у объекта ${target.kind} ${target.name} нет формы` });
            }
        }
    }
}

/** Добавляет подключения к копии раскладки объекта; ошибки мест записывает в problems. */
export function applyFormComponents(state: ObjectState, definitions: ReadonlyArray<FormComponentDefinition>, problems: Array<MetadataProblem>): ObjectState {
    const overrides: FormOverride[] = [...(state.form ?? [])];
    // Вставки после одного поля идут в порядке реестра, а не в обратном порядке splice.
    const insertedAfter = new Map<string, number>();
    for (const definition of definitions) {
        for (const attachment of definition.attachments) {
            const target = attachment.override?.object ?? attachment.insert?.object;
            if (target?.kind !== state.kind || target.name !== state.name) continue;
            const addProblem = (message: string) => problems.push({ object: `${state.kind} ${state.name}`, location: `компонент «${definition.name}»`, message });
            if (attachment.override !== undefined) {
                const binding = attachment.override;
                const field = binding.field ?? binding.tablePart;
                if (field === undefined || (binding.field !== undefined && binding.tablePart !== undefined)) {
                    addProblem('override должен назвать ровно одно поле или табличную часть');
                    continue;
                }
                const exists = binding.tablePart !== undefined
                    ? state.tableParts.some((part) => part.name === field)
                    : state.fields.some((candidate) => candidate.name === field);
                if (!exists) addProblem(`нет ${binding.tablePart !== undefined ? 'табличной части' : 'поля'} «${field}»`);
                overrides.push({ kind: 'input', field, element: definition.name });
                continue;
            }
            const binding = attachment.insert;
            if (binding === undefined) continue;
            const groups = overrides.flatMap((override, index) => override.kind === 'group' && override.title === binding.group ? [index] : []);
            if (groups.length !== 1) {
                addProblem(`группа «${binding.group}» должна существовать и иметь единственное объявление`);
                continue;
            }
            const index = groups[0]!;
            const group = overrides[index];
            if (group?.kind !== 'group') continue;
            const anchor = binding.after === undefined ? -1 : group.fields.indexOf(binding.after);
            if (binding.after !== undefined && anchor < 0) {
                addProblem(`в группе «${binding.group}» нет места «${binding.after}»`);
                continue;
            }
            const key = `${index}/${binding.after ?? ''}`;
            const count = insertedAfter.get(key) ?? 0;
            const fields = [...group.fields];
            fields.splice(anchor + 1 + count, 0, { element: definition.name });
            insertedAfter.set(key, count + 1);
            overrides[index] = { ...group, fields };
        }
    }
    return { ...state, form: state.form === null && overrides.length === 0 ? null : overrides };
}
