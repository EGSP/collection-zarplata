import { Form } from 'antd';
import { useLayoutEffect, useRef } from 'react';
import { computeFields } from '../../common/formulas';
import type { FormView } from '../../server/ui/descriptions';

/** Пересчитывает формулы при пользовательском вводе и при изменении строк через SDK. */
export function ComputedValues({ view, saved }: { readonly view: Pick<FormView, 'fields' | 'tableParts'>; readonly saved?: Readonly<Record<string, unknown>> | null }) {
    const form = Form.useFormInstance();
    const watched = Form.useWatch((values) => values, { form, preserve: true });
    const failedPaths = useRef<Array<Array<string | number>>>([]);
    useLayoutEffect(() => {
        const current = { ...saved, ...form.getFieldsValue(true) };
        let paths: Array<Array<string | number>> = [];
        try {
            for (const part of view.tableParts) {
                const rows = current[part.name];
                if (Array.isArray(rows)) current[part.name] = rows.map((row, index) => {
                    paths = part.columns.filter((field) => field.computed).map((field) => [part.name, index, field.name]);
                    return computeFields(part.columns, row);
                });
            }
            paths = view.fields.filter((field) => field.computed).map((field) => [field.name]);
            const next = computeFields(view.fields, current);
            if (JSON.stringify(next) !== JSON.stringify(current) || view.tableParts.some((part) => JSON.stringify(next[part.name]) !== JSON.stringify(form.getFieldValue(part.name)))) form.setFieldsValue(next);
            if (failedPaths.current.length > 0) form.setFields(failedPaths.current.map((name) => ({ name, errors: [] })));
            failedPaths.current = [];
        } catch (cause) {
            // Форма показывает причину сразу; окончательную проверку результата выполняет сервер.
            if (failedPaths.current.length > 0) form.setFields(failedPaths.current.map((name) => ({ name, errors: [] })));
            failedPaths.current = paths;
            form.setFields(paths.map((name) => ({ name, errors: [String(cause)] })));
        }
    }, [form, watched, view, saved]);
    return null;
}
