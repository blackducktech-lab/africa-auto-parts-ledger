import { collection, doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';

const fields = ['type', 'currency', 'categoryId', 'date', 'note'];
const toData = record => ({ ...Object.fromEntries(fields.map(key => [key, record[key]])), amountMinor: Math.round(record.amount * 100) });
const fromDoc = snapshot => {
    const data = snapshot.data();
    return { version: data.version, record: { id: snapshot.id, ...Object.fromEntries(fields.map(key => [key, data[key]])), amount: data.amountMinor / 100, isSample: false } };
};
const conflict = () => Object.assign(new Error('conflict'), { code: 'conflict' });

export function createRecordStore(db, currentUid) {
    const entries = collection(db, 'entries');
    const checkUser = uid => { if (currentUid() !== uid) throw conflict(); };
    const create = (record, uid) => ({ ...toData(record), deleted: false, version: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: uid });
    return {
        watch: (next, error) => onSnapshot(entries, { includeMetadataChanges: true }, snapshot => {
            next({ fromCache: snapshot.metadata.fromCache, rows: snapshot.docs.filter(row => row.data().deleted !== true).map(fromDoc) });
        }, error),
        save: (record, expectedVersion, uid) => runTransaction(db, async transaction => {
            checkUser(uid);
            const ref = doc(entries, record.id);
            const current = await transaction.get(ref);
            if (expectedVersion === null) {
                if (current.exists()) throw conflict();
                transaction.set(ref, create(record, uid));
            } else {
                if (!current.exists() || current.data().deleted || current.data().version !== expectedVersion) throw conflict();
                transaction.update(ref, { ...toData(record), version: expectedVersion + 1, updatedAt: serverTimestamp(), updatedBy: uid });
            }
        }, { maxAttempts: 3 }),
        remove: (id, expectedVersion, uid) => runTransaction(db, async transaction => {
            checkUser(uid);
            const ref = doc(entries, id);
            const current = await transaction.get(ref);
            if (expectedVersion === null || !current.exists() || current.data().deleted || current.data().version !== expectedVersion) throw conflict();
            // Keep a deletion marker so importing an old phone backup cannot resurrect this record.
            transaction.update(ref, { deleted: true, version: expectedVersion + 1, updatedAt: serverTimestamp(), updatedBy: uid });
        }, { maxAttempts: 3 }),
        merge: (records, uid) => runTransaction(db, async transaction => {
            checkUser(uid);
            const refs = records.map(record => doc(entries, record.id));
            const snapshots = [];
            for (const ref of refs) snapshots.push(await transaction.get(ref));
            const result = { created: 0, skipped: 0, conflicts: 0 };
            records.forEach((record, index) => {
                const current = snapshots[index];
                if (!current.exists()) {
                    transaction.set(refs[index], create(record, uid));
                    result.created++;
                } else {
                    const data = toData(record), existing = current.data();
                    if (!existing.deleted && Object.keys(data).every(key => data[key] === existing[key])) result.skipped++;
                    else result.conflicts++;
                }
            });
            return result;
        }, { maxAttempts: 3 })
    };
}
