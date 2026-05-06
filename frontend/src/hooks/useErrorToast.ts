/**
 * frontend/src/hooks/useErrorToast.ts
 * Global error toast system — shows a dismissible toast for API errors.
 * Usage: const { showError, showSuccess } = useErrorToast()
 */
import { useState, useCallback, useEffect } from 'react'

export interface Toast {
  id: string
  type: 'error' | 'success' | 'warning' | 'info'
  title: string
  message?: string
  duration?: number  // ms, default 5000, 0 = persistent
}

// Global toast store (simple singleton — no extra library needed)
let _listeners: Array<(toasts: Toast[]) => void> = []
let _toasts: Toast[] = []

function emit() {
  _listeners.forEach(fn => fn([..._toasts]))
}

export function addToast(toast: Omit<Toast, 'id'>) {
  const id = Math.random().toString(36).slice(2)
  _toasts = [{ ...toast, id }, ..._toasts].slice(0, 5)  // max 5 toasts
  emit()
  const duration = toast.duration ?? 5000
  if (duration > 0) {
    setTimeout(() => removeToast(id), duration)
  }
  return id
}

export function removeToast(id: string) {
  _toasts = _toasts.filter(t => t.id !== id)
  emit()
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>(_toasts)
  useEffect(() => {
    _listeners.push(setToasts)
    return () => { _listeners = _listeners.filter(fn => fn !== setToasts) }
  }, [])
  return toasts
}

// Convenience helpers
export function showError(title: string, message?: string) {
  return addToast({ type: 'error', title, message, duration: 7000 })
}
export function showSuccess(title: string, message?: string) {
  return addToast({ type: 'success', title, message, duration: 4000 })
}
export function showWarning(title: string, message?: string) {
  return addToast({ type: 'warning', title, message, duration: 6000 })
}
export function showInfo(title: string, message?: string) {
  return addToast({ type: 'info', title, message, duration: 4000 })
}

export function useErrorToast() {
  const showErr = useCallback((title: string, message?: string) => showError(title, message), [])
  const showSuc = useCallback((title: string, message?: string) => showSuccess(title, message), [])
  return { showError: showErr, showSuccess: showSuc, showWarning, showInfo }
}
