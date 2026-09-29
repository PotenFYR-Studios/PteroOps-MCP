import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import Home from './pages/Home';
import DocsIndex from './pages/DocsIndex';
import DocPage from './pages/DocPage';
import Examples from './pages/Examples';
import Status from './pages/Status';
import About from './pages/About';
import License from './pages/License';
import './index.css';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={base || undefined}>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Home />} />
          <Route path="docs" element={<DocsIndex />} />
          <Route path="docs/:slug" element={<DocPage />} />
          <Route path="examples" element={<Examples />} />
          <Route path="status" element={<Status />} />
          <Route path="about" element={<About />} />
          <Route path="license" element={<License />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
