/* ============================================================
   Firestore sync.

   Loads as a module, so it runs after app.js has rendered from
   local storage. The rota then arrives from the cloud and
   replaces it.

   The collection and document are created automatically on first
   run — Firestore has no schema to set up in advance.

   Firestore cannot store an array inside an array, so a slot like
   ["D-401","D-404"] is written as the string "D-401+D-404" and
   split again on the way back. That also keeps the document
   readable in the Firebase console.
   ============================================================ */

import { initializeApp }
  from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const SCHEMA = 1;

function status(text, tone, hint){
  window.dispatchEvent(new CustomEvent("rota:status", { detail:{ text, tone, hint } }));
}

/* Turn a Firestore error into something you can act on. */
function explain(err){
  const code = (err && err.code) || "";
  const msg  = String((err && err.message) || err);

  if(code === "permission-denied"){
    return ["Rules blocked", "Firestore refused the request. Paste firestore.rules into the console Rules tab and Publish."];
  }
  if(code === "not-found" || /database .*does not exist|NOT_FOUND/i.test(msg)){
    return ["No database", "The Firestore database has not been created. Firebase console > Firestore Database > Create database."];
  }
  if(code === "unavailable" || /offline|network/i.test(msg)){
    return ["Offline", "Cannot reach Firestore. Changes are saved locally and will sync when the connection returns."];
  }
  if(code === "invalid-argument" || /project/i.test(msg)){
    return ["Wrong project", "Check projectId in js/firebase-config.js matches your Firebase project."];
  }
  return ["Sync failed", msg];
}

function report(err, where){
  const [text, hint] = explain(err);
  console.error("[sync] " + where + ":", err);
  console.error("[sync] " + hint);
  status(text, "bad", hint);
}

/* ---------- shape conversion ---------- */

function encode(state){
  const schedule = {};
  Object.keys(state.schedule).forEach(day => {
    schedule[day] = state.schedule[day].map(slot => slot.join("+"));
  });
  return {
    schemaVersion: SCHEMA,
    schedule,
    vacant: state.vacant.slice(),
    donations: Object.assign({}, state.donations),
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now()
  };
}

function decode(data){
  const schedule = {};
  Object.keys(data.schedule || {}).forEach(day => {
    schedule[day] = (data.schedule[day] || []).map(s => s.split("+"));
  });
  return {
    schedule,
    vacant: (data.vacant || []).slice(),
    donations: Object.assign({}, data.donations || {})
  };
}

/* ---------- connect ---------- */

const cfg = window.FIREBASE_CONFIG;

if(!cfg || !cfg.projectId || String(cfg.apiKey).startsWith("YOUR_")){
  status("Local only", "warn");
  console.info("[sync] No Firebase config found. Running on local storage alone.");
} else {
  try {
    const db = getFirestore(initializeApp(cfg));
    const path = window.FIREBASE_PATH || { collection:"rota", document:"current" };
    const ref = doc(db, path.collection, path.document);

    status("Connecting", "wait");

    // Create the document on first run, seeded with whatever this device holds.
    getDoc(ref).then(snap => {
      if(!snap.exists()){
        const seed = window.RotaApp ? window.RotaApp.getState() : null;
        if(seed){
          return setDoc(ref, encode(seed)).then(() => {
            console.info("[sync] Created rota/current and seeded it with the starting rota.");
          });
        }
      }
    }).catch(err => report(err, "Could not read the rota"));

    // Live updates, including this device's own writes coming back confirmed.
    onSnapshot(ref,
      snap => {
        if(!snap.exists()) return;
        if(snap.metadata.hasPendingWrites){
          status("Saving", "wait");
          return;
        }
        const data = snap.data();
        if(window.RotaApp) window.RotaApp.applyRemote(decode(data), data.updatedAtMs);
        status(snap.metadata.fromCache ? "Offline" : "Live",
               snap.metadata.fromCache ? "warn" : "ok");
      },
      err => report(err, "Live updates stopped")
    );

    // app.js calls this after every change.
    window.RotaSync = {
      ready: true,
      push(state){
        return setDoc(ref, encode(state)).catch(err => report(err, "Could not save"));
      }
    };

    window.addEventListener("offline", () => status("Offline", "warn"));

  } catch (err) {
    console.error("[sync] Firebase failed to start:", err);
    status("Local only", "warn", "Firebase could not start. Check js/firebase-config.js.");
  }
}