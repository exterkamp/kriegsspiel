import { greeting } from './greeting.js';

const app = document.getElementById('app');
if (app) app.textContent = greeting();
