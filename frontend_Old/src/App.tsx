import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/Layout'
import { useStore } from './store'
import Setup from './pages/Setup'
import Ideas from './pages/Ideas'
import Script from './pages/Script'
import SceneEditor from './pages/SceneEditor'
import VoiceVisuals from './pages/VoiceVisuals'
import Export from './pages/Export'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

function Pages() {
  const currentStep = useStore((s) => s.currentStep)

  return (
    <Layout>
      {currentStep === 'setup'  && <Setup />}
      {currentStep === 'ideas'  && <Ideas />}
      {currentStep === 'script' && <Script />}
      {currentStep === 'scenes' && <SceneEditor />}
      {currentStep === 'voice'  && <VoiceVisuals />}
      {currentStep === 'export' && <Export />}
    </Layout>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Pages />
    </QueryClientProvider>
  )
}
