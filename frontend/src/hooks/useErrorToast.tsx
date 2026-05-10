// This file exists for backward compatibility.
// The actual implementation is in src/components/ErrorToast.tsx
import { useState, useCallback } from 'react'

export interface Toast {
  id: number
  message: string
  status?: number
  type: 'error' | 'warning' | 'info'
}

let _id = 0

// Stub exports so existing imports don't break
export function useToasts(): Toast[] { return [] }
export function removeToast(_id: number): void {}

export default function useErrorToast() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const add = useCallback((message: string, status?: number, type: Toast['type'] = 'error') => {
    const id = ++_id
    setToasts((prev) => [...prev.slice(-3), { id, message, status, type }])
    setTimeout(() => remove(id), 6000)
  }, [remove])

  return { toasts, add, remove }
}
