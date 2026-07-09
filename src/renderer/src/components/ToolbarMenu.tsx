import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Toolbar dropdown that renders into document.body as position:fixed, so it
 * floats above every pane and never clips inside scroll containers.
 * Clamped to the window edges; flips above the trigger when out of room.
 */
export function ToolbarMenu(props: {
  title: string
  trigger: React.ReactNode
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current || !menuRef.current) return
    const btn = btnRef.current.getBoundingClientRect()
    const menu = menuRef.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(btn.left, window.innerWidth - menu.width - 8))
    let top = btn.bottom + 6
    if (top + menu.height > window.innerHeight - 8) top = Math.max(8, btn.top - menu.height - 6)
    setPos({ top, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !btnRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={props.title}
        aria-label={props.title}
        aria-expanded={open}
        className={`${props.className ?? ''} ${open ? 'is-active' : ''}`}
        onClick={() => {
          setPos(null)
          setOpen((value) => !value)
        }}
      >
        {props.trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="toolbar-menu"
            role="menu"
            style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('button')) setOpen(false)
            }}
          >
            {props.children}
          </div>,
          document.body
        )}
    </>
  )
}
