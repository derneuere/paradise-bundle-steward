import * as Sentry from '@sentry/browser'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

Sentry.init({
  dsn: 'https://5cb9d99c7fe94e6595e81234b326c380@errors.niaz.omg.lol/4',
  environment: import.meta.env.MODE,
})

createRoot(document.getElementById("root")!).render(<App />);
