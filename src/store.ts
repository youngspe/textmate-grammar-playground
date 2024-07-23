export interface Store extends Record<(
    | 'code' | 'grammar' | 'theme'
    | 'langPreset' | 'themePreset'
), string | null> { }

export function storageObject<P extends string>(storage: Storage, keys: Record<P, string>): Record<P, string | null> {
    const out: Partial<Record<P, string | null>> = {}
    for (const prop in keys) {
        const key = keys[prop]
        Object.defineProperty(out, prop, {
            get() {
                return storage.getItem(key)
            },
            set(value: string | null) {
                if (value == null) {
                    storage.removeItem(key)
                } else {
                    storage.setItem(key, value)
                }
            },
        })
    }
    return out as Record<P, string | null>
}
