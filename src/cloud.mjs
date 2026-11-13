import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { createRecordStore } from './cloud-store.mjs';
import config from './firebase-config.json';

window.createCloudAdapter = function () {
    const app = initializeApp(config);
    const auth = getAuth(app);
    // Cloud records stay in memory; localStorage continues to hold only the original local ledger.
    const db = initializeFirestore(app, { localCache: memoryLocalCache() });
    return {
        ...createRecordStore(db, () => auth.currentUser?.uid),
        auth: callback => onAuthStateChanged(auth, callback),
        online: () => navigator.onLine !== false,
        signIn: () => {
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            return signInWithPopup(auth, provider);
        },
        signOut: () => signOut(auth)
    };
};
