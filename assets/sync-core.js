(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.LedgerSync = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    class SyncError extends Error {
        constructor(code) { super(code); this.code = code; }
    }
    class Controller {
        constructor(adapter, validate, hooks = {}) {
            this.adapter = adapter;
            this.validate = validate;
            this.hooks = hooks;
            this.rows = new Map();
            this.generation = 0;
            this.state = { mode: 'local', user: null, ready: false, busy: false, error: null };
        }
        emit() { this.hooks.state?.({ ...this.state }); }
        start() { this.stopAuth = this.adapter.auth(user => this.useUser(user)); }
        useUser(user) {
            const generation = ++this.generation;
            this.stopWatch?.();
            this.stopWatch = null;
            this.rows.clear();
            this.state = { mode: user ? 'cloud' : 'local', user, ready: false, busy: false, error: null };
            this.emit();
            this.hooks.records?.(null);
            if (!user) return;
            let authorized = false;
            this.stopWatch = this.adapter.watch(snapshot => {
                if (generation !== this.generation) return;
                // An empty local cache is not proof that the shared ledger is empty.
                // Cached documents must never be revealed to a newly signed-in account.
                if (!snapshot.fromCache) {
                    let checked;
                    try {
                        checked = this.validate(snapshot.rows.map(row => row.record));
                        if (snapshot.rows.some(row => !Number.isSafeInteger(row.version) || row.version < 1)) throw new Error('version');
                    } catch (_) {
                        this.state.ready = false; this.state.error = 'invalid-data'; this.emit(); return;
                    }
                    this.rows = new Map(checked.map((record, i) => [record.id, { record, version: snapshot.rows[i].version }]));
                    authorized = true;
                    this.hooks.records?.(checked);
                }
                this.state.ready = authorized && !snapshot.fromCache && this.adapter.online();
                this.state.error = null;
                this.emit();
            }, error => {
                if (generation !== this.generation) return;
                this.state.ready = false;
                this.state.error = error.code || 'unavailable';
                this.emit();
            });
        }
        networkChanged() {
            if (!this.adapter.online()) this.state.ready = false;
            this.emit();
        }
        version(id) { return this.rows.get(id)?.version ?? null; }
        async signIn() { return this.adapter.signIn(); }
        async signOut() {
            if (this.state.busy) throw new SyncError('busy');
            this.state.ready = false; this.emit();
            try { await this.adapter.signOut(); }
            catch (error) { this.state.error = error.code || 'unavailable'; this.emit(); throw error; }
        }
        async mutate(action) {
            if (this.state.mode !== 'cloud' || !this.state.ready || !this.adapter.online()) throw new SyncError('not-ready');
            if (this.state.busy) throw new SyncError('busy');
            const generation = this.generation;
            this.state.busy = true; this.emit();
            try { return await action(this.state.user); }
            finally { if (generation === this.generation) { this.state.busy = false; this.emit(); } }
        }
        save(record, expectedVersion) {
            const [checked] = this.validate([record]);
            if (checked.isSample) throw new SyncError('sample');
            return this.mutate(user => this.adapter.save(checked, expectedVersion, user.uid));
        }
        remove(id, expectedVersion) {
            return this.mutate(user => this.adapter.remove(id, expectedVersion, user.uid));
        }
        merge(records) {
            const checked = this.validate(records).filter(record => !record.isSample);
            return this.mutate(async user => {
                const result = { created: 0, skipped: 0, conflicts: 0 };
                for (let i = 0; i < checked.length; i += 20) {
                    if (this.state.user?.uid !== user.uid) throw new SyncError('not-ready');
                    const part = await this.adapter.merge(checked.slice(i, i + 20), user.uid);
                    for (const key of Object.keys(result)) result[key] += part[key];
                }
                return result;
            });
        }
        destroy() { this.generation++; this.stopWatch?.(); this.stopAuth?.(); }
    }
    return { Controller, SyncError };
});
