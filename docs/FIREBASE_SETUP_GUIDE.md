# Οδηγός Ρύθμισης Firebase Auth + Cloud Functions (FinanceGR)

## Βήμα 1 — Αναβάθμιση σε Blaze & Προστασία Κόστους (€0/μήνα για προσωπική χρήση)
1. Στο **Firebase Console** (`financegr-sync`), πήγαινε κάτω αριστερά στο **Upgrade → Blaze (Pay as you go)**.
2. Στο **Google Cloud Console → Billing → Budgets & Alerts**, φτιάξε ένα Budget Alert στο **€1** (email ειδοποίηση).
3. Στο **Artifact Registry** (Google Cloud Console), ενεργοποίησε Cleanup Policy για το repository των Cloud Functions ώστε να κρατά μόνο το τελευταίο container image (για να μένεις κάτω από τα 0,5 GB free tier).

## Βήμα 2 — Ενεργοποίηση Firebase Authentication
1. Στο Firebase Console → **Build → Authentication → Get started**.
2. Στην καρτέλα **Sign-in method**, ενεργοποίησε:
   - **Google** (βάλε το email σου ως support email)
   - **Email/Password** (προαιρετικά)
3. Στην καρτέλα **Settings → Authorized domains**, πρόσθεσε: `thgoulis.github.io` (το `localhost` υπάρχει ήδη).
4. Πήγαινε **Project Settings (⚙️) → Your apps → Add app → Web (`</>`)**, αντέγραψε τα `apiKey` και `appId` και βάλε τα στο `js/firebase-config.js`.

## Βήμα 3 — Deploy Cloud Functions (Admin SDK)
Από PowerShell / Terminal στον φάκελο του project (απαιτεί Node.js 22 και `npm i -g firebase-tools`):
### Ρύθμιση Email Διαχειριστή (χωρίς hardcoding στον κώδικα)
Πριν τρέξεις `firebase deploy --only functions`, φτιάξε το αρχείο `functions/.env` (αντιγράφοντας το `functions/.env.example`, και βεβαιώσου ότι το `.env` είναι στο `.gitignore`) με το δικό σου Google email:
```env
FINANCEGR_ADMIN_EMAILS=your-email@gmail.com
```

```bash
firebase login
cd functions
npm install
cd ..
firebase deploy --only functions
```
Τα 3 functions (`createRoom`, `manageMember`, `listMyRooms`) ανεβαίνουν στο `europe-west1` με όριο `maxInstances: 2`.

## Βήμα 4 — Μετάβαση (Migration) & Ενεργοποίηση Αυστηρών Rules
Επειδή χρησιμοποιείς την εφαρμογή μόνο εσύ προς το παρόν, η μετάβαση γίνεται σε 30 δευτερόλεπτα:
1. Κάνε **Ρυθμίσεις → ⬇️ Εξαγωγή JSON** (τοπικό backup ασφαλείας).
2. Ανέβασε το νέο πακέτο στο GitHub Pages και κάνε **Hard Refresh (`Ctrl + Shift + R`)**.
3. Κάνε deploy τους αυστηρούς κανόνες βάσης:
```bash
firebase deploy --only database
```
4. Άνοιξε το FinanceGR → **☁️ Cloud Sync** → **🔑 Σύνδεση με Google** → πάτησε **🎲 Νέος**, βάλε το PIN σου (6+ χαρ.) και πάτησε **🔗 Σύνδεση & Συγχρονισμός Τώρα**.
5. Η Cloud Function `createRoom` σε ορίζει αυτόματα **Owner** και ανεβάζει όλα τα τοπικά σου δεδομένα κρυπτογραφημένα (AES-256-GCM) στο νέο προστατευμένο room!
