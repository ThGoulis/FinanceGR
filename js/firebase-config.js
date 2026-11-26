/**
 * FinanceGR Firebase Client Configuration
 */
const firebaseConfig = {
  apiKey: "AIzaSyDdtZdy1pW9sH2e5ACo7p0cTyM4e7VRP7Q",
  authDomain: "financegr-sync.firebaseapp.com",
  databaseURL: "https://financegr-sync-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "financegr-sync",
  storageBucket: "financegr-sync.firebasestorage.app",
  messagingSenderId: "990499110013",
  appId: "1:990499110013:web:6599c94ec8c67059a78514"
};

window.FINANCEGR_FIREBASE_CONFIG = {
  ...firebaseConfig,
  functionsBaseUrl: "https://europe-west1-financegr-sync.cloudfunctions.net"
};
