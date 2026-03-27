import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyA-xHNvxMc3Dg06qoeR6uFbQcK0b3YMnqQ",
  authDomain: "netpulse-faf11.firebaseapp.com",
  projectId: "netpulse-faf11",
  storageBucket: "netpulse-faf11.firebasestorage.app",
  messagingSenderId: "140251743256",
  appId: "1:140251743256:web:d5acab932cb1385260af6d"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);
export default app;
