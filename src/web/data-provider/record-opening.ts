import type { ObjectReferenceValue } from '../../server/metadata/descriptions';
import { perform, type PerformTarget } from './perform';

/** Сервер проверяет обе записи; original отключает правило, сохраняя проверку исходной. */
export function resolveRecordOpening(object: PerformTarget, guid: string, original = false): Promise<ObjectReferenceValue> {
    return perform({ target: { kind: 'platform', name: 'records' }, action: 'resolveOpening', payload: { reference: { kind: object.kind, name: object.name, guid }, original } });
}
