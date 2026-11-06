import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bricolage-grotesque'
import '@fontsource/patrick-hand'
import '@fontsource/jetbrains-mono/400.css'
import '@xyflow/react/dist/style.css'
import './styles.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(<App />)
