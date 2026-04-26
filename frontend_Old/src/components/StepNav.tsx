import { useStore, type AppStep } from '../store'

const STEPS: { id: AppStep; label: string }[] = [
  { id: 'setup',  label: 'Setup' },
  { id: 'ideas',  label: 'Ideas' },
  { id: 'script', label: 'Script' },
  { id: 'scenes', label: 'Scenes' },
  { id: 'voice',  label: 'Voice' },
  { id: 'export', label: 'Export' },
]

export default function StepNav() {
  const currentStep = useStore((s) => s.currentStep)
  const completedSteps = useStore((s) => s.completedSteps)
  const setStep = useStore((s) => s.setStep)

  const currentIndex = STEPS.findIndex((s) => s.id === currentStep)

  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((step, i) => {
        const isActive = step.id === currentStep
        const isDone = completedSteps.has(step.id)
        const isReachable = isDone || i <= currentIndex

        return (
          <div key={step.id} className="flex items-center flex-1">
            <button
              onClick={() => isReachable && setStep(step.id)}
              disabled={!isReachable}
              className={`
                flex flex-col items-center gap-1 w-full transition-all
                ${isReachable ? 'cursor-pointer' : 'cursor-default'}
              `}
            >
              {/* Dot */}
              <div className={`
                w-6 h-6 rounded-full border-2 flex items-center justify-center
                text-[10px] font-bold transition-all
                ${isActive
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : isDone
                  ? 'bg-teal-500/20 border-teal-500 text-teal-400'
                  : 'bg-transparent border-white/15 text-white/25'}
              `}>
                {isDone && !isActive
                  ? <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-5"/></svg>
                  : i + 1
                }
              </div>
              {/* Label */}
              <span className={`text-[10px] font-medium ${isActive ? 'text-violet-300' : isDone ? 'text-teal-400' : 'text-white/25'}`}>
                {step.label}
              </span>
            </button>

            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div className="flex-1 h-px mx-1 mb-4">
                <div className={`h-full transition-all ${isDone ? 'bg-teal-500/40' : 'bg-white/8'}`} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
