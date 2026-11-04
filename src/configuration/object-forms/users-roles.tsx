import { PlatformObjects } from '../../web/sdk';
/** Выбор ролей использует стандартную табличную часть и заменяет только ввод её колонки. */
import { Select } from 'antd';
import { useImperativeHandle, useRef, type ComponentRef } from 'react';
import { TablePart, useFunctionResult, useFormData } from '../../web/sdk';
import type { InputProperties } from '../../web/sdk';

function RoleInput({ value, onChange, disabled, id, ref }: InputProperties<unknown>) {
    const control = useRef<ComponentRef<typeof Select>>(null);
    useImperativeHandle(ref, () => ({ focus: () => control.current?.focus() }));
    const data = useFormData();
    const allowed = data.object.functions.some(declared => declared.name === 'roleOptions');
    const options = useFunctionResult({ object: PlatformObjects.catalog.users, name: 'roleOptions', payload: {}, enabled: allowed });
    return <Select ref={control} {...(id === undefined ? {} : { id })} value={typeof value === 'string' ? value : undefined} disabled={disabled || !allowed} showSearch={{ optionFilterProp: 'label' }} options={(Array.isArray(options.data) ? options.data : []).map(role => ({ value: role.name, label: role.title }))} onChange={value => onChange?.(value ?? null)} />;
}

export function UserRolesInput() {
    const data = useFormData();
    const part = data.view.tableParts.find(part => part.name === 'roles');
    if (part === undefined || part.access === 'deny') return null;
    return <TablePart part={part} disabled={data.readOnly || part.access !== 'edit'} columnInputs={{ role: RoleInput }} />;
}
