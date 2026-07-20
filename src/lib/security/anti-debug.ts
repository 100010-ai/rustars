/**
 * Anti-Debug — multi-layer protection against DevTools inspection.
 *
 * Layers:
 *   1. Keyboard shortcut blocking (F12, Ctrl+Shift+I/J/C, Cmd+Option+I)
 *   2. Right-click context menu blocking
 *   3. Console method override (log, warn, error, info, debug, table)
 *   4. Debugger detection via timing
 *   5. DevTools open detection via element size trick
 *   6. Source code protection (toString() override)
 *   7. Window properties freezing
 */

const isDev = process.env.NODE_ENV === 'development';

// ═══════════════════════════════════════════════════════════
// 1. KEYBOARD SHORTCUT BLOCKING
// ═══════════════════════════════════════════════════════════

function blockKeyboardShortcuts(): void {
  if (typeof document === 'undefined') return;

  document.addEventListener('keydown', (e) => {
    // F12
    if (e.key === 'F12' || e.keyCode === 123) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+Shift+I (DevTools)
    if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.keyCode === 73)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+Shift+J (Console)
    if (e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j' || e.keyCode === 74)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+Shift+C (Element Inspector)
    if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c' || e.keyCode === 67)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+U (View Source)
    if (e.ctrlKey && (e.key === 'U' || e.key === 'u' || e.keyCode === 85)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Cmd+Option+I (macOS DevTools)
    if (e.metaKey && e.altKey && (e.key === 'I' || e.key === 'i')) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Cmd+Option+J (macOS Console)
    if (e.metaKey && e.altKey && (e.key === 'J' || e.key === 'j')) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Cmd+Option+U (macOS View Source)
    if (e.metaKey && e.altKey && (e.key === 'U' || e.key === 'u')) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // F11 (Fullscreen toggle)
    if (e.key === 'F11' || e.keyCode === 122) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+F5 / Cmd+R (hard reload that might bypass)
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
      // Allow normal reload but not hard refresh
    }
  }, true);
}

// ═══════════════════════════════════════════════════════════
// 2. RIGHT-CLICK BLOCKING
// ═══════════════════════════════════════════════════════════

function blockContextMenu(): void {
  if (typeof document === 'undefined') return;

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }, true);
}

// ═══════════════════════════════════════════════════════════
// 3. CONSOLE OVERRIDE
// ═══════════════════════════════════════════════════════════

function overrideConsole(): void {
  if (typeof window === 'undefined' || isDev) return;

  const noop = () => {};
  const fakeObj = () => ({} as any);

  // Override all console methods
  const methods: Array<keyof Console> = [
    'log', 'warn', 'error', 'info', 'debug', 'trace',
    'dir', 'dirxml', 'table', 'group', 'groupCollapsed', 'groupEnd',
    'count', 'countReset', 'time', 'timeEnd', 'timeLog',
    'clear', 'profile', 'profileEnd', 'assert',
  ];

  for (const method of methods) {
    try {
      (console as any)[method] = noop;
    } catch {}
  }

  // Keep error for critical crashes only (but make it useless)
  console.error = noop;
  console.warn = noop;
}

// ═══════════════════════════════════════════════════════════
// 4. DEBUGGER DETECTION (Timing-based)
// ═══════════════════════════════════════════════════════════

function startDebuggerDetection(): void {
  if (typeof window === 'undefined' || isDev) return;

  const threshold = 100; // ms

  // Method 1: setInterval timing
  setInterval(() => {
    const start = performance.now();
    debugger; // eslint-disable-line
    const end = performance.now();
    if (end - start > threshold) {
      // DevTools is open with debugger — redirect or disable
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;font-size:24px;color:#333;">Доступ ограничен</div>';
      window.location.href = 'about:blank';
    }
  }, 500);

  // Method 2: console.table timing (console.log with object)
  const element = document.createElement('div');
  Object.defineProperty(element, 'id', {
    get() {
      // When DevTools reads element.id, it takes time
      const start = performance.now();
      while (performance.now() - start < 100) {}
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;font-size:24px;color:#333;">Доступ ограничен</div>';
      window.location.href = 'about:blank';
      return '';
    },
  });
  setInterval(() => {
    console.log(element); // Triggers the getter
  }, 1000);
}

// ═══════════════════════════════════════════════════════════
// 5. SOURCE CODE PROTECTION
// ═══════════════════════════════════════════════════════════

function protectSourceCode(): void {
  if (typeof window === 'undefined' || isDev) return;

  // Override toString() for functions
  const originalFunction = Function.prototype.toString;
  const customToString = function(this: Function): string {
    if (this === Function.prototype.toString) {
      return 'function toString() { [native code] }';
    }
    return originalFunction.call(this);
  };

  try {
    Function.prototype.toString = customToString as any;
  } catch {}

  // Prevent eval
  try {
    window.eval = (() => {
      throw new Error('Eval is not allowed');
    }) as any;
  } catch {}

  // Override new Function
  try {
    (window as any).Function = (() => {
      throw new Error('Dynamic function creation is not allowed');
    }) as any;
  } catch {}
}

// ═══════════════════════════════════════════════════════════
// 6. WINDOW PROPERTIES FREEZING
// ═══════════════════════════════════════════════════════════

function freezeWindowProperties(): void {
  if (typeof window === 'undefined' || isDev) return;

  // Prevent console access via window.console
  try {
    Object.defineProperty(window, 'console', {
      value: new Proxy({} as Console, {
        get: () => (() => {}),
        set: () => false,
      }),
      writable: false,
      configurable: false,
    });
  } catch {}

  // Prevent __proto__ access
  try {
    Object.defineProperty(Object.prototype, '__proto__', {
      get() {
        return null;
      },
      set() {},
      configurable: false,
    });
  } catch {}

  // Prevent debuggers
  try {
    Object.defineProperty(window, 'debugger', {
      get: () => { throw new Error('Debugger access denied'); },
      configurable: false,
    });
  } catch {}
}

// ═══════════════════════════════════════════════════════════
// 7. DRAG & DROP PROTECTION (prevent saving images/text)
// ═══════════════════════════════════════════════════════════

function blockDragAndDrop(): void {
  if (typeof document === 'undefined') return;

  document.addEventListener('dragstart', (e) => {
    e.preventDefault();
    return false;
  }, true);

  document.addEventListener('selectstart', (e) => {
    const target = e.target as HTMLElement;
    // Allow text selection in inputs/textareas
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
      return true;
    }
    e.preventDefault();
    return false;
  }, true);
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

export function initAntiDebug(): void {
  if (typeof window === 'undefined' || isDev) return;

  // Check if already initialized
  if ((window as any).__antiDebug) return;
  (window as any).__antiDebug = true;

  blockKeyboardShortcuts();
  blockContextMenu();
  overrideConsole();
  protectSourceCode();
  blockDragAndDrop();

  // Delay debugger detection to avoid issues with Next.js hydration
  setTimeout(() => {
    startDebuggerDetection();
    freezeWindowProperties();
  }, 2000);
}
