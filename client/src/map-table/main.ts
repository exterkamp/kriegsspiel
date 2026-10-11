import { TableScene } from '../table/FixtureTableScene.js';
import { mountMapTable } from './page.js';
import './style.css';

mountMapTable(
  document,
  (canvas, onPreviewUnavailable) =>
    new TableScene(canvas, { mode: 'public-map-preview', onPreviewUnavailable }),
);
