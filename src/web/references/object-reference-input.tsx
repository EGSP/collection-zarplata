/** Выбор полной ссылки: сначала вид объекта конфигурации, затем запись обычным полем ссылки. */
import { Flex, Input, Select } from 'antd';
import { useState } from 'react';
import type { ObjectTarget } from '../../server/metadata/descriptions';
import { objectReference } from '../../server/metadata/references';
import { useMetadata } from '../data-provider/metadata';
import { defined, useInputHandle } from '../widgets/inputs';
import type { FieldValues, InputProperties } from '../widgets/widget';
import { ReferenceInput } from './reference-input';
import { noAccessText } from './reference-display';

/**
 * Предлагает только доступные пользователю справочники и документы.
 * Значение сохраняется полной ссылкой; смена типа очищает прежнюю запись.
 */
export function ObjectReferenceInput({ field, value, onChange, disabled, id, ref }: InputProperties<FieldValues['objectReference']>) {
    const metadata = useMetadata();
    const inner = useInputHandle(ref);
    const [selectedTarget, setSelectedTarget] = useState<ObjectTarget | null>(null);
    const target = value ?? selectedTarget;
    const objects = metadata.data?.objects.filter((object) => object.kind === 'catalog' || object.kind === 'document') ?? [];
    if (value != null && !objects.some((object) => object.kind === value.kind && object.name === value.name)) {
        return <Input ref={inner} {...defined({ id })} disabled value={noAccessText} />;
    }
    return (
        <Flex vertical gap="small">
            <Select<string>
                ref={inner}
                {...defined({ id, disabled })}
                value={target === null ? null : `${target.kind}/${target.name}`}
                placeholder="Выберите справочник или документ"
                allowClear={field.rules?.required !== true}
                options={objects.map((object) => ({ value: `${object.kind}/${object.name}`, label: object.title }))}
                onChange={(selected: string | undefined) => {
                    if (selected === undefined) setSelectedTarget(null);
                    else {
                        const [kind, name] = selected.split('/');
                        if ((kind === 'catalog' || kind === 'document') && name !== undefined) setSelectedTarget({ kind, name });
                    }
                    onChange?.(null);
                }}
            />
            {target !== null && (
                <ReferenceInput
                    field={{ ...field, kind: 'reference', target }}
                    value={value?.guid ?? null}
                    disabled={disabled}
                    onChange={(guid) => onChange?.(guid === null ? null : objectReference(target, guid))}
                />
            )}
        </Flex>
    );
}
