/**
 * Simple toast notification system
 * Shows error/success messages to the user
 */

type ToastType = 'error' | 'success' | 'info'

interface ToastOptions {
  type: ToastType
  message: string
  duration?: number
}

export function showToast({ type, message, duration = 3000 }: ToastOptions) {
  // Remove existing toast if any
  const existing = document.getElementById('app-toast')
  if (existing) existing.remove()

  // Create toast element
  const toast = document.createElement('div')
  toast.id = 'app-toast'
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-family: monospace;
    z-index: 9999;
    animation: slideIn 0.3s ease-out;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `

  // Style based on type
  const styles = {
    error: 'background: #dc2626; color: white; border: 1px solid #991b1b;',
    success: 'background: #16a34a; color: white; border: 1px solid #15803d;',
    info: 'background: #3b82f6; color: white; border: 1px solid #1d4ed8;',
  }
  toast.style.cssText += styles[type]
  toast.textContent = message

  // Add animation
  const style = document.createElement('style')
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(400px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
  `
  document.head.appendChild(style)

  document.body.appendChild(toast)

  // Auto remove
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out'
    setTimeout(() => toast.remove(), 300)
  }, duration)
}
