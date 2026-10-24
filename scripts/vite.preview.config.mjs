// Servidor só para QA visual do mascote: http://localhost:5199/#preview
import react from '@vitejs/plugin-react'
export default { root: 'src/renderer', plugins: [react()], server: { port: 5199 } }
