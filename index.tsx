import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app';
import { bootstrapReaderSettings } from './lib/readerSettings';
import 'ranui/typings';
import './styles/base.css';

bootstrapReaderSettings();

const container = document.getElementById('app')!;

const root = createRoot(container);

root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
