import { theme } from 'antd';
import type { CSSProperties } from 'react';
import { FieldDisplay, Text } from '../../web/sdk';
import type { BreakdownEntry } from '../summary-breakdown';
import './summary-breakdown-list.css';

/** Сумма в том же денежном формате, что и в документах. */
export function Money({ value }: { readonly value: number }) {
    return <FieldDisplay field={{ kind: 'money', target: null }} value={value} />;
}

/** Строки списка ставят приёмник рядом с суммой. На узком месте сумма переносится целиком. */
function BreakdownItems({ entries }: { readonly entries: ReadonlyArray<BreakdownEntry> }) {
    return entries.map(({ kind, name, amount, group }) => (
        <li key={JSON.stringify([kind, name, group])} className="summary-breakdown-item">
            <span className="summary-breakdown-name"><Text.Label>{name}</Text.Label></span>
            <span className="summary-breakdown-amount">
                <Text.Label noWrap>{amount > 0 && '+'}<Money value={amount} /></Text.Label>
            </span>
        </li>
    ));
}

/** Общий вид расшифровки в таблицах и итогах «Кассы» и «Периода». */
export function SummaryBreakdownList({ entries, inTable = false, grouped = true }: {
    readonly entries: ReadonlyArray<BreakdownEntry>;
    readonly inTable?: boolean;
    readonly grouped?: boolean;
}) {
    const { token } = theme.useToken();
    if (entries.length === 0) return null;
    const groups = [
        { key: 'ownInstallment', title: 'Взносы по собственной рассрочке' },
        { key: 'bankInstallment', title: 'Банковская' },
    ] as const;
    const regular = grouped ? entries.filter((entry) => entry.group === undefined) : entries;
    const colors = { '--summary-breakdown-fill': token.colorFillQuaternary, '--summary-breakdown-border': token.colorBorderSecondary } as CSSProperties;
    return (
        <ul role="list" className="summary-breakdown-list" data-placement={inTable ? 'table' : 'totals'} style={colors}>
            <BreakdownItems entries={regular} />
            {grouped && groups.map(({ key, title }) => {
                const items = entries.filter((entry) => entry.group === key);
                return items.length > 0 && (
                    <li key={key} className="summary-breakdown-group">
                        <Text.Label strong>{title}</Text.Label>
                        <ul role="list" className="summary-breakdown-list"><BreakdownItems entries={items} /></ul>
                    </li>
                );
            })}
        </ul>
    );
}
