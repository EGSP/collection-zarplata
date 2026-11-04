/** Стандартная форма справочника с вкладкой сессий и окном установки PIN. */
import { Input, Tabs, Typography } from 'antd';
import { useState, useImperativeHandle, useRef, type ComponentRef } from 'react';
import { ActionDialog, Button, FieldGroup, FormStack, RecordFormPage, recordFormElements, useRecordForm,
    type NewFormProperties, type RecordFormProperties } from '../../web/sdk';
import type { InputProperties } from '../../web/sdk';
import { UserSessions } from './user-sessions';
import { UserRolesInput } from './users-roles';

/** Маскируется только ввод; окно по-прежнему проверяет схему и показывает ошибки платформы. */
function PinInput({ value, onChange, disabled, id, ref }: InputProperties<unknown>) {
    const control = useRef<ComponentRef<typeof Input.Password>>(null);
    useImperativeHandle(ref, () => ({ focus: () => control.current?.focus() }));
    return <Input.Password ref={control} id={id} value={typeof value === 'string' ? value : ''} onChange={event => onChange?.(event.target.value)} disabled={disabled ?? false} autoComplete="new-password" inputMode="numeric" />;
}

export default function UsersForm(properties: NewFormProperties | RecordFormProperties) {
    const state = useRecordForm(properties);
    const [pinOpen, setPinOpen] = useState(false);
    const setPin = state.view.actions.find(action => action.name === 'setPin');
    const sessionsAllowed = state.object.functions.some(declared => declared.name === 'sessions');
    // Вкладки меняют только раскладку. Значения, запись, ошибки, клавиши и закрытие ведёт стандартный хук.
    return <RecordFormPage state={state}>
        <Tabs items={[{
            key: 'account', label: 'Данные пользователя', forceRender: true,
            children: <FormStack>
                <FieldGroup elements={recordFormElements(state, ['name', 'disabledAt'])} record={state.record} disabled={!state.editable} traversal={state.traversal} />
                <UserRolesInput />
                {setPin !== undefined && <Button disabled={state.record === null || state.running !== null} onClick={() => setPinOpen(true)}>Установить PIN</Button>}
                {state.record === null && <Typography.Text type="secondary">Запишите пользователя, затем установите PIN для входа.</Typography.Text>}
                <Typography.Text type="secondary">Дата «Отключён с» запрещает вход и завершает действующие сессии. Очистка даты включает учётную запись.</Typography.Text>
            </FormStack>,
        }, ...(state.record === null || !sessionsAllowed ? [] : [{
            key: 'sessions', label: 'Сессии',
            children: <UserSessions userGuid={String(state.record['guid'])} canWrite={state.view.actions.some(action => action.name === 'revokeSession')} />,
        }])]} />
        {pinOpen && setPin !== undefined && <ActionDialog action={{ ...setPin, input: setPin.input.filter(field => field.name !== 'guid') }} fieldInputs={{ pin: PinInput }} onClose={() => setPinOpen(false)} onExecute={async input => {
            await state.run(setPin, saved => ({ ...input, guid: saved['guid'] }));
        }} />}
    </RecordFormPage>;
}
