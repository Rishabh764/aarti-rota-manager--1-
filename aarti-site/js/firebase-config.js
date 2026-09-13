// Firebase project configuration.
//
// These values are public by design — they identify the project, they do not
// authorise anything. Security comes from the Firestore rules, not from hiding
// these. It is fine for this file to sit in a public GitHub repo.
//
// To point the site at a different project, replace the object below with the
// one from Firebase console > Project settings > General > Your apps > Config.

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBBYJ6Pqf-I9n2jJgPaq5AuZbgLQTcjkk0",
  authDomain: "aarti-schedule.firebaseapp.com",
  projectId: "aarti-schedule",
  storageBucket: "aarti-schedule.firebasestorage.app",
  messagingSenderId: "615510469257",
  appId: "1:615510469257:web:d0aa0f5c0c3e7b6f01f458"
};

// Where the rota lives in Firestore. Both are created automatically on first run.
window.FIREBASE_PATH = { collection: "rota", document: "current" };
