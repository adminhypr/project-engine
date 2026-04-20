import '@testing-library/jest-dom'

// jsdom 29 + vitest 4 currently exposes a non-functional Storage stub on the
// window — `localStorage.clear is not a function` under the default setup.
// Install a minimal in-memory Storage shim when the native one is broken.
function installStorageShim() {
  function make() {
    const store = new Map()
    return {
      get length() { return store.size },
      key(i) { return [...store.keys()][i] ?? null },
      getItem(k) { return store.has(k) ? store.get(k) : null },
      setItem(k, v) { store.set(k, String(v)) },
      removeItem(k) { store.delete(k) },
      clear() { store.clear() },
    }
  }
  for (const name of ['localStorage', 'sessionStorage']) {
    const native = globalThis[name]
    if (!native || typeof native.clear !== 'function') {
      Object.defineProperty(globalThis, name, { configurable: true, value: make() })
    }
  }
}
installStorageShim()
